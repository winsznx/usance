// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {Types} from "../libraries/Types.sol";

/// @title PassportRegistry
/// @notice Versioned, immutable-per-version commitments to what an asset actually is.
/// @dev A Passport is not a risk score. It is a set of verified claims with a Merkle root over
///      the evidence that supports them. Risk parameters live in RiskPolicyRegistry and are set
///      by governance; the Passport only says what the asset *is*, never what it is *worth*.
///      Keeping those two apart is what stops an evidence pipeline from becoming a pricing oracle.
contract PassportRegistry is Authorized {
    struct PassportHeader {
        bytes32 passportId;
        bytes32 assetId;
        uint64 version;
        bytes32 evidenceRoot; // Merkle root over the committed EvidenceIds
        bytes32 claimsRoot; // Merkle root over the extracted structured claims
        uint64 createdAt;
        uint64 expiresAt;
        Types.PassportStatus status;
        // Redemption is on the header rather than behind the claims root because the risk
        // pipeline reads it on every valuation and must not need a Merkle proof to price.
        bool redemptionSupported;
        uint16 redemptionFloorBps;
        // True when only one extraction path produced these claims. Invariant I-17: a
        // single-source Passport is capped and cannot unlock corroboration-gated capabilities.
        bool singleSource;
    }

    mapping(bytes32 assetId => mapping(uint64 version => PassportHeader)) internal _passports;
    mapping(bytes32 assetId => uint64) public currentVersion;

    event PassportCommitted(
        bytes32 indexed assetId,
        uint64 indexed version,
        bytes32 passportId,
        bytes32 evidenceRoot,
        bytes32 claimsRoot,
        bool singleSource
    );
    event PassportStatusSet(bytes32 indexed assetId, uint64 indexed version, Types.PassportStatus status);

    error VersionNotSequential(uint64 expected, uint64 got);
    error UnknownPassport(bytes32 assetId, uint64 version);
    error NoPassport(bytes32 assetId);
    error EmptyEvidenceRoot();
    error BadRedemptionFloor();

    constructor(Authority authority_) Authorized(authority_) {}

    function passportIdFor(bytes32 assetId, uint64 version) public pure returns (bytes32) {
        return keccak256(abi.encode(assetId, version));
    }

    /// @notice Commit the next Passport version for an asset.
    /// @dev Versions are strictly sequential, so history cannot be rewritten or back-filled and a
    ///      receipt that cites "Passport v39" refers to exactly one thing forever.
    function commitPassport(
        bytes32 assetId,
        uint64 version,
        bytes32 evidenceRoot,
        bytes32 claimsRoot,
        uint64 expiresAt,
        bool redemptionSupported,
        uint16 redemptionFloorBps,
        bool singleSource
    ) external onlyRole(authority.ADMISSION()) returns (bytes32 passportId) {
        uint64 expected = currentVersion[assetId] + 1;
        if (version != expected) revert VersionNotSequential(expected, version);
        if (evidenceRoot == bytes32(0)) revert EmptyEvidenceRoot();
        if (redemptionSupported && redemptionFloorBps > Types.BPS) revert BadRedemptionFloor();

        passportId = passportIdFor(assetId, version);
        _passports[assetId][version] = PassportHeader({
            passportId: passportId,
            assetId: assetId,
            version: version,
            evidenceRoot: evidenceRoot,
            claimsRoot: claimsRoot,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            status: Types.PassportStatus.ACTIVE,
            redemptionSupported: redemptionSupported,
            redemptionFloorBps: redemptionFloorBps,
            singleSource: singleSource
        });
        currentVersion[assetId] = version;

        emit PassportCommitted(assetId, version, passportId, evidenceRoot, claimsRoot, singleSource);
    }

    /// @notice Restrict a Passport. Risk-reducing, so guardians may call it without a timelock.
    /// @dev There is no function that moves a Passport back to ACTIVE. Recovering from a
    ///      conflict or suspension requires committing a new version with new evidence, which is
    ///      the point: the way out of "we are not sure what this asset is" is to find out.
    function restrict(bytes32 assetId, uint64 version, Types.PassportStatus status) external {
        if (
            !authority.hasRole(authority.ADMISSION(), msg.sender)
                && !authority.hasRole(authority.GUARDIAN(), msg.sender)
        ) revert Unauthorized(authority.GUARDIAN());

        PassportHeader storage p = _passports[assetId][version];
        if (p.passportId == bytes32(0)) revert UnknownPassport(assetId, version);
        require(uint8(status) > uint8(p.status), "restrict may only move downward");

        p.status = status;
        emit PassportStatusSet(assetId, version, status);
    }

    function getPassport(bytes32 assetId, uint64 version) external view returns (PassportHeader memory) {
        PassportHeader memory p = _passports[assetId][version];
        if (p.passportId == bytes32(0)) revert UnknownPassport(assetId, version);
        return p;
    }

    function getCurrentPassport(bytes32 assetId) external view returns (PassportHeader memory) {
        uint64 v = currentVersion[assetId];
        if (v == 0) revert NoPassport(assetId);
        return _passports[assetId][v];
    }

    function hasPassport(bytes32 assetId) external view returns (bool) {
        return currentVersion[assetId] != 0;
    }

    /// @notice Effective status, accounting for the expiry the Passport itself declares.
    /// @dev Expiry is evaluated at read time rather than by a keeper, so an unattended Passport
    ///      degrades to STALE on its own. Freshness that depends on someone remembering to run a
    ///      job is not freshness.
    function effectiveStatus(bytes32 assetId) external view returns (Types.PassportStatus) {
        uint64 v = currentVersion[assetId];
        if (v == 0) return Types.PassportStatus.NONE;
        PassportHeader storage p = _passports[assetId][v];
        if (p.status != Types.PassportStatus.ACTIVE) return p.status;
        if (p.expiresAt != 0 && block.timestamp > p.expiresAt) return Types.PassportStatus.STALE;
        return Types.PassportStatus.ACTIVE;
    }
}
