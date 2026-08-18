// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Authority, Authorized} from "./Authority.sol";
import {RiskMath} from "../libraries/RiskMath.sol";
import {Types} from "../libraries/Types.sol";

/// @title LiquidityVault
/// @notice Where settlement liquidity lives, and where lenders' claims on it are tracked.
///
/// @dev The distinction this contract exists to enforce is between **NAV** and **withdrawable
///      cash**. A vault with $10m of assets and $200k of idle cash cannot honour a $1m
///      withdrawal, and pretending otherwise is how lending products lie to their depositors.
///      `totalAssets()` and `availableCash()` are separate functions, the UI shows both, and the
///      withdrawal path is bounded by cash rather than by NAV.
contract LiquidityVault is ERC20, Authorized, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    uint8 internal immutable _assetDecimals;

    /// @notice Principal currently lent out. Grows on borrow, shrinks on repay.
    uint256 public totalPrincipal;
    /// @notice Interest recognised but not yet received in cash.
    uint256 public accruedReceivables;
    /// @notice Cash promised to in-flight executions. Held back from both lending and withdrawal.
    uint256 public reservedCash;
    /// @notice Principal written off. Reduces NAV permanently.
    uint256 public badDebt;
    /// @notice Protocol reserve, funded from the spread. Not lender-owned.
    uint256 public reserves;

    event Supplied(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event CashLent(address indexed to, uint256 amount);
    event CashReturned(uint256 principal, uint256 interest);
    event BadDebtRecorded(uint256 amount);
    event ReservesAccrued(uint256 amount);
    event WithdrawalRequested(uint256 indexed id, address indexed lender, uint256 shares, uint256 amount);
    event WithdrawalFunded(uint256 indexed id, uint256 amount);
    event WithdrawalClaimed(uint256 indexed id, address indexed receiver, uint256 amount);
    event WithdrawalCancelled(uint256 indexed id, address indexed lender, uint256 shares);
    event BadDebtAbsorbedByReserves(uint256 fromReserves, uint256 toLenders);

    error ZeroAmount();
    error InsufficientCash(uint256 available, uint256 requested);
    error InsufficientShares();
    error UnknownRequest(uint256 id);
    error NotYourRequest(uint256 id);
    error RequestAlreadySettled(uint256 id);
    error RequestNotFunded(uint256 id, uint256 funded, uint256 owed);

    /// @dev Both ClearingHouse and FinancingEngine drive this vault: the first moves cash, the
    ///      second recognises interest. Rather than hardcode one address and discover the other
    ///      is locked out the first time interest accrues, both hold the CLEARING role and the
    ///      vault checks the role.
    modifier onlyClearing() {
        if (!authority.hasRole(authority.CLEARING(), msg.sender)) revert Unauthorized(authority.CLEARING());
        _;
    }

    constructor(Authority authority_, IERC20 asset_, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        Authorized(authority_)
    {
        asset = asset_;
        _assetDecimals = IERC20Metadata(address(asset_)).decimals();
    }

    function decimals() public view override returns (uint8) {
        return _assetDecimals;
    }

    // ---------------------------------------------------------------------------------
    // Accounting views
    // ---------------------------------------------------------------------------------

    /// @notice Cash sitting in the contract, minus what is already spoken for.
    /// @dev This is the number that bounds a withdrawal and bounds a new borrow. It is not NAV.
    function availableCash() public view returns (uint256) {
        uint256 held = asset.balanceOf(address(this));
        // Cash already promised to the queue is not available to lend and is not a lender's to
        // redeem. Counting it twice would let new borrowing consume the money a queued redemption
        // is waiting on.
        uint256 spokenFor = reservedCash + reserves + queuedFunded;
        return held > spokenFor ? held - spokenFor : 0;
    }

    /// @notice Lender-owned value: idle cash plus outstanding principal plus accrued interest,
    ///         less write-offs and the protocol reserve.
    function totalAssets() public view returns (uint256) {
        uint256 gross = asset.balanceOf(address(this)) + totalPrincipal + accruedReceivables;
        // Queued liabilities are already-burned shares. Leaving them in NAV would credit remaining
        // lenders with money that belongs to people who have left.
        uint256 deductions = badDebt + reserves + queuedLiabilities;
        return gross > deductions ? gross - deductions : 0;
    }

    function utilizationBps() external view returns (uint256) {
        uint256 cash = availableCash();
        if (totalPrincipal == 0) return 0;
        return RiskMath.mulDiv(totalPrincipal, Types.BPS, cash + totalPrincipal);
    }

    function convertToShares(uint256 assets_) public view returns (uint256) {
        uint256 shareSupply = totalSupply();
        uint256 ta = totalAssets();
        if (shareSupply == 0 || ta == 0) return assets_;
        return RiskMath.mulDiv(assets_, shareSupply, ta);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 shareSupply = totalSupply();
        if (shareSupply == 0) return shares;
        return RiskMath.mulDiv(shares, totalAssets(), shareSupply);
    }

    // ---------------------------------------------------------------------------------
    // Lender flows
    // ---------------------------------------------------------------------------------

    function supply(uint256 amount, address receiver) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        // Shares are priced before the transfer so the depositor cannot buy into their own deposit.
        shares = convertToShares(amount);
        asset.safeTransferFrom(msg.sender, address(this), amount);
        _mint(receiver, shares);
        emit Supplied(receiver, amount, shares);
    }

    /// @notice Redeem shares for cash, bounded by cash actually on hand.
    /// @dev Deliberately does not queue. A partial fill with an honest number beats a queue that
    ///      nobody understands; the UI shows `Withdraw now: X` from `maxWithdraw`.
    function withdraw(uint256 shares, address receiver) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();

        amount = convertToAssets(shares);
        uint256 cash = availableCash();
        if (amount > cash) revert InsufficientCash(cash, amount);

        _burn(msg.sender, shares);
        asset.safeTransfer(receiver, amount);
        emit Withdrawn(receiver, amount, shares);
    }

    /// @notice Largest redemption this vault can honour right now, in asset units.
    function maxWithdraw(address lender) external view returns (uint256) {
        uint256 owed = convertToAssets(balanceOf(lender));
        uint256 cash = availableCash();
        return owed < cash ? owed : cash;
    }

    // ---------------------------------------------------------------------------------
    // ClearingHouse flows
    // ---------------------------------------------------------------------------------

    function lend(address to, uint256 amount) external onlyClearing nonReentrant {
        uint256 cash = availableCash();
        if (amount > cash) revert InsufficientCash(cash, amount);
        totalPrincipal += amount;
        asset.safeTransfer(to, amount);
        emit CashLent(to, amount);
    }

    /// @notice Book a repayment. `tokensIn` is in SETTLEMENT-TOKEN units and has already arrived.
    ///
    /// @dev Every quantity on this contract's books is token-denominated. Passing a USD amount
    ///      corrupts NAV silently, which is exactly what happened before: `totalAssets()` sums
    ///      these against `asset.balanceOf(this)`, so a single mixed unit poisons every share
    ///      price and every withdrawal quote, and lenders lose access to their own deposit.
    ///
    ///      Interest is retired before principal. That ordering keeps `accruedReceivables`
    ///      draining rather than growing without bound, which was the second half of the same
    ///      defect: the previous caller passed a hardcoded zero interest, so the branch that
    ///      reduces receivables and funds reserves was unreachable.
    function onRepaid(uint256 tokensIn, uint16 reserveFactorBps) external onlyClearing {
        uint256 interestPart = accruedReceivables < tokensIn ? accruedReceivables : tokensIn;
        uint256 principalPart = tokensIn - interestPart;

        if (interestPart > 0) {
            accruedReceivables -= interestPart;
            uint256 toReserves = RiskMath.mulDiv(interestPart, reserveFactorBps, Types.BPS);
            reserves += toReserves;
            emit ReservesAccrued(toReserves);
        }

        totalPrincipal = totalPrincipal > principalPart ? totalPrincipal - principalPart : 0;
        emit CashReturned(principalPart, interestPart);
    }

    /// @notice Recognise accrued interest, in settlement-token units.
    function accrue(uint256 interestDeltaTokens) external onlyClearing {
        accruedReceivables += interestDeltaTokens;
    }

    /// @notice Apply returning cash to the queue before it becomes lendable again.
    /// @dev Called after a repayment or a liquidation recovery. Redemptions that are already waiting
    ///      are senior to new lending; without this, a vault could keep originating loans while
    ///      lenders who asked to leave a month ago are still queued.
    function serviceWithdrawalQueue() external onlyClearing {
        _serviceQueue();
    }

    /// @notice Write off unrecoverable principal, in settlement-token units.
    /**
     * @notice Write off unrecoverable principal, in settlement-token units.
     * @dev The waterfall, in order: the protocol reserve absorbs first, and only what it cannot
     *      cover reaches lender NAV. Reserves exist to be spent exactly here — a protocol that
     *      accumulates a reserve out of borrower interest and then socialises the first loss anyway
     *      has taken a fee for insurance it did not provide.
     *
     *      Losses beyond the reserve are borne by lenders in this vault and nowhere else. There is
     *      no cross-vault socialisation, because a lender who chose one asset's risk did not choose
     *      another's.
     */
    function recordBadDebt(uint256 amountTokens) external onlyClearing {
        totalPrincipal = totalPrincipal > amountTokens ? totalPrincipal - amountTokens : 0;

        uint256 fromReserves = reserves < amountTokens ? reserves : amountTokens;
        reserves -= fromReserves;
        uint256 toLenders = amountTokens - fromReserves;
        badDebt += toLenders;

        emit BadDebtAbsorbedByReserves(fromReserves, toLenders);
        emit BadDebtRecorded(amountTokens);
    }

    // ---------------------------------------------------------------------------------
    // Withdrawal queue
    // ---------------------------------------------------------------------------------

    /**
     * A redemption that cannot be paid today.
     *
     * `amount` is fixed when the request is made, and the shares are burned then. That is the point
     * of the queue: a lender who joins it stops earning yield and stops carrying risk from that
     * moment, so a subsequent default cannot retroactively shrink a claim they already exited. The
     * alternative — keeping shares alive until cash arrives — would let people queue during good
     * times and get repriced during bad ones, which is the behaviour that makes queues useless.
     */
    struct WithdrawalRequest {
        address lender;
        uint256 shares;
        uint256 amount;
        uint256 funded;
        uint64 requestedAt;
        bool claimed;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 id => WithdrawalRequest) public withdrawalRequests;

    /// @notice Total still owed to the queue. Senior to new lending.
    uint256 public queuedLiabilities;
    /// @notice Cash set aside for the queue and no longer lendable.
    uint256 public queuedFunded;
    /// @notice The oldest request that has not been fully funded. FIFO, so nobody jumps ahead.
    uint256 public queueHead = 1;

    /**
     * @notice Join the withdrawal queue for shares that cannot be redeemed right now.
     * @dev The honest counterpart to `withdraw` reverting. A vault whose capital is lent out cannot
     *      promise instant redemption, and pretending otherwise is how a run starts: everybody
     *      discovers the same thing at the same moment.
     */
    function requestWithdrawal(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();

        uint256 amount = convertToAssets(shares);
        _burn(msg.sender, shares);

        id = nextRequestId++;
        withdrawalRequests[id] = WithdrawalRequest({
            lender: msg.sender,
            shares: shares,
            amount: amount,
            funded: 0,
            requestedAt: uint64(block.timestamp),
            claimed: false
        });
        queuedLiabilities += amount;
        emit WithdrawalRequested(id, msg.sender, shares, amount);

        _serviceQueue();
    }

    /// @notice Take back an unfunded request and get the shares reissued at the current price.
    /// @dev Reissued at the current price, not the price when queued. Leaving the queue is
    ///      re-entering the risk, so it has to be re-entered at today's value — otherwise a lender
    ///      could queue at a high NAV, wait out a loss, and cancel back in at the old number.
    function cancelWithdrawal(uint256 id) external nonReentrant {
        WithdrawalRequest storage r = withdrawalRequests[id];
        if (r.lender == address(0)) revert UnknownRequest(id);
        if (r.lender != msg.sender) revert NotYourRequest(id);
        if (r.claimed) revert RequestAlreadySettled(id);

        uint256 refundCash = r.funded;
        uint256 unfunded = r.amount - r.funded;

        // The whole liability is discharged, not just the part still waiting on cash. The funded
        // portion is paid out and the rest becomes shares again; leaving the funded part booked
        // would keep depressing NAV for a claim that no longer exists.
        queuedLiabilities -= r.amount;
        queuedFunded -= refundCash;
        r.claimed = true;

        if (refundCash > 0) asset.safeTransfer(msg.sender, refundCash);
        uint256 shares = convertToShares(unfunded);
        if (shares > 0) _mint(msg.sender, shares);
        emit WithdrawalCancelled(id, msg.sender, shares);
    }

    /// @notice Collect a fully funded request.
    function claimWithdrawal(uint256 id, address receiver) external nonReentrant returns (uint256 amount) {
        WithdrawalRequest storage r = withdrawalRequests[id];
        if (r.lender == address(0)) revert UnknownRequest(id);
        if (r.lender != msg.sender) revert NotYourRequest(id);
        if (r.claimed) revert RequestAlreadySettled(id);
        if (r.funded < r.amount) revert RequestNotFunded(id, r.funded, r.amount);

        amount = r.amount;
        r.claimed = true;
        queuedLiabilities -= amount;
        queuedFunded -= amount;

        asset.safeTransfer(receiver, amount);
        emit WithdrawalClaimed(id, receiver, amount);
    }

    /**
     * @dev Push cash into the queue in request order.
     *
     * FIFO and partial. Cash that arrives is applied to the oldest request first and can fund it
     * part-way, because a queue that only pays complete requests strands everybody behind a large
     * one. `queueHead` advances only past fully funded requests, so the ordering cannot be jumped.
     */
    /// @dev Bounded per call. An unbounded loop over the queue makes the gas cost of a repayment a
    ///      function of how many people are waiting to leave, which is exactly backwards: the more
    ///      stressed the vault, the more expensive it becomes to feed the queue that relieves it.
    ///      Servicing resumes from `queueHead` on the next call, so nothing is skipped — a long
    ///      queue drains over several transactions instead of one that might not fit in a block.
    uint256 public constant MAX_QUEUE_STEPS_PER_CALL = 16;

    function _serviceQueue() internal {
        uint256 free = availableCash();
        uint256 id = queueHead;
        uint256 steps = 0;
        while (free > 0 && id < nextRequestId && steps < MAX_QUEUE_STEPS_PER_CALL) {
            steps++;
            WithdrawalRequest storage r = withdrawalRequests[id];
            if (r.claimed || r.funded == r.amount) {
                if (id == queueHead) queueHead = id + 1;
                id++;
                continue;
            }
            uint256 need = r.amount - r.funded;
            uint256 give = need < free ? need : free;
            r.funded += give;
            queuedFunded += give;
            free -= give;
            emit WithdrawalFunded(id, give);
            if (r.funded < r.amount) break; // partially funded; nobody behind it may overtake
            if (id == queueHead) queueHead = id + 1;
            id++;
        }
    }

    /// @notice What the queue looks like to a lender deciding whether to join it.
    function queueStatus()
        external
        view
        returns (uint256 outstanding, uint256 fundedSoFar, uint256 head, uint256 next)
    {
        return (queuedLiabilities, queuedFunded, queueHead, nextRequestId);
    }

    function reserveCash(uint256 amount) external onlyClearing {
        uint256 cash = availableCash();
        if (amount > cash) revert InsufficientCash(cash, amount);
        reservedCash += amount;
    }

    function releaseCash(uint256 amount) external onlyClearing {
        reservedCash = reservedCash > amount ? reservedCash - amount : 0;
    }
}
