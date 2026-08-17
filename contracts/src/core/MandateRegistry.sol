// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {Authority, Authorized} from "./Authority.sol";
import {RiskMath} from "../libraries/RiskMath.sol";
import {Types} from "../libraries/Types.sol";

/// @title MandateRegistry
/// @notice The boundary between "an agent decided something" and "the protocol will act on it".
///
/// @dev Usance's safety argument for autonomous agents is not that the model is well behaved. It
///      is that the model's output arrives at a component with no authority, and that the only
///      authority in the system is a bounded envelope the owner signed with their own wallet.
///      This contract is that envelope. It never computes a risk number and never moves a token;
///      it answers one question — "is this act inside what the owner signed" — and keeps the
///      running budget that makes the answer cumulative rather than per-call.
///
///      Three structural properties, each chosen so that a misconfiguration cannot defeat it:
///
///      1. **No mandate authorises a withdrawal (invariant I-28).** The action vocabulary is a
///         closed Solidity enum with no outflow verb in it, committed to as a bitmask rather than
///         a Merkle root. A root would let an owner commit to `keccak256("WITHDRAW")` and later
///         prove membership of a leaf the protocol never defined; a bitmask over a closed enum
///         cannot name an action that does not exist. `ACTION_VOCABULARY` freezes the whole list,
///         so extending it is a visible, reviewed act rather than a quiet one. On top of that,
///         `AuthorizationRequest` has no destination field anywhere: an authorization that cannot
///         name a recipient cannot authorise an outflow, whatever its parameters say.
///
///      2. **Assets and venues are Merkle roots.** Unlike actions, those sets are open-ended,
///         user-chosen and potentially large, and the protocol does not know them at signing
///         time. A root keeps the signed payload constant-size, keeps membership proofs
///         O(log n), and commits to the exact set — an asset added after signing has no proof.
///
///      3. **MandateRegistry produces no risk numbers.** Debt, exposure and equity arrive as
///         inputs, already computed by `RiskMath` through `ClearingHouse`. Recomputing them here
///         would create a second opinion about a risk number, which is precisely the failure mode
///         `spec/accounting.md §3` exists to prevent.
///
///      **Deviation recorded.** The planning material's mandate shape does not name the delegate.
///      An `agent` field is added here, because an authorization layer that says what may be done
///      but not by whom is a bearer instrument: anyone who observed the mandate could act inside
///      it. Nothing else about the shape changes, and the field is inside the EIP-712 type, so it
///      is covered by the owner's signature like every other bound.
///
///      **Integration surface (deliberately unwired this session).** `ClearingHouse` is untouched
///      here. The wiring, when it lands, is one call: an agent-initiated borrow enters through
///      `IntentBook`, which calls `authorize` before `ClearingHouse.reserve`. `ClearingHouse`
///      itself gains no reference to this contract and no mandate-shaped parameter, because the
///      owner-initiated paths must keep working with no mandate at all — a user with a wallet is
///      not required to have an agent.
contract MandateRegistry is Authorized, EIP712 {
    // ---------------------------------------------------------------------------------
    // Action vocabulary — the structural half of invariant I-28
    // ---------------------------------------------------------------------------------

    /// @dev Every verb an agent may ever be delegated. There is no withdrawal, transfer, approval
    ///      or redemption member, and there never will be one without an RFC: `ACTION_VOCABULARY`
    ///      hashes this exact list and `Mandate.t.sol` asserts the hash, so adding a member breaks
    ///      the suite loudly instead of quietly widening what a signature can mean.
    enum MandateAction {
        BORROW, //          0
        REPAY, //           1
        ADD_COLLATERAL, //  2
        TRADE, //           3
        HEDGE, //           4
        CLOSE //            5
    }

    uint8 public constant ACTION_COUNT = 6;

    /// @notice Frozen enumeration of the entire action vocabulary.
    /// @dev A canary, not a lookup. Its only job is to fail a test when someone widens the set.
    bytes32 public constant ACTION_VOCABULARY =
        keccak256("USANCE_MANDATE_ACTIONS_V1:BORROW,REPAY,ADD_COLLATERAL,TRADE,HEDGE,CLOSE");

    uint16 internal constant BIT_TRADE = uint16(1) << uint16(uint8(MandateAction.TRADE));
    uint16 internal constant BIT_HEDGE = uint16(1) << uint16(uint8(MandateAction.HEDGE));
    uint16 internal constant BIT_CLOSE = uint16(1) << uint16(uint8(MandateAction.CLOSE));

    /// @dev Actions that execute against an external venue and therefore must name one.
    uint16 internal constant VENUE_ACTIONS = BIT_TRADE | BIT_HEDGE | BIT_CLOSE;

    /// @dev Actions that draw down the signed notional budget. `REPAY` and `ADD_COLLATERAL` are
    ///      absent on purpose: neither touches a venue, so both are unambiguously risk-reducing
    ///      whatever the caller claims, and charging them against a cap would give an agent a
    ///      reason to leave a position open rather than unwind it once the budget ran low.
    ///
    ///      `CLOSE` is charged despite reading as risk-reducing, because this contract cannot
    ///      verify direction: a "close" is a venue order like any other, and an agent that could
    ///      spend an uncapped budget by labelling orders `CLOSE` would have no notional cap at
    ///      all. Direction is bounded by `maxEffectiveLeverageBps` instead, which is computed from
    ///      numbers `RiskMath` produced rather than from a label the caller chose.
    uint16 internal constant NOTIONAL_ACTIONS = VENUE_ACTIONS;

    // ---------------------------------------------------------------------------------
    // Bounds on what a signature may express
    // ---------------------------------------------------------------------------------

    /// @dev A mandate with no horizon is a key handover with extra steps. Ninety days is long
    ///      enough for a real strategy and short enough that a forgotten signature expires.
    uint64 public constant MAX_MANDATE_DURATION = 90 days;

    /// @dev Matches the outer bound `RiskPolicyRegistry` policies use for Passport freshness. A
    ///      mandate cannot tolerate staler evidence than the risk pipeline itself would.
    uint64 public constant MAX_PASSPORT_FRESHNESS = 30 days;

    // ---------------------------------------------------------------------------------
    // The signed envelope
    // ---------------------------------------------------------------------------------

    /// @param maxDebtUsd usd18. Cumulative principal an agent may draw under this mandate, not a
    ///        per-call ceiling — a per-call ceiling is defeated by splitting the borrow, which is
    ///        the first thing an autonomous loop does.
    /// @param maxTradeNotionalUsd usd18, cumulative, for the same reason.
    /// @param requiredPassportFreshness seconds. Zero is rejected at registration rather than
    ///        being read as "no requirement": an unset bound must never silently become an
    ///        unbounded one.
    /// @param allowedActions bitmask over `MandateAction`. Bits above the vocabulary are rejected.
    struct Mandate {
        address owner;
        address agent;
        bytes32 accountId;
        uint64 validFrom;
        uint64 expiresAt;
        uint256 maxDebtUsd;
        uint256 maxTradeNotionalUsd;
        uint16 maxEffectiveLeverageBps;
        uint16 maxSlippageBps;
        uint16 allowedActions;
        uint64 requiredPassportFreshness;
        bytes32 allowedAssetsRoot;
        bytes32 allowedVenuesRoot;
        uint256 nonce;
    }

    /// @dev The literal is split across adjacent string fragments so the source obeys the 110
    ///      column limit; Solidity concatenates them at parse time, so the typehash is still a
    ///      compile-time constant and still exactly the EIP-712 encodeType string.
    bytes32 public constant MANDATE_TYPEHASH = keccak256(
        "Mandate(address owner,address agent,bytes32 accountId,uint64 validFrom,"
        "uint64 expiresAt,uint256 maxDebtUsd,uint256 maxTradeNotionalUsd,"
        "uint16 maxEffectiveLeverageBps,uint16 maxSlippageBps,uint16 allowedActions,"
        "uint64 requiredPassportFreshness,bytes32 allowedAssetsRoot,"
        "bytes32 allowedVenuesRoot,uint256 nonce)"
    );

    // ---------------------------------------------------------------------------------
    // Mutable state — everything a signature deliberately does not cover
    // ---------------------------------------------------------------------------------

    /// @dev `ownerPaused` and `guardianPaused` are separate flags rather than one, because they
    ///      are lifted by different people. A guardian may restrict and may not un-restrict
    ///      (invariant I-25, `spec/threat-model.md §6`); folding both into one flag would let an
    ///      owner clear a guardian's freeze, which turns an emergency power into a suggestion.
    struct MandateState {
        bool exists;
        bool revoked;
        bool ownerPaused;
        bool guardianPaused;
        uint256 debtDrawnUsd18;
        uint256 notionalTradedUsd18;
    }

    mapping(bytes32 mandateId => Mandate) internal _mandates;
    mapping(bytes32 mandateId => MandateState) internal _state;

    /// @dev Set on registration and never cleared, by any path, for any caller. This is what makes
    ///      revocation irreversible (I-27) and replay impossible (I-29): the nonce is spent by the
    ///      act of registering, so re-presenting the same signature — or presenting a different
    ///      one that reuses the nonce — finds the slot already burnt.
    mapping(address owner => mapping(uint256 nonce => bool)) public nonceConsumed;

    // ---------------------------------------------------------------------------------
    // Authorization request
    // ---------------------------------------------------------------------------------

    /// @notice One proposed act, fully materialised, plus the risk numbers it would produce.
    ///
    /// @dev There is no `to`, `recipient` or `receiver` field, and that omission is load-bearing:
    ///      it is the second structural leg of invariant I-28.
    ///
    /// @param projectedDebtUsd18 the account's debt *after* the act, from `RiskMath`.
    /// @param grossExposureUsd18 exposure the act would leave outstanding, from `RiskMath`.
    /// @param equityUsd18 the account's equity backing that exposure, from `RiskMath`.
    /// @param passportCommittedAt `createdAt` of the current Passport for `assetId`.
    struct AuthorizationRequest {
        bytes32 mandateId;
        address agent;
        MandateAction action;
        bytes32 assetId;
        bytes32 venueId;
        uint256 amountUsd18;
        uint256 projectedDebtUsd18;
        uint256 grossExposureUsd18;
        uint256 equityUsd18;
        uint64 passportCommittedAt;
        uint16 slippageBps;
    }

    /// @dev A named reason rather than a bare `false`. The UI has to be able to say *which* bound
    ///      an agent hit, and "the agent was refused" with no reason is how an operator learns to
    ///      widen every bound at once.
    enum Reason {
        OK,
        UNKNOWN_MANDATE,
        REVOKED,
        PAUSED,
        WRONG_AGENT,
        NOT_YET_VALID,
        EXPIRED,
        ACTION_NOT_COMMITTED,
        ASSET_NOT_COMMITTED,
        VENUE_NOT_COMMITTED,
        PASSPORT_STALE,
        SLIPPAGE_CAP_EXCEEDED,
        DEBT_CAP_EXCEEDED,
        NOTIONAL_CAP_EXCEEDED,
        LEVERAGE_CAP_EXCEEDED
    }

    // ---------------------------------------------------------------------------------
    // Events and errors
    // ---------------------------------------------------------------------------------

    event MandateRegistered(
        bytes32 indexed mandateId,
        address indexed owner,
        address indexed agent,
        uint256 nonce,
        uint64 expiresAt
    );
    event MandateRevoked(bytes32 indexed mandateId, address indexed by, bytes32 reason);
    event MandatePaused(bytes32 indexed mandateId, address indexed by, bool byGuardian);
    event MandateResumed(bytes32 indexed mandateId, address indexed by, bool guardianFlag);
    event MandateConsumed(
        bytes32 indexed mandateId,
        address indexed agent,
        MandateAction action,
        uint256 amountUsd18,
        uint256 debtDrawnUsd18,
        uint256 notionalTradedUsd18
    );

    error Denied(bytes32 mandateId, Reason reason);
    error BadSignature();
    error NonceAlreadyConsumed(address owner, uint256 nonce);
    error AccountIdMismatch(bytes32 expected, bytes32 got);
    error BadWindow();
    error DurationTooLong(uint64 maximum);
    error FreshnessOutOfRange(uint64 maximum);
    error EmptyActionSet();
    error UndefinedActionBit(uint16 allowedActions);
    error EmptyAssetCommitment();
    error EmptyVenueCommitment();
    error SlippageOutOfRange();
    error ZeroAddress();
    error UnknownMandate(bytes32 mandateId);
    error NotOwner(bytes32 mandateId);
    error AlreadyRevoked(bytes32 mandateId);
    error GuardianCannotResume();

    constructor(Authority authority_) Authorized(authority_) EIP712("Usance Mandate", "1") {}

    // ---------------------------------------------------------------------------------
    // Identifiers — derived, never assigned (spec/accounting.md §2)
    // ---------------------------------------------------------------------------------

    /// @dev Same shape as `accountId` in `spec/accounting.md §2`, so an offchain signer and the
    ///      contract cannot disagree about which account a mandate is scoped to.
    function accountIdFor(address owner) public pure returns (bytes32) {
        return keccak256(abi.encode("USANCE_ACCOUNT_V1", owner));
    }

    /// @dev Keyed on `(owner, nonce)` and nothing else. Deriving the id from the full parameter
    ///      set instead would let two mandates share a nonce and both live, which is exactly the
    ///      uniqueness invariant I-29 asserts.
    function mandateIdFor(address owner, uint256 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode("USANCE_MANDATE_V1", owner, nonce));
    }

    /// @notice Leaf encoding for the asset and venue commitment trees.
    /// @dev Double-hashed, matching OpenZeppelin's convention: a leaf preimage is then never a
    ///      valid internal node preimage, which closes the second-preimage forgery that lets a
    ///      64-byte "leaf" masquerade as a pair of hashes.
    function leafFor(bytes32 id) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(id))));
    }

    function actionBit(MandateAction action) public pure returns (uint16) {
        return uint16(1) << uint16(uint8(action));
    }

    // ---------------------------------------------------------------------------------
    // EIP-712
    // ---------------------------------------------------------------------------------

    /// @notice The domain separator, including chainId and this contract's address.
    /// @dev Inherited from OpenZeppelin's EIP712, which rebuilds the separator if the chain forks
    ///      under a deployed contract. A cached separator would let a mandate signed for X Layer
    ///      be replayed on a fork of it.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @dev Encoded in four chunks rather than one `abi.encode` so the field count stays off the
    ///      stack ceiling; `via_ir` is off in this repo on purpose and must stay off.
    function hashMandate(Mandate calldata m) public pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(MANDATE_TYPEHASH, m.owner, m.agent, m.accountId, m.validFrom, m.expiresAt),
                abi.encode(m.maxDebtUsd, m.maxTradeNotionalUsd, m.maxEffectiveLeverageBps),
                abi.encode(m.maxSlippageBps, m.allowedActions, m.requiredPassportFreshness),
                abi.encode(m.allowedAssetsRoot, m.allowedVenuesRoot, m.nonce)
            )
        );
    }

    function mandateDigest(Mandate calldata m) public view returns (bytes32) {
        return _hashTypedDataV4(hashMandate(m));
    }

    // ---------------------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------------------

    /// @notice Register a mandate the owner signed. Anyone may relay it; the signature is the
    ///         authority, and the relayer gains nothing by holding it.
    /// @dev `SignatureChecker` covers both EOAs and ERC-1271 smart accounts, and its ECDSA path
    ///      rejects the malleable high-`s` form, so one signature cannot be reshaped into a second
    ///      distinct-but-valid one.
    function registerMandate(Mandate calldata m, bytes calldata signature)
        external
        returns (bytes32 mandateId)
    {
        _validate(m);

        if (nonceConsumed[m.owner][m.nonce]) revert NonceAlreadyConsumed(m.owner, m.nonce);
        if (!SignatureChecker.isValidSignatureNow(m.owner, mandateDigest(m), signature)) {
            revert BadSignature();
        }

        // Burnt before any state that could be re-derived from it is written. The nonce is spent
        // by registration, so the same signature presented twice finds it gone (I-29), and a
        // revoked mandate cannot be resurrected by replaying the paper that created it (I-27).
        nonceConsumed[m.owner][m.nonce] = true;

        mandateId = mandateIdFor(m.owner, m.nonce);
        _mandates[mandateId] = m;
        _state[mandateId].exists = true;

        emit MandateRegistered(mandateId, m.owner, m.agent, m.nonce, m.expiresAt);
    }

    /// @dev Every rejection here is a bound that would otherwise have to be re-checked on every
    ///      authorization. Refusing an unusable mandate at registration means a live mandate is
    ///      always one whose parameters mean something.
    function _validate(Mandate calldata m) internal view {
        if (m.owner == address(0) || m.agent == address(0)) revert ZeroAddress();

        bytes32 expected = accountIdFor(m.owner);
        if (m.accountId != expected) revert AccountIdMismatch(expected, m.accountId);

        if (m.validFrom >= m.expiresAt || m.expiresAt <= block.timestamp) revert BadWindow();
        if (m.expiresAt - m.validFrom > MAX_MANDATE_DURATION) revert DurationTooLong(MAX_MANDATE_DURATION);

        if (m.requiredPassportFreshness == 0 || m.requiredPassportFreshness > MAX_PASSPORT_FRESHNESS) {
            revert FreshnessOutOfRange(MAX_PASSPORT_FRESHNESS);
        }

        if (m.allowedActions == 0) revert EmptyActionSet();
        // Bits above the vocabulary are refused rather than ignored. Silently masking them off
        // would let a signature carry a verb this protocol does not define and let its owner
        // believe it was granted.
        if (m.allowedActions >= (uint16(1) << uint16(ACTION_COUNT))) {
            revert UndefinedActionBit(m.allowedActions);
        }

        if (m.allowedAssetsRoot == bytes32(0)) revert EmptyAssetCommitment();
        if (m.allowedActions & VENUE_ACTIONS != 0 && m.allowedVenuesRoot == bytes32(0)) {
            revert EmptyVenueCommitment();
        }

        if (m.maxSlippageBps > Types.BPS) revert SlippageOutOfRange();
    }

    // ---------------------------------------------------------------------------------
    // Revocation and pause
    // ---------------------------------------------------------------------------------

    /// @notice Revoke a mandate. Effective in this transaction and permanent.
    /// @dev Invariant I-27. There is no un-revoke function anywhere in this contract, and the
    ///      nonce that authorised this mandate is already burnt, so the only route back to a live
    ///      mandate is a fresh signature over a fresh nonce. That is the definition of
    ///      "irreversible except by a new signature", expressed as absent code rather than as a
    ///      guarded setter somebody could later relax.
    function revokeMandate(bytes32 mandateId, bytes32 reason) external {
        MandateState storage s = _state[mandateId];
        if (!s.exists) revert UnknownMandate(mandateId);
        if (s.revoked) revert AlreadyRevoked(mandateId);

        bool byOwner = msg.sender == _mandates[mandateId].owner;
        bool byEmergency = authority.hasRole(authority.GUARDIAN(), msg.sender)
            || authority.hasRole(authority.GOVERNANCE(), msg.sender);
        if (!byOwner && !byEmergency) revert NotOwner(mandateId);

        s.revoked = true;
        emit MandateRevoked(mandateId, msg.sender, reason);
    }

    /// @notice Suspend a mandate without destroying its budget history.
    /// @dev The owner's pause and the guardian's pause are recorded separately so that `resume`
    ///      can enforce who may lift which.
    function pauseMandate(bytes32 mandateId) external {
        MandateState storage s = _state[mandateId];
        if (!s.exists) revert UnknownMandate(mandateId);

        if (msg.sender == _mandates[mandateId].owner) {
            s.ownerPaused = true;
            emit MandatePaused(mandateId, msg.sender, false);
            return;
        }
        if (
            authority.hasRole(authority.GUARDIAN(), msg.sender)
                || authority.hasRole(authority.GOVERNANCE(), msg.sender)
        ) {
            s.guardianPaused = true;
            emit MandatePaused(mandateId, msg.sender, true);
            return;
        }
        revert NotOwner(mandateId);
    }

    /// @notice Lift a pause. An owner lifts their own; only governance lifts a guardian's.
    /// @dev A guardian calling this reverts outright rather than lifting nothing, because an
    ///      emergency power that appears to succeed while doing nothing is worse than one that
    ///      refuses. `spec/threat-model.md §6`: a guardian may not lift a restriction.
    function resumeMandate(bytes32 mandateId) external {
        MandateState storage s = _state[mandateId];
        if (!s.exists) revert UnknownMandate(mandateId);
        if (s.revoked) revert AlreadyRevoked(mandateId);

        if (authority.hasRole(authority.GOVERNANCE(), msg.sender)) {
            s.guardianPaused = false;
            emit MandateResumed(mandateId, msg.sender, true);
            return;
        }
        if (authority.hasRole(authority.GUARDIAN(), msg.sender)) revert GuardianCannotResume();
        if (msg.sender != _mandates[mandateId].owner) revert NotOwner(mandateId);

        s.ownerPaused = false;
        emit MandateResumed(mandateId, msg.sender, false);
    }

    // ---------------------------------------------------------------------------------
    // Authorization
    // ---------------------------------------------------------------------------------

    function isAuthorized(
        AuthorizationRequest calldata req,
        bytes32[] calldata assetProof,
        bytes32[] calldata venueProof
    ) external view returns (bool) {
        return _reasonFor(req, assetProof, venueProof) == Reason.OK;
    }

    /// @notice The same decision, with the bound that was hit. For UI and for post-mortems.
    function authorizationReason(
        AuthorizationRequest calldata req,
        bytes32[] calldata assetProof,
        bytes32[] calldata venueProof
    ) external view returns (Reason) {
        return _reasonFor(req, assetProof, venueProof);
    }

    /// @notice Check and record. Reverts unless the act is inside the signed envelope.
    /// @dev Held behind `CLEARING` because recording consumption is the act of spending the
    ///      owner's budget. An open `authorize` would let anyone burn an agent's remaining
    ///      allowance without executing anything — a free denial of service against a strategy.
    function authorize(
        AuthorizationRequest calldata req,
        bytes32[] calldata assetProof,
        bytes32[] calldata venueProof
    ) external onlyRole(authority.CLEARING()) {
        Reason r = _reasonFor(req, assetProof, venueProof);
        if (r != Reason.OK) revert Denied(req.mandateId, r);

        MandateState storage s = _state[req.mandateId];
        uint16 bit = actionBit(req.action);
        if (req.action == MandateAction.BORROW) {
            s.debtDrawnUsd18 += req.amountUsd18;
        } else if (bit & NOTIONAL_ACTIONS != 0) {
            s.notionalTradedUsd18 += req.amountUsd18;
        }

        emit MandateConsumed(
            req.mandateId, req.agent, req.action, req.amountUsd18, s.debtDrawnUsd18, s.notionalTradedUsd18
        );
    }

    // ---------------------------------------------------------------------------------
    // Check pipeline — split so no frame carries more than it must (via_ir stays off)
    // ---------------------------------------------------------------------------------

    /// @dev Ordering is deliberate. Lifecycle first, so an expired or revoked mandate is refused
    ///      before any budget is consulted — invariant I-30 says an expired mandate authorises
    ///      nothing *regardless of remaining budget*, and checking in this order means there is no
    ///      code path where the budget is even read.
    function _reasonFor(
        AuthorizationRequest calldata req,
        bytes32[] calldata assetProof,
        bytes32[] calldata venueProof
    ) internal view returns (Reason) {
        Reason r = _lifecycleReason(req);
        if (r != Reason.OK) return r;

        r = _commitmentReason(req, assetProof, venueProof);
        if (r != Reason.OK) return r;

        return _budgetReason(req);
    }

    function _lifecycleReason(AuthorizationRequest calldata req) internal view returns (Reason) {
        MandateState storage s = _state[req.mandateId];
        if (!s.exists) return Reason.UNKNOWN_MANDATE;
        if (s.revoked) return Reason.REVOKED;
        if (s.ownerPaused || s.guardianPaused) return Reason.PAUSED;

        Mandate storage m = _mandates[req.mandateId];
        if (req.agent != m.agent) return Reason.WRONG_AGENT;
        if (block.timestamp < m.validFrom) return Reason.NOT_YET_VALID;
        if (block.timestamp > m.expiresAt) return Reason.EXPIRED;
        return Reason.OK;
    }

    function _commitmentReason(
        AuthorizationRequest calldata req,
        bytes32[] calldata assetProof,
        bytes32[] calldata venueProof
    ) internal view returns (Reason) {
        Mandate storage m = _mandates[req.mandateId];

        uint16 bit = actionBit(req.action);
        if (m.allowedActions & bit == 0) return Reason.ACTION_NOT_COMMITTED;

        if (req.assetId == bytes32(0)) return Reason.ASSET_NOT_COMMITTED;
        if (!MerkleProof.verifyCalldata(assetProof, m.allowedAssetsRoot, leafFor(req.assetId))) {
            return Reason.ASSET_NOT_COMMITTED;
        }

        if (bit & VENUE_ACTIONS != 0) {
            if (req.venueId == bytes32(0)) return Reason.VENUE_NOT_COMMITTED;
            if (!MerkleProof.verifyCalldata(venueProof, m.allowedVenuesRoot, leafFor(req.venueId))) {
                return Reason.VENUE_NOT_COMMITTED;
            }
        } else if (req.venueId != bytes32(0)) {
            // A non-venue action carrying a venue is a caller that has confused two code paths.
            // Accepting it would mean the venue commitment silently stopped being checked.
            return Reason.VENUE_NOT_COMMITTED;
        }

        // A Passport dated in the future is not fresh evidence, it is a broken input, and
        // subtracting it from `block.timestamp` would underflow into "arbitrarily fresh".
        if (req.passportCommittedAt == 0 || req.passportCommittedAt > block.timestamp) {
            return Reason.PASSPORT_STALE;
        }
        if (block.timestamp - req.passportCommittedAt > m.requiredPassportFreshness) {
            return Reason.PASSPORT_STALE;
        }
        return Reason.OK;
    }

    function _budgetReason(AuthorizationRequest calldata req) internal view returns (Reason) {
        Mandate storage m = _mandates[req.mandateId];
        MandateState storage s = _state[req.mandateId];

        if (req.slippageBps > m.maxSlippageBps) return Reason.SLIPPAGE_CAP_EXCEEDED;

        uint16 bit = actionBit(req.action);
        if (req.action == MandateAction.BORROW) {
            // Cumulative first: repaying and re-drawing under one mandate must still spend budget,
            // otherwise a cap on debt is a cap on nothing.
            if (req.amountUsd18 > _remaining(m.maxDebtUsd, s.debtDrawnUsd18)) {
                return Reason.DEBT_CAP_EXCEEDED;
            }
            if (req.projectedDebtUsd18 > m.maxDebtUsd) return Reason.DEBT_CAP_EXCEEDED;
        } else if (bit & NOTIONAL_ACTIONS != 0) {
            if (req.amountUsd18 > _remaining(m.maxTradeNotionalUsd, s.notionalTradedUsd18)) {
                return Reason.NOTIONAL_CAP_EXCEEDED;
            }
        }

        if (_leverageExceeds(req.grossExposureUsd18, req.equityUsd18, m.maxEffectiveLeverageBps)) {
            return Reason.LEVERAGE_CAP_EXCEEDED;
        }
        return Reason.OK;
    }

    /// @dev Saturating rather than checked, so a view called with an absurd amount answers
    ///      "denied" instead of reverting. A UI that cannot render a refusal shows nothing.
    function _remaining(uint256 cap, uint256 used) internal pure returns (uint256) {
        return cap > used ? cap - used : 0;
    }

    /// @notice Effective leverage against the signed bound, rounded against the account.
    /// @dev `ceil(gross * BPS / equity) > maxBps` is the comparison, and it is computed with the
    ///      512-bit `RiskMath.mulDivUp` so a large position cannot overflow into a pass. The early
    ///      `gross / equity > 6` exit exists because `maxEffectiveLeverageBps` is a `uint16`:
    ///      anything above 7x already exceeds every representable bound, and taking the exit keeps
    ///      the 512-bit result inside 256 bits for every input, so this function never reverts.
    ///      Rounding up follows `spec/accounting.md §1.2` — overstate leverage, restrict earlier.
    function _leverageExceeds(uint256 gross, uint256 equity, uint16 maxBps) internal pure returns (bool) {
        if (gross == 0) return false;
        // Exposure with nothing behind it is unbounded leverage, not zero leverage.
        if (equity == 0) return true;
        if (gross / equity > uint256(type(uint16).max) / Types.BPS) return true;
        return RiskMath.mulDivUp(gross, Types.BPS, equity) > maxBps;
    }

    // ---------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------

    /// @notice True when the mandate exists, is not revoked, is not paused and is inside its
    ///         validity window. Says nothing about budgets — those are per-act.
    function isLive(bytes32 mandateId) public view returns (bool) {
        MandateState storage s = _state[mandateId];
        if (!s.exists || s.revoked || s.ownerPaused || s.guardianPaused) return false;
        Mandate storage m = _mandates[mandateId];
        return block.timestamp >= m.validFrom && block.timestamp <= m.expiresAt;
    }

    function getMandate(bytes32 mandateId) external view returns (Mandate memory) {
        if (!_state[mandateId].exists) revert UnknownMandate(mandateId);
        return _mandates[mandateId];
    }

    function getState(bytes32 mandateId) external view returns (MandateState memory) {
        return _state[mandateId];
    }

    function remainingDebtBudget(bytes32 mandateId) external view returns (uint256) {
        return _remaining(_mandates[mandateId].maxDebtUsd, _state[mandateId].debtDrawnUsd18);
    }

    function remainingNotionalBudget(bytes32 mandateId) external view returns (uint256) {
        return _remaining(_mandates[mandateId].maxTradeNotionalUsd, _state[mandateId].notionalTradedUsd18);
    }
}
