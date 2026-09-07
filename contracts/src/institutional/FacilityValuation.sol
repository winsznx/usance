// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {AssetRegistry} from "../core/AssetRegistry.sol";
import {PassportRegistry} from "../core/PassportRegistry.sol";
import {RiskPolicyRegistry} from "../core/RiskPolicyRegistry.sol";
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {RiskMath} from "../libraries/RiskMath.sol";
import {Types} from "../libraries/Types.sol";

/// @title FacilityValuation
/// @notice Stateless single-instrument valuation and settlement-price conversion for the
///         institutional facility. Deployed once, shared by every `InstitutionalFacility`.
///
/// @dev Split out of the facility for two reasons. It reuses `RiskMath` (the same authority the
///      revolving-credit core uses — the risk math is not re-transcribed here), and pulling the
///      `RiskMath.valueAsset` call into its own contract frame keeps the facility itself well
///      inside the stack limit without `via_ir`, which the deployed core is not compiled with.
///
///      It holds no per-account state and no role. It reads the shared registries and returns
///      numbers. "Fails closed" is the whole contract: a stale price, an invalid price, a
///      non-active asset, a stale or suspended Passport, or a down / in-grace sequencer all yield
///      a recognised value of zero rather than a number the facility would lend against.
contract FacilityValuation {
    IOracleAdapter public immutable oracle;
    RiskPolicyRegistry public immutable policies;
    AssetRegistry public immutable assets;
    PassportRegistry public immutable passports;

    error PriceUnusable(bytes32 assetId);
    error SequencerNotTrustworthy();

    constructor(
        IOracleAdapter oracle_,
        RiskPolicyRegistry policies_,
        AssetRegistry assets_,
        PassportRegistry passports_
    ) {
        oracle = oracle_;
        policies = policies_;
        assets = assets_;
        passports = passports_;
    }

    /// @notice Recognised collateral value for `units` of `assetId` under `policyId`.
    /// @return recognisedUsd18 the number the facility may lend against — 0 when any gate fires
    /// @return maintenanceLtvBps the policy's maintenance LTV, always returned so the caller can
    ///         run the coverage comparison even on a zero valuation
    function recognisedValue(bytes32 policyId, bytes32 assetId, uint8 decimals, uint256 units)
        external
        view
        returns (uint256 recognisedUsd18, uint16 maintenanceLtvBps)
    {
        Types.AssetRiskInput memory a = _riskInput(policyId, assetId, decimals, units);
        maintenanceLtvBps = a.params.maintenanceLtvBps;
        if (_blocked(a)) return (0, maintenanceLtvBps);
        recognisedUsd18 = RiskMath.valueAsset(a).recognizedUsd18;
    }

    function _blocked(Types.AssetRiskInput memory a) internal view returns (bool) {
        return RiskMath.assetGates(a, uint64(block.timestamp)) != 0
            || a.assetStatus != Types.AssetStatus.ACTIVE || a.priceUsd18 == 0;
    }

    function _riskInput(bytes32 policyId, bytes32 assetId, uint8 decimals, uint256 units)
        internal
        view
        returns (Types.AssetRiskInput memory a)
    {
        a.assetId = assetId;
        a.quantity = units;
        a.decimals = decimals;
        a.params = policies.getParams(policyId);
        a.exitCurve = policies.getCurve(policyId);
        (a.priceUsd18, a.priceUpdatedAt) = oracle.getPrice(assetId);
        a.passportStatus = passports.effectiveStatus(assetId);

        uint64 pv = passports.currentVersion(assetId);
        if (pv != 0) {
            PassportRegistry.PassportHeader memory ph = passports.getPassport(assetId, pv);
            a.passportCommittedAt = ph.createdAt;
            a.redemptionSupported = ph.redemptionSupported;
            a.redemptionFloorBps = ph.redemptionFloorBps;
        }
        a.assetStatus =
            assets.isRegistered(assetId) ? assets.getAsset(assetId).status : Types.AssetStatus.UNREGISTERED;
    }

    /// @notice Convert settlement-token units to usd18 through the settlement feed, failing
    ///         closed if the feed is missing or stale beyond `maxPriceAge`.
    function toUsd18(bytes32 settlementAssetId, uint8 settlementDecimals, uint256 tokens, uint64 maxPriceAge)
        external
        view
        returns (uint256)
    {
        (uint256 p, uint64 updatedAt) = oracle.getPrice(settlementAssetId);
        if (p == 0 || _age(updatedAt) > maxPriceAge) revert PriceUnusable(settlementAssetId);
        return RiskMath.mulDiv(tokens, p, 10 ** settlementDecimals);
    }

    /// @notice Reverts unless the settlement layer is currently arbitrable.
    function requireSequencerTrustworthy() external view {
        (bool up, uint64 lastRestartAt, uint64 grace) = oracle.sequencerStatus();
        if (!up || _age(lastRestartAt) < grace) revert SequencerNotTrustworthy();
    }

    function _age(uint64 then) internal view returns (uint64) {
        return uint64(block.timestamp) > then ? uint64(block.timestamp) - then : 0;
    }
}
