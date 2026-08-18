// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {MandateRegistry} from "../src/core/MandateRegistry.sol";
import {Types} from "../src/libraries/Types.sol";

/**
 * Delegated authority, at the boundary where money actually moves.
 *
 * MandateRegistry already decides whether an act is inside a signed envelope, and it was already
 * well tested. What was missing is the part that matters financially: nothing called it. A registry
 * that answers correctly and is never consulted authorises everything.
 *
 * The constitution these tests defend:
 *
 *     AllowedAction = ProtocolAllows AND MandateAllows
 *
 * and, the one that cannot be traded away for any amount of convenience:
 *
 *     AN AGENT CANNOT WITHDRAW USER COLLATERAL
 *
 * The second is enforced by the shape of the control flow rather than by the absence of an enum
 * member. An enum nobody will widen is a promise about future commits; a switch that reverts on
 * everything it does not name is a rule.
 */
contract DelegatedAuthorityTest is Fixture {
    MandateRegistry internal registry;

    /// REPAY, ADD_COLLATERAL and BORROW move no order to a venue, and the registry refuses a
    /// non-venue action that carries a venue id rather than letting the commitment quietly stop
    /// being checked.
    bytes32 internal constant NO_VENUE = bytes32(0);

    uint256 internal constant OWNER_PK = 0xA11CE;
    address internal ownerAcct;
    address internal agent;
    address internal stranger;

    bytes32 internal ownerAccountId;
    uint16 internal actions;

    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);

        ownerAcct = vm.addr(OWNER_PK);
        agent = makeAddr("agent");
        stranger = makeAddr("stranger");

        registry = new MandateRegistry(authority);
        ownerAccountId = registry.accountIdFor(ownerAcct);
        actions = registry.actionBit(MandateRegistry.MandateAction.REPAY)
            | registry.actionBit(MandateRegistry.MandateAction.ADD_COLLATERAL)
            | registry.actionBit(MandateRegistry.MandateAction.BORROW);

        vm.startPrank(governance);
        clearing.setMandateRegistry(registry);
        authority.grantRole(authority.CLEARING(), address(clearing));
        vm.stopPrank();

        giveCollateral(ownerAcct, 10_000e18);
        usdc.mint(agent, 100_000e6);
        vm.prank(agent);
        usdc.approve(address(clearing), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _leaf(bytes32 id) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(id))));
    }

    function _mandate() internal view returns (MandateRegistry.Mandate memory m) {
        m = MandateRegistry.Mandate({
            owner: ownerAcct,
            agent: agent,
            accountId: ownerAccountId,
            validFrom: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 7 days),
            maxDebtUsd: 5_000e18,
            maxTradeNotionalUsd: 10_000e18,
            maxEffectiveLeverageBps: 30_000,
            maxSlippageBps: 50,
            allowedActions: actions,
            requiredPassportFreshness: 7 days,
            allowedAssetsRoot: _leaf(USTB_ID),
            allowedVenuesRoot: _leaf(bytes32("USANCE_INTERNAL")),
            nonce: 1
        });
    }

    function _sign(MandateRegistry.Mandate memory m) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_PK, registry.mandateDigest(m));
        return abi.encodePacked(r, s, v);
    }

    function _register() internal returns (bytes32) {
        MandateRegistry.Mandate memory m = _mandate();
        return registry.registerMandate(m, _sign(m));
    }

    function _empty() internal pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function _positionWithDebt() internal {
        vm.startPrank(ownerAcct);
        ustb.approve(address(collateralVault), type(uint256).max);
        clearing.addCollateral(USTB_ID, 1_000e18);
        clearing.borrow(200e18, 0);
        vm.stopPrank();
    }

    function _repayAs(address who, bytes32 id, uint256 amount) internal {
        vm.prank(who);
        clearing.executeDelegated(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, amount, NO_VENUE, _empty(), _empty()
        );
    }

    // ------------------------------------------------------------------ the permitted case

    function test_anAuthorisedAgentCanReduceRisk() public {
        _positionWithDebt();
        bytes32 id = _register();

        uint256 before = clearing.debtOf(ownerAcct);
        _repayAs(agent, id, 50e18);

        assertLt(clearing.debtOf(ownerAcct), before, "a permitted delegated repayment did nothing");
    }

    /// The agent's own funds move, never the account's. An agent that could spend the account's
    /// balance would drain a standing wallet allowance without putting anything into the account.
    function test_theAgentFundsTheRepaymentItself() public {
        _positionWithDebt();
        bytes32 id = _register();

        uint256 agentBefore = usdc.balanceOf(agent);
        uint256 ownerBefore = usdc.balanceOf(ownerAcct);
        _repayAs(agent, id, 50e18);

        assertLt(usdc.balanceOf(agent), agentBefore, "the agent paid nothing");
        assertEq(usdc.balanceOf(ownerAcct), ownerBefore, "the account was charged for the agent's act");
    }

    // ------------------------------------------------------------------ agent withdrawal

    /**
     * The constitutional invariant.
     *
     * There is no delegated withdrawal function to call, so the test is that no delegated verb can
     * be bent into one. Each of these is a distinct escape route: an enum member that does not
     * exist, one that does but is not delegable, and the ordinary owner path called by an agent.
     */
    function test_noDelegatedPathReachesAWithdrawal() public {
        _positionWithDebt();
        bytes32 id = _register();

        // Two layers refuse these, and which one fires depends on the mandate. Under this mandate
        // the registry refuses first with ACTION_NOT_COMMITTED, because the owner never granted
        // TRADE, HEDGE or CLOSE. That is the outer layer working.
        //
        // The inner layer — ClearingHouse refusing regardless of what was granted — is pinned by
        // test_anOverlyBroadMandateStillCannotWithdraw, which signs every bit in the vocabulary and
        // still gets ActionNotDelegable. Asserting one specific selector here would test whichever
        // layer happened to be first and hide the other.
        for (uint8 a = 3; a <= 5; a++) {
            vm.prank(agent);
            vm.expectRevert();
            clearing.executeDelegated(
                ownerAcct, id, MandateRegistry.MandateAction(a), USTB_ID, 1e18, NO_VENUE, _empty(), _empty()
            );
        }

        // The ordinary withdrawal path takes no account argument, so an agent calling it can only
        // ever reach its own empty position. It cannot name the owner's.
        uint256 ownerCollateralBefore = collateralVault.balanceOf(USTB_ID, ownerAcct);
        vm.prank(agent);
        vm.expectRevert();
        clearing.withdrawCollateral(USTB_ID, 100e18);

        assertEq(
            collateralVault.balanceOf(USTB_ID, ownerAcct),
            ownerCollateralBefore,
            "an agent moved the account's collateral"
        );
    }

    /// Even an owner who signs a mandate granting every action in the vocabulary cannot delegate
    /// an outflow, because the outflow verb is not in the vocabulary and is not in the switch.
    function test_anOverlyBroadMandateStillCannotWithdraw() public {
        _positionWithDebt();

        MandateRegistry.Mandate memory m = _mandate();
        m.allowedActions = 0x3F; // every bit in the vocabulary
        bytes32 id = registry.registerMandate(m, _sign(m));

        // A fully valid request in every respect the registry checks: granted action, committed
        // asset, committed venue, inside every cap. The registry says yes. ClearingHouse says no
        // anyway, which is the whole point of the second gate — the owner cannot sign away this
        // boundary even by granting everything.
        uint256 before = collateralVault.balanceOf(USTB_ID, ownerAcct);
        for (uint8 a = 3; a <= 5; a++) {
            vm.prank(agent);
            vm.expectRevert(abi.encodeWithSelector(ClearingHouse.ActionNotDelegable.selector, a));
            clearing.executeDelegated(
                ownerAcct,
                id,
                MandateRegistry.MandateAction(a),
                USTB_ID,
                1e18,
                bytes32("USANCE_INTERNAL"),
                _empty(),
                _empty()
            );
        }
        assertEq(collateralVault.balanceOf(USTB_ID, ownerAcct), before);
    }

    /// Autonomous debt is not wired. It is refused loudly rather than shipped half-checked.
    function test_autonomousBorrowIsRefusedRatherThanHalfWired() public {
        _positionWithDebt();
        bytes32 id = _register();

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                ClearingHouse.ActionNotDelegable.selector, uint8(MandateRegistry.MandateAction.BORROW)
            )
        );
        clearing.executeDelegated(
            ownerAcct, id, MandateRegistry.MandateAction.BORROW, USTB_ID, 10e18, NO_VENUE, _empty(), _empty()
        );
    }

    // ------------------------------------------------------------------ the conjunction

    /// Protocol refusal survives a valid mandate. A signature cannot reach a path the protocol
    /// would not take for the owner themselves.
    function test_aValidMandateCannotOverrideTheProtocol() public {
        bytes32 id = _register();
        // No debt, so the protocol refuses a repayment regardless of what the mandate permits.
        vm.prank(agent);
        vm.expectRevert(ClearingHouse.NoDebt.selector);
        clearing.executeDelegated(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 50e18, NO_VENUE, _empty(), _empty()
        );
    }

    /// Mandate refusal survives a protocol-legal action. Both must say yes.
    function test_aProtocolLegalActionStillNeedsAMandate() public {
        _positionWithDebt();
        bytes32 id = _register();

        vm.prank(stranger);
        vm.expectRevert();
        clearing.executeDelegated(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 50e18, NO_VENUE, _empty(), _empty()
        );
    }

    // ------------------------------------------------------------------ lifecycle

    function test_aRevokedMandateCannotExecute() public {
        _positionWithDebt();
        bytes32 id = _register();
        _repayAs(agent, id, 10e18);

        vm.prank(ownerAcct);
        registry.revokeMandate(id, bytes32("owner changed their mind"));

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateRegistry.Denied.selector, id, MandateRegistry.Reason.REVOKED)
        );
        clearing.executeDelegated(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 10e18, NO_VENUE, _empty(), _empty()
        );
    }

    function test_aPausedMandateCannotExecuteAndResumingRestoresIt() public {
        _positionWithDebt();
        bytes32 id = _register();

        vm.prank(ownerAcct);
        registry.pauseMandate(id);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateRegistry.Denied.selector, id, MandateRegistry.Reason.PAUSED)
        );
        clearing.executeDelegated(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 10e18, NO_VENUE, _empty(), _empty()
        );

        vm.prank(ownerAcct);
        registry.resumeMandate(id);
        _repayAs(agent, id, 10e18);
    }

    function test_anExpiredMandateCannotExecute() public {
        _positionWithDebt();
        bytes32 id = _register();

        vm.warp(block.timestamp + 8 days);
        ustbFeed.set(1e8, block.timestamp);
        usdcFeed.set(1e8, block.timestamp);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateRegistry.Denied.selector, id, MandateRegistry.Reason.EXPIRED)
        );
        clearing.executeDelegated(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 10e18, NO_VENUE, _empty(), _empty()
        );
    }

    function test_theWrongAgentIsRefused() public {
        _positionWithDebt();
        bytes32 id = _register();

        usdc.mint(stranger, 10_000e6);
        vm.prank(stranger);
        usdc.approve(address(clearing), type(uint256).max);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(MandateRegistry.Denied.selector, id, MandateRegistry.Reason.WRONG_AGENT)
        );
        clearing.executeDelegated(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 10e18, NO_VENUE, _empty(), _empty()
        );
    }

    /// An agent acting on its own account is not delegation. Routing it here would push an ordinary
    /// user action through a gate that was never meant to govern them.
    function test_anAccountCannotDelegateToItself() public {
        bytes32 id = _register();
        vm.prank(ownerAcct);
        vm.expectRevert(ClearingHouse.AgentIsNotTheAccount.selector);
        clearing.executeDelegated(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 10e18, NO_VENUE, _empty(), _empty()
        );
    }

    // ------------------------------------------------------------------ owner independence

    /// Owners must never need to issue themselves a mandate to use their own account.
    function test_ownerActionsDoNotRequireAMandate() public {
        vm.startPrank(governance);
        clearing.setMandateRegistry(MandateRegistry(address(0)));
        vm.stopPrank();

        vm.startPrank(ownerAcct);
        ustb.approve(address(collateralVault), type(uint256).max);
        clearing.addCollateral(USTB_ID, 1_000e18);
        clearing.borrow(100e18, 0);
        usdc.mint(ownerAcct, 1_000e6);
        usdc.approve(address(clearing), type(uint256).max);
        clearing.repay(0, true);
        clearing.withdrawCollateral(USTB_ID, 1_000e18);
        vm.stopPrank();

        assertEq(clearing.debtOf(ownerAcct), 0);
    }

    function test_delegationIsRefusedUntilARegistryIsWired() public {
        vm.prank(governance);
        clearing.setMandateRegistry(MandateRegistry(address(0)));

        vm.prank(agent);
        vm.expectRevert(ClearingHouse.MandatesNotConfigured.selector);
        clearing.executeDelegated(
            ownerAcct,
            bytes32(uint256(1)),
            MandateRegistry.MandateAction.REPAY,
            USTB_ID,
            10e18,
            NO_VENUE,
            _empty(),
            _empty()
        );
    }

    // ------------------------------------------------------------------ live-state binding

    /**
     * The authorization request is built from live protocol state, never from agent arguments.
     *
     * This exists because a mutation replacing `projectedDebtUsd18` with a constant zero survived
     * every other test in this file. It survives honestly: the debt ceiling is only checked for
     * BORROW, and BORROW is not delegable yet. So the severed wire would be invisible until the day
     * autonomous borrowing shipped, which is the worst possible day to discover it.
     */
    function test_theAuthorizationRequestReflectsLiveState() public {
        _positionWithDebt();
        bytes32 id = _register();

        MandateRegistry.AuthorizationRequest memory req = clearing.authorizationRequestFor(
            ownerAcct, id, MandateRegistry.MandateAction.BORROW, USTB_ID, 10e18, NO_VENUE
        );

        (Types.RiskResult memory health,) = clearing.accountHealth(ownerAcct);
        assertGt(health.debtUsd18, 0, "the fixture produced no debt; this proves nothing");
        assertEq(req.projectedDebtUsd18, health.debtUsd18, "projected debt is not read from live state");
        assertEq(req.grossExposureUsd18, health.totalRecognizedUsd18, "exposure is not read from live state");
        assertEq(
            req.equityUsd18, health.totalRecognizedUsd18 - health.debtUsd18, "equity is not derived live"
        );
    }

    /// And that the registry actually rejects on it, so the binding has somewhere to bite.
    function test_theDebtCeilingIsEnforcedAgainstLiveDebt() public {
        _positionWithDebt();

        MandateRegistry.Mandate memory m = _mandate();
        m.maxDebtUsd = 1e18; // far below the account's actual debt
        bytes32 id = registry.registerMandate(m, _sign(m));

        vm.prank(agent);
        MandateRegistry.AuthorizationRequest memory req = clearing.authorizationRequestFor(
            ownerAcct, id, MandateRegistry.MandateAction.BORROW, USTB_ID, 1e17, NO_VENUE
        );
        assertEq(
            uint8(registry.authorizationReason(req, _empty(), _empty())),
            uint8(MandateRegistry.Reason.DEBT_CAP_EXCEEDED),
            "a live debt above the mandate ceiling was not refused"
        );
    }
}
