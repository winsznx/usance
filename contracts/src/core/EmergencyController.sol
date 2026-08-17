// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {Types} from "../libraries/Types.sol";

/// @notice The single function this controller needs from `AssetRegistry`.
/// @dev Deliberately narrow. The controller is granted the GUARDIAN role, so anything it *can*
///      express is something a compromised guardian key can execute. Importing the full registry
///      would hand this contract the vocabulary to call `bindRiskPolicy` or `setCapabilities`;
///      the role check downstream would still refuse, but the argument for invariant I-25 would
///      have to be made by reading two contracts instead of one.
interface IAssetStatusRestrictor {
    function setStatus(bytes32 assetId, Types.AssetStatus status) external;
}

/// @notice The single function this controller needs from `ClearingHouse`.
interface IAccountStatusRestrictor {
    function setAccountRiskState(address account, Types.AccountStatus status, bytes32 reason) external;
}

/// @notice The single function this controller needs from `RiskPolicyRegistry`.
interface IRiskEpochBumper {
    function bumpEpoch(bytes32 cause) external;
}

/// @title EmergencyController
/// @notice The guardian's entire surface area. Six powers, all of them restrictions.
///
/// @dev The security argument here is structural and is meant to be checkable by reading this
///      one file:
///
///      1. **No function takes a status argument.** Every restriction this contract can apply is
///         a compile-time constant — `SUSPENDED`, `PAUSED`, `REDUCE_ONLY`. There is no
///         parameterisation under which a guardian expresses "make this less restrictive",
///         because the destination is not a parameter. That closes the whole class of bugs where
///         an ordinal check is present but reachable with the wrong argument.
///
///      2. **The downstream setters check ordinals anyway.** `AssetRegistry.setStatus` and
///         `ClearingHouse.setAccountRiskState` both reject a guardian move toward a lower
///         ordinal. Belt and braces, because this contract is not the only holder of the
///         GUARDIAN role and must not be the only thing standing between a key and an LTV.
///
///      3. **The controller holds GUARDIAN and never GOVERNANCE.** Lifting an asset or account
///         restriction is a governance call on the owning registry, and this contract cannot
///         make it — not because it declines to, but because `setStatus(ACTIVE)` from a
///         guardian-roled caller reverts in `AssetRegistry`. Granting this contract GOVERNANCE
///         would silently void that argument, which is why the deploy script must not.
///
///      4. **There is no token, no debt and no policy vocabulary in this file.** No `IERC20`
///         import, no vault reference, no `RiskParameters`. A guardian cannot move collateral or
///         raise an LTV through here for the same reason they cannot mint an NFT: the function
///         does not exist.
///
///      Two of the six powers — the global borrowing freeze and the market-creation pause —
///      have no enforcement point in the contracts that exist today. They are held here as
///      state with `requireBorrowingAllowed()` / `requireMarketCreationAllowed()` gates, and
///      `ClearingHouse.borrow` and the future market factory must call them. Until that wiring
///      lands the freeze is **partially** enforced: `freezeNewBorrowing` advances the risk epoch,
///      which voids every outstanding epoch-stamped quote (invariant I-12), but a caller passing
///      `expectedEpoch == 0` still reaches the risk pipeline. This is stated plainly rather than
///      implied to be complete, because an emergency control that is documented as working and
///      is not is worse than one that is documented as pending.
contract EmergencyController is Authorized {
    /// @dev The only restriction levels this contract can ever name. Constants, not parameters.
    Types.AssetStatus internal constant ASSET_DISABLED = Types.AssetStatus.SUSPENDED;
    Types.AssetStatus internal constant ASSET_REDUCE_ONLY = Types.AssetStatus.PAUSED;
    Types.AccountStatus internal constant ACCOUNT_REDUCE_ONLY = Types.AccountStatus.REDUCE_ONLY;

    IAssetStatusRestrictor public immutable assets;
    IAccountStatusRestrictor public immutable clearing;
    IRiskEpochBumper public immutable policies;

    /// @notice Set by a guardian, cleared only by governance.
    bool public borrowingFrozen;
    bool public marketCreationPaused;
    mapping(address adapter => bool) public adapterDisabled;

    event NewBorrowingFrozen(address indexed by, bytes32 indexed reason, uint64 at);
    event NewBorrowingUnfrozen(address indexed by, bytes32 indexed reason, uint64 at);
    event AssetDisabled(bytes32 indexed assetId, address indexed by, bytes32 indexed reason);
    event AssetSetReduceOnly(bytes32 indexed assetId, address indexed by, bytes32 indexed reason);
    event AccountSetReduceOnly(address indexed account, address indexed by, bytes32 indexed reason);
    event AdapterDisabled(address indexed adapter, address indexed by, bytes32 indexed reason);
    event AdapterEnabled(address indexed adapter, address indexed by, bytes32 indexed reason);
    event MarketCreationPaused(address indexed by, bytes32 indexed reason, uint64 at);
    event MarketCreationResumed(address indexed by, bytes32 indexed reason, uint64 at);

    error ReasonRequired();
    error BorrowingIsFrozen();
    error MarketCreationIsPaused();
    error AdapterIsDisabled(address adapter);
    error AlreadyFrozen();
    error NotFrozen();
    error AlreadyPaused();
    error NotPaused();
    error AdapterAlreadyDisabled(address adapter);
    error AdapterNotDisabled(address adapter);
    error ZeroAdapter();

    /// @dev Governance is admitted everywhere a guardian is, because every power here is a
    ///      restriction and governance already outranks the guardian on the same registries.
    ///      The converse is not true and is not expressible: see the `onlyRole(GOVERNANCE)` lifts.
    modifier onlyGuardian() {
        if (
            !authority.hasRole(authority.GUARDIAN(), msg.sender)
                && !authority.hasRole(authority.GOVERNANCE(), msg.sender)
        ) revert Unauthorized(authority.GUARDIAN());
        _;
    }

    /// @dev An emergency action with no stated cause cannot be reviewed after the fact, and the
    ///      review is the only thing that makes an unaccountable immediate power acceptable.
    modifier withReason(bytes32 reason) {
        if (reason == bytes32(0)) revert ReasonRequired();
        _;
    }

    constructor(
        Authority authority_,
        IAssetStatusRestrictor assets_,
        IAccountStatusRestrictor clearing_,
        IRiskEpochBumper policies_
    ) Authorized(authority_) {
        assets = assets_;
        clearing = clearing_;
        policies = policies_;
    }

    // ---------------------------------------------------------------------------------
    // The six powers
    // ---------------------------------------------------------------------------------

    /// @notice Power 1 — freeze new borrowing across the whole protocol.
    /// @dev The epoch bump is the part that bites today: every quote the UI has issued cites an
    ///      epoch, and `ClearingHouse.borrow` refuses a stale one. It is not a complete freeze on
    ///      its own — see the contract-level note — and the flag below is what makes it one once
    ///      `borrow` consults `requireBorrowingAllowed()`.
    function freezeNewBorrowing(bytes32 reason) external onlyGuardian withReason(reason) {
        if (borrowingFrozen) revert AlreadyFrozen();
        borrowingFrozen = true;
        policies.bumpEpoch(reason);
        emit NewBorrowingFrozen(msg.sender, reason, uint64(block.timestamp));
    }

    /// @notice Power 2 — disable an asset entirely.
    /// @dev `SUSPENDED` raises `GATE_ASSET_SUSPENDED` for every account holding a non-zero
    ///      quantity, which floors those accounts at `NO_NEW_RISK` and zeroes their capacity.
    ///      Repayment and withdrawal stay open, which is the whole point of restricting rather
    ///      than pausing: trapping holders inside a failing asset turns a credit event into a
    ///      liquidation event.
    function disableAsset(bytes32 assetId, bytes32 reason) external onlyGuardian withReason(reason) {
        assets.setStatus(assetId, ASSET_DISABLED);
        emit AssetDisabled(assetId, msg.sender, reason);
    }

    /// @notice Power 3 — stop an asset backing anything new, without gating existing holders.
    /// @dev `PAUSED` strips every capability except `HOLD`, so the asset can no longer be
    ///      deposited as collateral or used to open anything. It deliberately raises no risk
    ///      gate: an asset we no longer want more of is not the same claim as an asset we no
    ///      longer trust, and conflating them would restrict accounts that did nothing wrong.
    ///      `PAUSED` sits below `SUSPENDED` in the ordinal, so this can be escalated to
    ///      `disableAsset` later but never walked back from it.
    function setAssetReduceOnly(bytes32 assetId, bytes32 reason) external onlyGuardian withReason(reason) {
        assets.setStatus(assetId, ASSET_REDUCE_ONLY);
        emit AssetSetReduceOnly(assetId, msg.sender, reason);
    }

    /// @notice Power 4 — place one account under a reduce-only floor.
    /// @dev The floor enters `RiskMath.evaluate` as `statusOverride` and is combined with a
    ///      `max` over the status total order, so it can only ever restrict. `ClearingHouse`
    ///      additionally rejects a move to a lower ordinal, which is what stops this being
    ///      re-callable as a way back to `NORMAL`.
    function setAccountReduceOnly(address account, bytes32 reason) external onlyGuardian withReason(reason) {
        clearing.setAccountRiskState(account, ACCOUNT_REDUCE_ONLY, reason);
        emit AccountSetReduceOnly(account, msg.sender, reason);
    }

    /// @notice Power 5 — refuse to route through an adapter.
    /// @dev Adapters own no accounting and hold no funds, so disabling one is always safe and
    ///      always immediate. This is the registry every dispatcher must consult before handing
    ///      an adapter a reservation (invariant I-19); no execution adapter exists yet, so today
    ///      the flag has no consumer and `requireAdapterEnabled` is the seam that will give it
    ///      one. Recorded here rather than left implicit.
    function disableAdapter(address adapter, bytes32 reason) external onlyGuardian withReason(reason) {
        if (adapter == address(0)) revert ZeroAdapter();
        if (adapterDisabled[adapter]) revert AdapterAlreadyDisabled(adapter);
        adapterDisabled[adapter] = true;
        emit AdapterDisabled(adapter, msg.sender, reason);
    }

    /// @notice Power 6 — stop new markets being created.
    /// @dev A market created during an incident is a market created under inputs nobody has
    ///      checked. Existing markets keep operating; this only closes the door on new ones.
    function pauseMarketCreation(bytes32 reason) external onlyGuardian withReason(reason) {
        if (marketCreationPaused) revert AlreadyPaused();
        marketCreationPaused = true;
        emit MarketCreationPaused(msg.sender, reason, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------------------
    // Lifting — governance only, and structurally unreachable from a guardian key
    // ---------------------------------------------------------------------------------

    /// @dev These three are the complete set of lifts this contract owns, and every one of them
    ///      carries `onlyRole(GOVERNANCE)` rather than `onlyGuardian`. Asset and account
    ///      restrictions are not liftable here at all: those live on `AssetRegistry` and
    ///      `ClearingHouse` behind their own governance checks, and this contract has no
    ///      governance-roled path into either.
    function liftBorrowingFreeze(bytes32 reason)
        external
        onlyRole(authority.GOVERNANCE())
        withReason(reason)
    {
        if (!borrowingFrozen) revert NotFrozen();
        borrowingFrozen = false;
        policies.bumpEpoch(reason);
        emit NewBorrowingUnfrozen(msg.sender, reason, uint64(block.timestamp));
    }

    function enableAdapter(address adapter, bytes32 reason)
        external
        onlyRole(authority.GOVERNANCE())
        withReason(reason)
    {
        if (!adapterDisabled[adapter]) revert AdapterNotDisabled(adapter);
        adapterDisabled[adapter] = false;
        emit AdapterEnabled(adapter, msg.sender, reason);
    }

    function resumeMarketCreation(bytes32 reason)
        external
        onlyRole(authority.GOVERNANCE())
        withReason(reason)
    {
        if (!marketCreationPaused) revert NotPaused();
        marketCreationPaused = false;
        emit MarketCreationResumed(msg.sender, reason, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------------------
    // Gates for consumers
    // ---------------------------------------------------------------------------------

    /// @dev Reverting gates rather than boolean views on purpose. A caller that forgets to check
    ///      a boolean compiles and ships; a caller that forgets to call the gate is a missing
    ///      line that shows up in review as an absence, which is easier to catch than an
    ///      inverted condition.
    function requireBorrowingAllowed() external view {
        if (borrowingFrozen) revert BorrowingIsFrozen();
    }

    function requireMarketCreationAllowed() external view {
        if (marketCreationPaused) revert MarketCreationIsPaused();
    }

    function requireAdapterEnabled(address adapter) external view {
        if (adapterDisabled[adapter]) revert AdapterIsDisabled(adapter);
    }
}
