// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {
    DecisionBinding,
    FacilityDecision,
    FacilityDecisionLib,
    FacilityOperation,
    IAuthorityVerifier,
    IPolicyVerifier
} from "../interfaces/IFacilityDecisions.sol";

/// @dev The bound-field check both verifiers run before anything else. Kept here so "a decision
///      for facility A / collateral B / request R" is checked identically on both paths.
library DecisionBindingLib {
    function matches(FacilityDecision calldata d, DecisionBinding calldata b) internal pure returns (bool) {
        return d.facilityId == b.facilityId && d.operation == b.operation
            && d.subjectAssetId == b.subjectAssetId && d.subjectInstrumentRef == b.subjectInstrumentRef
            && d.requestId == b.requestId && d.pinnedEpoch == b.epoch
            && d.collateralPolicyVersion == b.collateralPolicyVersion;
    }
}

/// @title EthOnlineAuthorityVerifier
/// @notice `IAuthorityVerifier` for the ETHOnline lifecycle. Composes two independent facts
///         (Phase 07 brief §18): ENSv2 says an account currently holds the delegated role, and
///         Privy says the organisation actually signed *this* financial action.
///
/// @dev The Hedera facility cannot read ENSv2 Sepolia state (§13). The trust path is:
///        ENSv2 Sepolia  → canonical EAC resolution                [ENS contracts, Sepolia]
///        Usance relayer → pins the ENS observation as an evidence digest
///        Privy org key  → signs (decisionHash, ensEvidenceDigest)  [Privy TEE / key quorum]
///        this contract  → recovers the signer, checks it is the facility's registered org
///                          approver, checks the ENS digest is the expected one and not revoked
///      `submitApproval` is the relayer's call; `verify` is the facility's read. A generic
///      "Approve Usance" signature does not recover to anything this contract accepts, because the
///      signed message *is* the full decision hash plus the ENS digest.
contract EthOnlineAuthorityVerifier is IAuthorityVerifier {
    using FacilityDecisionLib for FacilityDecision;
    using DecisionBindingLib for FacilityDecision;

    address public immutable governance;

    struct FacilityAuthority {
        address orgApprover; // the Privy-controlled signer (single key, or the quorum's aggregate)
        bytes32 expectedEnsDigest; // the pinned ENSv2 EAC evidence digest
        bool ensRoleRevoked; // set when the EAC role is revoked on Sepolia
        bool configured;
    }

    mapping(bytes32 facilityId => FacilityAuthority) public facilityAuthority;
    mapping(bytes32 decisionHash => bool) public approved;
    mapping(bytes32 decisionHash => bool) private _revoked;
    mapping(bytes32 decisionHash => bytes32 facilityId) private _decisionFacility;
    /// @notice Strictly-monotone per (facilityId, operation): a new approval must use a higher
    ///         nonce, so an old signed approval cannot be re-submitted to refresh it.
    mapping(bytes32 key => uint64) public highestNonce;

    event FacilityAuthorityConfigured(bytes32 indexed facilityId, address orgApprover, bytes32 ensDigest);
    event EnsRoleRevoked(bytes32 indexed facilityId);
    event ApprovalSubmitted(bytes32 indexed facilityId, bytes32 indexed decisionHash, address signer);

    error NotGovernance();
    error NotConfigured(bytes32 facilityId);
    error WrongSigner(address recovered, address expected);
    error EnsDigestMismatch();
    error EnsRoleIsRevoked();
    error DecisionExpired();
    error StaleNonce(uint64 got, uint64 highest);

    constructor(address governance_) {
        governance = governance_;
    }

    function configureFacility(bytes32 facilityId, address orgApprover, bytes32 expectedEnsDigest) external {
        if (msg.sender != governance) revert NotGovernance();
        facilityAuthority[facilityId] = FacilityAuthority({
            orgApprover: orgApprover,
            expectedEnsDigest: expectedEnsDigest,
            ensRoleRevoked: false,
            configured: true
        });
        emit FacilityAuthorityConfigured(facilityId, orgApprover, expectedEnsDigest);
    }

    /// @notice The EAC role was revoked on Sepolia. Every outstanding approval for the facility is
    ///         now revoked too (I-98 re-check at release blocks a pending substitution). A
    ///         substitution that already released the old collateral is unaffected (§33).
    function revokeEnsRole(bytes32 facilityId) external {
        if (msg.sender != governance) revert NotGovernance();
        facilityAuthority[facilityId].ensRoleRevoked = true;
        emit EnsRoleRevoked(facilityId);
    }

    /// @notice Relayer submits the Privy-signed org approval for one decision.
    /// @param ensEvidenceDigest keccak of the pinned ENSv2 EAC observation (name, resource, role,
    ///        resolved account, Sepolia block, expiry) — recomputed off-chain, checked here.
    /// @param privySignature ECDSA over keccak256(abi.encode("USANCE_ORG_APPROVAL_V1",
    ///        decisionHash, ensEvidenceDigest)).
    function submitApproval(
        FacilityDecision calldata d,
        bytes32 ensEvidenceDigest,
        bytes calldata privySignature
    ) external {
        FacilityAuthority memory fa = facilityAuthority[d.facilityId];
        if (!fa.configured) revert NotConfigured(d.facilityId);
        if (fa.ensRoleRevoked) revert EnsRoleIsRevoked();
        if (ensEvidenceDigest != fa.expectedEnsDigest) revert EnsDigestMismatch();
        if (d.expiry <= block.timestamp) revert DecisionExpired();

        bytes32 nkey = keccak256(abi.encode(d.facilityId, d.operation));
        if (d.nonce <= highestNonce[nkey]) revert StaleNonce(d.nonce, highestNonce[nkey]);
        highestNonce[nkey] = d.nonce;

        bytes32 decisionHash = d.hash();
        bytes32 signed = keccak256(abi.encode("USANCE_ORG_APPROVAL_V1", decisionHash, ensEvidenceDigest));
        address signer = ECDSA.recover(signed, privySignature);
        if (signer != fa.orgApprover) revert WrongSigner(signer, fa.orgApprover);

        approved[decisionHash] = true;
        _decisionFacility[decisionHash] = d.facilityId;
        emit ApprovalSubmitted(d.facilityId, decisionHash, signer);
    }

    // ---- IAuthorityVerifier ----

    function verify(FacilityDecision calldata d, DecisionBinding calldata b)
        external
        view
        returns (bool ok, bytes32 decisionHash)
    {
        decisionHash = d.hash();
        if (!d.matches(b)) return (false, bytes32(0));
        if (d.expiry <= block.timestamp) return (false, bytes32(0));
        if (!approved[decisionHash] || isRevoked(decisionHash)) return (false, bytes32(0));
        return (true, decisionHash);
    }

    function isRevoked(bytes32 decisionHash) public view returns (bool) {
        if (_revoked[decisionHash]) return true;
        return facilityAuthority[_decisionFacility[decisionHash]].ensRoleRevoked;
    }

    function revokeDecision(bytes32 decisionHash) external {
        if (msg.sender != governance) revert NotGovernance();
        _revoked[decisionHash] = true;
    }
}

