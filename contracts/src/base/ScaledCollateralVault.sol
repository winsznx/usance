// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @dev Minimal ERC-20 surface — B20 tokens are ERC-20 supersets.
interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title ScaledCollateralVault
/// @notice Custody + per-account raw-entitlement ledger for `EXTERNALLY_SCALED` (B20) instruments.
///         `spec/base-portfolio-facility-model.md §5`, `spec/corporate-action-model.md §7`.
///
/// @dev NOT the deployed X Layer `CollateralVault` (untouched) and NOT the `RebasingCollateralVault`
///      `SHARE_BASED_CUSTODY` design (that is for `REBASING_BALANCE` / xStocks, Phase 09).
///
///      B20 raw `balanceOf` is STABLE across corporate actions — a `multiplier()` change never
///      rewrites holder raw balances. So a nominal per-account raw ledger is safe: `Σ creditedRaw
///      == token.balanceOf(vault)` holds under authorised deposits, withdrawals and liquidation
///      transfers, and `I-01`-style solvency never breaks on a reverse split. The economic
///      quantity `effectiveOf = creditedRaw × factorWad / 1e18` is derived at read time; the
///      snapshot is pinned by the caller (the facility), not stored here.
///
///      I-109: a corporate action moves every `effectiveOf` proportionally and never changes
///      `creditedRaw`, never mints/burns a deposit, and emits no deposit/withdraw event.
///      An unprovenanced balance increase is unattributed surplus (I-82), credited to no account.
contract ScaledCollateralVault {
    address public immutable governance;

    /// @notice The single facility allowed to drive deposit/withdraw/liquidation. One-shot bind.
    address public facility;

    struct Instrument {
        IERC20Min token;
        bool registered;
    }

    mapping(bytes32 instrumentId => Instrument) public instrument;
    mapping(bytes32 instrumentId => mapping(address account => uint256)) public creditedRaw;
    mapping(bytes32 instrumentId => uint256) public totalCreditedRaw;
    /// @notice `token.balanceOf(vault) - totalCreditedRaw` — never credited to a holder (I-82).
    mapping(bytes32 instrumentId => uint256) public surplusRaw;

    event FacilityBound(address indexed facility);
    event InstrumentRegistered(bytes32 indexed instrumentId, address token);
    event Deposited(
        bytes32 indexed instrumentId, address indexed account, uint256 requested, uint256 measured
    );
    event Withdrawn(bytes32 indexed instrumentId, address indexed account, uint256 raw);
    event LiquidationTransfer(bytes32 indexed instrumentId, address indexed account, address to, uint256 raw);
    event SurplusObserved(bytes32 indexed instrumentId, uint256 surplusRaw);

    error NotGovernance();
    error NotFacility();
    error FacilityAlreadyBound();
    error InstrumentNotRegistered(bytes32 instrumentId);
    error InstrumentAlreadyRegistered(bytes32 instrumentId);
    error ZeroDeposit();
    error InsufficientEntitlement(uint256 have, uint256 want);
    error TransferFailed();

    constructor(address governance_) {
        governance = governance_;
    }

    modifier onlyGov() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlyFacility() {
        if (msg.sender != facility) revert NotFacility();
        _;
    }

    function bindFacility(address facility_) external onlyGov {
        if (facility != address(0)) revert FacilityAlreadyBound();
        facility = facility_;
        emit FacilityBound(facility_);
    }

    function registerInstrument(bytes32 instrumentId, address token) external onlyGov {
        if (instrument[instrumentId].registered) revert InstrumentAlreadyRegistered(instrumentId);
        instrument[instrumentId] = Instrument({token: IERC20Min(token), registered: true});
        emit InstrumentRegistered(instrumentId, token);
    }

    /// @notice Deposit raw B20 units for `account`. The facility must hold an allowance from the
    ///         source and calls with `from` = the token holder. Credits the MEASURED balance delta
    ///         (I-33), which can be less than `raw` if a policy applied a restriction.
    function deposit(bytes32 instrumentId, address from, address account, uint256 raw)
        external
        onlyFacility
        returns (uint256 measured)
    {
        Instrument memory inst = instrument[instrumentId];
        if (!inst.registered) revert InstrumentNotRegistered(instrumentId);
        if (raw == 0) revert ZeroDeposit();

        uint256 before = inst.token.balanceOf(address(this));
        if (!inst.token.transferFrom(from, address(this), raw)) revert TransferFailed();
        uint256 delta = inst.token.balanceOf(address(this)) - before;
        if (delta == 0) revert ZeroDeposit();

        creditedRaw[instrumentId][account] += delta;
        totalCreditedRaw[instrumentId] += delta;
        emit Deposited(instrumentId, account, raw, delta);
        return delta;
    }

    /// @notice Withdraw raw units back to `account`. The facility gates safety (§9) before calling.
    function withdraw(bytes32 instrumentId, address account, uint256 raw) external onlyFacility {
        _debit(instrumentId, account, raw);
        Instrument memory inst = instrument[instrumentId];
        if (!inst.token.transfer(account, raw)) revert TransferFailed();
        emit Withdrawn(instrumentId, account, raw);
    }

    /// @notice Move raw units to a liquidation route. The facility gates unsafe-state + freshness.
    function liquidationTransfer(bytes32 instrumentId, address account, address to, uint256 raw)
        external
        onlyFacility
    {
        _debit(instrumentId, account, raw);
        Instrument memory inst = instrument[instrumentId];
        if (!inst.token.transfer(to, raw)) revert TransferFailed();
        emit LiquidationTransfer(instrumentId, account, to, raw);
    }

    /// @notice Permissionless: classify any balance above `totalCreditedRaw` as unattributed
    ///         surplus. Never credits an account or a share (I-82). Emits no deposit event.
    function reconcileSurplus(bytes32 instrumentId) external {
        Instrument memory inst = instrument[instrumentId];
        if (!inst.registered) revert InstrumentNotRegistered(instrumentId);
        uint256 held = inst.token.balanceOf(address(this));
        uint256 credited = totalCreditedRaw[instrumentId];
        surplusRaw[instrumentId] = held > credited ? held - credited : 0;
        emit SurplusObserved(instrumentId, surplusRaw[instrumentId]);
    }

    /// @notice Economic quantity for an account, given a pinned factor. `spec/corporate-action-model.md §1`.
    function effectiveOf(bytes32 instrumentId, address account, uint256 factorWad)
        external
        view
        returns (uint256)
    {
        return (creditedRaw[instrumentId][account] * factorWad) / 1e18;
    }

    function _debit(bytes32 instrumentId, address account, uint256 raw) internal {
        uint256 have = creditedRaw[instrumentId][account];
        if (raw > have) revert InsufficientEntitlement(have, raw);
        creditedRaw[instrumentId][account] = have - raw;
        totalCreditedRaw[instrumentId] -= raw;
    }
}
