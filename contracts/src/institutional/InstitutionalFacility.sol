// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Authority, Authorized} from "../core/Authority.sol";
import {RiskPolicyRegistry} from "../core/RiskPolicyRegistry.sol";

import {FacilityValuation} from "./FacilityValuation.sol";
import {ICollateralAdapter} from "./interfaces/ICollateralAdapter.sol";
import {
    DecisionBinding,
    FacilityDecision,
    FacilityOperation,
    IAuthorityVerifier,
    IPolicyVerifier
} from "./interfaces/IFacilityDecisions.sol";
import {FacilityMath} from "./libraries/FacilityMath.sol";

/// @title InstitutionalFacility
/// @notice One bilateral secured-term financing facility. The sole owner of its own financial
///         truth: collateral custody, debt, fee, lifecycle, settlement. `spec/institutional-
///         facility-model.md`.
///
/// @dev This is a NEW `FacilityImplementation`. It does not inherit, call into, or hold any role
///      over `ClearingHouse` or the revolving-credit core. It reuses `Authority`, the registries
///      and `RiskMath` as libraries / read dependencies, nothing more.
///
///      The one property everything here is arranged around (`§7.1`, invariant I-95):
///
///          OLD COLLATERAL NEVER BECOMES RELEASABLE UNTIL A VALID REPLACEMENT HAS BEEN
///          COMMITTED AND THE FACILITY REMAINS SAFE AFTER THE REPLACEMENT.
///
///      `_releaseOldCollateral` is internal, has exactly two callers, and both run
///      `_assertReleasable` first. There is no external function that releases collateral outside
///      the substitution state machine or a terminal (SETTLED / DEFAULTED) state, and no function
///      anywhere takes a recipient parameter.
contract InstitutionalFacility is Authorized, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------------

    enum Status {
        DRAFT, //                0
        PENDING_ACTIVATION, //   1
        ACTIVE, //               2
        SUBSTITUTION_PENDING, // 3
        RECALLING, //            4
        MATURED, //              5
        SETTLED, //              6  terminal
        DEFAULTED //             7  terminal
    }

    enum SubState {
        NONE, //                   0
        REQUESTED, //              1
        REPLACEMENT_COMMITTING, // 2
        COMMITMENT_UNKNOWN, //     3
        REPLACEMENT_COMMITTED //   4
    }

    struct Collateral {
        bytes32 assetId;
        bytes32 instrumentRef;
        address adapter;
        uint256 committedUnits;
        uint64 passportVersion;
    }

    struct Substitution {
        SubState state;
        bool consumed;
        bytes32 id;
        bytes32 replacementAssetId;
        bytes32 replacementInstrumentRef;
        address replacementAdapter;
        uint256 requiredUnits;
        uint64 pinnedEpoch;
        uint64 collateralPolicyVersion;
        uint64 authorityExpiry;
        bytes32 policyDecisionHash;
        bytes32 authorityDecisionHash;
        bytes32 lastReason;
    }

    /// @notice Everything frozen at construction. A struct so the constructor is readable and the
    ///         identity-and-terms fields are visibly all in one place.
    struct Terms {
        bytes32 homeDomainId;
        bytes32 discriminator;
        address borrower;
        address lender;
        address operator; // address(0) disables the operator role
        address treasury;
        IERC20 settlementToken;
        bytes32 settlementAssetId;
        uint8 settlementDecimals;
        uint256 principalLimit;
        uint64 maturityAt;
        uint16 interestRateBps;
        uint16 originationFeeBps;
        uint16 feePolicyVersion;
        bytes32 collateralPolicyId;
        bytes32 initialCollateralAssetId;
        address initialCollateralAdapter;
        uint64 settlementMaxPriceAge;
        uint64 recallGracePeriod;
        uint64 maturityGracePeriod;
    }

    // ---------------------------------------------------------------------------------
    // Immutables — identity and terms
    // ---------------------------------------------------------------------------------

    uint16 public constant MAX_ORIGINATION_FEE_BPS = 50; // 0.5%, matches FeeController's ceiling

    FacilityValuation public immutable valuation;
    RiskPolicyRegistry public immutable policies;
    IAuthorityVerifier public immutable authorityVerifier;
    IPolicyVerifier public immutable policyVerifier;

    bytes32 public immutable facilityId;
    bytes32 public immutable homeDomainId;
    bytes32 public immutable discriminator;
    address public immutable borrower;
    address public immutable lender;
    address public immutable operator;
    address public immutable treasury;

    IERC20 public immutable settlementToken;
    bytes32 public immutable settlementAssetId;
    uint8 public immutable settlementDecimals;

    uint256 public immutable principalLimit;
    uint64 public immutable maturityAt;
    uint16 public immutable interestRateBps;
    uint16 public immutable originationFeeBps;
    uint16 public immutable feePolicyVersion;
    bytes32 public immutable collateralPolicyId;
    uint64 public immutable settlementMaxPriceAge;
    uint64 public immutable recallGracePeriod;
    uint64 public immutable maturityGracePeriod;

    // ---------------------------------------------------------------------------------
    // Mutable financial state — this contract is the only authority for all of it
    // ---------------------------------------------------------------------------------

    Status public status;
    uint256 public funded; //          settlement-token units the lender has put in, pre-activation
    uint256 public principalDrawn; //  set once, at activation
    uint256 public feeCharged; //      set once, at activation
    uint256 public repaid; //          cumulative repayment applied to outstanding
    uint256 public interestAccrued; // cumulative interest folded into outstanding
    uint64 public interestAccruedAt;
    uint64 public riskEpochAtActivation;
    uint64 public recallDeadline;
    uint256 public lenderClaimed; //   settlement-token units the lender has taken back out

    // Explicit `returns (… memory)` getters below rather than the auto-generated tuple getters:
    // a public 13-field struct getter ABI-encodes a 13-value return, which overflows the stack
    // without `via_ir`.
    Collateral internal _collateral;
    Substitution internal _substitution;

    function collateral() external view returns (Collateral memory) {
        return _collateral;
    }

    function substitution() external view returns (Substitution memory) {
        return _substitution;
    }

    // guardian restrictions — set by GUARDIAN, lifted by GOVERNANCE
    bool public activationPaused;
    bool public substitutionPaused;
    bool public interestFrozen;
    bool public unsafeReleaseBlocked;

    // ---------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------

    event FacilityCreated(
        bytes32 indexed facilityId, address borrower, address lender, uint256 principalLimit
    );
    event FacilityFunded(address indexed lender, uint256 amount);
    event FundingWithdrawn(address indexed lender, uint256 amount);
    event InitialCollateralCommitted(bytes32 indexed assetId, uint256 units);
    event FacilityActivated(uint256 principalDrawn, uint256 borrowerProceeds, uint256 fee, uint64 riskEpoch);
    event InterestAccrued(uint256 delta, uint256 totalOutstanding);
    event Repaid(address indexed payer, uint256 applied, uint256 outstandingAfter);
    event SubstitutionRequested(bytes32 indexed requestId, bytes32 replacementAssetId, uint256 requiredUnits);
    event ReplacementCommitting(bytes32 indexed requestId, uint256 committedUnits);
    event ReplacementCommitted(bytes32 indexed requestId, uint256 committedUnits);
    event CommitmentUnknown(bytes32 indexed requestId);
    event SubstitutionRejected(bytes32 indexed requestId, bytes32 reason);
    event OldCollateralReleased(
        bytes32 indexed requestId, bytes32 oldAssetId, bytes32 newAssetId, uint256 oldUnits
    );
    event RecallInitiated(address indexed lender, uint64 deadline);
    event FacilitySettled(uint256 totalRepaid);
    event FacilityDefaulted(bytes32 reason);
    event CollateralReleasedFinal(address indexed to, uint256 units);
    event SettlementProceedsClaimed(address indexed lender, uint256 amount);
    event GuardianRestrictionSet(bytes32 indexed which, bool on, bytes32 reason);

    // ---------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------

    error WrongStatus(Status have, Status want);
    error NotBorrower();
    error NotLender();
    error NotOperator();
    error ZeroAmount();
    error AlreadyFunded();
    error FundingShort(uint256 have, uint256 want);
    error MaturityInPast();
    error OriginationFeeTooHigh(uint16 bps);
    error ActivationPaused();
    error SubstitutionPaused();
    error SubstitutionAlreadyActive();
    error NoActiveSubstitution();
    error SubStateMismatch(SubState have, SubState want);
    error DecisionRejected(bool authority, bytes32 decisionHash);
    error DecisionUnbound(bytes32 field);
    error EligibilityStale();
    error AuthorityStale();
    error PolicyVersionStale();
    error ReplacementInsufficient(uint256 have, uint256 want);
    error CoverageFailed(uint256 outstandingUsd18, uint256 recognisedUsd18);
    error OutstandingDebt(uint256 outstanding);
    error SubstitutionPending();
    error CommitmentUnknownOutstanding();
    error AdapterRefusedCommit(bytes32 reason);
    error RequestIdMismatch();
    error AlreadyConsumed();
    error NothingToRelease();
    error ReleaseBlockedBySafety();
    error RecallNotElapsed(uint64 deadline);
    error NotTerminal();

    // ---------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------

    constructor(
        Authority authority_,
        FacilityValuation valuation_,
        RiskPolicyRegistry policies_,
        IAuthorityVerifier authorityVerifier_,
        IPolicyVerifier policyVerifier_,
        Terms memory t
    ) Authorized(authority_) {
        if (t.maturityAt <= block.timestamp) revert MaturityInPast();
        if (t.originationFeeBps > MAX_ORIGINATION_FEE_BPS) revert OriginationFeeTooHigh(t.originationFeeBps);
        if (t.principalLimit == 0) revert ZeroAmount();

        valuation = valuation_;
        policies = policies_;
        authorityVerifier = authorityVerifier_;
        policyVerifier = policyVerifier_;

        homeDomainId = t.homeDomainId;
        discriminator = t.discriminator;
        borrower = t.borrower;
        lender = t.lender;
        operator = t.operator;
        treasury = t.treasury;
        settlementToken = t.settlementToken;
        settlementAssetId = t.settlementAssetId;
        settlementDecimals = t.settlementDecimals;
        principalLimit = t.principalLimit;
        maturityAt = t.maturityAt;
        interestRateBps = t.interestRateBps;
        originationFeeBps = t.originationFeeBps;
        feePolicyVersion = t.feePolicyVersion;
        collateralPolicyId = t.collateralPolicyId;
        settlementMaxPriceAge = t.settlementMaxPriceAge;
        recallGracePeriod = t.recallGracePeriod;
        maturityGracePeriod = t.maturityGracePeriod;

        facilityId = _deriveFacilityId(t.homeDomainId, t.discriminator);
        _collateral.assetId = t.initialCollateralAssetId;
        _collateral.adapter = t.initialCollateralAdapter;
        _collateral.instrumentRef = ICollateralAdapter(t.initialCollateralAdapter).instrumentRef();

        status = Status.DRAFT;
        emit FacilityCreated(facilityId, t.borrower, t.lender, t.principalLimit);
    }

    /// @dev `spec/facility-model.md §4`: keccak256(abi.encode("USANCE_FACILITY_V1", facilityType,
    ///      homeDomainId, controller, discriminator)). The controller is this contract's canonical
    ///      reference — an EVM address left-padded to bytes32.
    function _deriveFacilityId(bytes32 homeDomainId_, bytes32 discriminator_)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                "USANCE_FACILITY_V1",
                "TERM_SECURED_CREDIT",
                homeDomainId_,
                bytes32(uint256(uint160(address(this)))),
                discriminator_
            )
        );
    }

    // ---------------------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------------------

    modifier onlyBorrower() {
        if (msg.sender != borrower) revert NotBorrower();
        _;
    }

    modifier onlyLender() {
        if (msg.sender != lender) revert NotLender();
        _;
    }

    /// @dev Operator OR borrower. Non-financial lifecycle steps (commit, reconcile) can be driven
    ///      by either; value-moving steps cannot be driven by the operator at all.
    modifier onlyOperatorOrBorrower() {
        if (msg.sender != borrower && (operator == address(0) || msg.sender != operator)) {
            revert NotOperator();
        }
        _;
    }

    modifier inStatus(Status want) {
        if (status != want) revert WrongStatus(status, want);
        _;
    }

    // ---------------------------------------------------------------------------------
    // DRAFT / PENDING_ACTIVATION
    // ---------------------------------------------------------------------------------

    /// @notice The lender puts the full principal in. DRAFT -> PENDING_ACTIVATION.
    function fund() external onlyLender inStatus(Status.DRAFT) nonReentrant {
        if (funded != 0) revert AlreadyFunded();
        funded = principalLimit;
        status = Status.PENDING_ACTIVATION;
        settlementToken.safeTransferFrom(msg.sender, address(this), principalLimit);
        emit FacilityFunded(msg.sender, principalLimit);
    }

    /// @notice The lender pulls funding back before activation. PENDING_ACTIVATION -> DRAFT.
    function withdrawFunding() external onlyLender inStatus(Status.PENDING_ACTIVATION) nonReentrant {
        uint256 amt = funded;
        funded = 0;
        status = Status.DRAFT;
        settlementToken.safeTransfer(msg.sender, amt);
        emit FundingWithdrawn(msg.sender, amt);
    }

    /// @notice The borrower locks the initial collateral through the fixed initial adapter.
    /// @dev Allowed in DRAFT or PENDING_ACTIVATION only. Uses the adapter's measured-delta credit.
    function commitInitialCollateral(uint256 units) external onlyBorrower nonReentrant {
        if (status != Status.DRAFT && status != Status.PENDING_ACTIVATION) {
            revert WrongStatus(status, Status.PENDING_ACTIVATION);
        }
        if (units == 0) revert ZeroAmount();
        ICollateralAdapter a = ICollateralAdapter(_collateral.adapter);
        (bool ok, bytes32 reason) = a.canCommit(address(this));
        if (!ok) revert AdapterRefusedCommit(reason);
        uint256 got = a.commit(address(this), msg.sender, units);
        _collateral.committedUnits = a.committedOf(address(this));
        emit InitialCollateralCommitted(_collateral.assetId, got);
    }

    /// @notice Activate the facility. Callable once, by the lender or the operator.
    /// @param policyD  a fresh IPolicyVerifier decision: operation ACTIVATE, subject = the initial
    ///                 collateral, pinned to the current epoch and policy version.
    /// @param authorityD a fresh IAuthorityVerifier decision: operation ACTIVATE.
    function activate(FacilityDecision calldata policyD, FacilityDecision calldata authorityD)
        external
        inStatus(Status.PENDING_ACTIVATION)
        nonReentrant
    {
        if (msg.sender != lender && (operator == address(0) || msg.sender != operator)) {
            revert NotOperator();
        }
        if (activationPaused) revert ActivationPaused();
        if (maturityAt <= block.timestamp) revert MaturityInPast();
        if (funded < principalLimit) revert FundingShort(funded, principalLimit);
        if (settlementToken.balanceOf(address(this)) < principalLimit) {
            revert FundingShort(settlementToken.balanceOf(address(this)), principalLimit);
        }

        riskEpochAtActivation = policies.riskEpoch();
        {
            DecisionBinding memory b = _binding(
                FacilityOperation.ACTIVATE, _collateral.assetId, _collateral.instrumentRef, bytes32(0)
            );
            _verifyPolicy(policyD, b);
            _verifyAuthority(authorityD, b);
        }

        valuation.requireSequencerTrustworthy();
        uint256 principalUsd18 = _toUsd18(principalLimit);
        _requireCoverage(principalUsd18, _collateral.assetId, _collateral.adapter, _collateral.committedUnits);

        interestAccruedAt = uint64(block.timestamp);
        principalDrawn = principalLimit;
        status = Status.ACTIVE;
        _disburse();
    }

    /// @dev The origination split and the two transfers, isolated so `activate` stays shallow.
    function _disburse() internal {
        (uint256 borrowerProceeds, uint256 fee) =
            FacilityMath.originationSplit(principalDrawn, originationFeeBps);
        feeCharged = fee;
        if (fee != 0) settlementToken.safeTransfer(treasury, fee);
        settlementToken.safeTransfer(borrower, borrowerProceeds);
        emit FacilityActivated(principalDrawn, borrowerProceeds, fee, riskEpochAtActivation);
    }

    /// @dev `outstandingUsd18 <= recognisedValue(collateral) * maintenanceLtv`. Reverts otherwise,
    ///      or `ReleaseBlockedBySafety` when a guardian has set the unsafe-release brake. The
    ///      valuation and the settlement-price conversion both run in `FacilityValuation`'s own
    ///      contract frame.
    function _requireCoverage(uint256 outstandingUsd18, bytes32 assetId, address adapter, uint256 units)
        internal
        view
    {
        (uint256 recognisedUsd18, uint16 maintenanceLtvBps) = valuation.recognisedValue(
            collateralPolicyId, assetId, ICollateralAdapter(adapter).decimals(), units
        );
        if (!FacilityMath.coverageHolds(outstandingUsd18, recognisedUsd18, maintenanceLtvBps)) {
            if (unsafeReleaseBlocked) revert ReleaseBlockedBySafety();
            revert CoverageFailed(outstandingUsd18, recognisedUsd18);
        }
    }

    function _toUsd18(uint256 settlementTokens) internal view returns (uint256) {
        return
            valuation.toUsd18(settlementAssetId, settlementDecimals, settlementTokens, settlementMaxPriceAge);
    }

    // ---------------------------------------------------------------------------------
    // Accounting
    // ---------------------------------------------------------------------------------

    /// @notice Outstanding debt right now, in settlement-token units.
    function outstanding() public view returns (uint256) {
        return principalDrawn + interestAccrued + _pendingInterest() - repaid;
    }

    function _pendingInterest() internal view returns (uint256) {
        if (interestFrozen || interestAccruedAt == 0) return 0;
        uint256 principalPortion = principalDrawn > repaid ? principalDrawn - repaid : 0;
        return FacilityMath.accruedInterest(
            principalPortion, interestRateBps, uint64(block.timestamp) - interestAccruedAt
        );
    }

    /// @notice Fold pending interest into the stored figure. Any state-changing call does this;
    ///         `poke` exposes it and also advances the lifecycle past maturity / a recall deadline.
    function _accrue() internal {
        uint256 delta = _pendingInterest();
        if (delta != 0) {
            interestAccrued += delta;
            emit InterestAccrued(delta, outstanding());
        }
        interestAccruedAt = uint64(block.timestamp);
    }

    function poke() external nonReentrant {
        if (status == Status.SETTLED || status == Status.DEFAULTED) return;
        _accrue();

        if (status == Status.RECALLING && block.timestamp >= recallDeadline && outstanding() > 0) {
            _default("RECALL_UNMET");
            return;
        }
        if (
            (status == Status.ACTIVE || status == Status.MATURED)
                && block.timestamp >= maturityAt + maturityGracePeriod && outstanding() > 0
        ) {
            _default("MATURITY_UNMET");
            return;
        }
        if (status == Status.ACTIVE && block.timestamp >= maturityAt) {
            status = Status.MATURED;
        }
    }

    /// @notice Repay outstanding debt. Anyone may pay; the payer funds it. Interest first, then
    ///         principal. `repayAll` clears `outstanding` exactly and refunds any excess.
    function repay(uint256 amount, bool repayAll) external nonReentrant returns (uint256 applied) {
        if (
            status != Status.ACTIVE && status != Status.SUBSTITUTION_PENDING && status != Status.RECALLING
                && status != Status.MATURED
        ) {
            revert WrongStatus(status, Status.ACTIVE);
        }
        _accrue();
        uint256 owed = outstanding();
        if (owed == 0) revert OutstandingDebt(0);
        applied = (repayAll || amount > owed) ? owed : amount;
        if (applied == 0) revert ZeroAmount();

        repaid += applied;
        settlementToken.safeTransferFrom(msg.sender, address(this), applied);
        emit Repaid(msg.sender, applied, outstanding());
    }

    // ---------------------------------------------------------------------------------
    // Collateral substitution — spec §7
    // ---------------------------------------------------------------------------------

    /// @notice Open a substitution. ACTIVE -> SUBSTITUTION_PENDING; SubState -> REQUESTED.
    /// @dev Pins the epoch, the policy version, both decision hashes and the authority expiry.
    ///      Exactly one substitution may be live (I-96).
    function requestSubstitution(
        bytes32 requestId,
        address replacementAdapter,
        uint256 requiredUnits,
        FacilityDecision calldata policyD,
        FacilityDecision calldata authorityD
    ) external onlyBorrower nonReentrant {
        _openSubstitution(requestId, replacementAdapter, requiredUnits, policyD, authorityD);
    }

    /// @dev The body, with no reentrancy guard of its own so `substituteAtomic` can hold one
    ///      guard across the whole request → commit → release sequence.
    function _openSubstitution(
        bytes32 requestId,
        address replacementAdapter,
        uint256 requiredUnits,
        FacilityDecision calldata policyD,
        FacilityDecision calldata authorityD
    ) internal {
        if (status != Status.ACTIVE) {
            revert WrongStatus(status, Status.ACTIVE);
        }
        if (substitutionPaused) revert SubstitutionPaused();
        if (_substitution.state != SubState.NONE) revert SubstitutionAlreadyActive();
        if (requiredUnits == 0) revert ZeroAmount();
        if (requestId == bytes32(0)) revert DecisionUnbound("requestId");
        // A substitution is a swap to a *different* custody position. Allowing the same adapter
        // would let the committed-replacement check be satisfied by the collateral already in
        // custody, and the release would then drain it. A same-asset top-up is not this operation.
        if (replacementAdapter == _collateral.adapter) revert DecisionUnbound("replacementAdapter");
        _accrue();

        Substitution storage s = _substitution;
        s.state = SubState.REQUESTED;
        s.id = requestId;
        s.replacementAdapter = replacementAdapter;
        s.replacementInstrumentRef = ICollateralAdapter(replacementAdapter).instrumentRef();
        s.replacementAssetId = ICollateralAdapter(replacementAdapter).assetId();
        s.requiredUnits = requiredUnits;
        s.pinnedEpoch = policies.riskEpoch();
        s.collateralPolicyVersion = policies.riskEpoch();
        s.authorityExpiry = authorityD.expiry;

        DecisionBinding memory b = _binding(
            FacilityOperation.SUBSTITUTE, s.replacementAssetId, s.replacementInstrumentRef, requestId
        );
        s.policyDecisionHash = _verifyPolicy(policyD, b);
        s.authorityDecisionHash = _verifyAuthority(authorityD, b);

        status = Status.SUBSTITUTION_PENDING;
        emit SubstitutionRequested(requestId, s.replacementAssetId, requiredUnits);
    }

    /// @notice Pull the replacement into custody. REQUESTED -> REPLACEMENT_COMMITTING, and, when
    ///         the adapter settles synchronously, straight on to REPLACEMENT_COMMITTED.
    function commitReplacement() external onlyOperatorOrBorrower nonReentrant {
        _commitReplacement();
    }

    function _commitReplacement() internal {
        if (substitutionPaused) revert SubstitutionPaused();
        _requireSub(SubState.REQUESTED);
        Substitution storage s = _substitution;
        s.state = SubState.REPLACEMENT_COMMITTING;

        ICollateralAdapter ra = ICollateralAdapter(s.replacementAdapter);
        (bool ok, bytes32 reason) = ra.canCommit(address(this));
        if (!ok) {
            _rejectSubstitution(reason == bytes32(0) ? bytes32("INELIGIBLE") : reason);
            return;
        }
        uint256 got = ra.commit(address(this), borrower, s.requiredUnits);
        emit ReplacementCommitting(s.id, got);

        if (ra.committedOf(address(this)) >= s.requiredUnits) {
            s.state = SubState.REPLACEMENT_COMMITTED;
            emit ReplacementCommitted(s.id, ra.committedOf(address(this)));
        }
    }

    /// @notice Resolve a committing / unknown replacement against authoritative custody state.
    /// @dev COMMITMENT_UNKNOWN releases nothing (I-97). Only this function moves a substitution
    ///      out of COMMITMENT_UNKNOWN.
    function reconcileCommitment() external onlyOperatorOrBorrower nonReentrant {
        Substitution storage s = _substitution;
        if (s.state != SubState.REPLACEMENT_COMMITTING && s.state != SubState.COMMITMENT_UNKNOWN) {
            revert SubStateMismatch(s.state, SubState.REPLACEMENT_COMMITTING);
        }
        ICollateralAdapter.CommitmentState cs =
            ICollateralAdapter(s.replacementAdapter).reconcile(address(this));
        if (cs == ICollateralAdapter.CommitmentState.COMMITTED) {
            if (ICollateralAdapter(s.replacementAdapter).committedOf(address(this)) < s.requiredUnits) {
                s.state = SubState.COMMITMENT_UNKNOWN;
                emit CommitmentUnknown(s.id);
                return;
            }
            s.state = SubState.REPLACEMENT_COMMITTED;
            emit ReplacementCommitted(
                s.id, ICollateralAdapter(s.replacementAdapter).committedOf(address(this))
            );
        } else if (cs == ICollateralAdapter.CommitmentState.NOT_COMMITTED) {
            _rejectSubstitution("INSUFFICIENT");
        } else {
            s.state = SubState.COMMITMENT_UNKNOWN;
            emit CommitmentUnknown(s.id);
        }
    }

    /// @notice Release the old collateral to the borrower and adopt the replacement.
    /// @dev The one function that can reach `_releaseOldCollateral` outside `substituteAtomic`.
    function releaseOld(bytes32 requestId) external onlyBorrower nonReentrant {
        _assertReleasable(requestId);
        _releaseOldCollateral();
    }

    /// @notice request + commit + release in one transaction. Only reaches OLD_RELEASED when the
    ///         replacement adapter commits synchronously and every releasable check passes.
    function substituteAtomic(
        bytes32 requestId,
        address replacementAdapter,
        uint256 requiredUnits,
        FacilityDecision calldata policyD,
        FacilityDecision calldata authorityD
    ) external onlyBorrower nonReentrant {
        _openSubstitution(requestId, replacementAdapter, requiredUnits, policyD, authorityD);
        _commitReplacement();
        if (_substitution.state != SubState.REPLACEMENT_COMMITTED) {
            // Nothing irreversible happened: the old collateral is still locked and the
            // two-phase path (reconcileCommitment -> releaseOld) takes over.
            return;
        }
        _assertReleasable(requestId);
        _releaseOldCollateral();
    }

    /// @notice Undo a _substitution whose replacement was already committed, without releasing the
    ///         old _collateral. Returns the replacement units to the borrower. Safe by
    ///         construction: the old collateral never moved.
    function abortCommittedSubstitution() external nonReentrant {
        if (msg.sender != borrower && !_isGuardian(msg.sender)) revert NotBorrower();
        Substitution storage s = _substitution;
        if (s.state != SubState.REPLACEMENT_COMMITTED && s.state != SubState.COMMITMENT_UNKNOWN) {
            revert SubStateMismatch(s.state, SubState.REPLACEMENT_COMMITTED);
        }
        ICollateralAdapter ra = ICollateralAdapter(s.replacementAdapter);
        uint256 held = ra.committedOf(address(this));
        s.lastReason = "CANCELLED";
        emit SubstitutionRejected(s.id, "CANCELLED");
        _clearSubstitution();
        status = Status.ACTIVE;
        if (held != 0) ra.release(address(this), borrower, held);
    }

    /// @notice Cancel a _substitution that has committed nothing. REQUESTED only.
    function cancelSubstitution() external onlyBorrower nonReentrant {
        _requireSub(SubState.REQUESTED);
        _rejectSubstitution("CANCELLED");
    }

    // ---------------------------------------------------------------------------------
    // Recall / settlement / default
    // ---------------------------------------------------------------------------------

    function initiateRecall(FacilityDecision calldata authorityD)
        external
        onlyLender
        inStatus(Status.ACTIVE)
        nonReentrant
    {
        if (_substitution.state != SubState.NONE) revert SubstitutionPending();
        _accrue();
        _verifyAuthority(authorityD, _binding(FacilityOperation.RECALL, bytes32(0), bytes32(0), bytes32(0)));
        status = Status.RECALLING;
        recallDeadline = uint64(block.timestamp) + recallGracePeriod;
        emit RecallInitiated(msg.sender, recallDeadline);
    }

    /// @notice Settle a fully-repaid facility. Only the controller marks SETTLED.
    function settle(FacilityDecision calldata authorityD) external nonReentrant {
        if (msg.sender != borrower && msg.sender != lender) revert NotBorrower();
        if (status == Status.SETTLED || status == Status.DEFAULTED) revert NotTerminal();
        if (_substitution.state != SubState.NONE) {
            if (_substitution.state == SubState.COMMITMENT_UNKNOWN) revert CommitmentUnknownOutstanding();
            revert SubstitutionPending();
        }
        _accrue();
        uint256 owed = outstanding();
        if (owed != 0) revert OutstandingDebt(owed);
        _verifyAuthority(authorityD, _binding(FacilityOperation.SETTLE, bytes32(0), bytes32(0), bytes32(0)));
        status = Status.SETTLED;
        emit FacilitySettled(repaid);
    }

    function _default(bytes32 reason) internal {
        status = Status.DEFAULTED;
        emit FacilityDefaulted(reason);
    }

    /// @notice After a terminal state, release the remaining collateral to its rightful owner:
    ///         the borrower on SETTLED, the lender on DEFAULTED. No recipient parameter.
    function releaseCollateralAfterSettlement() external nonReentrant {
        if (status != Status.SETTLED && status != Status.DEFAULTED) revert NotTerminal();
        address to = status == Status.SETTLED ? borrower : lender;
        if (msg.sender != to && msg.sender != operator) revert NotBorrower();
        ICollateralAdapter a = ICollateralAdapter(_collateral.adapter);
        uint256 units = a.committedOf(address(this));
        if (units == 0) revert NothingToRelease();
        _collateral.committedUnits = 0;
        a.release(address(this), to, units);
        emit CollateralReleasedFinal(to, units);
    }

    /// @notice The lender takes repayments (and, on default, whatever settlement balance remains).
    function claimSettlementProceeds() external onlyLender nonReentrant {
        uint256 bal = settlementToken.balanceOf(address(this));
        // Pre-activation funding is not a proceed. After activation the facility holds only
        // repayments (principal went out to the borrower and the treasury at activation).
        if (status == Status.DRAFT || status == Status.PENDING_ACTIVATION) {
            revert WrongStatus(status, Status.ACTIVE);
        }
        if (bal == 0) revert NothingToRelease();
        lenderClaimed += bal;
        settlementToken.safeTransfer(lender, bal);
        emit SettlementProceedsClaimed(lender, bal);
    }

    // ---------------------------------------------------------------------------------
    // The releasable check — invariant I-95
    // ---------------------------------------------------------------------------------

    function _assertReleasable(bytes32 requestId) internal view {
        Substitution storage s = _substitution;
        if (status != Status.SUBSTITUTION_PENDING) revert WrongStatus(status, Status.SUBSTITUTION_PENDING);
        if (s.state != SubState.REPLACEMENT_COMMITTED) {
            revert SubStateMismatch(s.state, SubState.REPLACEMENT_COMMITTED);
        }
        if (s.consumed) revert AlreadyConsumed();
        if (requestId != s.id) revert RequestIdMismatch();

        // 5 — eligibility freshness. A moved epoch is only tolerated when the pinned policy
        // decision explicitly permits the current epoch AND a guardian has not blocked the
        // risk-reducing carve-out.
        if (policies.riskEpoch() != s.pinnedEpoch && !_epochCarveOutPermitted(s)) revert EligibilityStale();
        if (s.collateralPolicyVersion != _collateralPolicyVersion()) revert PolicyVersionStale();

        // 6 — authority freshness.
        if (s.authorityExpiry <= block.timestamp) revert AuthorityStale();
        if (authorityVerifier.isRevoked(s.authorityDecisionHash)) revert AuthorityStale();

        // 7 — replacement committed amount verified now.
        uint256 committed = ICollateralAdapter(s.replacementAdapter).committedOf(address(this));
        if (committed < s.requiredUnits) revert ReplacementInsufficient(committed, s.requiredUnits);

        // 8 — post-replacement coverage, from a fresh oracle read.
        valuation.requireSequencerTrustworthy();
        uint256 owedUsd18 = _toUsd18(outstanding());
        _requireCoverage(owedUsd18, s.replacementAssetId, s.replacementAdapter, committed);
    }

    /// @dev The risk-reducing carve-out: a moved epoch is tolerated only when the pinned policy
    ///      decision's verifier says the current epoch is still acceptable, and a guardian has not
    ///      set `unsafeReleaseBlocked`.
    function _epochCarveOutPermitted(Substitution storage s) internal view returns (bool) {
        if (unsafeReleaseBlocked) return false;
        return policyVerifier.permitsCurrentEpoch(s.policyDecisionHash, s.pinnedEpoch, policies.riskEpoch());
    }

    function _releaseOldCollateral() internal {
        Substitution storage s = _substitution;
        s.consumed = true; // effect before interaction

        ICollateralAdapter oldA = ICollateralAdapter(_collateral.adapter);
        uint256 oldUnits = oldA.committedOf(address(this));
        bytes32 oldAssetId = _collateral.assetId;

        // Adopt the replacement as the facility's _collateral.
        _collateral.assetId = s.replacementAssetId;
        _collateral.instrumentRef = s.replacementInstrumentRef;
        _collateral.adapter = s.replacementAdapter;
        _collateral.committedUnits = ICollateralAdapter(s.replacementAdapter).committedOf(address(this));
        _collateral.passportVersion = 0;

        bytes32 reqId = s.id;
        bytes32 newAssetId = s.replacementAssetId;
        _clearSubstitution();
        status = Status.ACTIVE;

        if (oldUnits != 0) oldA.release(address(this), borrower, oldUnits);
        emit OldCollateralReleased(reqId, oldAssetId, newAssetId, oldUnits);
    }

    // ---------------------------------------------------------------------------------
    // Guardian surface — restriction only, spec §10
    // ---------------------------------------------------------------------------------

    /// @notice `which`: 1 ACTIVATION, 2 SUBSTITUTION, 3 INTEREST, 4 UNSAFE_RELEASE. Every one is a
    ///         restriction; a guardian sets it, only governance lifts it. Nothing here can seize
    ///         collateral, forgive debt, widen a limit or mark a facility settled.
    function setRestriction(uint8 which, bool on, bytes32 reason) external {
        if (reason == bytes32(0)) revert DecisionUnbound("reason");
        if (on) {
            if (!_isGuardian(msg.sender)) revert Unauthorized(authority.GUARDIAN());
        } else {
            if (!authority.hasRole(authority.GOVERNANCE(), msg.sender)) {
                revert Unauthorized(authority.GOVERNANCE());
            }
        }
        if (which == 1) {
            activationPaused = on;
        } else if (which == 2) {
            substitutionPaused = on;
        } else if (which == 3) {
            _accrue();
            interestFrozen = on;
        } else if (which == 4) {
            unsafeReleaseBlocked = on;
        } else {
            revert DecisionUnbound("which");
        }
        emit GuardianRestrictionSet(bytes32(uint256(which)), on, reason);
    }

    // ---------------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------------

    function _requireSub(SubState want) internal view {
        if (_substitution.state == SubState.NONE) revert NoActiveSubstitution();
        if (_substitution.state != want) revert SubStateMismatch(_substitution.state, want);
    }

    function _rejectSubstitution(bytes32 reason) internal {
        bytes32 id = _substitution.id;
        _clearSubstitution();
        _substitution.lastReason = reason;
        status = Status.ACTIVE;
        emit SubstitutionRejected(id, reason);
    }

    function _clearSubstitution() internal {
        delete _substitution;
    }

    /// @dev The whole binding check runs inside the verifier's contract frame. The facility only
    ///      builds the `DecisionBinding`, calls, and stores the returned hash. `_binding` keeps
    ///      the struct construction out of the caller's stack.
    function _binding(FacilityOperation op, bytes32 subjectAssetId, bytes32 subjectRef, bytes32 requestId)
        internal
        view
        returns (DecisionBinding memory b)
    {
        b.facilityId = facilityId;
        b.operation = op;
        b.subjectAssetId = subjectAssetId;
        b.subjectInstrumentRef = subjectRef;
        b.requestId = requestId;
        b.epoch = policies.riskEpoch();
        b.collateralPolicyVersion = policies.riskEpoch();
    }

    function _verifyAuthority(FacilityDecision calldata d, DecisionBinding memory b)
        internal
        view
        returns (bytes32 h)
    {
        bool ok;
        (ok, h) = authorityVerifier.verify(d, b);
        if (!ok) revert DecisionRejected(true, d.facilityId);
    }

    function _verifyPolicy(FacilityDecision calldata d, DecisionBinding memory b)
        internal
        view
        returns (bytes32 h)
    {
        bool ok;
        (ok, h) = policyVerifier.verify(d, b);
        if (!ok) revert DecisionRejected(false, d.facilityId);
    }

    function _collateralPolicyVersion() internal view returns (uint64) {
        // The RiskPolicyRegistry does not version policies by number; the risk epoch is the
        // monotone version signal for "the parameters a decision was made under". Using it here
        // keeps "policy version" and "epoch" from drifting.
        return policies.riskEpoch();
    }

    function _isGuardian(address who) internal view returns (bool) {
        return authority.hasRole(authority.GUARDIAN(), who) || authority.hasRole(authority.GOVERNANCE(), who);
    }
}