/// @title EthOnlinePolicyVerifier
/// @notice `IPolicyVerifier` for the ETHOnline lifecycle. Carries the Chainlink CRE confidential
///         lender-policy decision. CRE evaluates the replacement candidate against the lender's
///         private thresholds inside a TEE and emits a DON-signed public report; this contract
///         checks the report binds the exact request and says ALLOW.
///
/// @dev CRE does not become the risk engine (§20). This verifier only carries the confidential
///      policy verdict. `InstitutionalFacility._assertReleasable` still runs the deterministic
///      public checks (exact asset identity, committed amount, oracle freshness, RiskEpoch,
///      coverage). An `IPolicyVerifier` pass is necessary, never sufficient.
contract EthOnlinePolicyVerifier is IPolicyVerifier {
    using FacilityDecisionLib for FacilityDecision;
    using DecisionBindingLib for FacilityDecision;

    uint8 internal constant DENY = 0;
    uint8 internal constant ALLOW = 1;

    address public immutable governance;

    struct FacilityPolicy {
        address creReporter; // the DON / relayer key that signs the CRE report
        bytes32 expectedPolicyCommitment; // the pinned lender-policy version commitment
        uint32 expectedWorkflowVersion;
        bool configured;
    }

    mapping(bytes32 facilityId => FacilityPolicy) public facilityPolicy;

    struct Verdict {
        bool allow;
        bytes32 policyCommitment;
        uint32 workflowVersion;
        bytes32 reasonCode; // disclosure-safe
        uint64 expiry;
        bool present;
    }

    mapping(bytes32 decisionHash => Verdict) public verdict;
    mapping(bytes32 decisionHash => bool) public epochCarveOut;
    mapping(bytes32 key => uint64) public highestNonce; // strictly monotone per (facilityId, operation)

    event FacilityPolicyConfigured(bytes32 indexed facilityId, address creReporter, bytes32 policyCommitment);
    event VerdictSubmitted(
        bytes32 indexed facilityId, bytes32 indexed decisionHash, bool allow, bytes32 reasonCode
    );

    error NotGovernance();
    error NotConfigured(bytes32 facilityId);
    error WrongReporter(address recovered, address expected);
    error PolicyCommitmentMismatch();
    error WorkflowVersionMismatch();
    error StaleNonce(uint64 got, uint64 highest);
    error VerdictExpired();

    constructor(address governance_) {
        governance = governance_;
    }

    function configureFacility(
        bytes32 facilityId,
        address creReporter,
        bytes32 expectedPolicyCommitment,
        uint32 expectedWorkflowVersion
    ) external {
        if (msg.sender != governance) revert NotGovernance();
        facilityPolicy[facilityId] = FacilityPolicy({
            creReporter: creReporter,
            expectedPolicyCommitment: expectedPolicyCommitment,
            expectedWorkflowVersion: expectedWorkflowVersion,
            configured: true
        });
        emit FacilityPolicyConfigured(facilityId, creReporter, expectedPolicyCommitment);
    }

    /// @notice Relayer submits the CRE report for one decision.
    /// @param creReportSig ECDSA over keccak256(abi.encode("USANCE_CRE_POLICY_V1", decisionHash,
    ///        allow, policyCommitment, workflowVersion, reasonCode, expiry)).
    function submitVerdict(
        FacilityDecision calldata d,
        bool allow,
        bytes32 policyCommitment,
        uint32 workflowVersion,
        bytes32 reasonCode,
        uint64 expiry,
        bytes calldata creReportSig
    ) external {
        FacilityPolicy memory fp = facilityPolicy[d.facilityId];
        if (!fp.configured) revert NotConfigured(d.facilityId);
        if (policyCommitment != fp.expectedPolicyCommitment) revert PolicyCommitmentMismatch();
        if (workflowVersion != fp.expectedWorkflowVersion) revert WorkflowVersionMismatch();
        if (expiry <= block.timestamp) revert VerdictExpired();

        bytes32 nkey = keccak256(abi.encode(d.facilityId, d.operation));
        if (d.nonce <= highestNonce[nkey]) revert StaleNonce(d.nonce, highestNonce[nkey]);
        highestNonce[nkey] = d.nonce;

        bytes32 decisionHash = d.hash();
        bytes32 signed = keccak256(
            abi.encode(
                "USANCE_CRE_POLICY_V1",
                decisionHash,
                allow,
                policyCommitment,
                workflowVersion,
                reasonCode,
                expiry
            )
        );
        address reporter = ECDSA.recover(signed, creReportSig);
        if (reporter != fp.creReporter) revert WrongReporter(reporter, fp.creReporter);

        verdict[decisionHash] = Verdict({
            allow: allow,
            policyCommitment: policyCommitment,
            workflowVersion: workflowVersion,
            reasonCode: reasonCode,
            expiry: expiry,
            present: true
        });
        emit VerdictSubmitted(d.facilityId, decisionHash, allow, reasonCode);
    }

    /// @notice Governance opens the risk-reducing epoch carve-out for one decision, only after CRE
    ///         re-attested that the moved epoch is still safe for this exact request.
    function setEpochCarveOut(bytes32 decisionHash, bool on) external {
        if (msg.sender != governance) revert NotGovernance();
        epochCarveOut[decisionHash] = on;
    }

    // ---- IPolicyVerifier ----

    function verify(FacilityDecision calldata d, DecisionBinding calldata b)
        external
        view
        returns (bool ok, bytes32 decisionHash)
    {
        decisionHash = d.hash();
        if (!d.matches(b)) return (false, bytes32(0));
        Verdict memory v = verdict[decisionHash];
        // Absence, DENY, or expiry all fail closed (§27) — never default ALLOW.
        if (!v.present || !v.allow || v.expiry <= block.timestamp) return (false, bytes32(0));
        return (true, decisionHash);
    }

    function permitsCurrentEpoch(bytes32 decisionHash, uint64, uint64) external view returns (bool) {
        return epochCarveOut[decisionHash];
    }
}
