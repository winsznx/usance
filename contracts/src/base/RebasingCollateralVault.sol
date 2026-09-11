// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IPortfolioCollateralVault} from "./interfaces/IBaseFacility.sol";

interface IRebasingShareToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function sharesOf(address account) external view returns (uint256);
}

/// @title RebasingCollateralVault
/// @notice Share-based custody for `REBASING_BALANCE` instruments such as xStocks.
///
/// The issuer token's `balanceOf()` is already multiplier-adjusted, so Usance credits stable
/// token-share claims rather than nominal displayed balances. A multiplier event changes only the
/// displayed/economic quantity. It cannot mint a deposit, reassign ownership, or make this vault
/// owe a nominal balance it no longer holds.
contract RebasingCollateralVault is IPortfolioCollateralVault {
    address public immutable governance;
    address public facility;

    struct Instrument {
        IRebasingShareToken token;
        bool registered;
    }

    mapping(bytes32 instrumentId => Instrument) public instrument;
    mapping(bytes32 instrumentId => mapping(address account => uint256)) public claimShares;
    mapping(bytes32 instrumentId => uint256) public totalClaimShares;
    mapping(bytes32 instrumentId => uint256) public roundingDustShares;
    mapping(bytes32 instrumentId => uint256) public surplusShares;

    event FacilityBound(address indexed facility);
    event InstrumentRegistered(bytes32 indexed instrumentId, address token);
    event Deposited(
        bytes32 indexed instrumentId, address indexed account, uint256 requested, uint256 sharesMinted
    );
    event Withdrawn(
        bytes32 indexed instrumentId, address indexed account, uint256 claimShares, uint256 adjustedOut
    );
    event LiquidationTransfer(
        bytes32 indexed instrumentId,
        address indexed account,
        address indexed to,
        uint256 claimShares,
        uint256 adjustedOut
    );
    event CorporateActionObserved(bytes32 indexed instrumentId, uint256 tokenShares, uint256 adjustedBalance);
    event SurplusObserved(bytes32 indexed instrumentId, uint256 surplusShares);

    error NotGovernance();
    error NotFacility();
    error FacilityAlreadyBound();
    error InstrumentAlreadyRegistered(bytes32 instrumentId);
    error InstrumentNotRegistered(bytes32 instrumentId);
    error ZeroDeposit();
    error InsufficientClaim(uint256 have, uint256 want);
    error TransferFailed();
    error UnexpectedShareIncrease(bytes32 instrumentId, uint256 expected, uint256 actual);

    constructor(address governance_) {
        governance = governance_;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlyFacility() {
        if (msg.sender != facility) revert NotFacility();
        _;
    }

    function bindFacility(address facility_) external onlyGovernance {
        if (facility != address(0)) revert FacilityAlreadyBound();
        facility = facility_;
        emit FacilityBound(facility_);
    }

    function registerInstrument(bytes32 instrumentId, address token) external onlyGovernance {
        if (instrument[instrumentId].registered) revert InstrumentAlreadyRegistered(instrumentId);
        instrument[instrumentId] = Instrument({token: IRebasingShareToken(token), registered: true});
        emit InstrumentRegistered(instrumentId, token);
    }

    function deposit(bytes32 instrumentId, address from, address account, uint256 requested)
        external
        onlyFacility
        returns (uint256 sharesMinted)
    {
        Instrument memory inst = _instrument(instrumentId);
        if (requested == 0) revert ZeroDeposit();

        uint256 beforeShares = inst.token.sharesOf(address(this));
        if (!inst.token.transferFrom(from, address(this), requested)) revert TransferFailed();
        uint256 afterShares = inst.token.sharesOf(address(this));
        if (afterShares <= beforeShares) revert ZeroDeposit();
        sharesMinted = afterShares - beforeShares;

        claimShares[instrumentId][account] += sharesMinted;
        totalClaimShares[instrumentId] += sharesMinted;
        _observe(instrumentId, inst, afterShares);
        emit Deposited(instrumentId, account, requested, sharesMinted);
    }

    function claimOf(bytes32 instrumentId, address account) external view returns (uint256) {
        return claimShares[instrumentId][account];
    }

    /// @notice The adjusted units which belong economically to `account` right now. The token
    /// factor appears inside `balanceOf()` exactly once; no caller may multiply it again.
    function valuationQuantityOf(bytes32 instrumentId, address account) public view returns (uint256) {
        return _adjustedForShares(instrumentId, claimShares[instrumentId][account]);
    }

    function valuationQuantityAfterWithdrawal(bytes32 instrumentId, address account, uint256 claim)
        external
        view
        returns (uint256)
    {
        uint256 have = claimShares[instrumentId][account];
        return _adjustedForShares(instrumentId, have > claim ? have - claim : 0);
    }

    function valuationQuantityForClaim(bytes32 instrumentId, address, uint256 claim)
        external
        view
        returns (uint256)
    {
        return _adjustedForShares(instrumentId, claim);
    }

    function withdrawClaim(bytes32 instrumentId, address account, uint256 claim)
        external
        onlyFacility
        returns (uint256)
    {
        return _withdraw(instrumentId, account, account, claim, false);
    }

    function liquidationTransfer(bytes32 instrumentId, address account, address to, uint256 claim)
        external
        onlyFacility
        returns (uint256)
    {
        return _withdraw(instrumentId, account, to, claim, true);
    }

    /// @notice Records the latest authoritative token state. A multiplier rebase changes adjusted
    /// balance but not token shares; a direct token donation changes shares and is surplus.
    function reconcile(bytes32 instrumentId) external {
        Instrument memory inst = _instrument(instrumentId);
        _observe(instrumentId, inst, inst.token.sharesOf(address(this)));
    }

    function _withdraw(bytes32 instrumentId, address account, address to, uint256 claim, bool liquidation)
        private
        returns (uint256 adjustedOut)
    {
        Instrument memory inst = _instrument(instrumentId);
        uint256 have = claimShares[instrumentId][account];
        if (claim == 0 || claim > have) revert InsufficientClaim(have, claim);

        uint256 allShares = inst.token.sharesOf(address(this));
        uint256 adjustedBefore = inst.token.balanceOf(address(this));
        adjustedOut = _mulDivDown(claim, adjustedBefore, allShares);

        // Effects precede the token interaction. Rounding leaves a classified dust share rather
        // than an untracked entitlement or an over-withdrawal.
        claimShares[instrumentId][account] = have - claim;
        totalClaimShares[instrumentId] -= claim;
        if (!inst.token.transfer(to, adjustedOut)) revert TransferFailed();

        uint256 afterShares = inst.token.sharesOf(address(this));
        uint256 actualSharesOut = allShares - afterShares;
        if (actualSharesOut > claim) revert UnexpectedShareIncrease(instrumentId, claim, actualSharesOut);
        roundingDustShares[instrumentId] += claim - actualSharesOut;
        _observe(instrumentId, inst, afterShares);

        if (liquidation) {
            emit LiquidationTransfer(instrumentId, account, to, claim, adjustedOut);
        } else {
            emit Withdrawn(instrumentId, account, claim, adjustedOut);
        }
    }

    function _adjustedForShares(bytes32 instrumentId, uint256 shares) private view returns (uint256) {
        Instrument memory inst = _instrument(instrumentId);
        uint256 allShares = inst.token.sharesOf(address(this));
        if (allShares == 0 || shares == 0) return 0;
        return _mulDivDown(shares, inst.token.balanceOf(address(this)), allShares);
    }

    function _observe(bytes32 instrumentId, Instrument memory inst, uint256 allShares) private {
        uint256 accounted = totalClaimShares[instrumentId] + roundingDustShares[instrumentId];
        surplusShares[instrumentId] = allShares > accounted ? allShares - accounted : 0;
        emit CorporateActionObserved(instrumentId, allShares, inst.token.balanceOf(address(this)));
        emit SurplusObserved(instrumentId, surplusShares[instrumentId]);
    }

    function _instrument(bytes32 instrumentId) private view returns (Instrument memory inst) {
        inst = instrument[instrumentId];
        if (!inst.registered) revert InstrumentNotRegistered(instrumentId);
    }

    function _mulDivDown(uint256 a, uint256 b, uint256 d) private pure returns (uint256) {
        return d == 0 ? 0 : (a * b) / d;
    }
}
