// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title Facility authority & policy decisions
/// @notice Provider-neutral. Phase 07 wires ENSv2 / Privy behind `IAuthorityVerifier` and
///         Chainlink CRE behind `IPolicyVerifier`. The facility validates the binding; it never
///         accepts `approved = true` from a caller.
///
/// @dev The two decision structs are identical in shape on purpose — an authority decision and a
///      policy decision bind the same operation to the same subject under the same epoch, they
///      just answer different questions ("is this actor allowed to ask" vs "is this collateral
///      eligible and the result safe"). One struct, one hash function, two verifiers.

/// @notice What a decision authorises. A decision for one operation cannot authorise another.
enum FacilityOperation {
    ACTIVATE,
    SUBSTITUTE,
    RECALL,
    SETTLE
}

/// @notice A decision bound to exactly one facility operation on exactly one subject.
/// @dev `keccak256(abi.encode(FacilityDecision))` is the decisionHash the facility stores and
///      re-checks for revocation. Every field participates; changing any one produces a
///      different hash, which is what makes "a decision for collateral B cannot authorise
///      collateral C" structural rather than reviewed.
struct FacilityDecision {
    bytes32 facilityId;
    FacilityOperation operation;
    bytes32 subjectAssetId; //          the collateral assetId the decision concerns (or 0 for RECALL/SETTLE)
    bytes32 subjectInstrumentRef; //    the canonical instrument reference of that collateral
    bytes32 requestId; //               ties the decision to one substitution request; 0 for ACTIVATE
    uint64 pinnedEpoch; //              policies.riskEpoch() the decision was made under
    uint64 collateralPolicyVersion; //  the RiskPolicy version the decision was made under
    uint32 decisionVersion; //          verifier schema version
    uint64 expiry; //                   block.timestamp past this authorises nothing
    uint64 nonce; //                    per-(facility, operation) monotone; a stale nonce fails
    bytes32 proofRef; //                pointer to the off-chain decision record / receipt
    bytes32 attestationHash; //         commitment to the verifier's own proof; the verifier holds
    //   the pre-image (signature, membership proof) — its shape, its concern
}

library FacilityDecisionLib {
    /// @notice The canonical decision hash. Every field participates, so a decision for
    ///         collateral B genuinely cannot hash-collide with one for collateral C.
    /// @dev `internal`: the struct is now all fixed-size, so `abi.encode` here is head-only and
    ///      shallow enough to inline without `via_ir` (the deployed core is not compiled with it).
    function hash(FacilityDecision memory d) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "USANCE_FACILITY_DECISION_V1",
                d.facilityId,
                d.operation,
                d.subjectAssetId,
                d.subjectInstrumentRef,
                d.requestId,
                d.pinnedEpoch,
                d.collateralPolicyVersion,
                d.decisionVersion,
                d.expiry,
                d.nonce,
                d.proofRef,
                d.attestationHash
            )
        );
    }
}

/// @notice The operation binding the facility expects a decision to match. Passed to the verifier
///         so the binding check runs in the verifier's own contract frame, not inlined into the
///         facility (which overflowed the stack without `via_ir`).
struct DecisionBinding {
    bytes32 facilityId;
    FacilityOperation operation;
    bytes32 subjectAssetId;
    bytes32 subjectInstrumentRef;
    bytes32 requestId;
    uint64 epoch;
    uint64 collateralPolicyVersion;
}

/// @title IAuthorityVerifier
/// @notice "Is this actor, in this organisation, allowed to ask for this operation on this
///         facility." ENSv2 name / Privy org membership lives behind here in Phase 07.
interface IAuthorityVerifier {
    /// @notice Validate the decision's binding against `b` and the verifier's own attestation.
    /// @dev MUST check every field of `b` against `d`, plus `d.decisionVersion`, `d.expiry` vs
    ///      `block.timestamp`, nonce monotonicity, and the attestation. Returns
    ///      `(false, bytes32(0))` rather than reverting on a bad decision; `(true, decisionHash)`
    ///      on success. The facility stores `decisionHash` and re-checks `isRevoked` at release.
    function verify(FacilityDecision calldata d, DecisionBinding calldata b)
        external
        view
        returns (bool ok, bytes32 decisionHash);

    /// @notice Whether a previously-valid decision has since been revoked (I-98).
    function isRevoked(bytes32 decisionHash) external view returns (bool);
}

/// @title IPolicyVerifier
/// @notice "Is this collateral eligible for this facility, and is the post-operation result
///         safe, under this epoch and this policy version." Chainlink CRE confidential policy
///         lives behind here in Phase 07. Eligibility is NOT "the instrument is registered".
interface IPolicyVerifier {
    function verify(FacilityDecision calldata d, DecisionBinding calldata b)
        external
        view
        returns (bool ok, bytes32 decisionHash);

    /// @notice Whether the current epoch is still acceptable for a decision that was pinned at
    ///         `pinnedEpoch` — the risk-reducing carve-out in `_assertReleasable` step 5. A
    ///         conservative verifier returns false whenever the epoch has moved.
    function permitsCurrentEpoch(bytes32 decisionHash, uint64 pinnedEpoch, uint64 currentEpoch)
        external
        view
        returns (bool);
}
