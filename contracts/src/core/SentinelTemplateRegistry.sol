// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";

/// @title SentinelTemplateRegistry
/// @notice A marketplace catalogue of versioned strategy specifications. A template is declarative:
///         a set of schema hashes and bounded policy, never executable code, and it holds no
///         authority over anyone's money (invariant I-61). Its only consumers are the offchain
///         Sentinel runtime, the UI, and the instance registry's pin check.
/// @dev Mirrors the `PassportRegistry` discipline deliberately: strictly sequential,
///      immutable-per-version commitments, and a status ladder whose ordinal only increases except
///      by GOVERNANCE. The registry holds no role on any other contract and calls none — it is an
///      input the runtime reads, not a participant in the money path.
contract SentinelTemplateRegistry is Authorized {
    enum RiskClass {
        RISK_REDUCING_ONLY,
        MARKET_NEUTRAL,
        RISK_INCREASING
    }

    enum TemplateStatus {
        ACTIVE,
        DEPRECATED,
        SECURITY_DISABLED
    }

    enum AuditStatus {
        UNAUDITED,
        SELF_ATTESTED,
        REVIEWED
    }

    /// @dev Fee ceilings, mirrored by `MAX_TEMPLATE_FEE_BPS` / `MAX_TEMPLATE_FLAT_FEE_USD18` in
    ///      `packages/schemas/src/sentinel-template.ts`. Constants, not governance parameters: a
    ///      ceiling something can raise for itself is not a ceiling (the FeeController pattern).
    uint16 public constant MAX_FEE_BPS = 1_000;
    uint128 public constant MAX_FLAT_FEE_USD18 = 100e18;

    /// @dev The mandate vocabulary size. Mirrors `MandateRegistry.ACTION_COUNT`; a Forge test
    ///      asserts the two are equal, so a change to the onchain vocabulary cannot silently drift
    ///      from the bound this registry enforces.
    uint8 public constant MANDATE_ACTION_COUNT = 6;

    /// @dev 11 trigger classes, mirroring `TRIGGER_CLASSES` in `sentinel-triggers.ts`.
    uint8 public constant TRIGGER_CLASS_COUNT = 11;

    /// @dev The mandate verbs that increase risk (BORROW=0, TRADE=3, HEDGE=4), as a bitmask. A
    ///      RISK_REDUCING_ONLY template may require none of them — the onchain half of I-66.
    uint16 internal constant RISK_INCREASING_ACTIONS = (uint16(1) << 0) | (uint16(1) << 3) | (uint16(1) << 4);

    struct TemplateVersion {
        address publisher;
        bytes32 manifestHash;
        bytes32 configSchemaHash;
        bytes32 triggerSchemaHash;
        bytes32 planSchemaHash;
        RiskClass riskClass;
        uint16 requiredActions;
        uint16 requiredTriggerClasses;
        uint16 feePerSuccessfulRunBps;
        uint128 feeFlatPerRunUsd18;
        TemplateStatus status;
        AuditStatus auditStatus;
        uint64 createdAt;
    }

    /// @dev Passed as one calldata struct rather than a dozen parameters, so the function has a
    ///      stack. The PassportRegistry hit the same wall and split a helper; a struct is cleaner.
    struct CommitParams {
        bytes32 manifestHash;
        bytes32 configSchemaHash;
        bytes32 triggerSchemaHash;
        bytes32 planSchemaHash;
        RiskClass riskClass;
        uint16 requiredActions;
        uint16 requiredTriggerClasses;
        uint16 feePerSuccessfulRunBps;
        uint128 feeFlatPerRunUsd18;
        AuditStatus auditStatus;
    }

    mapping(bytes32 templateId => mapping(uint64 version => TemplateVersion)) internal _versions;
    mapping(bytes32 templateId => uint64) public latestVersion;
    mapping(bytes32 templateId => address) public familyPublisher;

    event TemplateCommitted(
        bytes32 indexed templateId, uint64 indexed version, address indexed publisher, bytes32 manifestHash
    );
    event TemplateStatusSet(bytes32 indexed templateId, uint64 indexed version, TemplateStatus status);

    error VersionNotSequential(uint64 expected, uint64 got);
    error NotFamilyPublisher(address expected, address got);
    error UnknownTemplateVersion(bytes32 templateId, uint64 version);
    error FeeAboveCeiling();
    error ZeroHash();
    error ActionBitOutsideVocabulary(uint16 requiredActions);
    error TriggerBitOutsideVocabulary(uint16 requiredTriggerClasses);
    error RiskReducingRequiresNonIncreasing();
    error StatusMayOnlyRestrict();
    error NotAuthorizedToSetStatus();

    constructor(Authority authority_) Authorized(authority_) {}

    /// @notice Commit the next version of a template. Strictly sequential, immutable once written.
    /// @dev The first version claims the family for its publisher; later versions must come from
    ///      that same publisher, so nobody can append a version to someone else's template. There
    ///      is no path that rewrites an existing version — history cannot be back-filled, and an
    ///      instance that pinned "v3" refers to exactly one thing forever (I-62).
    function commitTemplate(bytes32 templateId, uint64 version, CommitParams calldata p)
        external
        returns (bytes32)
    {
        uint64 expected = latestVersion[templateId] + 1;
        if (version != expected) revert VersionNotSequential(expected, version);

        if (version == 1) {
            familyPublisher[templateId] = msg.sender;
        } else if (familyPublisher[templateId] != msg.sender) {
            revert NotFamilyPublisher(familyPublisher[templateId], msg.sender);
        }

        if (
            p.manifestHash == bytes32(0) || p.configSchemaHash == bytes32(0) || p.triggerSchemaHash == bytes32(0)
                || p.planSchemaHash == bytes32(0)
        ) revert ZeroHash();

        if (p.feePerSuccessfulRunBps > MAX_FEE_BPS || p.feeFlatPerRunUsd18 > MAX_FLAT_FEE_USD18) {
            revert FeeAboveCeiling();
        }

        // Bits above the vocabulary are rejected, exactly as MandateRegistry rejects an undefined
        // action bit. The count mirrors MandateRegistry.ACTION_COUNT and a test asserts they agree.
        if (p.requiredActions >= (uint16(1) << uint16(MANDATE_ACTION_COUNT))) {
            revert ActionBitOutsideVocabulary(p.requiredActions);
        }
        if (p.requiredTriggerClasses >= (uint16(1) << uint16(TRIGGER_CLASS_COUNT))) {
            revert TriggerBitOutsideVocabulary(p.requiredTriggerClasses);
        }

        if (p.riskClass == RiskClass.RISK_REDUCING_ONLY && (p.requiredActions & RISK_INCREASING_ACTIONS) != 0) {
            revert RiskReducingRequiresNonIncreasing();
        }

        _versions[templateId][version] = TemplateVersion({
            publisher: msg.sender,
            manifestHash: p.manifestHash,
            configSchemaHash: p.configSchemaHash,
            triggerSchemaHash: p.triggerSchemaHash,
            planSchemaHash: p.planSchemaHash,
            riskClass: p.riskClass,
            requiredActions: p.requiredActions,
            requiredTriggerClasses: p.requiredTriggerClasses,
            feePerSuccessfulRunBps: p.feePerSuccessfulRunBps,
            feeFlatPerRunUsd18: p.feeFlatPerRunUsd18,
            status: TemplateStatus.ACTIVE,
            auditStatus: p.auditStatus,
            createdAt: uint64(block.timestamp)
        });
        latestVersion[templateId] = version;

        emit TemplateCommitted(templateId, version, msg.sender, p.manifestHash);
        return templateId;
    }

    /// @notice Change a version's status. Deprecation and disable only restrict.
    /// @dev The publisher may restrict their own template; a GUARDIAN may restrict anything; the
    ///      ordinal may only increase — except GOVERNANCE, which may also lift. This mirrors the
    ///      PassportRegistry ladder, with the one added door (GOVERNANCE) that the architecture
    ///      grants for recovering a wrongly-disabled template.
    function setStatus(bytes32 templateId, uint64 version, TemplateStatus status) external {
        TemplateVersion storage tv = _versions[templateId][version];
        if (tv.publisher == address(0)) revert UnknownTemplateVersion(templateId, version);

        if (authority.hasRole(authority.GOVERNANCE(), msg.sender)) {
            tv.status = status;
            emit TemplateStatusSet(templateId, version, status);
            return;
        }

        bool isGuardian = authority.hasRole(authority.GUARDIAN(), msg.sender);
        bool isPublisher = msg.sender == familyPublisher[templateId];
        if (!isGuardian && !isPublisher) revert NotAuthorizedToSetStatus();
        if (uint8(status) <= uint8(tv.status)) revert StatusMayOnlyRestrict();

        tv.status = status;
        emit TemplateStatusSet(templateId, version, status);
    }

    function getVersion(bytes32 templateId, uint64 version) external view returns (TemplateVersion memory) {
        TemplateVersion memory tv = _versions[templateId][version];
        if (tv.publisher == address(0)) revert UnknownTemplateVersion(templateId, version);
        return tv;
    }

    function versionExists(bytes32 templateId, uint64 version) external view returns (bool) {
        return _versions[templateId][version].publisher != address(0);
    }
}
