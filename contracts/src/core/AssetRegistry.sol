// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {Types} from "../libraries/Types.sol";

/// @title AssetRegistry
/// @notice Which tokens Usance knows about, and what each is currently allowed to be used for.
/// @dev Registration and capability are separate decisions. Registering an asset makes it
///      addressable; it does not make it collateral. Capability is granted by the admission
///      process against a committed Passport, per asset and per capability, because a tokenized
///      private-credit note can be perfectly good collateral and a terrible perp underlying.
contract AssetRegistry is Authorized {
    struct AssetConfig {
        address token;
        uint256 chainId;
        bytes32 underlyingId;
        uint8 decimals;
        Types.AssetStatus status;
        uint64 passportVersion;
        bytes32 riskPolicyId;
        uint16 capabilities; // bitmask over Types.Capability
    }

    mapping(bytes32 assetId => AssetConfig) internal _assets;
    bytes32[] internal _assetIds;

    event AssetRegistered(bytes32 indexed assetId, address indexed token, uint256 chainId);
    event AssetStatusSet(bytes32 indexed assetId, Types.AssetStatus status);
    event CapabilitiesSet(bytes32 indexed assetId, uint16 capabilities);
    event PassportBound(bytes32 indexed assetId, uint64 version);
    event RiskPolicyBound(bytes32 indexed assetId, bytes32 policyId);

    error AlreadyRegistered(bytes32 assetId);
    error UnknownAsset(bytes32 assetId);
    error ZeroToken();

    constructor(Authority authority_) Authorized(authority_) {}

    /// @notice Canonical asset identity. Derived, never assigned — see spec/accounting.md §2.
    function assetIdFor(uint256 chainId, address token) public pure returns (bytes32) {
        return keccak256(abi.encode(chainId, token));
    }

    function registerAsset(uint256 chainId, address token, bytes32 underlyingId, uint8 decimals)
        external
        onlyRole(authority.ADMISSION())
        returns (bytes32 assetId)
    {
        if (token == address(0)) revert ZeroToken();
        assetId = assetIdFor(chainId, token);
        if (_assets[assetId].token != address(0)) revert AlreadyRegistered(assetId);

        _assets[assetId] = AssetConfig({
            token: token,
            chainId: chainId,
            underlyingId: underlyingId,
            decimals: decimals,
            // Registered is not admitted. A newly registered asset can be held and nothing else
            // until an admission decision grants it capabilities against a committed Passport.
            status: Types.AssetStatus.PAUSED,
            passportVersion: 0,
            riskPolicyId: bytes32(0),
            capabilities: uint16(1) << uint16(Types.Capability.HOLD)
        });
        _assetIds.push(assetId);

        emit AssetRegistered(assetId, token, chainId);
    }

    function setStatus(bytes32 assetId, Types.AssetStatus status) external {
        _requireKnown(assetId);
        // Governance may move an asset in any direction. A guardian may only restrict, which is
        // the enum ordering doing the work rather than a comment asking nicely.
        if (authority.hasRole(authority.GOVERNANCE(), msg.sender)) {
            // permitted
        } else if (authority.hasRole(authority.GUARDIAN(), msg.sender)) {
            require(uint8(status) > uint8(_assets[assetId].status), "guardian may only restrict");
        } else {
            revert Unauthorized(authority.GOVERNANCE());
        }
        _assets[assetId].status = status;
        emit AssetStatusSet(assetId, status);
    }

    function setCapabilities(bytes32 assetId, uint16 capabilities) external onlyRole(authority.ADMISSION()) {
        _requireKnown(assetId);
        _assets[assetId].capabilities = capabilities;
        emit CapabilitiesSet(assetId, capabilities);
    }

    function bindPassport(bytes32 assetId, uint64 version) external onlyRole(authority.ADMISSION()) {
        _requireKnown(assetId);
        _assets[assetId].passportVersion = version;
        emit PassportBound(assetId, version);
    }

    function bindRiskPolicy(bytes32 assetId, bytes32 policyId) external onlyRole(authority.GOVERNANCE()) {
        _requireKnown(assetId);
        _assets[assetId].riskPolicyId = policyId;
        emit RiskPolicyBound(assetId, policyId);
    }

    function getAsset(bytes32 assetId) external view returns (AssetConfig memory) {
        _requireKnown(assetId);
        return _assets[assetId];
    }

    function isRegistered(bytes32 assetId) external view returns (bool) {
        return _assets[assetId].token != address(0);
    }

    function hasCapability(bytes32 assetId, Types.Capability c) external view returns (bool) {
        AssetConfig storage a = _assets[assetId];
        if (a.status != Types.AssetStatus.ACTIVE) {
            // A non-active asset retains exactly one capability: being held. Everything else
            // requires the asset to be live, so suspension is a single write.
            return c == Types.Capability.HOLD;
        }
        return a.capabilities & (uint16(1) << uint16(c)) != 0;
    }

    function assetCount() external view returns (uint256) {
        return _assetIds.length;
    }

    function assetIdAt(uint256 i) external view returns (bytes32) {
        return _assetIds[i];
    }

    function _requireKnown(bytes32 assetId) internal view {
        if (_assets[assetId].token == address(0)) revert UnknownAsset(assetId);
    }
}
