// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {Types} from "../libraries/Types.sol";

/// @title EvidenceRegistry
/// @notice Onchain commitments to the documents a Passport rests on.
/// @dev Documents live offchain in content-addressed storage. What is committed here is small,
///      permanent and enough to prove later that the document you are shown is the document the
///      protocol actually priced: the content hash, where it came from, when it took effect, and
///      how much authority its source class carries.
///
///      Nothing in this contract interprets a document. Extraction happens offchain; a model can
///      produce a claim but has no path to a state-changing function here (invariant I-15).
contract EvidenceRegistry is Authorized {
    struct EvidenceCommitment {
        bytes32 contentHash; // digest of the canonicalised bytes
        bytes32 sourceHash; // digest of the retrieval origin (URI + issuer identity)
        uint64 effectiveAt; // when the document itself says it takes effect
        uint64 retrievedAt; // when Usance fetched it
        Types.SourceClass sourceClass;
        bool invalidated;
        bytes32 supersededBy;
    }

    mapping(bytes32 evidenceId => EvidenceCommitment) internal _evidence;
    mapping(bytes32 assetId => bytes32[]) internal _assetEvidence;

    /// @notice Which asset a commitment was filed against.
    /// @dev A reverse index rather than a scan of `_assetEvidence`. PassportRegistry checks this on
    ///      every cited evidence id, and an O(n) membership test there would make the cost of
    ///      committing a Passport depend on how much evidence the asset has accumulated.
    mapping(bytes32 evidenceId => bytes32 assetId) public evidenceAsset;

    event EvidenceCommitted(
        bytes32 indexed evidenceId,
        bytes32 indexed assetId,
        bytes32 contentHash,
        Types.SourceClass sourceClass,
        uint64 effectiveAt
    );
    event EvidenceSuperseded(bytes32 indexed evidenceId, bytes32 indexed by);
    event EvidenceInvalidated(bytes32 indexed evidenceId, string reason);

    error AlreadyCommitted(bytes32 evidenceId);
    error UnknownEvidence(bytes32 evidenceId);
    error WeakerSource(Types.SourceClass existing, Types.SourceClass replacement);

    constructor(Authority authority_) Authorized(authority_) {}

    function evidenceIdFor(bytes32 sourceHash, bytes32 contentHash, uint64 effectiveAt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(sourceHash, contentHash, effectiveAt));
    }

    function commit(
        bytes32 assetId,
        bytes32 contentHash,
        bytes32 sourceHash,
        uint64 effectiveAt,
        uint64 retrievedAt,
        Types.SourceClass sourceClass
    ) external onlyRole(authority.ADMISSION()) returns (bytes32 evidenceId) {
        evidenceId = evidenceIdFor(sourceHash, contentHash, effectiveAt);
        if (_evidence[evidenceId].contentHash != bytes32(0)) revert AlreadyCommitted(evidenceId);

        _evidence[evidenceId] = EvidenceCommitment({
            contentHash: contentHash,
            sourceHash: sourceHash,
            effectiveAt: effectiveAt,
            retrievedAt: retrievedAt,
            sourceClass: sourceClass,
            invalidated: false,
            supersededBy: bytes32(0)
        });
        _assetEvidence[assetId].push(evidenceId);
        evidenceAsset[evidenceId] = assetId;

        emit EvidenceCommitted(evidenceId, assetId, contentHash, sourceClass, effectiveAt);
    }

    /// @notice Replace one commitment with a newer one.
    /// @dev Invariant I-18. A weaker source class may never supersede a stronger one. A news
    ///      article does not overwrite a regulatory filing; at most it triggers a refresh that
    ///      goes and re-reads the filing. This is the structural half of "weak evidence cannot
    ///      create strong privileges" — the policy half lives in the risk gates.
    function supersede(bytes32 evidenceId, bytes32 replacementId) external onlyRole(authority.ADMISSION()) {
        EvidenceCommitment storage prev = _evidence[evidenceId];
        EvidenceCommitment storage next = _evidence[replacementId];
        if (prev.contentHash == bytes32(0)) revert UnknownEvidence(evidenceId);
        if (next.contentHash == bytes32(0)) revert UnknownEvidence(replacementId);
        if (uint8(next.sourceClass) < uint8(prev.sourceClass)) {
            revert WeakerSource(prev.sourceClass, next.sourceClass);
        }

        prev.supersededBy = replacementId;
        emit EvidenceSuperseded(evidenceId, replacementId);
    }

    /// @notice Mark a commitment untrustworthy. Risk-reducing, so a guardian may do it directly.
    function invalidate(bytes32 evidenceId, string calldata reason) external {
        if (
            !authority.hasRole(authority.ADMISSION(), msg.sender)
                && !authority.hasRole(authority.GUARDIAN(), msg.sender)
        ) revert Unauthorized(authority.GUARDIAN());

        EvidenceCommitment storage e = _evidence[evidenceId];
        if (e.contentHash == bytes32(0)) revert UnknownEvidence(evidenceId);
        e.invalidated = true;
        emit EvidenceInvalidated(evidenceId, reason);
    }

    /// @notice Whether `evidenceId` may back a Passport for `assetId` right now.
    /// @dev Three ways to fail, and they are deliberately not distinguished to the caller here —
    ///      PassportRegistry raises its own error naming the offending id. Evidence that was never
    ///      committed, evidence committed against a different asset, and evidence that has since
    ///      been invalidated are all equally unusable.
    ///
    ///      Superseded evidence is still usable. A superseded document was true when it was filed
    ///      and the Passport version that cited it is a historical record, not a live assertion.
    ///      Invalidation is the state that says "this should never have counted".
    function isUsableFor(bytes32 assetId, bytes32 evidenceId) public view returns (bool) {
        EvidenceCommitment storage e = _evidence[evidenceId];
        if (e.contentHash == bytes32(0)) return false;
        if (evidenceAsset[evidenceId] != assetId) return false;
        return !e.invalidated;
    }

    function get(bytes32 evidenceId) external view returns (EvidenceCommitment memory) {
        EvidenceCommitment memory e = _evidence[evidenceId];
        if (e.contentHash == bytes32(0)) revert UnknownEvidence(evidenceId);
        return e;
    }

    function evidenceCount(bytes32 assetId) external view returns (uint256) {
        return _assetEvidence[assetId].length;
    }

    function evidenceAt(bytes32 assetId, uint256 i) external view returns (bytes32) {
        return _assetEvidence[assetId][i];
    }
}
