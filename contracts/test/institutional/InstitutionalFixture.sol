// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Fixture} from "../Fixture.sol";
import {Types} from "../../src/libraries/Types.sol";
import {MockERC20, MockAggregator} from "../mocks/Mocks.sol";

import {FacilityValuation} from "../../src/institutional/FacilityValuation.sol";
import {InstitutionalFacility} from "../../src/institutional/InstitutionalFacility.sol";
import {ICollateralAdapter} from "../../src/institutional/interfaces/ICollateralAdapter.sol";
import {FacilityDecision, FacilityOperation} from "../../src/institutional/interfaces/IFacilityDecisions.sol";
import {TestCollateralAdapter, TestFacilityVerifier} from "./mocks/TestAdapters.sol";

/// @notice Deploys the full institutional facility over the core registries, plus a second
///         collateral asset and two custody adapters so substitution can actually be exercised.
abstract contract InstitutionalFixture is Fixture {
    FacilityValuation internal fval;
    TestFacilityVerifier internal verifier;
    InstitutionalFacility internal facility;

    MockERC20 internal repToken; // the replacement collateral
    bytes32 internal REP_ID;
    MockAggregator internal repFeed;

    TestCollateralAdapter internal oldAdapter;
    TestCollateralAdapter internal repAdapter;

    bytes32 internal constant OLD_REF = keccak256("INSTRUMENT_OLD");
    bytes32 internal constant REP_REF = keccak256("INSTRUMENT_REP");
    bytes32 internal constant HOME_DOMAIN = keccak256("USANCE_DOMAIN_V1:eip155:31337");
    bytes32 internal constant DISCRIMINATOR = keccak256("INSTITUTIONAL-FACILITY-1");

    address internal borrowerAcct = address(0xB0B);
    address internal lenderAcct = address(0x1EDD);
    address internal operatorAcct = address(0x09E7);
    address internal treasuryAcct = address(0x7EA5);

    uint256 internal constant PRINCIPAL = 100_000e6; // 100k settlement units (6dp)
    uint16 internal constant RATE_BPS = 500; // 5% fixed
    uint16 internal constant ORIG_FEE_BPS = 25; // 0.25%

    function deployInstitutional() internal {
        deployProtocol();

        // ---- a second collateral asset, same policy as USTB ----
        repToken = new MockERC20("Replacement T-Bill", "REP", 18);
        vm.prank(admission);
        REP_ID = assetsReg.registerAsset(block.chainid, address(repToken), keccak256("US-TBILL-6M"), 18);

        repFeed = new MockAggregator(8, "REP / USD", 1e8, block.timestamp);
        vm.startPrank(governance);
        oracle.setFeed(REP_ID, address(repFeed));
        assetsReg.bindRiskPolicy(REP_ID, POLICY_TBILL);
        vm.stopPrank();

        vm.startPrank(admission);
        (bytes32[] memory ev, bytes32 root) = _fileEvidence(REP_ID, "REP_V1");
        passportReg.commitPassport(REP_ID, 1, ev, root, keccak256("REP_CLAIMS_V1"), 0, true, 9900, false);
        assetsReg.setCapabilities(
            REP_ID,
            uint16(1) << uint16(Types.Capability.HOLD) | uint16(1) << uint16(Types.Capability.COLLATERAL)
        );
        vm.stopPrank();
        vm.prank(governance);
        assetsReg.setStatus(REP_ID, Types.AssetStatus.ACTIVE);

        // ---- institutional stack ----
        fval = new FacilityValuation(oracle, policyReg, assetsReg, passportReg);
        verifier = new TestFacilityVerifier();

        oldAdapter = new TestCollateralAdapter(ustb, OLD_REF, USTB_ID, 18);
        repAdapter = new TestCollateralAdapter(repToken, REP_REF, REP_ID, 18);

        InstitutionalFacility.Terms memory t = InstitutionalFacility.Terms({
            homeDomainId: HOME_DOMAIN,
            discriminator: DISCRIMINATOR,
            borrower: borrowerAcct,
            lender: lenderAcct,
            operator: operatorAcct,
            treasury: treasuryAcct,
            settlementToken: usdc,
            settlementAssetId: USDC_ID,
            settlementDecimals: 6,
            principalLimit: PRINCIPAL,
            maturityAt: uint64(block.timestamp + 365 days),
            interestRateBps: RATE_BPS,
            originationFeeBps: ORIG_FEE_BPS,
            feePolicyVersion: 1,
            collateralPolicyId: POLICY_TBILL,
            initialCollateralAssetId: USTB_ID,
            initialCollateralAdapter: address(oldAdapter),
            settlementMaxPriceAge: SETTLEMENT_MAX_PRICE_AGE,
            recallGracePeriod: 7 days,
            maturityGracePeriod: 3 days
        });
        facility = new InstitutionalFacility(authority, fval, policyReg, verifier, verifier, t);

        // ---- fund the participants ----
        usdc.mint(lenderAcct, PRINCIPAL);
        ustb.mint(borrowerAcct, 400_000e18);
        repToken.mint(borrowerAcct, 400_000e18);
        vm.startPrank(borrowerAcct);
        ustb.approve(address(oldAdapter), type(uint256).max);
        repToken.approve(address(repAdapter), type(uint256).max);
        vm.stopPrank();
    }

    // ---- decision helper ----

    /// @dev A well-formed, whitelisted decision pinned to the current epoch. The mock verifier is
    ///      both the authority and the policy verifier, so one decision serves both call sites.
    function _decision(FacilityOperation op, bytes32 subjectAssetId, bytes32 subjectRef, bytes32 requestId)
        internal
        returns (FacilityDecision memory d)
    {
        d.facilityId = facility.facilityId();
        d.operation = op;
        d.subjectAssetId = subjectAssetId;
        d.subjectInstrumentRef = subjectRef;
        d.requestId = requestId;
        d.pinnedEpoch = policyReg.riskEpoch();
        d.collateralPolicyVersion = policyReg.riskEpoch();
        d.decisionVersion = 1;
        d.expiry = uint64(block.timestamp + 1 hours);
        d.nonce = 0;
        d.proofRef = keccak256(abi.encode("proof", op, requestId));
        d.attestationHash = keccak256(abi.encode("attestation", d.proofRef));
        verifier.approve(d);
    }

    /// @dev Drive a facility from DRAFT to ACTIVE with a comfortable collateral buffer.
    function _activate() internal {
        vm.startPrank(lenderAcct);
        usdc.approve(address(facility), PRINCIPAL);
        facility.fund();
        vm.stopPrank();

        vm.prank(borrowerAcct);
        facility.commitInitialCollateral(150_000e18);

        FacilityDecision memory d = _decision(FacilityOperation.ACTIVATE, USTB_ID, OLD_REF, bytes32(0));
        vm.prank(lenderAcct);
        facility.activate(d, d);
    }
}
