// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Authority} from "../src/core/Authority.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";

/**
 * Regressions in the deployment itself.
 *
 * Every defect here shipped to X Layer testnet and none of them could fail in a unit test, because
 * unit tests construct contracts directly and never run the script that wires them. The script is
 * the artifact that decides who holds authority over a live protocol, so it is tested as one.
 *
 * D-01  The script granted ADMISSION to `address(this)`. Under `vm.startBroadcast` every call
 *       originates from the deployer key, so the grant authorised an address that would never act
 *       and left the deployer unable to register anything. Foundry rejects the pattern and the
 *       broadcast reverted after nine contracts were already on chain.
 *
 * D-02  A deploy key that keeps ADMISSION forever is a standing admission backdoor. The role must
 *       be surrendered by the time the script returns.
 */
contract DeploymentTest is Test {
    uint256 constant X_LAYER_TESTNET = 1952;
    uint256 constant DEPLOYER_PK = 0xA11CE;

    Deploy internal script;

    function setUp() public {
        vm.chainId(X_LAYER_TESTNET);
        script = new Deploy();
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(DEPLOYER_PK));
        vm.deal(vm.addr(DEPLOYER_PK), 100 ether);

        // `vm.setEnv` writes to the real process environment, which outlives the test that set it,
        // and forge runs tests concurrently. A value configured by one test therefore leaks into
        // every test that reads it, and the leak reads as a deployment bug rather than as test
        // pollution — a mainnet test setting a fake settlement token made three unrelated testnet
        // tests revert. Every knob the deploy script reads is normalised here, so each test starts
        // from the documented default whatever ran before it.
        vm.setEnv("USANCE_GOVERNANCE", vm.toString(vm.addr(DEPLOYER_PK)));
        vm.setEnv("USANCE_GUARDIAN", vm.toString(vm.addr(DEPLOYER_PK)));
        vm.setEnv("USANCE_SETTLEMENT_TOKEN", vm.toString(address(0)));
        vm.setEnv("USANCE_SETTLEMENT_FEED", vm.toString(address(0)));
        vm.setEnv("USANCE_SETTLEMENT_MAX_PRICE_AGE", "0");
        vm.setEnv("USANCE_SEQUENCER_FEED", vm.toString(address(0)));
    }

    /// Runs the real script and recovers what it deployed, so the assertions run against the wired
    /// system rather than against a second construction that shares none of the script's wiring.
    ///
    /// The script reports addresses through console2, which emits no retrievable event, so the
    /// contracts are found by walking CREATE trails. Both the broadcasting EOA and the script
    /// contract are walked, because which one is credited with a `new` depends on how broadcast is
    /// being interpreted, and hard-coding that assumption is how this test would quietly stop
    /// finding anything.
    function _deployAndCollect() internal returns (Authority authority, ClearingHouse clearing) {
        script.run();

        address[2] memory creators = [vm.addr(DEPLOYER_PK), address(script)];
        for (uint256 i = 0; i < creators.length; i++) {
            for (uint64 n = 0; n < 40; n++) {
                address candidate = vm.computeCreateAddress(creators[i], n);
                if (candidate.code.length == 0) continue;
                if (address(authority) == address(0) && _responds(candidate, "ADMISSION()")) {
                    authority = Authority(candidate);
                }
                if (address(clearing) == address(0) && _responds(candidate, "settlementAssetId()")) {
                    clearing = ClearingHouse(candidate);
                }
            }
        }
        require(address(authority) != address(0), "Authority not found in any CREATE trail");
    }

    /// A public constant has no `.selector`, so the signature is hashed directly. `ok` alone is not
    /// enough — a contract with a fallback answers everything — so a non-empty return is required.
    function _responds(address a, string memory sig) internal view returns (bool) {
        (bool ok, bytes memory out) = a.staticcall(abi.encodeWithSignature(sig));
        return ok && out.length >= 32;
    }

    // ------------------------------------------------------------------ D-01

    /// The script contract is ephemeral. If it holds ADMISSION when the run finishes, the role was
    /// granted to an address that cannot act and the deployer was never authorised at all.
    function test_D01_ephemeralScriptAddressHoldsNoRole() public {
        (Authority authority,) = _deployAndCollect();

        assertFalse(authority.hasRole(authority.ADMISSION(), address(script)), "script holds ADMISSION");
        assertFalse(authority.hasRole(authority.GOVERNANCE(), address(script)), "script holds GOVERNANCE");
        assertFalse(authority.hasRole(authority.GUARDIAN(), address(script)), "script holds GUARDIAN");
        assertFalse(authority.hasRole(authority.CLEARING(), address(script)), "script holds CLEARING");
    }

    /// The handover, which is the part that can actually be broken.
    ///
    /// Asserting that the deployer holds GOVERNANCE proves nothing on its own: `Authority`'s
    /// constructor grants it, so that assertion passes with the entire handover deleted. An earlier
    /// version of this test did exactly that and survived every mutation. Pointing
    /// `USANCE_GOVERNANCE` at a different address is what makes the handover observable.
    ///
    /// Both halves live in one test on purpose. `vm.setEnv` writes to the real process environment
    /// and forge runs tests concurrently, so two tests that disagree about the same variable race
    /// against each other and fail depending on scheduling. Splitting this in two produced exactly
    /// that flake. One test, one value, no shared mutable state.
    function test_D01_governanceIsHandedToTheConfiguredHolderAndTakenFromTheDeployKey() public {
        address deployKey = vm.addr(DEPLOYER_PK);
        address intended = makeAddr("governance-multisig");
        vm.setEnv("USANCE_GOVERNANCE", vm.toString(intended));

        (Authority authority,) = _deployAndCollect();

        assertTrue(
            authority.hasRole(authority.GOVERNANCE(), intended), "configured holder never received GOVERNANCE"
        );
        assertFalse(
            authority.hasRole(authority.GOVERNANCE(), deployKey), "deploy key kept GOVERNANCE after handover"
        );

        // The guardian is a separate power and must not be silently bundled into the handover.
        assertTrue(authority.hasRole(authority.GUARDIAN(), deployKey), "guardian default was not applied");
    }

    // ------------------------------------------------------------------ D-02

    /// ADMISSION is needed only while the script registers the settlement asset. Holding it
    /// afterwards would let the deploy key admit any asset it liked, forever.
    function test_D02_admissionIsSurrenderedWhenTheScriptReturns() public {
        (Authority authority,) = _deployAndCollect();
        assertFalse(
            authority.hasRole(authority.ADMISSION(), vm.addr(DEPLOYER_PK)),
            "deploy key kept ADMISSION after deployment"
        );
    }

    // ------------------------------------------------------------------ wiring

    /// A deployment that reports success while leaving the settlement asset unset is a protocol
    /// that can price nothing. This is the invariant `make test-live-xlayer` checks on chain.
    function test_settlementAssetIsBoundBeforeTheScriptReturns() public {
        (, ClearingHouse clearing) = _deployAndCollect();
        assertTrue(address(clearing) != address(0), "ClearingHouse not found");
        assertTrue(clearing.settlementAssetId() != bytes32(0), "settlement asset never bound");
    }

    // ------------------------------------------------------------------ freshness config

    /**
     * Both freshness postures, in one test on purpose.
     *
     * `vm.setEnv` writes to the real process environment and forge runs tests concurrently, so two
     * tests that disagree about the same variable race. Normalising in `setUp` does not fix it: the
     * other test rewrites the variable mid-flight, after this one's setUp has run. A mainnet test
     * setting a fake settlement token made three unrelated testnet tests revert exactly this way.
     *
     * Sequential sections inside one test have no such window. This is the second time the pattern
     * has come up in this file; the first was governance handover.
     */
    function test_freshnessMustBeConfiguredAndOnlyTestnetGetsADefault() public {
        // Testnet: a labelled stand-in policy, so a demo does not fail on a feed nobody updated.
        (, ClearingHouse clearing) = _deployAndCollect();
        (bool configured, uint64 maxAge) = clearing.settlementFreshness();
        assertTrue(configured, "testnet deployment left freshness unconfigured");
        assertEq(maxAge, 172_800, "stand-in policy is not the documented two heartbeats");

        // Mainnet: no default. The right bound depends on the cadence of the specific feed, and a
        // guessed one either rejects healthy feeds or accepts dead ones.
        vm.chainId(196);
        vm.setEnv("USANCE_SETTLEMENT_TOKEN", vm.toString(makeAddr("usdc")));
        vm.setEnv("USANCE_SETTLEMENT_FEED", vm.toString(makeAddr("usdc-feed")));

        Deploy mainnetScript = new Deploy();
        vm.expectRevert();
        mainnetScript.run();

        // Put the environment back so a concurrently-scheduled test does not inherit mainnet config.
        vm.setEnv("USANCE_SETTLEMENT_TOKEN", vm.toString(address(0)));
        vm.setEnv("USANCE_SETTLEMENT_FEED", vm.toString(address(0)));
    }

    /// Mainnet must never receive the labelled testnet stand-ins.
    function test_mainnetRefusesToDeployTestFixtures() public {
        vm.chainId(196);
        Deploy mainnetScript = new Deploy();
        vm.expectRevert();
        mainnetScript.run();
    }
}
