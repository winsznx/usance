// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Authority, Authorized} from "./Authority.sol";
import {AssetRegistry} from "./AssetRegistry.sol";
import {PassportRegistry} from "./PassportRegistry.sol";
import {RiskPolicyRegistry} from "./RiskPolicyRegistry.sol";
import {CollateralVault} from "./CollateralVault.sol";
import {LiquidityVault} from "./LiquidityVault.sol";
import {FinancingEngine} from "./FinancingEngine.sol";
import {FeeController} from "./FeeController.sol";
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {RiskMath} from "../libraries/RiskMath.sol";
import {ILiquidationRoute} from "../interfaces/ILiquidationRoute.sol";
import {Types} from "../libraries/Types.sol";

/// @title ClearingHouse
/// @notice The single authority for Usance financial obligations.
///
/// @dev Everything a user can do to their financial position enters here, and every one of those
///      paths ends in the same place: assemble the current inputs, run the deterministic
///      pipeline, and refuse anything the pipeline does not permit. There is no second opinion
///      and no override that makes an account healthier than the maths says it is.
///
///      The account's asset list is maintained on deposit/withdraw and kept sorted, because
///      truncated sums are order-dependent and RiskMath asserts the ordering rather than
///      trusting it (spec/accounting.md §1.3).
contract ClearingHouse is Authorized, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------------------

    AssetRegistry public immutable assets;
    PassportRegistry public immutable passports;
    RiskPolicyRegistry public immutable policies;
    CollateralVault public immutable collateral;
    LiquidityVault public immutable liquidity;
    FinancingEngine public immutable financing;
    IOracleAdapter public oracle;

    /// @notice AssetId of the settlement asset, so it can be priced like anything else.
    bytes32 public settlementAssetId;

    struct AccountState {
        bytes32[] held; // ascending assetId
        uint256 reservedUsd18;
        Types.AccountStatus statusOverride;
        uint64 lastEpoch;
    }

    mapping(address account => AccountState) internal _accounts;

    event CollateralAdded(address indexed account, bytes32 indexed assetId, uint256 amount, uint64 riskEpoch);
    event CollateralRemoved(
        address indexed account, bytes32 indexed assetId, uint256 amount, uint64 riskEpoch
    );
    event BorrowExecuted(
        address indexed account, uint256 amountUsd18, uint256 tokensOut, uint64 riskEpoch, uint256 healthAfter
    );
    event RepayExecuted(address indexed account, uint256 amountUsd18, uint256 tokensIn, uint64 riskEpoch);
    event AccountRestricted(address indexed account, Types.AccountStatus status, bytes32 reason);
    event CapitalReserved(address indexed account, uint256 amountUsd18, bytes32 intentId);
    event ReservationReleased(address indexed account, uint256 amountUsd18, bytes32 intentId);
    event OracleSet(address oracle);
    event SettlementMaxPriceAgeSet(uint64 previous, uint64 current);
    event FeeControllerSet(address feeController);
    event LiquidationSettled(
        address indexed account,
        address indexed keeper,
        uint256 proceedsTokens,
        uint256 toDebtTokens,
        uint256 keeperIncentiveTokens,
        uint256 protocolFeeTokens
    );
    event LiquidationExecuted(
        address indexed account,
        bytes32 indexed assetId,
        address indexed route,
        uint256 collateralSeized,
        uint256 repaidUsd18,
        uint256 proceedsTokens
    );

    error RiskLimitExceeded(uint256 requested, uint256 maximum);
    error AccountNotHealthy(Types.AccountStatus status);
    error WithdrawWouldBreachMaintenance(uint256 maxSafe);
    error StaleRiskEpoch(uint64 expected, uint64 got);
    error AssetNotCollateral(bytes32 assetId);
    error InsufficientProtocolLiquidity(uint256 available, uint256 requested);
    error NoDebt();
    error ZeroAmount();
    error NotHolding(bytes32 assetId);
    error ReservationOutstanding();

    /// @notice How old the settlement price may be before new risk is refused.
    /// @dev `configured` is a separate field on purpose. The previous version used
    ///      `maxAge == 0` to mean "no bound", which made an unconfigured deployment and a
    ///      deliberately unbounded one the same state — and the unsafe reading of that state was
    ///      the permissive one. Forgetting to configure freshness silently allowed borrowing
    ///      against a feed that might have stopped publishing a month ago.
    ///
    ///      Now the two are distinct and the default is refusal. `configured == false` blocks new
    ///      risk while leaving every risk-reducing path open, which is the same posture the
    ///      protocol takes toward any input it does not trust.
    /// @notice Where liquidation splits and reserve factors are read from.
    /// @dev Optional at construction so the module can be attached to a live core, and read on
    ///      every use rather than cached: a cached fee is a fee that keeps being charged after
    ///      governance lowered it.
    FeeController public fees;

    struct FreshnessPolicy {
        bool configured;
        uint64 maxAgeSeconds;
    }

    FreshnessPolicy public settlementFreshness;

    error SettlementAssetUnpriced();
    error SettlementPriceStale(uint64 age, uint64 maxAge);
    error SettlementFreshnessUnconfigured();
    error AccountNotLiquidatable(Types.AccountStatus status);
    error SeizureExceedsHoldings(uint256 requested, uint256 held);
    error BorrowTooSmall(uint256 amountUsd18);

    constructor(
        Authority authority_,
        AssetRegistry assets_,
        PassportRegistry passports_,
        RiskPolicyRegistry policies_,
        CollateralVault collateral_,
        LiquidityVault liquidity_,
        FinancingEngine financing_,
        IOracleAdapter oracle_
    ) Authorized(authority_) {
        assets = assets_;
        passports = passports_;
        policies = policies_;
        collateral = collateral_;
        liquidity = liquidity_;
        financing = financing_;
        oracle = oracle_;
    }

    function setOracle(IOracleAdapter o) external onlyRole(authority.GOVERNANCE()) {
        oracle = o;
        emit OracleSet(address(o));
        policies.bumpEpoch(keccak256("ORACLE_CHANGED"));
    }

    function setSettlementAsset(bytes32 assetId) external onlyRole(authority.GOVERNANCE()) {
        settlementAssetId = assetId;
    }

    function setFeeController(FeeController fees_) external onlyRole(authority.GOVERNANCE()) {
        fees = fees_;
        emit FeeControllerSet(address(fees_));
        // Attaching or replacing the source of every economic parameter changes what a quote means.
        policies.bumpEpoch(keccak256("FEE_CONTROLLER_SET"));
    }

    /// @notice Set how old the settlement price may be before new risk is refused.
    /// @dev Deliberately not applied to repayment or collateral top-ups: a contract that refuses
    ///      repayment because a feed went quiet has locked the exit.
    ///
    ///      `maxAge` of zero is rejected rather than treated as "no bound". A caller who means
    ///      "stop enforcing this" has to say so through `clearSettlementFreshness`, which is
    ///      risk-increasing and is priced as such.
    ///
    ///      Measured on X Layer mainnet: the documented Chainlink heartbeat is 86,400s and the
    ///      worst observed gap across 23 rounds of seven feeds was 86,479s. A bound set at the
    ///      heartbeat would therefore reject honest feeds. See
    ///      `artifacts/oracles/xlayer-mainnet-feeds.json`.
    function setSettlementMaxPriceAge(uint64 maxAge) external onlyRole(authority.GOVERNANCE()) {
        if (maxAge == 0) revert SettlementFreshnessUnconfigured();

        FreshnessPolicy memory previous = settlementFreshness;
        settlementFreshness = FreshnessPolicy({configured: true, maxAgeSeconds: maxAge});
        emit SettlementMaxPriceAgeSet(previous.configured ? previous.maxAgeSeconds : 0, maxAge);

        // Widening the window, or opening one where there was none, lets risk be taken against
        // prices that would previously have been refused. Tightening cannot make an outstanding
        // quote unsafe, so it does not disturb the epoch.
        if (!previous.configured || maxAge > previous.maxAgeSeconds) {
            policies.bumpEpoch(keccak256("SETTLEMENT_FRESHNESS_RELAXED"));
        }
    }

    /// @notice Stop enforcing settlement-price freshness. New risk is refused until it is set again.
    /// @dev Explicit, because the honest consequence of "we do not know how fresh this price is" is
    ///      that the protocol will not lend against it — not that it lends without checking.
    function clearSettlementFreshness() external onlyRole(authority.GOVERNANCE()) {
        FreshnessPolicy memory previous = settlementFreshness;
        settlementFreshness = FreshnessPolicy({configured: false, maxAgeSeconds: 0});
        emit SettlementMaxPriceAgeSet(previous.configured ? previous.maxAgeSeconds : 0, 0);
        policies.bumpEpoch(keccak256("SETTLEMENT_FRESHNESS_CLEARED"));
    }

    // ---------------------------------------------------------------------------------
    // Risk assembly
    // ---------------------------------------------------------------------------------

    /// @notice Build the full risk input set for an account from live registry and oracle state.
    /// @dev Deliberately a view that reads everything fresh. Caching any part of this would let a
    ///      decision be made under inputs that no longer hold, which is the exact failure the
    ///      risk epoch exists to make impossible.
    function riskInputs(address account)
        public
        view
        returns (
            Types.AssetRiskInput[] memory inputs,
            Types.AccountInput memory acct,
            Types.SequencerInput memory seq
        )
    {
        AccountState storage st = _accounts[account];
        uint256 n = st.held.length;
        inputs = new Types.AssetRiskInput[](n);

        for (uint256 i; i < n; ++i) {
            inputs[i] = _assetInput(st.held[i], account);
        }

        acct = Types.AccountInput({
            scaledPrincipal: financing.scaledPrincipalOf(account),
            borrowIndex: financing.currentIndex(),
            reservedUsd18: st.reservedUsd18,
            statusOverride: st.statusOverride
        });

        (bool up, uint64 lastRestart, uint64 grace) = oracle.sequencerStatus();
        seq = Types.SequencerInput({up: up, lastRestartAt: lastRestart, gracePeriod: grace});
    }

    /// @dev Split out of `riskInputs` to keep the assembly loop off the stack ceiling. Every
    ///      field is read live from its owning registry; nothing here is cached or passed in.
    function _assetInput(bytes32 id, address account)
        internal
        view
        returns (Types.AssetRiskInput memory input)
    {
        AssetRegistry.AssetConfig memory cfg = assets.getAsset(id);
        PassportRegistry.PassportHeader memory pp = passports.getCurrentPassport(id);
        (uint256 price, uint64 updatedAt) = oracle.getPrice(id);

        input.assetId = id;
        input.quantity = collateral.balanceOf(id, account);
        input.decimals = cfg.decimals;
        input.priceUsd18 = price;
        input.priceUpdatedAt = updatedAt;
        input.passportCommittedAt = pp.createdAt;
        input.passportStatus = passports.effectiveStatus(id);
        input.redemptionSupported = pp.redemptionSupported;
        input.redemptionFloorBps = pp.redemptionFloorBps;
        input.assetStatus = cfg.status;
        input.params = policies.getParams(cfg.riskPolicyId);
        input.exitCurve = policies.getCurve(cfg.riskPolicyId);
    }

    /// @notice The account's current financial standing under the live risk epoch.
    function accountHealth(address account)
        public
        view
        returns (Types.RiskResult memory r, Types.AssetValuation[] memory vals)
    {
        (
            Types.AssetRiskInput[] memory inputs,
            Types.AccountInput memory acct,
            Types.SequencerInput memory seq
        ) = riskInputs(account);
        (r, vals) = RiskMath.evaluate(inputs, acct, seq, uint64(block.timestamp));
    }

    /// @notice What the user may borrow right now, bounded by both risk and available cash.
    /// @dev Two different constraints with two different remedies. The UI says which one is
    ///      binding, because "add collateral" and "wait for lenders" are not the same advice.
    function availableBorrow(address account)
        external
        view
        returns (uint256 amountUsd18, bool limitedByLiquidity)
    {
        (Types.RiskResult memory r,) = accountHealth(account);
        uint256 byRisk = r.availableBorrowUsd18;
        uint256 byCash = _tokensToUsd18(liquidity.availableCash());
        if (byCash < byRisk) return (byCash, true);
        return (byRisk, false);
    }

    // ---------------------------------------------------------------------------------
    // Collateral
    // ---------------------------------------------------------------------------------

    function addCollateral(bytes32 assetId, uint256 amount) external nonReentrant {
        _addCollateral(msg.sender, msg.sender, assetId, amount);
    }

    /// @dev `payer` and `beneficiary` are separate arguments and are never allowed to diverge
    ///      without an explicit reason. Both owner and delegated paths land here, so the protocol
    ///      rules are one implementation rather than two that drift.
    function _addCollateral(address payer, address beneficiary, bytes32 assetId, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (!assets.hasCapability(assetId, Types.Capability.COLLATERAL)) revert AssetNotCollateral(assetId);

        uint256 credited = collateral.deposit(assetId, payer, beneficiary, amount);
        _insertHeld(beneficiary, assetId);

        emit CollateralAdded(beneficiary, assetId, credited, policies.riskEpoch());
    }

    function withdrawCollateral(bytes32 assetId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        AccountState storage st = _accounts[msg.sender];
        if (st.reservedUsd18 != 0) revert ReservationOutstanding();

        _accrueAndRecognise();

        // Full re-simulation of the post-withdrawal state. Not a linear approximation: recognised
        // value steps at exit-curve tier boundaries, which is exactly where an approximation
        // would be wrong and exactly where users push.
        if (!_withdrawalIsSafe(msg.sender, assetId, amount)) {
            revert WithdrawWouldBreachMaintenance(maxWithdrawable(msg.sender, assetId));
        }

        collateral.withdraw(assetId, msg.sender, msg.sender, amount);
        if (collateral.balanceOf(assetId, msg.sender) == 0) _removeHeld(msg.sender, assetId);

        emit CollateralRemoved(msg.sender, assetId, amount, policies.riskEpoch());
    }

    function _withdrawalIsSafe(address account, bytes32 assetId, uint256 amount)
        internal
        view
        returns (bool)
    {
        (
            Types.AssetRiskInput[] memory inputs,
            Types.AccountInput memory acct,
            Types.SequencerInput memory seq
        ) = riskInputs(account);

        bool found;
        for (uint256 i; i < inputs.length; ++i) {
            if (inputs[i].assetId == assetId) {
                if (inputs[i].quantity < amount) return false;
                inputs[i].quantity -= amount;
                found = true;
                break;
            }
        }
        if (!found) return false;

        (Types.RiskResult memory r,) = RiskMath.evaluate(inputs, acct, seq, uint64(block.timestamp));
        return r.debtUsd18 <= r.maintenanceLimitUsd18;
    }

    /// @notice Largest amount of `assetId` that can leave without breaching maintenance.
    /// @dev Bounded binary search over the exact simulation above. 128 iterations of a view is
    ///      irrelevant offchain and gives the UI a number the contract will actually accept,
    ///      rather than an estimate the user discovers is wrong at signing time.
    function maxWithdrawable(address account, bytes32 assetId) public view returns (uint256) {
        uint256 held = collateral.balanceOf(assetId, account);
        if (held == 0) return 0;
        if (_accounts[account].reservedUsd18 != 0) return 0;
        if (_withdrawalIsSafe(account, assetId, held)) return held;

        uint256 lo;
        uint256 hi = held;
        for (uint256 i; i < 128 && lo < hi; ++i) {
            uint256 mid = lo + (hi - lo + 1) / 2;
            if (_withdrawalIsSafe(account, assetId, mid)) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    // ---------------------------------------------------------------------------------
    // Borrow / repay
    // ---------------------------------------------------------------------------------

    /// @param expectedEpoch the risk epoch the user was shown. Pass 0 to skip the check.
    /// @dev Invariant I-12. A quote is priced under a specific epoch; if policy moved between the
    ///      preview and the signature, this reverts rather than executing under rules the user
    ///      never saw. The UI catches it and re-quotes.
    function borrow(uint256 amountUsd18, uint64 expectedEpoch) external nonReentrant {
        if (amountUsd18 == 0) revert ZeroAmount();
        uint64 epoch = policies.riskEpoch();
        if (expectedEpoch != 0 && expectedEpoch != epoch) revert StaleRiskEpoch(epoch, expectedEpoch);

        _accrueAndRecognise();

        (Types.RiskResult memory r,) = accountHealth(msg.sender);
        if (r.status != Types.AccountStatus.NORMAL) revert AccountNotHealthy(r.status);
        if (amountUsd18 > r.availableBorrowUsd18) {
            revert RiskLimitExceeded(amountUsd18, r.availableBorrowUsd18);
        }

        (uint256 sPrice, uint8 sDec) = _settlementPriceForNewRisk();
        uint256 tokensOut = RiskMath.mulDiv(amountUsd18, 10 ** sDec, sPrice);
        // A draw smaller than one unit of the settlement token rounds to zero tokens out while
        // still recording scaled principal: debt nobody was paid. Invariant I-03 says every debt
        // increment has a corresponding outflow, so there is no such thing as a free-but-negative
        // rounding here.
        if (tokensOut == 0) revert BorrowTooSmall(amountUsd18);
        uint256 cash = liquidity.availableCash();
        if (tokensOut > cash) revert InsufficientProtocolLiquidity(cash, tokensOut);

        financing.onBorrow(msg.sender, amountUsd18);
        liquidity.lend(msg.sender, tokensOut);

        (Types.RiskResult memory after_,) = accountHealth(msg.sender);
        emit BorrowExecuted(msg.sender, amountUsd18, tokensOut, epoch, after_.healthFactorWad);
    }

    /// @notice Repay debt. `repayAll` clears the position exactly and refunds nothing extra.
    // ---------------------------------------------------------------------------------
    // Liquidation
    // ---------------------------------------------------------------------------------

    /**
     * @notice Move collateral out to a liquidation route and apply what comes back to the debt.
     *
     * @dev Money movement stays here rather than in `LiquidationManager`, because this contract
     *      already owns the two boundaries a liquidation crosses: the collateral vault and the
     *      usd18-to-token conversion. A manager that moved funds itself would be a second place
     *      those boundaries are implemented, and they would drift.
     *
     *      The manager decides *whether* and *how much*. This decides nothing; it enforces.
     *
     *      Three refusals are structural rather than policy:
     *
     *      - A healthy account cannot be liquidated. Status is recomputed here from live inputs,
     *        never taken from the caller, so a manager bug cannot liquidate a solvent account.
     *      - Proceeds only ever reduce debt. There is no path from here that increases it, so a
     *        route that returns more than the debt cannot leave the account owing more than it did.
     *      - Seizure is bounded by what the account actually holds.
     */
    function executeLiquidation(
        address account,
        bytes32 assetId,
        uint256 collateralAmount,
        address route,
        uint256 minProceedsTokens
    )
        external
        onlyRole(authority.LIQUIDATOR())
        nonReentrant
        returns (uint256 repaidUsd18, uint256 proceedsTokens)
    {
        if (collateralAmount == 0) revert ZeroAmount();

        _accrueAndRecognise();

        (Types.RiskResult memory before,) = accountHealth(account);
        if (uint8(before.status) < uint8(Types.AccountStatus.MARGIN_CALL)) {
            revert AccountNotLiquidatable(before.status);
        }
        if (before.debtUsd18 == 0) revert NoDebt();

        proceedsTokens = _seizeAndSell(account, assetId, collateralAmount, route, minProceedsTokens);
        repaidUsd18 = _settleLiquidation(account, msg.sender, proceedsTokens, before.debtUsd18);

        if (collateral.balanceOf(assetId, account) == 0) _removeHeld(account, assetId);
        emit LiquidationExecuted(account, assetId, route, collateralAmount, repaidUsd18, proceedsTokens);
    }

    /// @dev Split out of `executeLiquidation` because the two halves together exceed the stack.
    ///      Enabling `via_ir` would also compile, and would change codegen for every contract in
    ///      the system to work around one function.
    function _seizeAndSell(
        address account,
        bytes32 assetId,
        uint256 collateralAmount,
        address route,
        uint256 minProceedsTokens
    ) private returns (uint256 proceedsTokens) {
        uint256 held = collateral.balanceOf(assetId, account);
        if (collateralAmount > held) revert SeizureExceedsHoldings(collateralAmount, held);

        // The route is called between the seizure and the repayment, so a route that reverts
        // unwinds the whole liquidation rather than leaving collateral in transit.
        collateral.withdraw(assetId, account, route, collateralAmount);
        proceedsTokens =
            ILiquidationRoute(route).execute(assetId, collateralAmount, minProceedsTokens, address(this));
    }

    /**
     * @dev Split the proceeds three ways and settle each.
     *
     *      The previous version applied every unit of proceeds to the debt, which meant the
     *      liquidation "bonus" accrued to the borrower as extra debt retirement and nobody was paid
     *      to perform liquidations at all. That is a fine proof of mechanics and not a liquidation
     *      market: at scale, a protocol whose keepers earn nothing has no keepers on the day it
     *      first needs them.
     *
     *      Value is conserved and the equation is the one in spec/accounting.md:
     *
     *          collateral seized (market) = debt retired
     *                                     + keeper incentive
     *                                     + protocol fee
     *                                     + route loss
     *
     *      `route loss` is the gap between what the collateral was marked at and what the route
     *      actually returned, and it is already realised by the time this runs.
     *
     *      The keeper is `msg.sender`, never a caller-supplied address. Paying the account that
     *      passed the authorisation check is the strongest possible binding between doing the work
     *      and being paid for it; a recipient parameter would let a `LIQUIDATOR` holder direct
     *      rewards anywhere and turn one compromised key into a drain.
     */
    function _settleLiquidation(address account, address keeper, uint256 proceedsTokens, uint256 debtUsd18)
        private
        returns (uint256 repaidUsd18)
    {
        IERC20 settlement = liquidity.asset();

        // Without a FeeController every unit goes to the debt, which is the old behaviour. Failing
        // closed here would brick liquidation on a core that has not been attached yet.
        // Initialised explicitly. These defaults ARE the no-FeeController behaviour — every unit
        // retires debt and nobody is paid — and leaving that to implicit zero-init made the most
        // important fallback in the function invisible.
        uint256 toKeeper = 0;
        uint256 toProtocol = 0;
        uint256 toDebt = proceedsTokens;
        address treasury = address(0);
        if (address(fees) != address(0)) {
            (toKeeper, toProtocol, toDebt) = fees.splitLiquidationProceeds(proceedsTokens);
            treasury = fees.treasury();
        }

        // Debt first. A borrower's obligation is settled before anybody is paid out of it, so a
        // rounding argument can never leave the debt short to make a fee whole.
        uint256 toDebtUsd18 = _tokensToUsd18(toDebt);
        uint256 applyUsd18 = toDebtUsd18 > debtUsd18 ? debtUsd18 : toDebtUsd18;
        uint256 applyTokens = _usd18ToTokens(applyUsd18);
        if (applyTokens > toDebt) applyTokens = toDebt;

        settlement.safeTransfer(address(liquidity), applyTokens);
        repaidUsd18 = financing.onRepay(account, applyUsd18, false);
        (,,,, uint16 reserveFactorBps) = financing.rate();
        liquidity.onRepaid(applyTokens, reserveFactorBps);

        if (toKeeper > 0) settlement.safeTransfer(keeper, toKeeper);
        if (toProtocol > 0 && treasury != address(0)) settlement.safeTransfer(treasury, toProtocol);

        // Whatever the debt could not absorb returns to the borrower. Liquidation exists to make
        // lenders whole, not to keep the upside of a position it happened to close.
        uint256 residual = toDebt - applyTokens;
        if (residual > 0) settlement.safeTransfer(account, residual);

        emit LiquidationSettled(account, keeper, proceedsTokens, applyTokens, toKeeper, toProtocol);
    }

    function repay(uint256 amountUsd18, bool repayAll) external nonReentrant returns (uint256 applied) {
        return _repay(msg.sender, msg.sender, amountUsd18, repayAll);
    }

    function _repay(address payer, address account, uint256 amountUsd18, bool repayAll)
        internal
        returns (uint256 applied)
    {
        _accrueAndRecognise();

        uint256 debt = financing.debtOf(account);
        if (debt == 0) revert NoDebt();

        uint256 target = repayAll ? debt : amountUsd18;
        if (target == 0) revert ZeroAmount();
        if (target > debt) target = debt;

        uint256 tokensIn = _usd18ToTokensUp(target);

        IERC20 settlement = liquidity.asset();
        settlement.safeTransferFrom(payer, address(liquidity), tokensIn);

        applied = financing.onRepay(account, target, repayAll);
        // The vault's books are token-denominated. `applied` is USD, so it is the tokens that
        // actually arrived which get booked, along with the real reserve factor rather than a
        // hardcoded zero that made the reserve branch unreachable.
        (,,,, uint16 reserveFactorBps) = financing.rate();
        liquidity.onRepaid(tokensIn, reserveFactorBps);

        emit RepayExecuted(account, applied, tokensIn, policies.riskEpoch());
    }

    // ---------------------------------------------------------------------------------
    // Delegated-capable surface
    // ---------------------------------------------------------------------------------

    /**
     * @notice The entire set of acts another contract may perform on an account's behalf.
     *
     * @dev Two functions, and both move value *into* the account. That is the whole delegated
     *      surface of this contract, and it is the reason "an agent cannot withdraw collateral" is
     *      a structural property rather than a claim about an enum: there is no `withdrawFor`, no
     *      `transferFor`, and no third entry point to add one to.
     *
     *      Delegated authority moved out of ClearingHouse into `DelegationGateway` when this
     *      contract crossed the 24,576-byte limit. The alternative was lowering optimizer runs,
     *      which would have degraded gas for every user forever to make room for a concern that
     *      does not belong here. Splitting was the better answer on both counts — the mandate
     *      checking now lives in one small auditable contract, and what it can reach is these two
     *      functions and nothing else.
     *
     *      `payer` is always the caller's principal, never the account. An agent that could spend
     *      the account's own balance would drain a standing wallet allowance without putting
     *      anything into the account.
     */
    /// @dev One entry point rather than two, because ClearingHouse sits within a few hundred bytes
    ///      of the 24,576 limit and a second set of `onlyRole` + `nonReentrant` modifiers and ABI
    ///      entries did not fit. The dispatch has exactly two arms and no default that does
    ///      anything: an unrecognised verb reverts.
    ///
    ///      `payer` is always the delegate, never the account. An agent that could spend the
    ///      account's own balance would drain a standing wallet allowance without putting anything
    ///      into the account.
    uint8 internal constant ON_BEHALF_REPAY = 0;
    uint8 internal constant ON_BEHALF_ADD_COLLATERAL = 1;

    error UnsupportedOnBehalfAction(uint8 verb);

    function actOnBehalf(uint8 verb, address payer, address account, bytes32 assetId, uint256 amount)
        external
        onlyRole(authority.CLEARING())
        nonReentrant
        returns (uint256 result)
    {
        if (verb == ON_BEHALF_REPAY) return _repay(payer, account, amount, false);
        if (verb == ON_BEHALF_ADD_COLLATERAL) {
            _addCollateral(payer, account, assetId, amount);
            return amount;
        }
        revert UnsupportedOnBehalfAction(verb);
    }

    // ---------------------------------------------------------------------------------
    // Reservations — capital committed to an in-flight external execution
    // ---------------------------------------------------------------------------------

    function reserve(address account, uint256 amountUsd18, bytes32 intentId)
        external
        onlyRole(authority.CLEARING())
    {
        (Types.RiskResult memory r,) = accountHealth(account);
        if (r.status != Types.AccountStatus.NORMAL) revert AccountNotHealthy(r.status);
        if (amountUsd18 > r.availableBorrowUsd18) {
            revert RiskLimitExceeded(amountUsd18, r.availableBorrowUsd18);
        }
        _accounts[account].reservedUsd18 += amountUsd18;
        emit CapitalReserved(account, amountUsd18, intentId);
    }

    /// @dev Invariant I-23. Release is only ever called with the amount reconciliation proved
    ///      unused. An unknown execution result releases nothing, because "we do not know" and
    ///      "it did not happen" are different states.
    function releaseReservation(address account, uint256 amountUsd18, bytes32 intentId)
        external
        onlyRole(authority.CLEARING())
    {
        AccountState storage st = _accounts[account];
        uint256 amt = amountUsd18 > st.reservedUsd18 ? st.reservedUsd18 : amountUsd18;
        st.reservedUsd18 -= amt;
        emit ReservationReleased(account, amt, intentId);
    }

    // ---------------------------------------------------------------------------------
    // Guardian
    // ---------------------------------------------------------------------------------

    /// @notice Place an account under a restriction floor.
    /// @dev Invariant I-25. The override is a floor and is compared as an ordinal, so a guardian
    ///      literally cannot express "make this account healthier".
    function setAccountRiskState(address account, Types.AccountStatus status, bytes32 reason) external {
        if (
            !authority.hasRole(authority.GUARDIAN(), msg.sender)
                && !authority.hasRole(authority.GOVERNANCE(), msg.sender)
        ) revert Unauthorized(authority.GUARDIAN());

        AccountState storage st = _accounts[account];
        require(uint8(status) > uint8(st.statusOverride), "override may only restrict");
        st.statusOverride = status;
        emit AccountRestricted(account, status, reason);
    }

    /// @notice Governance can lift an override once the underlying cause is resolved.
    function clearAccountRiskState(address account) external onlyRole(authority.GOVERNANCE()) {
        _accounts[account].statusOverride = Types.AccountStatus.NORMAL;
        emit AccountRestricted(account, Types.AccountStatus.NORMAL, keccak256("CLEARED"));
    }

    // ---------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------

    function heldAssets(address account) external view returns (bytes32[] memory) {
        return _accounts[account].held;
    }

    function reservedOf(address account) external view returns (uint256) {
        return _accounts[account].reservedUsd18;
    }

    function debtOf(address account) external view returns (uint256) {
        return financing.debtOf(account);
    }

    // ---------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------

    /// @dev Insertion sort into the ascending held-asset list. Portfolios are small by
    ///      construction (a handful of admitted assets), and keeping the list sorted at write
    ///      time means every read path gets canonical ordering for free.
    function _insertHeld(address account, bytes32 assetId) internal {
        bytes32[] storage held = _accounts[account].held;
        uint256 n = held.length;
        for (uint256 i; i < n; ++i) {
            if (held[i] == assetId) return;
        }
        held.push(assetId);
        for (uint256 i = n; i > 0; --i) {
            if (uint256(held[i - 1]) > uint256(held[i])) {
                (held[i - 1], held[i]) = (held[i], held[i - 1]);
            } else {
                break;
            }
        }
    }

    function _removeHeld(address account, bytes32 assetId) internal {
        bytes32[] storage held = _accounts[account].held;
        uint256 n = held.length;
        for (uint256 i; i < n; ++i) {
            if (held[i] != assetId) continue;
            // Shift rather than swap-and-pop: the list must stay sorted.
            for (uint256 j = i; j + 1 < n; ++j) {
                held[j] = held[j + 1];
            }
            held.pop();
            return;
        }
    }

    /// @notice Advance interest and recognise it on the vault, converted into token units.
    /// @dev The conversion lives here because ClearingHouse is the only component holding an
    ///      oracle. FinancingEngine reports its delta in USD and writes nothing.
    function _accrueAndRecognise() internal {
        uint256 interestUsd18 = financing.accrueFor();
        if (interestUsd18 == 0) return;
        uint256 interestTokens = _usd18ToTokens(interestUsd18);
        if (interestTokens > 0) liquidity.accrue(interestTokens);
    }

    /// @dev The settlement price with no staleness check, used on every path.
    ///
    ///      Slither flags this as an oracle read without a freshness test, and the omission was
    ///      real. Adding the obvious check here would have been worse than the finding: this
    ///      function is on the repay path, and a contract that refuses repayment because a feed
    ///      went quiet has locked the exit — the failure R-02 exists to prevent, arrived at from
    ///      the opposite direction.
    ///
    ///      So freshness is enforced where taking on risk depends on it and nowhere else. See
    ///      `_settlementPriceForNewRisk`.
    function _settlementPrice() internal view returns (uint256 price, uint8 dec) {
        (price,) = oracle.getPrice(settlementAssetId);
        if (price == 0) revert SettlementAssetUnpriced();
        dec = IERC20Metadata(address(liquidity.asset())).decimals();
    }

    /// @dev The settlement price, refused when it is too old to price new risk against.
    ///
    ///      A stale settlement feed matters most exactly when it is most likely: during a depeg, an
    ///      unmoved feed pays a borrower fewer real dollars than the debt it records. That is a
    ///      reason to refuse the borrow, not a reason to refuse the repayment that follows it.
    ///
    ///      An unconfigured policy refuses too. "Nobody has said how fresh this price must be" is
    ///      not a reason to skip the question, and defaulting it to permissive means every
    ///      deployment is one forgotten transaction away from lending against a dead feed.
    function _settlementPriceForNewRisk() internal view returns (uint256 price, uint8 dec) {
        FreshnessPolicy memory policy = settlementFreshness;
        if (!policy.configured) revert SettlementFreshnessUnconfigured();

        uint64 updatedAt;
        (price, updatedAt) = oracle.getPrice(settlementAssetId);
        if (price == 0) revert SettlementAssetUnpriced();

        // Saturating, because ordinary L2 clock skew puts a feed a second into the future routinely
        // and unsigned subtraction panics on it. Same reason as RiskMath._age.
        uint64 nowTs = uint64(block.timestamp);
        uint64 age = nowTs > updatedAt ? nowTs - updatedAt : 0;
        if (age > policy.maxAgeSeconds) revert SettlementPriceStale(age, policy.maxAgeSeconds);

        dec = IERC20Metadata(address(liquidity.asset())).decimals();
    }

    function _usd18ToTokens(uint256 usd18) internal view returns (uint256) {
        (uint256 price, uint8 dec) = _settlementPrice();
        return RiskMath.mulDiv(usd18, 10 ** dec, price);
    }

    /// @dev Round up: this is what the user must hand over to clear a debt.
    function _usd18ToTokensUp(uint256 usd18) internal view returns (uint256) {
        (uint256 price, uint8 dec) = _settlementPrice();
        return RiskMath.mulDivUp(usd18, 10 ** dec, price);
    }

    function _tokensToUsd18(uint256 tokens) internal view returns (uint256) {
        (uint256 price, uint8 dec) = _settlementPrice();
        return RiskMath.mulDiv(tokens, price, 10 ** dec);
    }
}
