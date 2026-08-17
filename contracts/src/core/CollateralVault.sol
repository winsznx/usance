// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Authority, Authorized} from "./Authority.sol";
import {AssetRegistry} from "./AssetRegistry.sol";
import {Types} from "../libraries/Types.sol";

/// @title CollateralVault
/// @notice Custody. Nothing else.
///
/// @dev This contract holds tokens and tracks who they belong to. It does not know what a
///      Passport is, cannot price anything, and has no opinion about whether a withdrawal is
///      wise — it asks ClearingHouse and does what it is told. Keeping custody this dumb is what
///      makes it auditable: the interesting logic is all somewhere that holds no funds.
///
///      Balances are credited by measured delta rather than by the requested amount, so
///      fee-on-transfer and rebasing tokens are accounted for what actually arrived
///      (invariant I-33).
contract CollateralVault is Authorized, ReentrancyGuard {
    using SafeERC20 for IERC20;

    AssetRegistry public immutable assets;

    mapping(bytes32 assetId => mapping(address account => uint256)) public balanceOf;
    mapping(bytes32 assetId => uint256) public totalDeposited;

    /// @notice Set once, to ClearingHouse. Withdrawals route through it for a health check.
    address public clearingHouse;

    event CollateralDeposited(
        bytes32 indexed assetId, address indexed account, uint256 requested, uint256 credited
    );
    event CollateralWithdrawn(bytes32 indexed assetId, address indexed account, uint256 amount);
    event ClearingHouseSet(address clearingHouse);

    error AssetNotDepositable(bytes32 assetId);
    error ZeroAmount();
    error InsufficientBalance(uint256 have, uint256 want);
    error OnlyClearingHouse();
    error ClearingHouseAlreadySet();
    error NothingReceived();

    modifier onlyClearingHouse() {
        if (msg.sender != clearingHouse) revert OnlyClearingHouse();
        _;
    }

    constructor(Authority authority_, AssetRegistry assets_) Authorized(authority_) {
        assets = assets_;
    }

    function setClearingHouse(address ch) external onlyRole(authority.GOVERNANCE()) {
        if (clearingHouse != address(0)) revert ClearingHouseAlreadySet();
        clearingHouse = ch;
        emit ClearingHouseSet(ch);
    }

    /// @notice Take custody of collateral on behalf of `account`.
    /// @dev Called by ClearingHouse, which has already checked that the asset may be used as
    ///      collateral. The vault re-checks depositability anyway: a custody contract that trusts
    ///      its caller completely is one compromise away from holding worthless tokens.
    function deposit(bytes32 assetId, address from, address account, uint256 amount)
        external
        onlyClearingHouse
        nonReentrant
        returns (uint256 credited)
    {
        if (amount == 0) revert ZeroAmount();
        if (!assets.hasCapability(assetId, Types.Capability.COLLATERAL)) {
            revert AssetNotDepositable(assetId);
        }

        IERC20 token = IERC20(assets.getAsset(assetId).token);

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        credited = token.balanceOf(address(this)) - before;
        if (credited == 0) revert NothingReceived();

        balanceOf[assetId][account] += credited;
        totalDeposited[assetId] += credited;

        emit CollateralDeposited(assetId, account, amount, credited);
    }

    /// @notice Release collateral. ClearingHouse has already simulated the resulting health.
    function withdraw(bytes32 assetId, address account, address to, uint256 amount)
        external
        onlyClearingHouse
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[assetId][account];
        if (bal < amount) revert InsufficientBalance(bal, amount);

        // Effects before interactions. The token is arbitrary and may call back.
        balanceOf[assetId][account] = bal - amount;
        totalDeposited[assetId] -= amount;

        IERC20(assets.getAsset(assetId).token).safeTransfer(to, amount);

        emit CollateralWithdrawn(assetId, account, amount);
    }

    /// @notice Tokens held beyond what accounts are owed.
    /// @dev Non-zero surplus is not free revenue. It usually means a rebase or a direct transfer,
    ///      and it is surfaced rather than swept so that invariant I-01 stays checkable and
    ///      nothing becomes protocol income by accident (spec/accounting.md §7).
    function surplus(bytes32 assetId) external view returns (uint256) {
        uint256 held = IERC20(assets.getAsset(assetId).token).balanceOf(address(this));
        uint256 owed = totalDeposited[assetId];
        return held > owed ? held - owed : 0;
    }

    /// @notice Invariant I-01, callable by anyone.
    function isSolvent(bytes32 assetId) external view returns (bool) {
        return IERC20(assets.getAsset(assetId).token).balanceOf(address(this)) >= totalDeposited[assetId];
    }
}
