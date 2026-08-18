// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {MandateRegistry} from "../src/core/MandateRegistry.sol";
import {IntentBook} from "../src/core/IntentBook.sol";
import {DelegationGateway} from "../src/core/DelegationGateway.sol";
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
    DelegationGateway internal gateway;

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

        gateway = new DelegationGateway(authority, clearing, registry);
        vm.startPrank(governance);
        authority.grantRole(authority.CLEARING(), address(gateway));
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
        gateway.execute(
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
            gateway.execute(
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
            vm.expectRevert(abi.encodeWithSelector(DelegationGateway.ActionNotDelegable.selector, a));
            gateway.execute(
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
                DelegationGateway.ActionNotDelegable.selector, uint8(MandateRegistry.MandateAction.BORROW)
            )
        );
        gateway.execute(
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
        gateway.execute(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 50e18, NO_VENUE, _empty(), _empty()
        );
    }

    /// Mandate refusal survives a protocol-legal action. Both must say yes.
    function test_aProtocolLegalActionStillNeedsAMandate() public {
        _positionWithDebt();
        bytes32 id = _register();

        vm.prank(stranger);
        vm.expectRevert();
        gateway.execute(
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
        gateway.execute(
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
        gateway.execute(
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
        gateway.execute(
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
        gateway.execute(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 10e18, NO_VENUE, _empty(), _empty()
        );
    }

    /// An agent acting on its own account is not delegation. Routing it here would push an ordinary
    /// user action through a gate that was never meant to govern them.
    function test_anAccountCannotDelegateToItself() public {
        bytes32 id = _register();
        vm.prank(ownerAcct);
        vm.expectRevert(DelegationGateway.AgentIsNotTheAccount.selector);
        gateway.execute(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 10e18, NO_VENUE, _empty(), _empty()
        );
    }

    // ------------------------------------------------------------------ owner independence

    /// Owners must never need to issue themselves a mandate to use their own account. Nothing in
    /// this test touches the registry or the gateway.
    function test_ownerActionsDoNotRequireAMandate() public {
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

    /// A gateway that has not been granted CLEARING cannot reach the protocol at all. The mandate
    /// check may pass and the act still cannot happen, which is the conjunction seen from the other
    /// side: protocol authority is not something a signature can confer.
    function test_anUngrantedGatewayCannotReachTheProtocol() public {
        _positionWithDebt();
        bytes32 id = _register();

        DelegationGateway rogue = new DelegationGateway(authority, clearing, registry);
        vm.prank(agent);
        vm.expectRevert();
        rogue.execute(
            ownerAcct, id, MandateRegistry.MandateAction.REPAY, USTB_ID, 10e18, NO_VENUE, _empty(), _empty()
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

        MandateRegistry.AuthorizationRequest memory req = gateway.authorizationRequestFor(
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
        MandateRegistry.AuthorizationRequest memory req = gateway.authorizationRequestFor(
            ownerAcct, id, MandateRegistry.MandateAction.BORROW, USTB_ID, 1e17, NO_VENUE
        );
        assertEq(
            uint8(registry.authorizationReason(req, _empty(), _empty())),
            uint8(MandateRegistry.Reason.DEBT_CAP_EXCEEDED),
            "a live debt above the mandate ceiling was not refused"
        );
    }
}

/**
 * Capital reservation, at the point where two intents could otherwise spend the same capacity.
 *
 * IntentBook already held the whole state machine and was well tested. What it was missing is the
 * same thing MandateRegistry was missing: it was never deployed, so nothing on chain could reach
 * it. These tests cover the boundary between the two contracts rather than IntentBook's internals.
 */
contract ReservationTest is Fixture {
    MandateRegistry internal registry;
    IntentBook internal book;

    uint256 internal constant OWNER_PK = 0xB0B;
    address internal ownerAcct;
    address internal agent;
    address internal executor;

    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);

        ownerAcct = vm.addr(OWNER_PK);
        agent = makeAddr("intent-agent");
        executor = makeAddr("executor");

        registry = new MandateRegistry(authority);
        book = new IntentBook(authority, registry, clearing);

        vm.startPrank(governance);
        authority.grantRole(authority.CLEARING(), address(book));
        authority.grantRole(book.EXECUTOR(), executor);
        vm.stopPrank();

        giveCollateral(ownerAcct, 10_000e18);
        vm.startPrank(ownerAcct);
        ustb.approve(address(collateralVault), type(uint256).max);
        clearing.addCollateral(USTB_ID, 5_000e18);
        vm.stopPrank();
    }

    /// A reservation removes capacity from the account, so a second intent cannot spend it twice.
    function test_aReservationRemovesCapacityFromTheAccount() public {
        (uint256 before,) = clearing.availableBorrow(ownerAcct);
        assertGt(before, 0);

        vm.prank(address(book));
        clearing.reserve(ownerAcct, before / 2, bytes32("intent-1"));

        assertEq(clearing.reservedOf(ownerAcct), before / 2, "the reservation was not recorded");
    }

    /// Two intents cannot both believe the whole capacity is theirs.
    function test_twoIntentsCannotOverReserveTheSameAccount() public {
        (uint256 capacity,) = clearing.availableBorrow(ownerAcct);

        vm.prank(address(book));
        clearing.reserve(ownerAcct, capacity, bytes32("intent-1"));

        // The second reservation asks for capacity the first already holds.
        vm.prank(address(book));
        vm.expectRevert();
        clearing.reserve(ownerAcct, capacity, bytes32("intent-2"));
    }

    /// Reservation calls are privileged. An open `reserve` would let anybody pin somebody else's
    /// capacity indefinitely — a denial of service that costs the attacker nothing.
    function test_anArbitraryCallerCannotPinSomebodysCapacity() public {
        vm.prank(makeAddr("griefer"));
        vm.expectRevert();
        clearing.reserve(ownerAcct, 100e18, bytes32("intent-x"));
    }

    /**
     * Capacity returns exactly once, and a repeated release is harmless rather than fatal.
     *
     * The release saturates at the outstanding amount instead of reverting, and that is the right
     * choice: a reconciler that retries a release after an ambiguous receipt must not be punished
     * for it. What matters is that the second call credits nothing — the counter cannot go below
     * zero and available capacity does not grow.
     */
    function test_releasingReturnsCapacityOnceAndARepeatCreditsNothing() public {
        (uint256 capacity,) = clearing.availableBorrow(ownerAcct);

        vm.startPrank(address(book));
        clearing.reserve(ownerAcct, capacity / 2, bytes32("intent-1"));
        clearing.releaseReservation(ownerAcct, capacity / 2, bytes32("intent-1"));
        vm.stopPrank();

        assertEq(clearing.reservedOf(ownerAcct), 0);
        (uint256 afterFirst,) = clearing.availableBorrow(ownerAcct);

        vm.prank(address(book));
        clearing.releaseReservation(ownerAcct, capacity / 2, bytes32("intent-1"));

        assertEq(clearing.reservedOf(ownerAcct), 0, "a repeated release drove the counter below zero");
        (uint256 afterSecond,) = clearing.availableBorrow(ownerAcct);
        assertEq(afterSecond, afterFirst, "a repeated release credited capacity that was never freed");
    }

    /// A reservation outstanding blocks withdrawal. Capital committed to an in-flight execution is
    /// not capital the owner can also walk away with.
    function test_anOutstandingReservationBlocksWithdrawal() public {
        vm.prank(address(book));
        clearing.reserve(ownerAcct, 100e18, bytes32("intent-1"));

        vm.prank(ownerAcct);
        vm.expectRevert(ClearingHouse.ReservationOutstanding.selector);
        clearing.withdrawCollateral(USTB_ID, 100e18);
    }
}
