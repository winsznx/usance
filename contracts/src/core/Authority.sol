// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title Authority
/// @notice The single place that answers "who may do this". Kept deliberately small and
///         readable: an authorization model nobody can hold in their head is one nobody audits.
///
/// @dev Separation of powers is the point (spec/threat-model.md §Protocol):
///
///      GOVERNANCE  — may change long-term policy, but only through a timelock when the change
///                    increases risk. Holds the right to grant and revoke every other role.
///      GUARDIAN    — may restrict, immediately, and may do nothing else. There is no guardian
///                    call anywhere in the protocol that increases an LTV, mints debt, moves
///                    collateral or redirects a withdrawal (invariant I-25).
///      ADMISSION   — may commit Passports and register assets. Held by the evidence pipeline's
///                    settlement key, never by a model.
///      CLEARING    — internal role held by ClearingHouse so vaults will act on its behalf.
///      LIQUIDATOR  — may run liquidation routes, which can only reduce risk.
contract Authority {
    bytes32 public constant GOVERNANCE = keccak256("USANCE_GOVERNANCE");
    bytes32 public constant GUARDIAN = keccak256("USANCE_GUARDIAN");
    bytes32 public constant ADMISSION = keccak256("USANCE_ADMISSION");
    bytes32 public constant CLEARING = keccak256("USANCE_CLEARING");
    bytes32 public constant LIQUIDATOR = keccak256("USANCE_LIQUIDATOR");

    mapping(bytes32 role => mapping(address account => bool)) public hasRole;

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed by);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed by);

    error NotAuthorized(bytes32 role, address account);

    modifier only(bytes32 role) {
        if (!hasRole[role][msg.sender]) revert NotAuthorized(role, msg.sender);
        _;
    }

    constructor(address governance) {
        hasRole[GOVERNANCE][governance] = true;
        emit RoleGranted(GOVERNANCE, governance, msg.sender);
    }

    function grantRole(bytes32 role, address account) external only(GOVERNANCE) {
        hasRole[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    function revokeRole(bytes32 role, address account) external only(GOVERNANCE) {
        hasRole[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    function requireRole(bytes32 role, address account) external view {
        if (!hasRole[role][account]) revert NotAuthorized(role, account);
    }
}

/// @notice Mixin for contracts guarded by a shared Authority.
abstract contract Authorized {
    Authority public immutable authority;

    error Unauthorized(bytes32 role);

    constructor(Authority authority_) {
        authority = authority_;
    }

    modifier onlyRole(bytes32 role) {
        if (!authority.hasRole(role, msg.sender)) revert Unauthorized(role);
        _;
    }
}
