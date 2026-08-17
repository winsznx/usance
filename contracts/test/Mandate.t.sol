// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Fixture} from "./Fixture.sol";
import {ClearingHouse} from "../src/core/ClearingHouse.sol";
import {IntentBook} from "../src/core/IntentBook.sol";
import {MandateRegistry} from "../src/core/MandateRegistry.sol";

/// @title The mandate and intent authorization boundary
/// @notice Every test in this file is written from the attacker's side of the boundary. The
///         positive path is three tests; the rest are an agent trying to do something its owner
///         did not sign for, and being refused deterministically.
///
/// @dev Invariants exercised here: I-20, I-23, I-24, I-27 through I-31.
contract MandateTest is Fixture {
    MandateRegistry internal mandateReg;
    IntentBook internal intents;

    uint256 internal constant OWNER_PK = 0xB0B0BEEF;
    uint256 internal constant STRANGER_PK = 0xDECAFBAD;

    address internal owner;
    address internal stranger;
    address internal agent = address(0xA6E7);
    address internal executor = address(0xE7EC);

    bytes32 internal constant VENUE_A = keccak256("VENUE_XLAYER_AMM");
    bytes32 internal constant VENUE_B = keccak256("VENUE_XLAYER_RFQ");
    bytes32 internal constant VENUE_ROGUE = keccak256("VENUE_SOMEWHERE_ELSE");
    bytes32 internal constant ROGUE_ASSET = keccak256("ROGUE_ASSET");
    bytes32 internal constant PLAN_HASH = keccak256("PLAN_V1");

    /// @dev The frozen action vocabulary, restated here rather than read from the contract. If
    ///      someone adds a verb, the constant in the contract moves and this assertion fails —
    ///      which is the entire point of a canary. Reading it from the contract would make the
    ///      test agree with any vocabulary at all, including one containing a withdrawal.
    bytes32 internal constant FROZEN_VOCABULARY =
        keccak256("USANCE_MANDATE_ACTIONS_V1:BORROW,REPAY,ADD_COLLATERAL,TRADE,HEDGE,CLOSE");

    string internal constant IS_AUTHORIZED_SIG = "isAuthorized((bytes32,address,uint8,bytes32,bytes32,"
        "uint256,uint256,uint256,uint256,uint64,uint16),bytes32[],bytes32[])";

    bytes32 internal assetsRoot;
    bytes32 internal venuesRoot;

    /// @dev Cached in `setUp` and reconstructed locally from here on. Two reasons, both learned
    ///      the hard way: an external call inside an argument list silently consumes the pending
    ///      `vm.prank` or `vm.expectRevert`, and rebuilding the EIP-712 digest independently means
    ///      the suite would notice if the contract's encoding drifted from the spec'd type.
    bytes32 internal domainSep;
    bytes32 internal typeHash;
    bytes32 internal ownerAccountId;
    uint16 internal baseActions;
    uint64 internal passportAt;

    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);

        owner = vm.addr(OWNER_PK);
        stranger = vm.addr(STRANGER_PK);

        giveCollateral(owner, 10_000e18);
        depositCollateral(owner, 2_000e18);

        mandateReg = new MandateRegistry(authority);
        intents = new IntentBook(authority, mandateReg, clearing);

        vm.startPrank(governance);
        // IntentBook reserves and releases on ClearingHouse, which is already CLEARING-gated.
        // No existing contract changes; the wiring is a role grant.
        authority.grantRole(authority.CLEARING(), address(intents));
        authority.grantRole(intents.EXECUTOR(), executor);
        // The budget tests drive MandateRegistry.authorize directly, standing in for the
        // settlement contract that will hold this role in production.
        authority.grantRole(authority.CLEARING(), address(this));
        vm.stopPrank();

        assetsRoot = _pairRoot(_leaf(USTB_ID), _leaf(USDC_ID));
        venuesRoot = _pairRoot(_leaf(VENUE_A), _leaf(VENUE_B));

        domainSep = mandateReg.domainSeparator();
        typeHash = mandateReg.MANDATE_TYPEHASH();
        ownerAccountId = mandateReg.accountIdFor(owner);
        passportAt = passportReg.getCurrentPassport(USTB_ID).createdAt;
        baseActions = mandateReg.actionBit(MandateRegistry.MandateAction.BORROW)
            | mandateReg.actionBit(MandateRegistry.MandateAction.REPAY)
            | mandateReg.actionBit(MandateRegistry.MandateAction.TRADE);
    }

    /// @notice The locally reconstructed leaf, root and digest must be exactly what the contract
    ///         computes, or every other test in this file is proving something about a tree the
    ///         registry has never seen.
    function test_localEncodingMatchesTheRegistry() public view {
        assertEq(_leaf(USTB_ID), mandateReg.leafFor(USTB_ID), "leaf encoding");
        MandateRegistry.Mandate memory m = _baseMandate();
        assertEq(_digest(m), mandateReg.mandateDigest(m), "EIP-712 digest");
    }

    // ---------------------------------------------------------------------------------
    // Structural: no mandate authorises a withdrawal (I-28)
    // ---------------------------------------------------------------------------------

    function test_actionVocabularyIsFrozenAndNamesNoOutflow() public view {
        assertEq(mandateReg.ACTION_COUNT(), 6, "action count changed");
        assertEq(mandateReg.ACTION_VOCABULARY(), FROZEN_VOCABULARY, "action vocabulary changed");
    }

    /// @notice The selector this file hand-encodes must be the real one, or the raw-calldata
    ///         probes below would be testing a function that does not exist.
    function test_handEncodedSelectorMatchesTheRealFunction() public pure {
        assertEq(
            bytes32(bytes4(keccak256(bytes(IS_AUTHORIZED_SIG)))),
            bytes32(MandateRegistry.isAuthorized.selector),
            "AuthorizationRequest shape changed"
        );
    }

    /// @notice An action ordinal outside the vocabulary cannot even be decoded, so a caller cannot
    ///         smuggle an undefined verb past the type system through raw calldata.
    function test_undefinedActionOrdinalDoesNotDecode() public {
        bytes32 id = _registerBaseMandate();

        for (uint8 i = 0; i < 6; ++i) {
            (bool ok,) = address(mandateReg).call(_rawIsAuthorized(id, i));
            assertTrue(ok, "defined ordinal must decode");
        }
        for (uint16 i = 6; i < 256; ++i) {
            (bool ok,) = address(mandateReg).call(_rawIsAuthorized(id, uint8(i)));
            assertFalse(ok, "undefined ordinal must not decode");
        }
    }

    /// @notice Even holding a mandate with every action bit set, an agent cannot move the owner's
    ///         collateral. `withdrawCollateral` is `msg.sender`-scoped and there is no delegated
    ///         form of it anywhere in the protocol.
    function test_agentWithFullMandateCannotWithdraw() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.allowedActions = uint16((1 << 6) - 1);
        m.maxDebtUsd = type(uint128).max;
        m.maxTradeNotionalUsd = type(uint128).max;
        m.maxEffectiveLeverageBps = type(uint16).max;
        m.maxSlippageBps = 10_000;
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));

        uint256 held = collateralVault.balanceOf(USTB_ID, owner);

        vm.prank(agent);
        vm.expectRevert();
        clearing.withdrawCollateral(USTB_ID, 1e18);

        assertEq(collateralVault.balanceOf(USTB_ID, owner), held, "owner collateral untouched");
        assertEq(collateralVault.balanceOf(USTB_ID, agent), 0, "agent holds nothing");
    }

    /// @notice No mandate, under any parameterisation, lets an agent move the owner's collateral.
    ///
    /// @dev The earlier version of this test was vacuous. It fuzzed five mandate dimensions and
    ///      then asserted that `agent` could not withdraw — but `ClearingHouse.withdrawCollateral`
    ///      is scoped to `msg.sender`, and `agent` holds no collateral, so the assertion held with
    ///      no mandate registered at all. It proved that an address with nothing cannot withdraw
    ///      something, which is true of every address on every chain.
    ///
    ///      What makes the assertion mean anything is the pair of controls below: the agent holds
    ///      collateral of its own (so a msg.sender-scoped withdrawal would succeed if the exit
    ///      were delegable at all), and the mandate is maximally permissive with every action bit
    ///      set. The owner's balance must still be untouched.
    function testFuzz_noMandatePermitsWithdrawal(
        uint16 allowedActions,
        uint256 maxDebt,
        uint256 maxNotional,
        uint16 maxLev,
        uint16 maxSlip,
        uint8 rawAction,
        uint256 withdrawAmount
    ) public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.allowedActions = uint16(bound(allowedActions, 1, (1 << 6) - 1));
        m.maxDebtUsd = maxDebt;
        m.maxTradeNotionalUsd = maxNotional;
        m.maxEffectiveLeverageBps = maxLev;
        m.maxSlippageBps = uint16(bound(maxSlip, 0, 10_000));
        bytes32 id = mandateReg.registerMandate(m, _sign(OWNER_PK, m));

        uint256 ownerHeld = collateralVault.balanceOf(USTB_ID, owner);
        assertGt(ownerHeld, 0, "the owner must hold collateral for this to assert anything");

        // Positive control: give the agent its own collateral. If the collateral exit were
        // delegable, or if withdrawal were routed through the mandate at all, this address is now
        // in a position to exercise it.
        giveCollateral(agent, 500e18);
        vm.prank(agent);
        clearing.addCollateral(USTB_ID, 500e18);
        assertEq(collateralVault.balanceOf(USTB_ID, agent), 500e18, "agent holds its own collateral");

        // The vocabulary is closed, so there is no bit pattern that names an outflow...
        assertEq(mandateReg.ACTION_VOCABULARY(), FROZEN_VOCABULARY);
        // ...and nothing outside it survives ABI decoding.
        if (rawAction >= mandateReg.ACTION_COUNT()) {
            (bool decoded,) = address(mandateReg).call(_rawIsAuthorized(id, rawAction));
            assertFalse(decoded, "undefined ordinal decoded");
        }

        // The agent can move its OWN collateral, which proves the call shape is right and that a
        // failure below is about authority rather than about a malformed call.
        uint256 amount = bound(withdrawAmount, 1, 500e18);
        vm.prank(agent);
        clearing.withdrawCollateral(USTB_ID, amount);
        assertEq(collateralVault.balanceOf(USTB_ID, agent), 500e18 - amount, "agent moved its own");

        // And the owner's balance is untouched throughout. There is no calldata the agent can
        // send, under any mandate, that reaches it.
        assertEq(collateralVault.balanceOf(USTB_ID, owner), ownerHeld, "owner collateral moved");
    }

    // ---------------------------------------------------------------------------------
    // Signature and replay (I-29)
    // ---------------------------------------------------------------------------------

    function test_registrationBindsOwnerAndDerivesId() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        bytes32 id = mandateReg.registerMandate(m, _sign(OWNER_PK, m));

        assertEq(id, mandateReg.mandateIdFor(owner, m.nonce), "id is derived from (owner, nonce)");
        assertTrue(mandateReg.isLive(id), "mandate live");
        assertTrue(mandateReg.nonceConsumed(owner, m.nonce), "nonce burnt on registration");
    }

    function test_signatureReplayRejected() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        bytes memory sig = _sign(OWNER_PK, m);
        mandateReg.registerMandate(m, sig);

        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.NonceAlreadyConsumed.selector, owner, m.nonce));
        mandateReg.registerMandate(m, sig);
    }

    /// @notice A second, differently-parameterised mandate cannot reuse a spent nonce either.
    ///         Replay protection is on `(owner, nonce)`, not on the exact bytes of a signature.
    function test_differentMandateCannotReuseNonce() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));

        m.maxDebtUsd = 5_000_000e18;
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.NonceAlreadyConsumed.selector, owner, m.nonce));
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));
    }

    function test_signatureFromNonOwnerRejected() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        vm.expectRevert(MandateRegistry.BadSignature.selector);
        mandateReg.registerMandate(m, _sign(STRANGER_PK, m));
    }

    /// @notice A mandate signed for one deployment is not valid at another, because the domain
    ///         separator includes the verifying contract. Same argument covers a chain fork.
    function test_signatureDoesNotCrossDeployments() public {
        MandateRegistry other = new MandateRegistry(authority);
        assertTrue(other.domainSeparator() != mandateReg.domainSeparator(), "domains must differ");

        MandateRegistry.Mandate memory m = _baseMandate();
        bytes memory sig = _sign(OWNER_PK, m);
        mandateReg.registerMandate(m, sig);

        vm.expectRevert(MandateRegistry.BadSignature.selector);
        other.registerMandate(m, sig);
    }

    function test_mandateScopedToAnotherAccountRejected() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.accountId = mandateReg.accountIdFor(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateRegistry.AccountIdMismatch.selector, mandateReg.accountIdFor(owner), m.accountId
            )
        );
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));
    }

    // ---------------------------------------------------------------------------------
    // Registration bounds — an unusable mandate is refused at the door
    // ---------------------------------------------------------------------------------

    function test_registrationRejectsUnboundedDuration() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.expiresAt = uint64(block.timestamp + 91 days);
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateRegistry.DurationTooLong.selector, mandateReg.MAX_MANDATE_DURATION()
            )
        );
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));
    }

    /// @notice Zero freshness is refused rather than read as "no requirement". An unset bound must
    ///         never silently become an unbounded one.
    function test_registrationRejectsZeroPassportFreshness() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.requiredPassportFreshness = 0;
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateRegistry.FreshnessOutOfRange.selector, mandateReg.MAX_PASSPORT_FRESHNESS()
            )
        );
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));
    }

    function test_registrationRejectsActionBitOutsideVocabulary() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.allowedActions = uint16(1) << 6;
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.UndefinedActionBit.selector, m.allowedActions));
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));
    }

    function test_registrationRejectsEmptyAssetCommitment() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.allowedAssetsRoot = bytes32(0);
        vm.expectRevert(MandateRegistry.EmptyAssetCommitment.selector);
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));
    }

    function test_registrationRejectsVenueActionsWithNoVenueCommitment() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.allowedVenuesRoot = bytes32(0);
        vm.expectRevert(MandateRegistry.EmptyVenueCommitment.selector);
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));
    }

    // ---------------------------------------------------------------------------------
    // Lifecycle: expiry (I-30), revocation (I-27), pause
    // ---------------------------------------------------------------------------------

    function test_expiredMandateAuthorisesNothing() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        assertTrue(mandateReg.isAuthorized(q, _assetProof(USTB_ID), _noProof()), "sane before expiry");

        warpAndRefreshFeeds(8 days);

        // The budget is untouched — the whole point of I-30 is that this does not matter.
        assertEq(mandateReg.remainingDebtBudget(id), 500e18, "budget still full");
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.EXPIRED);
        assertFalse(mandateReg.isLive(id));
    }

    function test_mandateNotYetValidAuthorisesNothing() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.validFrom = uint64(block.timestamp + 1 days);
        bytes32 id = mandateReg.registerMandate(m, _sign(OWNER_PK, m));

        _expectReason(
            id,
            _borrowRequest(id, 1e18),
            _assetProof(USTB_ID),
            _noProof(),
            MandateRegistry.Reason.NOT_YET_VALID
        );
    }

    /// @notice Invariant I-27. Revocation lands in the same block and there is no code path back.
    function test_revokeIsImmediateAndIrreversible() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        assertTrue(mandateReg.isAuthorized(q, _assetProof(USTB_ID), _noProof()));

        vm.prank(owner);
        mandateReg.revokeMandate(id, keccak256("AGENT_COMPROMISED"));

        // Same block, no delay, no queue.
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.REVOKED);
        assertFalse(mandateReg.isLive(id));

        // There is no un-revoke: resume refuses, and the paper that created it cannot be replayed.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.AlreadyRevoked.selector, id));
        mandateReg.resumeMandate(id);

        MandateRegistry.Mandate memory m = _baseMandate();
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.NonceAlreadyConsumed.selector, owner, m.nonce));
        mandateReg.registerMandate(m, _sign(OWNER_PK, m));

        // The only route back is a fresh signature over a fresh nonce.
        m.nonce = 2;
        bytes32 fresh = mandateReg.registerMandate(m, _sign(OWNER_PK, m));
        assertTrue(mandateReg.isLive(fresh), "new signature, new mandate");
    }

    function test_guardianMayRevokeButNobodyMayUnrevoke() public {
        bytes32 id = _registerBaseMandate();
        vm.prank(guardian);
        mandateReg.revokeMandate(id, keccak256("INCIDENT"));
        assertFalse(mandateReg.isLive(id));

        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.AlreadyRevoked.selector, id));
        mandateReg.resumeMandate(id);
    }

    function test_pausedMandateAuthorisesNothing() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);

        vm.prank(owner);
        mandateReg.pauseMandate(id);
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.PAUSED);

        vm.prank(owner);
        mandateReg.resumeMandate(id);
        assertTrue(mandateReg.isAuthorized(q, _assetProof(USTB_ID), _noProof()), "owner may lift own pause");
    }

    /// @notice A guardian pause survives the owner. A guardian who can be overruled by the party
    ///         under investigation is not an emergency power (I-25, threat-model §6).
    function test_guardianPauseSurvivesOwnerAndGuardianCannotLiftIt() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);

        vm.prank(guardian);
        mandateReg.pauseMandate(id);

        vm.prank(owner);
        mandateReg.resumeMandate(id);
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.PAUSED);

        vm.prank(guardian);
        vm.expectRevert(MandateRegistry.GuardianCannotResume.selector);
        mandateReg.resumeMandate(id);

        vm.prank(governance);
        mandateReg.resumeMandate(id);
        assertTrue(mandateReg.isAuthorized(q, _assetProof(USTB_ID), _noProof()), "governance lifted it");
    }

    function test_strangerCannotRevokeOrPause() public {
        bytes32 id = _registerBaseMandate();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.NotOwner.selector, id));
        mandateReg.revokeMandate(id, keccak256("NOPE"));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.NotOwner.selector, id));
        mandateReg.pauseMandate(id);
    }

    // ---------------------------------------------------------------------------------
    // Commitment sets (I-31)
    // ---------------------------------------------------------------------------------

    function test_wrongAgentRejected() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        q.agent = stranger;
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.WRONG_AGENT);
    }

    function test_wrongActionRejected() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        q.action = MandateRegistry.MandateAction.HEDGE;
        q.venueId = VENUE_A;
        _expectReason(
            id, q, _assetProof(USTB_ID), _venueProof(VENUE_A), MandateRegistry.Reason.ACTION_NOT_COMMITTED
        );
    }

    function test_wrongAssetRejected() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        q.assetId = ROGUE_ASSET;
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.ASSET_NOT_COMMITTED);
    }

    function test_wrongVenueRejected() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _tradeRequest(id, 100e18);
        q.venueId = VENUE_ROGUE;
        _expectReason(
            id, q, _assetProof(USTB_ID), _venueProof(VENUE_A), MandateRegistry.Reason.VENUE_NOT_COMMITTED
        );
    }

    /// @notice A venue action that names no venue is refused, so "no venue" can never become
    ///         "venue not checked".
    function test_tradeWithoutVenueRejected() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _tradeRequest(id, 100e18);
        q.venueId = bytes32(0);
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.VENUE_NOT_COMMITTED);
    }

    function test_borrowCarryingAVenueRejected() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        q.venueId = VENUE_A;
        _expectReason(
            id, q, _assetProof(USTB_ID), _venueProof(VENUE_A), MandateRegistry.Reason.VENUE_NOT_COMMITTED
        );
    }

    function testFuzz_outsideCommitmentRejected(bytes32 rogueAsset, bytes32 rogueVenue, bytes32 rogueNode)
        public
    {
        vm.assume(rogueAsset != USTB_ID && rogueAsset != USDC_ID && rogueAsset != bytes32(0));
        vm.assume(rogueVenue != VENUE_A && rogueVenue != VENUE_B && rogueVenue != bytes32(0));

        bytes32 id = _registerBaseMandate();
        bytes32[] memory forged = new bytes32[](1);
        forged[0] = rogueNode;

        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 1e18);
        q.assetId = rogueAsset;
        _expectReason(id, q, forged, _noProof(), MandateRegistry.Reason.ASSET_NOT_COMMITTED);

        q = _tradeRequest(id, 1e18);
        q.venueId = rogueVenue;
        _expectReason(id, q, _assetProof(USTB_ID), forged, MandateRegistry.Reason.VENUE_NOT_COMMITTED);
    }

    // ---------------------------------------------------------------------------------
    // Evidence freshness
    // ---------------------------------------------------------------------------------

    function test_stalePassportRejected() public {
        MandateRegistry.Mandate memory m = _baseMandate();
        m.requiredPassportFreshness = 1 hours;
        bytes32 id = mandateReg.registerMandate(m, _sign(OWNER_PK, m));

        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        assertTrue(mandateReg.isAuthorized(q, _assetProof(USTB_ID), _noProof()), "fresh at signing");

        warpAndRefreshFeeds(2 hours);
        q.passportCommittedAt = passportReg.getCurrentPassport(USTB_ID).createdAt;
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.PASSPORT_STALE);
    }

    function test_missingOrFutureDatedPassportRejected() public {
        bytes32 id = _registerBaseMandate();

        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        q.passportCommittedAt = 0;
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.PASSPORT_STALE);

        // A Passport dated in the future is a broken input, not maximally fresh evidence.
        q.passportCommittedAt = uint64(block.timestamp + 1);
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.PASSPORT_STALE);
    }

    // ---------------------------------------------------------------------------------
    // Budgets — cumulative, not per-call
    // ---------------------------------------------------------------------------------

    function test_debtBudgetIsCumulativeAcrossCalls() public {
        bytes32 id = _registerBaseMandate(); // maxDebtUsd = 500e18
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 300e18);

        mandateReg.authorize(q, _assetProof(USTB_ID), _noProof());
        assertEq(mandateReg.remainingDebtBudget(id), 200e18, "budget drawn down");

        // The same call that just succeeded is now refused: 300 + 300 > 500.
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateRegistry.Denied.selector, id, MandateRegistry.Reason.DEBT_CAP_EXCEEDED
            )
        );
        mandateReg.authorize(q, _assetProof(USTB_ID), _noProof());

        // Exactly the remainder still fits. Off-by-one at the cap is where a budget either works
        // or quietly leaks a wei of authority.
        q.amountUsd18 = 200e18;
        q.projectedDebtUsd18 = 500e18;
        mandateReg.authorize(q, _assetProof(USTB_ID), _noProof());
        assertEq(mandateReg.remainingDebtBudget(id), 0);
    }

    function test_excessDebtRejected() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 500e18 + 1);
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.DEBT_CAP_EXCEEDED);
    }

    /// @notice Repaying does not refund budget. A cap on debt that resets on repayment is a cap on
    ///         nothing, because an agent can cycle it indefinitely.
    function test_projectedDebtIsCappedIndependentlyOfDraw() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        q.projectedDebtUsd18 = 500e18 + 1;
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.DEBT_CAP_EXCEEDED);
    }

    function test_excessNotionalRejected() public {
        bytes32 id = _registerBaseMandate(); // maxTradeNotionalUsd = 1_000e18
        MandateRegistry.AuthorizationRequest memory q = _tradeRequest(id, 600e18);

        mandateReg.authorize(q, _assetProof(USTB_ID), _venueProof(VENUE_A));
        assertEq(mandateReg.remainingNotionalBudget(id), 400e18);

        vm.expectRevert(
            abi.encodeWithSelector(
                MandateRegistry.Denied.selector, id, MandateRegistry.Reason.NOTIONAL_CAP_EXCEEDED
            )
        );
        mandateReg.authorize(q, _assetProof(USTB_ID), _venueProof(VENUE_A));
    }

    /// @notice Risk-reducing actions consume no budget, so an agent is never short of allowance
    ///         when it needs to close.
    function test_repayConsumesNoBudget() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        q.action = MandateRegistry.MandateAction.REPAY;

        mandateReg.authorize(q, _assetProof(USTB_ID), _noProof());
        assertEq(mandateReg.remainingDebtBudget(id), 500e18, "repay must not spend the debt budget");
        assertEq(mandateReg.remainingNotionalBudget(id), 1_000e18);
    }

    function test_excessSlippageRejected() public {
        bytes32 id = _registerBaseMandate(); // maxSlippageBps = 50
        MandateRegistry.AuthorizationRequest memory q = _tradeRequest(id, 100e18);

        q.slippageBps = 50;
        assertTrue(mandateReg.isAuthorized(q, _assetProof(USTB_ID), _venueProof(VENUE_A)), "at the cap");

        q.slippageBps = 51;
        _expectReason(
            id, q, _assetProof(USTB_ID), _venueProof(VENUE_A), MandateRegistry.Reason.SLIPPAGE_CAP_EXCEEDED
        );
    }

    function test_excessLeverageRejected() public {
        bytes32 id = _registerBaseMandate(); // maxEffectiveLeverageBps = 30_000 (3x)
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);

        q.grossExposureUsd18 = 3_000e18;
        q.equityUsd18 = 1_000e18;
        assertTrue(mandateReg.isAuthorized(q, _assetProof(USTB_ID), _noProof()), "exactly 3x");

        // One wei more exposure rounds leverage up past the bound: overstating leverage restricts
        // earlier, per accounting.md §1.2.
        q.grossExposureUsd18 = 3_000e18 + 1;
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.LEVERAGE_CAP_EXCEEDED);
    }

    /// @notice Exposure with nothing behind it is unbounded leverage, not zero leverage.
    function test_zeroEquityWithExposureRejected() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);
        q.grossExposureUsd18 = 1;
        q.equityUsd18 = 0;
        _expectReason(id, q, _assetProof(USTB_ID), _noProof(), MandateRegistry.Reason.LEVERAGE_CAP_EXCEEDED);
    }

    /// @notice The leverage comparison must answer rather than revert, whatever it is handed. A
    ///         view that reverts on an extreme input is a UI that shows nothing at the moment the
    ///         user most needs to see "denied".
    function testFuzz_leverageCheckNeverReverts(uint256 gross, uint256 equity) public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 1e18);
        q.grossExposureUsd18 = gross;
        q.equityUsd18 = equity;
        mandateReg.authorizationReason(q, _assetProof(USTB_ID), _noProof());
    }

    function test_authorizeIsNotOpenToTheAgent() public {
        bytes32 id = _registerBaseMandate();
        MandateRegistry.AuthorizationRequest memory q = _borrowRequest(id, 100e18);

        vm.prank(agent);
        vm.expectRevert();
        mandateReg.authorize(q, _assetProof(USTB_ID), _noProof());

        assertEq(mandateReg.remainingDebtBudget(id), 500e18, "budget cannot be burnt by an outsider");
    }

    // ---------------------------------------------------------------------------------
    // IntentBook — identity and duplication (I-20)
    // ---------------------------------------------------------------------------------

    function test_intentIdMatchesTheCanonicalDerivation() public {
        bytes32 id = _registerBaseMandate();
        vm.prank(agent);
        bytes32 intentId = intents.createIntent(id, 7, PLAN_HASH);

        assertEq(
            intentId,
            keccak256(abi.encode(mandateReg.accountIdFor(owner), id, uint256(7), PLAN_HASH)),
            "accounting.md section 2"
        );
    }

    function test_duplicateIntentRejected() public {
        bytes32 id = _registerBaseMandate();
        vm.prank(agent);
        bytes32 intentId = intents.createIntent(id, 7, PLAN_HASH);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IntentBook.IntentAlreadyExists.selector, intentId));
        intents.createIntent(id, 7, PLAN_HASH);

        // Even after the intent has run to completion, its id stays consumed.
        _validateAndReserve(intentId, id, 100e18);
        vm.startPrank(executor);
        intents.submitIntent(intentId, keccak256("REF"));
        intents.recordFill(intentId, 100e18);
        intents.reconcile(intentId);
        vm.stopPrank();

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IntentBook.IntentAlreadyExists.selector, intentId));
        intents.createIntent(id, 7, PLAN_HASH);
    }

    function test_onlyTheNamedAgentCanCreateAnIntent() public {
        bytes32 id = _registerBaseMandate();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IntentBook.NotIntentAgent.selector, id));
        intents.createIntent(id, 7, PLAN_HASH);
    }

    function test_revokedMandateStopsIntentCreation() public {
        bytes32 id = _registerBaseMandate();
        vm.prank(owner);
        mandateReg.revokeMandate(id, keccak256("STOP"));

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IntentBook.MandateNotLive.selector, id));
        intents.createIntent(id, 7, PLAN_HASH);
    }

    /// @notice Revocation between validation and reservation stops the capital, because the
    ///         reservation re-checks liveness rather than trusting the earlier decision.
    function test_revocationBetweenValidateAndReserveStopsCapital() public {
        bytes32 id = _registerBaseMandate();
        vm.prank(agent);
        bytes32 intentId = intents.createIntent(id, 7, PLAN_HASH);

        MandateRegistry.AuthorizationRequest memory q = _tradeRequest(id, 300e18);
        vm.prank(agent);
        intents.validateIntent(intentId, q, _assetProof(USTB_ID), _venueProof(VENUE_A));

        vm.prank(owner);
        mandateReg.revokeMandate(id, keccak256("STOP"));

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IntentBook.MandateNotLive.selector, id));
        intents.reserveIntent(intentId);
        assertEq(clearing.reservedOf(owner), 0, "no capital committed");
    }

    function test_intentValidationRefusesAForeignAuthorization() public {
        bytes32 idA = _registerBaseMandate();
        MandateRegistry.Mandate memory m = _baseMandate();
        m.nonce = 2;
        bytes32 idB = mandateReg.registerMandate(m, _sign(OWNER_PK, m));

        vm.prank(agent);
        bytes32 intentId = intents.createIntent(idA, 7, PLAN_HASH);

        vm.prank(agent);
        vm.expectRevert(IntentBook.RequestMandateMismatch.selector);
        intents.validateIntent(
            intentId, _tradeRequest(idB, 100e18), _assetProof(USTB_ID), _venueProof(VENUE_A)
        );
    }

    // ---------------------------------------------------------------------------------
    // IntentBook — reservation lifecycle (I-23, I-24)
    // ---------------------------------------------------------------------------------

    function test_happyPathReservesAndReconciles() public {
        bytes32 id = _registerBaseMandate();
        bytes32 intentId = _createValidateReserve(id, 8, 300e18);
        assertEq(clearing.reservedOf(owner), 300e18, "capital reserved before submission");

        vm.startPrank(executor);
        intents.submitIntent(intentId, keccak256("VENUE_REF"));
        intents.recordFill(intentId, 300e18);
        assertEq(uint8(intents.statusOf(intentId)), uint8(IntentBook.IntentStatus.FILLED));
        intents.reconcile(intentId);
        vm.stopPrank();

        IntentBook.Intent memory it = intents.getIntent(intentId);
        assertEq(uint8(it.status), uint8(IntentBook.IntentStatus.RECONCILED));
        assertEq(it.filledUsd18, 300e18);
        assertEq(it.releasedUsd18, 0, "nothing to release on a full fill");
    }

    /// @notice Invariant I-24. A 37% fill releases exactly 63% and not a wei more.
    function test_partialFillReleasesExactlyTheRemainder() public {
        bytes32 id = _registerBaseMandate();
        bytes32 intentId = _createValidateReserve(id, 9, 500e18);
        assertEq(clearing.reservedOf(owner), 500e18);

        vm.startPrank(executor);
        intents.submitIntent(intentId, keccak256("VENUE_REF"));
        intents.recordFill(intentId, 185e18); // 37%
        assertEq(uint8(intents.statusOf(intentId)), uint8(IntentBook.IntentStatus.PARTIALLY_FILLED));
        intents.cancelIntent(intentId, keccak256("VENUE_TIMEOUT"));
        intents.reconcile(intentId);
        vm.stopPrank();

        IntentBook.Intent memory it = intents.getIntent(intentId);
        assertEq(it.filledUsd18, 185e18, "reconciled to exactly the filled amount");
        assertEq(it.releasedUsd18, 315e18, "released exactly the remainder");
        assertEq(clearing.reservedOf(owner), 185e18, "filled portion stays committed");
    }

    /// @notice Invariant I-23. Not knowing and not having happened are different states.
    function test_executionUnknownReleasesNothing() public {
        bytes32 id = _registerBaseMandate();
        bytes32 intentId = _createValidateReserve(id, 10, 400e18);

        vm.startPrank(executor);
        intents.submitIntent(intentId, keccak256("VENUE_REF"));
        intents.markExecutionUnknown(intentId, keccak256("RPC_RESPONSE_LOST"));
        vm.stopPrank();

        assertEq(clearing.reservedOf(owner), 400e18, "I-23: reservation stands");
        assertEq(intents.outstandingReservation(intentId), 400e18);

        // And there is no shortcut from "unknown" to "settled".
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                IntentBook.BadTransition.selector,
                intentId,
                IntentBook.IntentStatus.EXECUTION_UNKNOWN,
                IntentBook.IntentStatus.RECONCILED
            )
        );
        intents.reconcile(intentId);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                IntentBook.BadTransition.selector,
                intentId,
                IntentBook.IntentStatus.EXECUTION_UNKNOWN,
                IntentBook.IntentStatus.CANCELLED
            )
        );
        intents.cancelIntent(intentId, keccak256("GIVE_UP"));

        assertEq(clearing.reservedOf(owner), 400e18, "still nothing released");
    }

    function test_unknownResolvesThroughReconciliationRequired() public {
        bytes32 id = _registerBaseMandate();
        bytes32 intentId = _createValidateReserve(id, 11, 400e18);

        vm.startPrank(executor);
        intents.submitIntent(intentId, keccak256("VENUE_REF"));
        intents.markExecutionUnknown(intentId, keccak256("RPC_RESPONSE_LOST"));
        intents.requireReconciliation(intentId);
        intents.recordFill(intentId, 150e18);
        intents.cancelIntent(intentId, keccak256("NO_MORE_FILLS"));
        intents.reconcile(intentId);
        vm.stopPrank();

        IntentBook.Intent memory it = intents.getIntent(intentId);
        assertEq(it.filledUsd18, 150e18);
        assertEq(it.releasedUsd18, 250e18);
        assertEq(clearing.reservedOf(owner), 150e18);
    }

    /// @notice Invariant I-19 at the book layer: a venue report cannot claim more than was
    ///         reserved, so an adapter cannot consume capital it was never given.
    function test_fillCannotExceedReservation() public {
        bytes32 id = _registerBaseMandate();
        bytes32 intentId = _createValidateReserve(id, 12, 300e18);

        vm.startPrank(executor);
        intents.submitIntent(intentId, keccak256("VENUE_REF"));
        vm.expectRevert(
            abi.encodeWithSelector(IntentBook.FillExceedsReservation.selector, 300e18 + 1, 300e18)
        );
        intents.recordFill(intentId, 300e18 + 1);
        vm.stopPrank();
    }

    function test_reserveUsesExactlyTheAuthorizedAmount() public {
        bytes32 id = _registerBaseMandate();
        bytes32 intentId = _createValidateReserve(id, 13, 250e18);
        IntentBook.Intent memory it = intents.getIntent(intentId);
        assertEq(it.authorizedUsd18, 250e18);
        assertEq(it.reservedUsd18, 250e18, "reservation is the authorized size, not a parameter");
    }

    function test_onlyExecutorCanReportVenueState() public {
        bytes32 id = _registerBaseMandate();
        bytes32 intentId = _createValidateReserve(id, 14, 100e18);

        vm.prank(agent);
        vm.expectRevert();
        intents.submitIntent(intentId, keccak256("REF"));
    }

    // ---------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------

    function _baseMandate() internal view returns (MandateRegistry.Mandate memory m) {
        m = MandateRegistry.Mandate({
            owner: owner,
            agent: agent,
            accountId: ownerAccountId,
            validFrom: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 7 days),
            maxDebtUsd: 500e18,
            maxTradeNotionalUsd: 1_000e18,
            maxEffectiveLeverageBps: 30_000,
            maxSlippageBps: 50,
            allowedActions: baseActions,
            requiredPassportFreshness: 7 days,
            allowedAssetsRoot: assetsRoot,
            allowedVenuesRoot: venuesRoot,
            nonce: 1
        });
    }

    function _registerBaseMandate() internal returns (bytes32) {
        MandateRegistry.Mandate memory m = _baseMandate();
        return mandateReg.registerMandate(m, _sign(OWNER_PK, m));
    }

    function _structHash(MandateRegistry.Mandate memory m) internal view returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(typeHash, m.owner, m.agent, m.accountId, m.validFrom, m.expiresAt),
                abi.encode(m.maxDebtUsd, m.maxTradeNotionalUsd, m.maxEffectiveLeverageBps),
                abi.encode(m.maxSlippageBps, m.allowedActions, m.requiredPassportFreshness),
                abi.encode(m.allowedAssetsRoot, m.allowedVenuesRoot, m.nonce)
            )
        );
    }

    function _digest(MandateRegistry.Mandate memory m) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", domainSep, _structHash(m)));
    }

    function _sign(uint256 pk, MandateRegistry.Mandate memory m) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(m));
        return abi.encodePacked(r, s, v);
    }

    function _borrowRequest(bytes32 mandateId, uint256 amount)
        internal
        view
        returns (MandateRegistry.AuthorizationRequest memory q)
    {
        q = MandateRegistry.AuthorizationRequest({
            mandateId: mandateId,
            agent: agent,
            action: MandateRegistry.MandateAction.BORROW,
            assetId: USTB_ID,
            venueId: bytes32(0),
            amountUsd18: amount,
            projectedDebtUsd18: amount,
            grossExposureUsd18: 0,
            equityUsd18: 0,
            passportCommittedAt: passportAt,
            slippageBps: 10
        });
    }

    function _tradeRequest(bytes32 mandateId, uint256 amount)
        internal
        view
        returns (MandateRegistry.AuthorizationRequest memory q)
    {
        q = _borrowRequest(mandateId, amount);
        q.action = MandateRegistry.MandateAction.TRADE;
        q.venueId = VENUE_A;
        q.projectedDebtUsd18 = 0;
    }

    /// @dev Asserts through all three surfaces at once: the named reason the UI renders, the
    ///      boolean an executor branches on, and the enforcing revert on the state-changing path.
    ///      Checking only the view would let the predicate and the enforcement drift apart, which
    ///      is the failure where a UI correctly says "denied" and the contract lets it through.
    function _expectReason(
        bytes32 mandateId,
        MandateRegistry.AuthorizationRequest memory q,
        bytes32[] memory assetProof,
        bytes32[] memory venueProof,
        MandateRegistry.Reason expected
    ) internal {
        assertEq(uint8(mandateReg.authorizationReason(q, assetProof, venueProof)), uint8(expected), "reason");
        assertFalse(mandateReg.isAuthorized(q, assetProof, venueProof), "must not authorize");

        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.Denied.selector, mandateId, expected));
        mandateReg.authorize(q, assetProof, venueProof);
    }

    function _validateAndReserve(bytes32 intentId, bytes32 mandateId, uint256 amount) internal {
        MandateRegistry.AuthorizationRequest memory q = _tradeRequest(mandateId, amount);
        bytes32[] memory ap = _assetProof(USTB_ID);
        bytes32[] memory vp = _venueProof(VENUE_A);
        vm.prank(agent);
        intents.validateIntent(intentId, q, ap, vp);
        vm.prank(agent);
        intents.reserveIntent(intentId);
    }

    function _createValidateReserve(bytes32 mandateId, uint256 nonce, uint256 amount)
        internal
        returns (bytes32 intentId)
    {
        vm.prank(agent);
        intentId = intents.createIntent(mandateId, nonce, PLAN_HASH);
        _validateAndReserve(intentId, mandateId, amount);
    }

    // --- Merkle -----------------------------------------------------------------------

    function _pairRoot(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _leaf(bytes32 id) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(id))));
    }

    function _assetProof(bytes32 assetId) internal view returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = _leaf(assetId == USTB_ID ? USDC_ID : USTB_ID);
    }

    function _venueProof(bytes32 venueId) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = _leaf(venueId == VENUE_A ? VENUE_B : VENUE_A);
    }

    function _noProof() internal pure returns (bytes32[] memory p) {
        p = new bytes32[](0);
    }

    // --- Raw calldata, for probing the ABI boundary ------------------------------------

    /// @dev Hand-encodes `isAuthorized` so an out-of-range action ordinal can be presented to the
    ///      decoder. Solidity will not let the enum hold such a value, which is the property under
    ///      test — so the calldata has to be built without it. Head is 11 static struct words plus
    ///      two array offsets; both arrays are empty.
    function _rawIsAuthorized(bytes32 mandateId, uint8 rawAction) internal view returns (bytes memory) {
        bytes memory args = bytes.concat(
            abi.encode(mandateId, agent, uint256(rawAction), USTB_ID),
            abi.encode(bytes32(0), uint256(1e18), uint256(1e18), uint256(0)),
            abi.encode(uint256(0), uint256(block.timestamp), uint256(0)),
            abi.encode(uint256(13 * 32), uint256(14 * 32), uint256(0), uint256(0))
        );
        return bytes.concat(bytes4(keccak256(bytes(IS_AUTHORIZED_SIG))), args);
    }
}
