// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {PortfolioRiskEngine} from "./PortfolioRiskEngine.sol";
import {PortfolioRiskPolicyRegistry} from "./PortfolioRiskPolicyRegistry.sol";
import {
    IInstrumentAdapter,
    IBaseOracleAdapter,
    IMarketSession,
    IPortfolioCollateralVault,
    CorporateActionSnapshot
} from "./interfaces/IBaseFacility.sol";

interface IERC20S {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IStaticLiquidityObserver {
    function observe(bytes32 instrumentId, uint256 notionalUsd18)
        external
        view
        returns (bytes32 group, uint256 depthUsd18, uint256 sizeAwareExitUsd18);
}

/// @title PortfolioRevolvingCredit
/// @notice `facilityType = PORTFOLIO_REVOLVING_CREDIT` (D-028). The **only** financial authority for
///         a Base portfolio-collateralised working-capital account. Provider-neutral: Base is the
///         deployment domain, not code. `spec/base-portfolio-facility-model.md §7`.
///
/// @dev Consumes the frozen Phase 03 (corporate-action) and Phase 04 (portfolio-risk) models
///      unchanged. `ClearingHouse` / `CollateralVault` / `RiskMath` are untouched. `outstandingDebt`
///      is stored (never derived); recognised value is derived through the pure `PortfolioRiskEngine`
///      on every state change. Every draw path charges the origination fee (I-110). A draw executes
///      only under its exact quoted portfolio snapshot (I-115).
contract PortfolioRevolvingCredit {
    using PortfolioRiskEngine for PortfolioRiskEngine.Position[];

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint16 public constant MAX_ORIGINATION_FEE_BPS = 100; // 1.00% ceiling (D-025 discipline)

    enum Status {
        DRAFT,
        PORTFOLIO_PENDING,
        ACTIVE,
        RECALLING,
        MATURED,
        SETTLED
    }

    struct Terms {
        bytes32 homeDomainId;
        bytes32 discriminator;
        address governance;
        address borrower;
        address lender;
        address treasury;
        address settlementToken; // native USDC
        uint8 settlementDecimals; // 6
        address vault; // IPortfolioCollateralVault
        address policyRegistry; // PortfolioRiskPolicyRegistry
        bytes32 policyId;
        uint256 facilityLimitUsd18;
        uint16 maxLtvBps;
        uint16 liquidationLtvBps;
        uint16 safetyBufferBps;
        uint16 originationFeeBps;
    }

    struct AdmittedInstrument {
        IInstrumentAdapter adapter;
        IBaseOracleAdapter oracle;
        IStaticLiquidityObserver liquidity;
        IMarketSession session;
        uint16 recognitionBps; // single-instrument recognition of market value (<= BPS); stand-in for the Passport policy on Base
        uint8 decimals;
        bool admitted;
    }

    struct Snap {
        uint256 portfolioRecognizedUsd18;
        uint256 singleRecognizedTotalUsd18;
        uint256 marketValueUsd18;
        uint8 bindingConstraint;
        bool allLive;
        bytes32 digest;
    }

    // ---- immutable terms ----
    bytes32 public immutable facilityId;
    address public immutable governance;
    address public immutable borrower;
    address public immutable lender;
    address public immutable treasury;
    IERC20S public immutable settlementToken;
    uint8 public immutable settlementDecimals;
    IPortfolioCollateralVault public immutable vault;
    PortfolioRiskPolicyRegistry public immutable policyReg;
    bytes32 public immutable policyId;
    uint256 public immutable facilityLimitUsd18;
    uint16 public immutable maxLtvBps;
    uint16 public immutable liquidationLtvBps;
    uint16 public immutable safetyBufferBps;
    uint16 public immutable originationFeeBps;

    // ---- state ----
    Status public status;
    uint256 public outstandingDebtUsd18; // stored, authoritative
    uint256 public lenderFundedUsd18;
    bytes32[] public admittedInstruments;
    mapping(bytes32 instrumentId => AdmittedInstrument) internal _admitted;

    event CollateralAdmitted(
        bytes32 indexed instrumentId, address adapter, address oracle, uint16 recognitionBps
    );
    event CollateralCommitted(bytes32 indexed instrumentId, address indexed from, uint256 measuredRaw);
    event Funded(uint256 amountUsd18);
    event Activated(uint256 portfolioRecognizedUsd18, bytes32 snapshotDigest);
    event Drawn(uint256 amountUsdc, uint256 feeUsd18, uint256 debtAfterUsd18, bytes32 snapshotDigest);
    event Repaid(uint256 amountUsdc, uint256 debtAfterUsd18);
    event CollateralWithdrawn(
        bytes32 indexed instrumentId, uint256 raw, uint256 portfolioRecognizedAfterUsd18
    );
    event Settled();
    event Liquidated(
        bytes32 indexed instrumentId, uint256 raw, uint256 proceedsUsd18, uint256 debtAfterUsd18
    );

    error NotGovernance();
    error NotBorrower();
    error NotLender();
    error WrongStatus(Status got, Status want);
    error AlreadyAdmitted(bytes32 instrumentId);
    error NotAdmitted(bytes32 instrumentId);
    error TooManyInstruments();
    error RecognitionTooHigh(uint16 bps);
    error FeeTooHigh(uint16 bps);
    error InstrumentNotTransferable(bytes32 instrumentId, bytes32 reason);
    error ZeroAmount();
    error StaleQuote(bytes32 got, bytes32 current);
    error FeedNotLive(bytes32 instrumentId);
    error OverDraw(uint256 wouldBeDebtUsd18, uint256 maxDebtUsd18);
    error NotFunded(uint256 have, uint256 want);
    error UnsafeWithdrawal(uint256 debtUsd18, uint256 safeMaxDebtUsd18);
    error OutstandingDebt(uint256 debtUsd18);
    error NotUnsafe();
    error TransferFailed();

    constructor(Terms memory t) {
        if (t.originationFeeBps > MAX_ORIGINATION_FEE_BPS) revert FeeTooHigh(t.originationFeeBps);
        facilityId = keccak256(
            abi.encode(
                "USANCE_FACILITY_V1",
                "PORTFOLIO_REVOLVING_CREDIT",
                t.homeDomainId,
                address(this),
                t.discriminator
            )
        );
        governance = t.governance;
        borrower = t.borrower;
        lender = t.lender;
        treasury = t.treasury;
        settlementToken = IERC20S(t.settlementToken);
        settlementDecimals = t.settlementDecimals;
        vault = IPortfolioCollateralVault(t.vault);
        policyReg = PortfolioRiskPolicyRegistry(t.policyRegistry);
        policyId = t.policyId;
        facilityLimitUsd18 = t.facilityLimitUsd18;
        maxLtvBps = t.maxLtvBps;
        liquidationLtvBps = t.liquidationLtvBps;
        safetyBufferBps = t.safetyBufferBps;
        originationFeeBps = t.originationFeeBps;
        status = Status.DRAFT;
    }

    modifier onlyGov() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlyBorrower() {
        if (msg.sender != borrower) revert NotBorrower();
        _;
    }

    // ----------------------------------------------------------------- admission

    function admitCollateral(
        bytes32 instrumentId,
        address adapter,
        address oracle,
        address liquidity,
        address session,
        uint16 recognitionBps
    ) external onlyGov {
        if (_admitted[instrumentId].admitted) revert AlreadyAdmitted(instrumentId);
        if (admittedInstruments.length >= _maxInstruments()) revert TooManyInstruments();
        if (recognitionBps > BPS) revert RecognitionTooHigh(recognitionBps);
        if (IInstrumentAdapter(adapter).instrumentId() != instrumentId) revert NotAdmitted(instrumentId);

        _admitted[instrumentId] = AdmittedInstrument({
            adapter: IInstrumentAdapter(adapter),
            oracle: IBaseOracleAdapter(oracle),
            liquidity: IStaticLiquidityObserver(liquidity),
            session: IMarketSession(session),
            recognitionBps: recognitionBps,
            decimals: IInstrumentAdapter(adapter).decimals(),
            admitted: true
        });
        admittedInstruments.push(instrumentId);
        emit CollateralAdmitted(instrumentId, adapter, oracle, recognitionBps);
    }

    // ----------------------------------------------------------------- funding + collateral

    function fund(uint256 amountUsdc) external {
        if (msg.sender != lender) revert NotLender();
        if (amountUsdc == 0) revert ZeroAmount();
        if (!settlementToken.transferFrom(lender, address(this), amountUsdc)) revert TransferFailed();
        lenderFundedUsd18 += _toUsd18(amountUsdc);
        emit Funded(_toUsd18(amountUsdc));
    }

    function commitCollateral(bytes32 instrumentId, address from, uint256 raw) external onlyBorrower {
        AdmittedInstrument memory a = _admitted[instrumentId];
        if (!a.admitted) revert NotAdmitted(instrumentId);
        (bool ok, bytes32 reason) = a.adapter.transferable(from, address(vault));
        if (!ok) revert InstrumentNotTransferable(instrumentId, reason);
        uint256 claimMinted = vault.deposit(instrumentId, from, borrower, raw);
        emit CollateralCommitted(instrumentId, from, claimMinted);
    }

    function activate() external {
        if (msg.sender != lender) revert NotLender();
        if (status != Status.DRAFT && status != Status.PORTFOLIO_PENDING) {
            revert WrongStatus(status, Status.DRAFT);
        }
        Snap memory s = _recompute();
        status = Status.ACTIVE;
        emit Activated(s.portfolioRecognizedUsd18, s.digest);
    }

    // ----------------------------------------------------------------- draw / repay

    function currentSnapshotDigest() external view returns (bytes32) {
        return _recompute().digest;
    }

    function quote()
        external
        view
        returns (
            uint256 portfolioRecognizedUsd18,
            uint256 maxDebtOutUsd18,
            uint256 availableUsd18,
            bytes32 snapshotDigest,
            bool allLive
        )
    {
        Snap memory s = _recompute();
        uint256 maxDebt = _maxDebt(s.portfolioRecognizedUsd18);
        uint256 avail = maxDebt > outstandingDebtUsd18 ? maxDebt - outstandingDebtUsd18 : 0;
        return (s.portfolioRecognizedUsd18, maxDebt, avail, s.digest, s.allLive);
    }

    function draw(uint256 amountUsdc, bytes32 quoteSnapshotDigest) external onlyBorrower {
        _draw(amountUsdc, quoteSnapshotDigest);
    }

    function drawAgain(uint256 amountUsdc, bytes32 quoteSnapshotDigest) external onlyBorrower {
        _draw(amountUsdc, quoteSnapshotDigest);
    }

    /// @dev The single draw path. There is no other route that moves USDC out to the borrower, so
    ///      the origination fee (I-110) and every guard apply to every draw.
    function _draw(uint256 amountUsdc, bytes32 quoteSnapshotDigest) internal {
        if (status != Status.ACTIVE) revert WrongStatus(status, Status.ACTIVE);
        if (amountUsdc == 0) revert ZeroAmount();

        Snap memory s = _recompute();
        if (s.digest != quoteSnapshotDigest) revert StaleQuote(quoteSnapshotDigest, s.digest);
        if (!s.allLive) revert FeedNotLive(bytes32(0));

        uint256 amountUsd18 = _toUsd18(amountUsdc);
        uint256 feeUsd18 = _mulDivUp(amountUsd18, originationFeeBps, BPS);
        uint256 wouldBeDebt = outstandingDebtUsd18 + amountUsd18 + feeUsd18;
        uint256 maxDebt = _maxDebt(s.portfolioRecognizedUsd18);
        if (wouldBeDebt > maxDebt) revert OverDraw(wouldBeDebt, maxDebt);
        if (_toUsd18(settlementToken.balanceOf(address(this))) < amountUsd18) {
            revert NotFunded(_toUsd18(settlementToken.balanceOf(address(this))), amountUsd18);
        }

        outstandingDebtUsd18 = wouldBeDebt;
        if (!settlementToken.transfer(borrower, amountUsdc)) revert TransferFailed();
        emit Drawn(amountUsdc, feeUsd18, outstandingDebtUsd18, s.digest);
    }

    function repay(uint256 amountUsdc) external onlyBorrower {
        if (amountUsdc == 0) revert ZeroAmount();
        if (!settlementToken.transferFrom(borrower, address(this), amountUsdc)) revert TransferFailed();
        uint256 amountUsd18 = _toUsd18(amountUsdc);
        uint256 applied = amountUsd18 > outstandingDebtUsd18 ? outstandingDebtUsd18 : amountUsd18;
        outstandingDebtUsd18 -= applied;
        uint256 refundUsd18 = amountUsd18 - applied;
        if (refundUsd18 > 0) {
            if (!settlementToken.transfer(borrower, _fromUsd18(refundUsd18))) revert TransferFailed();
        }
        emit Repaid(amountUsdc, outstandingDebtUsd18);
    }

    // ----------------------------------------------------------------- withdraw

    function withdrawCollateral(bytes32 instrumentId, uint256 claim) external onlyBorrower {
        if (status != Status.ACTIVE) revert WrongStatus(status, Status.ACTIVE);
        AdmittedInstrument memory a = _admitted[instrumentId];
        if (!a.admitted) revert NotAdmitted(instrumentId);

        // recompute the portfolio as if `raw` were already gone
        Snap memory s = _recomputeWithDelta(instrumentId, claim);
        if (!s.allLive) revert FeedNotLive(instrumentId); // I-111: no withdraw against a frozen/paused instrument
        uint256 safeMaxDebt = _mulDivDown(_maxDebt(s.portfolioRecognizedUsd18), safetyBufferBps, BPS);
        if (outstandingDebtUsd18 > safeMaxDebt) revert UnsafeWithdrawal(outstandingDebtUsd18, safeMaxDebt);

        vault.withdrawClaim(instrumentId, borrower, claim);
        emit CollateralWithdrawn(instrumentId, claim, s.portfolioRecognizedUsd18);
    }

    // ----------------------------------------------------------------- settle

    function settle() external {
        if (msg.sender != lender && msg.sender != borrower && msg.sender != governance) revert NotLender();
        if (outstandingDebtUsd18 != 0) revert OutstandingDebt(outstandingDebtUsd18);
        status = Status.SETTLED;
        // release everything
        for (uint256 i = 0; i < admittedInstruments.length; i++) {
            bytes32 id = admittedInstruments[i];
            uint256 held = vault.claimOf(id, borrower);
            if (held > 0) vault.withdrawClaim(id, borrower, held);
        }
        emit Settled();
    }

    // ----------------------------------------------------------------- unsafe-state / recovery

    function isUnsafe() public view returns (bool) {
        Snap memory s = _recompute();
        if (!s.allLive) return false; // cannot assert unsafe on a frozen feed (I-111)
        uint256 liqMax = _mulDivDown(s.portfolioRecognizedUsd18, liquidationLtvBps, BPS);
        return outstandingDebtUsd18 > liqMax;
    }

    /// @notice Permissionless once unsafe. Converts an effective B20 quantity to a settlement intent
    ///         handed off to `route` (a zero-authority execution adapter). Stale-state protected (I-111).
    function liquidate(bytes32 instrumentId, uint256 claim, address route) external {
        AdmittedInstrument memory a = _admitted[instrumentId];
        if (!a.admitted) revert NotAdmitted(instrumentId);
        Snap memory s = _recompute();
        if (!s.allLive) revert FeedNotLive(instrumentId);
        uint256 liqMax = _mulDivDown(s.portfolioRecognizedUsd18, liquidationLtvBps, BPS);
        if (outstandingDebtUsd18 <= liqMax) revert NotUnsafe();

        (uint256 price,,) = a.oracle.priceUsd18(instrumentId);
        uint256 valuationQuantity = vault.valuationQuantityForClaim(instrumentId, borrower, claim);
        uint256 proceedsUsd18 = (valuationQuantity * price) / (10 ** a.decimals);
        // route receives the custody-specific transfer quantity; it is expected to return settlement
        // proceeds to this facility. A venue remains zero-authority over credit policy.
        vault.liquidationTransfer(instrumentId, borrower, route, claim);

        uint256 applied = proceedsUsd18 > outstandingDebtUsd18 ? outstandingDebtUsd18 : proceedsUsd18;
        outstandingDebtUsd18 -= applied;
        emit Liquidated(instrumentId, claim, proceedsUsd18, outstandingDebtUsd18);
    }

    // ----------------------------------------------------------------- views / internals

    function admittedCount() external view returns (uint256) {
        return admittedInstruments.length;
    }

    function admittedInfo(bytes32 instrumentId) external view returns (AdmittedInstrument memory) {
        return _admitted[instrumentId];
    }

    function maxDebtUsd18() external view returns (uint256) {
        return _maxDebt(_recompute().portfolioRecognizedUsd18);
    }

    function _maxInstruments() internal view returns (uint256) {
        return policyReg.policy(policyId).maxCollateralInstruments;
    }

    function _maxDebt(uint256 portfolioRecognizedUsd18) internal view returns (uint256) {
        uint256 ltvLimit = _mulDivDown(portfolioRecognizedUsd18, maxLtvBps, BPS);
        return ltvLimit < facilityLimitUsd18 ? ltvLimit : facilityLimitUsd18;
    }

    function _recompute() internal view returns (Snap memory) {
        return _recomputeWithDelta(bytes32(0), 0);
    }

    /// @dev Builds engine positions from custody-derived valuation quantities. `deltaClaim` is
    ///      opaque: nominal raw units for B20 and stable pool shares for xStocks.
    function _recomputeWithDelta(bytes32 deltaInstrument, uint256 deltaClaim)
        internal
        view
        returns (Snap memory out)
    {
        uint256 n = admittedInstruments.length;
        PortfolioRiskEngine.Position[] memory pos = new PortfolioRiskEngine.Position[](n);
        bool allLive = true;

        // digest accumulators — pin facility, policy id + version, and the portfolio RiskEpoch
        (uint32 polVersion,,,,,) = policyReg.meta(policyId);
        bytes32 acc = keccak256(
            abi.encode(
                "USANCE_PORTFOLIO_SNAPSHOT_V2",
                facilityId,
                policyId,
                polVersion,
                policyReg.portfolioRiskEpoch()
            )
        );

        for (uint256 i = 0; i < n; i++) {
            bytes32 id = admittedInstruments[i];
            uint256 valuationQuantity = id == deltaInstrument
                ? vault.valuationQuantityAfterWithdrawal(id, borrower, deltaClaim)
                : vault.valuationQuantityOf(id, borrower);
            (PortfolioRiskEngine.Position memory p, bool live, bytes32 chunk) =
                _buildPosition(id, valuationQuantity);
            pos[i] = p;
            if (!live) allLive = false;
            acc = keccak256(abi.encode(acc, chunk));
        }

        PortfolioRiskEngine.Result memory res = PortfolioRiskEngine.evaluate(pos, policyReg.policy(policyId));

        out.portfolioRecognizedUsd18 = res.portfolioRecognizedValueUsd18;
        out.singleRecognizedTotalUsd18 = res.singleAssetRecognizedTotalUsd18;
        out.marketValueUsd18 = res.portfolioMarketValueUsd18;
        out.bindingConstraint = res.bindingConstraint;
        out.allLive = allLive;
        out.digest = acc;
    }

    /// @dev One instrument's engine `Position`, its live-flag, and a digest chunk. Extracted to
    ///      keep `_recomputeWithDelta` under the stack limit (`via_ir = false`, Phase 06 discipline).
    function _buildPosition(bytes32 id, uint256 valuationQuantity)
        internal
        view
        returns (PortfolioRiskEngine.Position memory p, bool live, bytes32 chunk)
    {
        AdmittedInstrument storage a = _admitted[id];
        uint256 mv;
        {
            (uint256 price, uint64 updatedAt, bool oracleLive) = a.oracle.priceUsd18(id);
            CorporateActionSnapshot memory ca = a.adapter.snapshot();
            uint8 feedStatus = ca.feedStatus;
            live = oracleLive && feedStatus == 0 && ca.support <= 1;
            mv = (valuationQuantity * price) / (10 ** a.decimals);
            chunk = keccak256(
                abi.encode(
                    id,
                    valuationQuantity,
                    price,
                    updatedAt,
                    ca.accountingMode,
                    ca.factorWad,
                    ca.pendingFactorWad,
                    ca.pendingActivationAt,
                    ca.sourceBlock,
                    ca.priceConvention,
                    feedStatus,
                    ca.support,
                    ca.observedAt
                )
            );
        }
        bytes32[5] memory g = policyReg.groupsOf(id);
        (bytes32 liqGroup, uint256 depth,) = a.liquidity.observe(id, mv);
        g[4] = liqGroup;
        p = PortfolioRiskEngine.Position({
            instrumentId: id,
            singleRecognizedUsd18: _mulDivDown(mv, a.recognitionBps, BPS),
            marketValueUsd18: mv,
            marketSession: a.session.sessionOf(id, uint64(block.timestamp)),
            groups: g,
            liquidityDepthUsd18: depth
        });
    }

    // usd18 <-> settlement token (6dp USDC) — spec/accounting.md D-009 pattern
    function _toUsd18(uint256 tokenAmount) internal view returns (uint256) {
        return settlementDecimals <= 18
            ? tokenAmount * (10 ** (18 - settlementDecimals))
            : tokenAmount / (10 ** (settlementDecimals - 18));
    }

    function _fromUsd18(uint256 usd18) internal view returns (uint256) {
        return settlementDecimals <= 18
            ? usd18 / (10 ** (18 - settlementDecimals))
            : usd18 * (10 ** (settlementDecimals - 18));
    }

    function _mulDivDown(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return (a * b) / d;
    }

    function _mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return a == 0 ? 0 : ((a * b) - 1) / d + 1;
    }
}
