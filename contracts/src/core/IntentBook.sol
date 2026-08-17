// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {ClearingHouse} from "./ClearingHouse.sol";
import {MandateRegistry} from "./MandateRegistry.sol";

/// @title IntentBook
/// @notice The ledger of everything an agent has asked the protocol to do externally, and the
///         only place a reservation is created or released.
///
/// @dev `spec/state-machines.md §4` is implemented here edge for edge. Two of its rules are the
///      reason this contract exists at all, and both are about the difference between *knowing*
///      and *not knowing*:
///
///      - `ExecutionUnknown` releases nothing (invariant I-23). "We do not know" and "it did not
///        happen" are different states, and collapsing them frees a reservation for capital that
///        may already be spent. `markExecutionUnknown` therefore contains no release call at all;
///        it is not a guarded release, it is an absent one.
///      - A partial fill reconciles to exactly the filled amount and releases exactly the
///        remainder (invariant I-24). The remainder is computed from the recorded fill, never
///        from an adapter's claim about what is left.
///
///      **Where a stranded reservation can and cannot happen.** The frozen machine has no edge
///      out of `Reserved` other than `Submitted`. A venue that rejects the order is expressed as
///      `Submitted → ExecutionUnknown → ReconciliationRequired → Cancelled → Reconciled`, which
///      reaches the same terminal state by a longer path and keeps the unknown state
///      distinguishable on the way. Adding a direct `Reserved → Cancelled` edge would be a
///      specification change and needs an RFC, not an implementation decision.
///
///      **What happens to the filled portion.** Reconciliation releases the unfilled remainder
///      and leaves the filled portion reserved, emitting `FillSettlementDue`. Releasing it here
///      without simultaneously creating the matching debt would free borrowing capacity against
///      capital that is already gone — invariant I-23's failure mode wearing a different hat. The
///      conversion belongs to the settlement adapter, which is deliberately not wired this
///      session; until it is, the residue stays on the conservative side.
///
///      **Integration surface.** `ClearingHouse` is untouched: `reserve` and `releaseReservation`
///      are already `CLEARING`-gated external functions, so this contract integrates by being
///      granted that role rather than by editing the file. The settlement adapter, when it lands,
///      consumes `FillSettlementDue` and calls the financing path; nothing in this contract needs
///      to change for it.
contract IntentBook is Authorized {
    /// @dev A role of its own rather than reuse of `CLEARING`. `CLEARING` is held by
    ///      `ClearingHouse` and `FinancingEngine`, which can move vault cash; handing that same
    ///      role to whatever observes a venue would make an execution adapter a custody
    ///      participant. `Authority` stores roles in an open mapping, so this is granted through
    ///      the existing governance path with no change to `Authority` itself.
    bytes32 public constant EXECUTOR = keccak256("USANCE_INTENT_EXECUTOR");

    /// @dev `NONE` is the zero value and means "this intentId was never created". Keeping it
    ///      distinguishable is what makes `create` able to reject a duplicate (invariant I-20)
    ///      without a second mapping that could drift out of step with this one.
    enum IntentStatus {
        NONE,
        CREATED,
        VALIDATED,
        RESERVED,
        SUBMITTED,
        PARTIALLY_FILLED,
        FILLED,
        CANCELLED,
        EXECUTION_UNKNOWN,
        RECONCILIATION_REQUIRED,
        RECONCILED
    }

    struct Intent {
        bytes32 accountId;
        bytes32 mandateId;
        address account;
        address agent;
        uint256 nonce;
        bytes32 planHash;
        uint256 authorizedUsd18;
        uint256 reservedUsd18;
        uint256 filledUsd18;
        uint256 releasedUsd18;
        uint64 createdAt;
        uint64 updatedAt;
        IntentStatus status;
    }

    MandateRegistry public immutable mandates;
    ClearingHouse public immutable clearing;

    mapping(bytes32 intentId => Intent) internal _intents;

    event IntentCreated(
        bytes32 indexed intentId, bytes32 indexed accountId, bytes32 indexed mandateId, bytes32 planHash
    );
    event IntentValidated(bytes32 indexed intentId, uint256 authorizedUsd18);
    event IntentReserved(bytes32 indexed intentId, uint256 amountUsd18);
    event IntentSubmitted(bytes32 indexed intentId, bytes32 venueRef);
    event IntentFillRecorded(bytes32 indexed intentId, uint256 filledUsd18, uint256 cumulativeUsd18);
    event IntentExecutionUnknown(bytes32 indexed intentId, bytes32 evidence);
    event IntentReconciliationRequired(bytes32 indexed intentId);
    event IntentCancelled(bytes32 indexed intentId, bytes32 reason);
    event IntentReconciled(bytes32 indexed intentId, uint256 filledUsd18, uint256 releasedUsd18);
    event FillSettlementDue(bytes32 indexed intentId, address indexed account, uint256 filledUsd18);

    error IntentAlreadyExists(bytes32 intentId);
    error UnknownIntent(bytes32 intentId);
    error BadTransition(bytes32 intentId, IntentStatus from, IntentStatus to);
    error NotIntentAgent(bytes32 intentId);
    error MandateNotLive(bytes32 mandateId);
    error RequestMandateMismatch();
    error RequestAgentMismatch();
    error FillExceedsReservation(uint256 cumulative, uint256 reserved);
    error ZeroAmount();

    constructor(Authority authority_, MandateRegistry mandates_, ClearingHouse clearing_)
        Authorized(authority_)
    {
        mandates = mandates_;
        clearing = clearing_;
    }

    // ---------------------------------------------------------------------------------
    // Identity — spec/accounting.md §2
    // ---------------------------------------------------------------------------------

    function intentIdFor(bytes32 accountId, bytes32 mandateId, uint256 nonce, bytes32 planHash)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(accountId, mandateId, nonce, planHash));
    }

    // ---------------------------------------------------------------------------------
    // Created → Validated → Reserved
    // ---------------------------------------------------------------------------------

    /// @notice Open an intent under a live mandate.
    /// @dev Invariant I-20. The id is derived from `(accountId, mandateId, nonce, planHash)`, so a
    ///      replayed or duplicated submission derives the same id and finds the slot occupied.
    ///      Rejecting on `status != NONE` rather than on a separate "seen" set means there is no
    ///      second structure that could disagree about whether this intent already exists.
    function createIntent(bytes32 mandateId, uint256 nonce, bytes32 planHash)
        external
        returns (bytes32 intentId)
    {
        if (!mandates.isLive(mandateId)) revert MandateNotLive(mandateId);

        MandateRegistry.Mandate memory m = mandates.getMandate(mandateId);
        // Reported against the mandate rather than the intent: the intentId does not exist yet,
        // and an error naming a slot that was never written is worse than no error.
        if (msg.sender != m.agent) revert NotIntentAgent(mandateId);

        intentId = intentIdFor(m.accountId, mandateId, nonce, planHash);
        Intent storage it = _intents[intentId];
        if (it.status != IntentStatus.NONE) revert IntentAlreadyExists(intentId);

        it.accountId = m.accountId;
        it.mandateId = mandateId;
        it.account = m.owner;
        it.agent = m.agent;
        it.nonce = nonce;
        it.planHash = planHash;
        it.createdAt = uint64(block.timestamp);
        it.updatedAt = uint64(block.timestamp);
        it.status = IntentStatus.CREATED;

        emit IntentCreated(intentId, m.accountId, mandateId, planHash);
    }

    /// @notice Run the mandate check and record the authorised size.
    /// @dev The request is bound to the intent it validates. Without that binding an agent could
    ///      validate a cheap intent by presenting an authorization it obtained for a different
    ///      mandate, which would make the whole envelope decorative.
    function validateIntent(
        bytes32 intentId,
        MandateRegistry.AuthorizationRequest calldata req,
        bytes32[] calldata assetProof,
        bytes32[] calldata venueProof
    ) external {
        Intent storage it = _intents[intentId];
        _requireStatus(intentId, it, IntentStatus.CREATED, IntentStatus.VALIDATED);
        if (msg.sender != it.agent) revert NotIntentAgent(intentId);
        if (req.mandateId != it.mandateId) revert RequestMandateMismatch();
        if (req.agent != it.agent) revert RequestAgentMismatch();
        if (req.amountUsd18 == 0) revert ZeroAmount();

        // Reverts with the specific bound that was hit if the act is outside the envelope, and
        // consumes the owner's budget if it is inside. Both effects belong to the registry.
        mandates.authorize(req, assetProof, venueProof);

        it.authorizedUsd18 = req.amountUsd18;
        it.updatedAt = uint64(block.timestamp);
        it.status = IntentStatus.VALIDATED;

        emit IntentValidated(intentId, req.amountUsd18);
    }

    /// @notice Commit capital on `ClearingHouse` for exactly the authorised amount.
    /// @dev The amount is not a parameter. Taking one would let an agent reserve more than the
    ///      mandate check priced, and the reservation is the budget an adapter spends against
    ///      (invariant I-19).
    function reserveIntent(bytes32 intentId) external {
        Intent storage it = _intents[intentId];
        _requireStatus(intentId, it, IntentStatus.VALIDATED, IntentStatus.RESERVED);
        if (msg.sender != it.agent) revert NotIntentAgent(intentId);
        // Re-checked here rather than trusting the check made at validation: a mandate revoked
        // between the two calls must stop capital moving, and revocation is immediate (I-27).
        if (!mandates.isLive(it.mandateId)) revert MandateNotLive(it.mandateId);

        uint256 amount = it.authorizedUsd18;
        it.reservedUsd18 = amount;
        it.updatedAt = uint64(block.timestamp);
        it.status = IntentStatus.RESERVED;

        clearing.reserve(it.account, amount, intentId);
        emit IntentReserved(intentId, amount);
    }

    // ---------------------------------------------------------------------------------
    // Reserved → Submitted → {PartiallyFilled, Filled, ExecutionUnknown}
    // ---------------------------------------------------------------------------------

    function submitIntent(bytes32 intentId, bytes32 venueRef) external onlyRole(EXECUTOR) {
        Intent storage it = _intents[intentId];
        _requireStatus(intentId, it, IntentStatus.RESERVED, IntentStatus.SUBMITTED);
        it.updatedAt = uint64(block.timestamp);
        it.status = IntentStatus.SUBMITTED;
        emit IntentSubmitted(intentId, venueRef);
    }

    /// @notice Record an observed fill.
    /// @dev Cumulative, and capped at the reservation. Invariant I-19: an adapter cannot consume
    ///      more capital than it reserved, and the cap is enforced here rather than trusted from
    ///      the venue report. Reaching the reservation exactly is `Filled`; anything short is
    ///      `PartiallyFilled` and stays open for more fills or a cancellation.
    function recordFill(bytes32 intentId, uint256 filledUsd18) external onlyRole(EXECUTOR) {
        Intent storage it = _intents[intentId];
        IntentStatus from = it.status;
        if (from == IntentStatus.NONE) revert UnknownIntent(intentId);
        if (
            from != IntentStatus.SUBMITTED && from != IntentStatus.PARTIALLY_FILLED
                && from != IntentStatus.RECONCILIATION_REQUIRED
        ) revert BadTransition(intentId, from, IntentStatus.PARTIALLY_FILLED);
        if (filledUsd18 == 0) revert ZeroAmount();

        uint256 cumulative = it.filledUsd18 + filledUsd18;
        if (cumulative > it.reservedUsd18) revert FillExceedsReservation(cumulative, it.reservedUsd18);

        it.filledUsd18 = cumulative;
        it.updatedAt = uint64(block.timestamp);
        it.status = cumulative == it.reservedUsd18 ? IntentStatus.FILLED : IntentStatus.PARTIALLY_FILLED;

        emit IntentFillRecorded(intentId, filledUsd18, cumulative);
    }

    /// @notice The venue's result is unavailable.
    /// @dev Invariant I-23, and the whole reason this state has a name. There is no call to
    ///      `clearing.releaseReservation` in this function and no branch that could reach one.
    ///      The reservation stands until reconciliation proves what actually happened.
    function markExecutionUnknown(bytes32 intentId, bytes32 evidence) external onlyRole(EXECUTOR) {
        Intent storage it = _intents[intentId];
        _requireStatus(intentId, it, IntentStatus.SUBMITTED, IntentStatus.EXECUTION_UNKNOWN);
        it.updatedAt = uint64(block.timestamp);
        it.status = IntentStatus.EXECUTION_UNKNOWN;
        emit IntentExecutionUnknown(intentId, evidence);
    }

    function requireReconciliation(bytes32 intentId) external onlyRole(EXECUTOR) {
        Intent storage it = _intents[intentId];
        _requireStatus(intentId, it, IntentStatus.EXECUTION_UNKNOWN, IntentStatus.RECONCILIATION_REQUIRED);
        it.updatedAt = uint64(block.timestamp);
        it.status = IntentStatus.RECONCILIATION_REQUIRED;
        emit IntentReconciliationRequired(intentId);
    }

    /// @notice Stop an intent that will take no further fills.
    /// @dev Reachable from `PartiallyFilled` and `ReconciliationRequired` only, matching the
    ///      frozen machine. Cancelling releases nothing on its own — release is reconciliation's
    ///      job, and keeping it there means there is exactly one function in this contract that
    ///      can hand capital back.
    function cancelIntent(bytes32 intentId, bytes32 reason) external {
        Intent storage it = _intents[intentId];
        IntentStatus from = it.status;
        if (from == IntentStatus.NONE) revert UnknownIntent(intentId);
        if (from != IntentStatus.PARTIALLY_FILLED && from != IntentStatus.RECONCILIATION_REQUIRED) {
            revert BadTransition(intentId, from, IntentStatus.CANCELLED);
        }
        if (
            msg.sender != it.agent && !authority.hasRole(EXECUTOR, msg.sender)
                && !authority.hasRole(authority.GUARDIAN(), msg.sender)
        ) revert NotIntentAgent(intentId);

        it.updatedAt = uint64(block.timestamp);
        it.status = IntentStatus.CANCELLED;
        emit IntentCancelled(intentId, reason);
    }

    // ---------------------------------------------------------------------------------
    // {Filled, Cancelled} → Reconciled
    // ---------------------------------------------------------------------------------

    /// @notice Settle the intent against what was actually observed.
    /// @dev Invariant I-24: the released amount is `reserved - filled`, computed from the recorded
    ///      fill, so a 37% fill releases exactly 63% and not a basis point more. Reachable only
    ///      from `Filled` and `Cancelled` — an `ExecutionUnknown` intent has no route here until
    ///      it has passed through `ReconciliationRequired` and been resolved, which is what stops
    ///      "we lost the response" from becoming "release the money".
    function reconcile(bytes32 intentId) external onlyRole(EXECUTOR) {
        Intent storage it = _intents[intentId];
        IntentStatus from = it.status;
        if (from == IntentStatus.NONE) revert UnknownIntent(intentId);
        if (from != IntentStatus.FILLED && from != IntentStatus.CANCELLED) {
            revert BadTransition(intentId, from, IntentStatus.RECONCILED);
        }

        uint256 remainder = it.reservedUsd18 - it.filledUsd18;
        it.releasedUsd18 = remainder;
        it.updatedAt = uint64(block.timestamp);
        it.status = IntentStatus.RECONCILED;

        if (remainder != 0) clearing.releaseReservation(it.account, remainder, intentId);
        if (it.filledUsd18 != 0) emit FillSettlementDue(intentId, it.account, it.filledUsd18);

        emit IntentReconciled(intentId, it.filledUsd18, remainder);
    }

    // ---------------------------------------------------------------------------------
    // Internals and views
    // ---------------------------------------------------------------------------------

    function _requireStatus(bytes32 intentId, Intent storage it, IntentStatus from, IntentStatus to)
        internal
        view
    {
        if (it.status == IntentStatus.NONE) revert UnknownIntent(intentId);
        if (it.status != from) revert BadTransition(intentId, it.status, to);
    }

    function getIntent(bytes32 intentId) external view returns (Intent memory) {
        Intent memory it = _intents[intentId];
        if (it.status == IntentStatus.NONE) revert UnknownIntent(intentId);
        return it;
    }

    function statusOf(bytes32 intentId) external view returns (IntentStatus) {
        return _intents[intentId].status;
    }

    /// @notice Capital still committed to this intent: reserved, less whatever was released.
    function outstandingReservation(bytes32 intentId) external view returns (uint256) {
        Intent storage it = _intents[intentId];
        return it.reservedUsd18 - it.releasedUsd18;
    }
}
