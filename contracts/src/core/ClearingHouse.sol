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
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {RiskMath} from "../libraries/RiskMath.sol";
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
    /// @notice Zero means no staleness bound is enforced on the settlement price.
    uint64 public settlementMaxPriceAge;

    error SettlementAssetUnpriced();
    error SettlementPriceStale(uint64 age, uint64 maxAge);
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

    /// @notice How old the settlement price may be before new borrowing is refused. Zero disables.
    /// @dev Deliberately not applied to repayment or collateral top-ups.
    ///
    ///      Zero means "no bound", which is the most permissive setting rather than the tightest,
    ///      so it cannot be compared as though it were a small number. Relaxing bumps the epoch;
    ///      tightening does not, because a tighter bound cannot make an outstanding quote unsafe.
    function setSettlementMaxPriceAge(uint64 maxAge) external onlyRole(authority.GOVERNANCE()) {
        uint64 previous = settlementMaxPriceAge;
        settlementMaxPriceAge = maxAge;
        emit SettlementMaxPriceAgeSet(previous, maxAge);

        bool relaxed = maxAge == 0 ? previous != 0 : (previous != 0 && maxAge > previous);
        if (relaxed) policies.bumpEpoch(keccak256("SETTLEMENT_PRICE_AGE_RELAXED"));
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
        public
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
        if (amount == 0) revert ZeroAmount();
        if (!assets.hasCapability(assetId, Types.Capability.COLLATERAL)) revert AssetNotCollateral(assetId);

        uint256 credited = collateral.deposit(assetId, msg.sender, msg.sender, amount);
        _insertHeld(msg.sender, assetId);

        emit CollateralAdded(msg.sender, assetId, credited, policies.riskEpoch());
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
    function repay(uint256 amountUsd18, bool repayAll) external nonReentrant returns (uint256 applied) {
        _accrueAndRecognise();

        uint256 debt = financing.debtOf(msg.sender);
        if (debt == 0) revert NoDebt();

        uint256 target = repayAll ? debt : amountUsd18;
        if (target == 0) revert ZeroAmount();
        if (target > debt) target = debt;

        uint256 tokensIn = _usd18ToTokensUp(target);

        IERC20 settlement = liquidity.asset();
        settlement.safeTransferFrom(msg.sender, address(liquidity), tokensIn);

        applied = financing.onRepay(msg.sender, target, repayAll);
        // The vault's books are token-denominated. `applied` is USD, so it is the tokens that
        // actually arrived which get booked, along with the real reserve factor rather than a
        // hardcoded zero that made the reserve branch unreachable.
        (,,,, uint16 reserveFactorBps) = financing.rate();
        liquidity.onRepaid(tokensIn, reserveFactorBps);

        emit RepayExecuted(msg.sender, applied, tokensIn, policies.riskEpoch());
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
    ///      A stale settlement feed matters most exactly when it is most likely: during a depeg,
    ///      an unmoved feed pays a borrower fewer real dollars than the debt it records. That is a
    ///      reason to refuse the borrow, not a reason to refuse the repayment that follows it.
    ///
    ///      `settlementMaxPriceAge` of zero disables the check, which is the honest default for a
    ///      chain whose feed cadence has not been characterised — a guessed threshold produces
    ///      outages that look like protocol failures.
    function _settlementPriceForNewRisk() internal view returns (uint256 price, uint8 dec) {
        uint64 updatedAt;
        (price, updatedAt) = oracle.getPrice(settlementAssetId);
        if (price == 0) revert SettlementAssetUnpriced();

        uint64 maxAge = settlementMaxPriceAge;
        if (maxAge != 0) {
            // Saturating, because ordinary L2 clock skew puts a feed a second into the future
            // routinely and unsigned subtraction panics on it. Same reason as RiskMath._age.
            uint64 nowTs = uint64(block.timestamp);
            uint64 age = nowTs > updatedAt ? nowTs - updatedAt : 0;
            if (age > maxAge) revert SettlementPriceStale(age, maxAge);
        }

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
