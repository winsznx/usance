// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {SentinelTemplateRegistry} from "./SentinelTemplateRegistry.sol";

/// @title SentinelInstanceRegistry
/// @notice Binds one template version to one owner's account, publicly and revocably. This is where
///         template pinning and executor identity become verifiable rather than a database row.
/// @dev The registry holds no role over any money contract and calls none (I-61): pausing an
///      instance here stops the *runtime* (which refuses to run a non-REGISTERED instance);
///      revoking the *mandate* stops the *authority*. The user's real kill switch is the mandate;
///      this contract is the public, revocable statement of intent that sits beside it.
contract SentinelInstanceRegistry is Authorized {
    enum InstanceStatus {
        REGISTERED,
        PAUSED,
        REVOKED
    }

    struct Instance {
        address owner;
        address account;
        bytes32 templateId;
        uint64 templateVersion;
        bytes32 manifestHash;
        address agentExecutor;
        bytes32 mandateId;
        bytes32 configHash;
        InstanceStatus status;
        bool pausedByGuardian;
        uint64 createdAt;
    }

    SentinelTemplateRegistry public immutable templates;

    mapping(bytes32 instanceId => Instance) internal _instances;
    mapping(address owner => uint256) public nonce;

    event InstanceRegistered(
        bytes32 indexed instanceId,
        address indexed owner,
        bytes32 indexed templateId,
        uint64 templateVersion,
        address agentExecutor,
        bytes32 mandateId
    );
    event InstancePaused(bytes32 indexed instanceId, bool byGuardian);
    event InstanceResumed(bytes32 indexed instanceId);
    event InstanceRevoked(bytes32 indexed instanceId);

    error TemplateDisabled();
    error ManifestMismatch(bytes32 expected, bytes32 got);
    error ZeroExecutorOrMandate();
    error UnknownInstance(bytes32 instanceId);
    error NotOwnerOrGuardian();
    error InstanceIsRevoked();
    error NotRegistered();
    error NotPaused();
    error OwnerCannotLiftGuardianPause();
    error NotOwnerOrGovernance();

    constructor(Authority authority_, SentinelTemplateRegistry templates_) Authorized(authority_) {
        templates = templates_;
    }

    /// @dev Matches the offchain derivation in `packages/schemas/src/sentinel-instance.ts` so an
    ///      offchain record and this registry agree on the id without a round-trip.
    function instanceIdFor(address owner, uint256 nonce_) public pure returns (bytes32) {
        return keccak256(abi.encode("USANCE_SENTINEL_V1", owner, nonce_));
    }

    /// @notice Register a Sentinel instance over an existing, non-disabled template version, pinning
    ///         the manifest hash so a later template mutation is detectable (and is also impossible,
    ///         because versions are immutable — the pin is defence in depth, I-62/I-68).
    /// @dev Changing template version is a *new* registration over a *new* mandate review; there is
    ///      no in-place upgrade, so a publisher update can never widen an installed instance.
    function registerInstance(
        bytes32 templateId,
        uint64 templateVersion,
        bytes32 manifestHash,
        address agentExecutor,
        bytes32 mandateId,
        bytes32 configHash
    ) external returns (bytes32 instanceId) {
        SentinelTemplateRegistry.TemplateVersion memory tv = templates.getVersion(templateId, templateVersion);
        if (tv.status == SentinelTemplateRegistry.TemplateStatus.SECURITY_DISABLED) revert TemplateDisabled();
        if (tv.manifestHash != manifestHash) revert ManifestMismatch(tv.manifestHash, manifestHash);
        if (agentExecutor == address(0) || mandateId == bytes32(0)) revert ZeroExecutorOrMandate();

        uint256 n = nonce[msg.sender]++;
        instanceId = instanceIdFor(msg.sender, n);

        _instances[instanceId] = Instance({
            owner: msg.sender,
            account: msg.sender,
            templateId: templateId,
            templateVersion: templateVersion,
            manifestHash: manifestHash,
            agentExecutor: agentExecutor,
            mandateId: mandateId,
            configHash: configHash,
            status: InstanceStatus.REGISTERED,
            pausedByGuardian: false,
            createdAt: uint64(block.timestamp)
        });

        emit InstanceRegistered(instanceId, msg.sender, templateId, templateVersion, agentExecutor, mandateId);
    }

    /// @notice Pause an instance. The owner may pause; a GUARDIAN may pause anything.
    /// @dev A guardian pause is recorded so the owner cannot silently lift it (below).
    function pause(bytes32 instanceId) external {
        Instance storage inst = _load(instanceId);
        if (inst.status == InstanceStatus.REVOKED) revert InstanceIsRevoked();
        if (inst.status != InstanceStatus.REGISTERED) revert NotRegistered();

        bool isOwner = msg.sender == inst.owner;
        bool isGuardian = authority.hasRole(authority.GUARDIAN(), msg.sender);
        if (!isOwner && !isGuardian) revert NotOwnerOrGuardian();

        inst.status = InstanceStatus.PAUSED;
        // A guardian-only pause the owner cannot lift; an owner's own pause they can.
        inst.pausedByGuardian = isGuardian && !isOwner;
        emit InstancePaused(instanceId, inst.pausedByGuardian);
    }

    /// @notice Resume a paused instance. The owner may lift their own pause; only a GUARDIAN or
    ///         GOVERNANCE may lift a guardian pause.
    function resume(bytes32 instanceId) external {
        Instance storage inst = _load(instanceId);
        if (inst.status == InstanceStatus.REVOKED) revert InstanceIsRevoked();
        if (inst.status != InstanceStatus.PAUSED) revert NotPaused();

        bool isGuardian = authority.hasRole(authority.GUARDIAN(), msg.sender);
        bool isGov = authority.hasRole(authority.GOVERNANCE(), msg.sender);

        if (inst.pausedByGuardian) {
            if (!isGuardian && !isGov) revert OwnerCannotLiftGuardianPause();
        } else {
            if (msg.sender != inst.owner && !isGov) revert OwnerCannotLiftGuardianPause();
        }

        inst.status = InstanceStatus.REGISTERED;
        inst.pausedByGuardian = false;
        emit InstanceResumed(instanceId);
    }

    /// @notice Terminally revoke an instance. Only the owner or GOVERNANCE — never a guardian,
    ///         because revocation is the owner's decision, not a restriction. Terminal: a revoked
    ///         instance is dead, and re-arming is a fresh registration over a fresh mandate.
    function revoke(bytes32 instanceId) external {
        Instance storage inst = _load(instanceId);
        if (inst.status == InstanceStatus.REVOKED) revert InstanceIsRevoked();
        if (msg.sender != inst.owner && !authority.hasRole(authority.GOVERNANCE(), msg.sender)) {
            revert NotOwnerOrGovernance();
        }

        inst.status = InstanceStatus.REVOKED;
        emit InstanceRevoked(instanceId);
    }

    function getInstance(bytes32 instanceId) external view returns (Instance memory) {
        return _load(instanceId);
    }

    function _load(bytes32 instanceId) internal view returns (Instance storage inst) {
        inst = _instances[instanceId];
        if (inst.owner == address(0)) revert UnknownInstance(instanceId);
    }
}
