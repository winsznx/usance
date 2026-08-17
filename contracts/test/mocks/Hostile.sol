// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IAggregatorV3} from "../../src/interfaces/IOracleAdapter.sol";

/// @notice The slice of `CollateralVault` a hostile token needs in order to try to exploit it.
/// @dev Declared here rather than importing the vault so the fixtures compile against a surface
///      that cannot grow. A mock that can call everything is a mock that stops proving anything.
interface IVaultProbe {
    function balanceOf(bytes32 assetId, address account) external view returns (uint256);
    function totalDeposited(bytes32 assetId) external view returns (uint256);
    function isSolvent(bytes32 assetId) external view returns (bool);
}

/// @notice ERC-20 storage and internals, with no external transfer surface.
/// @dev Split from {HostileERC20} because two of the fixtures below need transfer signatures the
///      standard one cannot express: a token that returns nothing has a different return type and
///      therefore cannot override a `returns (bool)` function.
abstract contract HostileERC20Core {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address account => uint256) internal _bal;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance(address from, uint256 have, uint256 want);
    error InsufficientAllowance(address owner, address spender, uint256 have, uint256 want);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        return _bal[account];
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function mint(address to, uint256 value) external virtual {
        totalSupply += value;
        _bal[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _spendAllowance(address owner, uint256 value) internal {
        uint256 current = allowance[owner][msg.sender];
        if (current == type(uint256).max) return;
        if (current < value) revert InsufficientAllowance(owner, msg.sender, current, value);
        allowance[owner][msg.sender] = current - value;
    }

    function _move(address from, address to, uint256 value) internal {
        uint256 have = _bal[from];
        if (have < value) revert InsufficientBalance(from, have, value);
        unchecked {
            _bal[from] = have - value;
        }
        _bal[to] += value;
        emit Transfer(from, to, value);
    }

    function _transfer(address from, address to, uint256 value) internal virtual {
        _move(from, to, value);
    }
}

/// @notice A well-behaved ERC-20 surface over {HostileERC20Core}, for fixtures whose hostility
///         lives in `_transfer` or `balanceOf` rather than in the return convention.
abstract contract HostileERC20 is HostileERC20Core {
    constructor(string memory n, string memory s, uint8 d) HostileERC20Core(n, s, d) {}

    function transfer(address to, uint256 value) external virtual returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external virtual returns (bool) {
        _spendAllowance(from, value);
        _transfer(from, to, value);
        return true;
    }
}

/// @notice A completely ordinary token, used as the control in oracle tests.
/// @dev Having a compliant fixture in the same file matters: several assertions below are only
///      meaningful if the hostile result differs from the honest one under identical setup.
contract PlainToken is HostileERC20 {
    constructor(uint8 d) HostileERC20("Plain", "PLAIN", d) {}
}

/// @notice Calls back into the protocol from inside `transfer` / `transferFrom`.
///
/// @dev Invariant I-32. Two dials, because reentrancy has two interesting windows and they fail
///      differently:
///
///      `fireBeforeMove == true`  reproduces a callback that arrives before the token's own
///                                balances change — the window a naive vault would read as
///                                "nothing has happened yet".
///      `fireBeforeMove == false` reproduces the ERC-777-style hook that arrives after, which is
///                                the window in which a vault that credits before transferring
///                                would already be inconsistent.
///
///      The reentry is one-shot. A fixture that retries forever proves the guard holds under
///      recursion but burns the whole gas limit doing it, and the failure it reports is
///      out-of-gas rather than the guard.
contract ReentrantToken is HostileERC20 {
    address public target;
    bytes public payload;
    bool public fireBeforeMove;
    bool public armed;

    uint256 public attempts;
    bool public lastCallSucceeded;
    bytes public lastReturnData;

    IVaultProbe public probe;
    bytes32 public probeAssetId;
    address public probeAccount;

    bool public observed;
    uint256 public seenLedgerBalance;
    uint256 public seenTotalDeposited;
    uint256 public seenVaultTokenBalance;
    bool public seenSolvent;

    constructor() HostileERC20("Reentrant", "REENT", 18) {}

    function arm(address target_, bytes calldata payload_, bool fireBeforeMove_) external {
        target = target_;
        payload = payload_;
        fireBeforeMove = fireBeforeMove_;
        armed = true;
    }

    /// @notice Record what the protocol looks like from inside the transfer.
    function watch(IVaultProbe probe_, bytes32 assetId, address account) external {
        probe = probe_;
        probeAssetId = assetId;
        probeAccount = account;
    }

    function _transfer(address from, address to, uint256 value) internal override {
        if (fireBeforeMove) _fire();
        _move(from, to, value);
        if (!fireBeforeMove) _fire();
    }

    function _fire() internal {
        if (address(probe) != address(0)) {
            seenLedgerBalance = probe.balanceOf(probeAssetId, probeAccount);
            seenTotalDeposited = probe.totalDeposited(probeAssetId);
            seenVaultTokenBalance = balanceOf(address(probe));
            seenSolvent = probe.isSolvent(probeAssetId);
            observed = true;
        }

        if (!armed || target == address(0)) return;
        armed = false;
        attempts += 1;
        (bool ok, bytes memory ret) = target.call(payload);
        lastCallSucceeded = ok;
        lastReturnData = ret;
    }
}

/// @notice Takes a cut on every transfer. Invariant I-33.
/// @dev The cut goes to a burn sink rather than back to the sender, so the difference between
///      "what was requested" and "what arrived" is real and permanent. A fixture that refunds the
///      fee would let a vault that credits the requested amount pass by accident.
contract FeeOnTransferToken is HostileERC20 {
    address public constant SINK = address(0xFEE);
    uint16 public feeBps;

    error FeeTooHigh(uint16 feeBps);

    constructor(uint16 feeBps_) HostileERC20("FeeOnTransfer", "FOT", 18) {
        _setFee(feeBps_);
    }

    function setFeeBps(uint16 feeBps_) external {
        _setFee(feeBps_);
    }

    function _setFee(uint16 feeBps_) internal {
        if (feeBps_ >= 10_000) revert FeeTooHigh(feeBps_);
        feeBps = feeBps_;
    }

    function _transfer(address from, address to, uint256 value) internal override {
        uint256 fee = (value * feeBps) / 10_000;
        if (fee != 0) _move(from, SINK, fee);
        _move(from, to, value - fee);
    }
}

/// @notice Balances are shares against a mutable index, so a corporate action can move every
///         holder's balance without a transfer. Invariant I-34.
/// @dev Not built on {HostileERC20Core}: the whole point is that `_bal` is not the balance.
///      Rebases are expressed in basis points and applied with integer arithmetic only — a
///      floating-point index here would make the fixture disagree with the protocol it is
///      testing about what the balance actually is.
contract RebasingToken {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    string public constant name = "Rebasing";
    string public constant symbol = "REB";
    uint8 public constant decimals = 18;

    uint256 public index = WAD;
    uint256 public totalShares;

    mapping(address account => uint256) public sharesOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Rebased(uint256 oldIndex, uint256 newIndex);

    error InsufficientShares(address from, uint256 have, uint256 want);
    error InsufficientAllowance(address owner, address spender, uint256 have, uint256 want);
    error RebaseOutOfRange(int256 bps);

    function totalSupply() external view returns (uint256) {
        return (totalShares * index) / WAD;
    }

    function balanceOf(address account) public view returns (uint256) {
        return (sharesOf[account] * index) / WAD;
    }

    function mint(address to, uint256 value) external {
        uint256 shares = (value * WAD) / index;
        sharesOf[to] += shares;
        totalShares += shares;
        emit Transfer(address(0), to, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 current = allowance[from][msg.sender];
        if (current != type(uint256).max) {
            if (current < value) revert InsufficientAllowance(from, msg.sender, current, value);
            allowance[from][msg.sender] = current - value;
        }
        _transfer(from, to, value);
        return true;
    }

    /// @param bps positive inflates every balance, negative deflates it.
    function rebase(int256 bps) external {
        if (bps <= -int256(BPS) || bps > int256(BPS)) revert RebaseOutOfRange(bps);
        uint256 old = index;
        index = bps >= 0 ? (index * (BPS + uint256(bps))) / BPS : (index * (BPS - uint256(-bps))) / BPS;
        emit Rebased(old, index);
    }

    function _transfer(address from, address to, uint256 value) internal {
        uint256 shares = (value * WAD) / index;
        uint256 have = sharesOf[from];
        if (have < shares) revert InsufficientShares(from, have, shares);
        unchecked {
            sharesOf[from] = have - shares;
        }
        sharesOf[to] += shares;
        emit Transfer(from, to, value);
    }
}

/// @notice Returns `false` instead of reverting, the failure mode `transfer` was born with.
/// @dev Toggleable so a fixture can be deposited honestly and only misbehave on the way out;
///      the withdrawal path is where a silent `false` would leave the ledger decremented and the
///      tokens still in the vault.
contract FalseReturnToken is HostileERC20 {
    bool public returnsFalse = true;

    constructor() HostileERC20("FalseReturn", "FALSE", 18) {}

    function setReturnsFalse(bool v) external {
        returnsFalse = v;
    }

    function transfer(address to, uint256 value) external override returns (bool) {
        if (returnsFalse) return false;
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external override returns (bool) {
        if (returnsFalse) return false;
        _spendAllowance(from, value);
        _transfer(from, to, value);
        return true;
    }
}

/// @notice Moves tokens correctly and returns no data at all, the USDT convention.
/// @dev `SafeERC20` treats empty returndata from an address with code as success. This fixture is
///      the one that proves that path is exercised rather than assumed; a plain `IERC20` call
///      would revert here on the ABI decode.
contract NoReturnToken is HostileERC20Core {
    constructor(uint8 d) HostileERC20Core("NoReturn", "NORET", d) {}

    function transfer(address to, uint256 value) external {
        _transfer(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external {
        _spendAllowance(from, value);
        _transfer(from, to, value);
    }
}

/// @notice `balanceOf` for one address changes between two reads inside a single transaction,
///         without a transfer explaining the difference.
/// @dev The measured-delta pattern reads the balance twice and subtracts. This fixture attacks the
///      gap between those two reads directly: the shift is applied by `_transfer` itself, so the
///      second read is neither the first read nor the first read plus the transferred amount.
///      Both directions matter — upward is an over-credit attempt, downward underflows the
///      subtraction and must not be allowed to wrap into an enormous credit.
contract ShiftingBalanceToken is HostileERC20 {
    address public shiftTarget;
    uint256 public shiftUp;
    uint256 public shiftDown;

    mapping(address account => uint256) internal _phantom;
    mapping(address account => uint256) internal _hidden;

    constructor() HostileERC20("ShiftingBalance", "SHIFT", 18) {}

    /// @dev One-shot: the shift is disarmed as it fires, so the balance is stable again by the
    ///      time the test asserts on it and every assertion is about the transaction, not a
    ///      moving target.
    function armShift(address target, uint256 up, uint256 down) external {
        shiftTarget = target;
        shiftUp = up;
        shiftDown = down;
    }

    function balanceOf(address account) public view override returns (uint256) {
        uint256 gross = _bal[account] + _phantom[account];
        uint256 hidden = _hidden[account];
        return gross > hidden ? gross - hidden : 0;
    }

    function _transfer(address from, address to, uint256 value) internal override {
        _move(from, to, value);
        address target = shiftTarget;
        if (target == address(0)) return;
        shiftTarget = address(0);
        _phantom[target] += shiftUp;
        _hidden[target] += shiftDown;
    }
}

/// @notice A Chainlink aggregator that lies, stalls or falls over.
/// @dev `latestRoundData` is `view`, so every misbehaviour has to be configured from the outside
///      rather than counted inside the call. That constraint is real — Solidity dispatches `view`
///      external calls with `STATICCALL`, so a fixture that mutated state on read would be
///      testing a feed that cannot exist.
contract HostileAggregator is IAggregatorV3 {
    /// @dev 0 = behave, 1 = revert with a reason, 2 = revert with no data at all.
    uint8 public revertMode;

    uint8 internal immutable _decimals;
    string internal _description;

    int256 public answer;
    uint256 public updatedAt;
    uint256 public startedAt;
    uint80 public roundId = 1;

    constructor(uint8 decimals_, int256 answer_, uint256 ts) {
        _decimals = decimals_;
        _description = "Hostile / USD";
        answer = answer_;
        updatedAt = ts;
        startedAt = ts;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function setAnswer(int256 a) external {
        answer = a;
    }

    function setTimestamps(uint256 started, uint256 updated) external {
        startedAt = started;
        updatedAt = updated;
    }

    function setRevertMode(uint8 mode) external {
        revertMode = mode;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (revertMode == 1) revert("aggregator down");
        if (revertMode == 2) {
            assembly ("memory-safe") {
                revert(0, 0)
            }
        }
        return (roundId, answer, startedAt, updatedAt, roundId);
    }
}
