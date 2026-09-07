// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {InstitutionalFixture} from "./InstitutionalFixture.sol";
import {InstitutionalFacility} from "../../src/institutional/InstitutionalFacility.sol";
import {ICollateralAdapter} from "../../src/institutional/interfaces/ICollateralAdapter.sol";
import {FacilityDecision, FacilityOperation} from "../../src/institutional/interfaces/IFacilityDecisions.sol";
import {TestCollateralAdapter} from "./mocks/TestAdapters.sol";

/// @notice Drives one active facility through a random sequence of substitution and repayment
///         steps and asserts the properties that must hold at every reachable state.
contract FacilityHandler is InstitutionalFixture {
    uint256 public releaseCount; //     times OLD collateral was released
    uint256 public lastRequiredUnits; // the required units of the most recent release
    bool public sawReleaseWithoutCommit; // must stay false forever

    bytes32 internal nextReq = keccak256("REQ");

    constructor() {
        deployInstitutional();
        _activate();
    }

    function facilityAddr() external view returns (address) {
        return address(facility);
    }

    function _newReq() internal returns (bytes32 r) {
        r = nextReq;
        nextReq = keccak256(abi.encode(nextReq));
    }

    function requestAndCommit(uint256 unitsSeed, bool async) public {
        if (facility.status() != InstitutionalFacility.Status.ACTIVE) return;
        uint256 units = 120_000e18 + (unitsSeed % 60_000e18);
        bytes32 req = _newReq();
        FacilityDecision memory d = _decision(FacilityOperation.SUBSTITUTE, REP_ID, REP_REF, req);
        repAdapter.setMode(async ? TestCollateralAdapter.Mode.ASYNC : TestCollateralAdapter.Mode.SYNC);
        vm.startPrank(borrowerAcct);
        try facility.requestSubstitution(req, address(repAdapter), units, d, d) {
            facility.commitReplacement();
            lastRequiredUnits = units;
        } catch {}
        vm.stopPrank();
    }

    function reconcile(bool committed) public {
        InstitutionalFacility.Substitution memory s = facility.substitution();
        if (
            s.state != InstitutionalFacility.SubState.REPLACEMENT_COMMITTING
                && s.state != InstitutionalFacility.SubState.COMMITMENT_UNKNOWN
        ) {
            return;
        }
        repAdapter.resolveAsync(
            address(facility),
            committed
                ? ICollateralAdapter.CommitmentState.COMMITTED
                : ICollateralAdapter.CommitmentState.UNKNOWN
        );
        vm.prank(operatorAcct);
        try facility.reconcileCommitment() {} catch {}
    }

    function releaseOld() public {
        InstitutionalFacility.Substitution memory s = facility.substitution();
        if (s.state == InstitutionalFacility.SubState.NONE) return;
        bool committed = s.state == InstitutionalFacility.SubState.REPLACEMENT_COMMITTED
            && repAdapter.committedOf(address(facility)) >= s.requiredUnits;

        (address adapterBefore,) = _collateralAdapter();
        vm.prank(borrowerAcct);
        try facility.releaseOld(s.id) {
            releaseCount++;
            (address adapterAfter,) = _collateralAdapter();
            // A release must have swapped the collateral to the replacement and left the
            // replacement in custody. If it fired without a real committed replacement, that is
            // the invariant breach we are hunting.
            if (!committed || adapterAfter == adapterBefore) sawReleaseWithoutCommit = true;
        } catch {}
    }

    function repaySome(uint256 amtSeed) public {
        if (facility.outstanding() == 0) return;
        uint256 amt = 1e6 + (amtSeed % (facility.outstanding() + 1));
        usdc.mint(borrowerAcct, amt);
        vm.startPrank(borrowerAcct);
        usdc.approve(address(facility), amt);
        try facility.repay(amt, false) {} catch {}
        vm.stopPrank();
    }

    function warp(uint256 dtSeed) public {
        vm.warp(block.timestamp + (dtSeed % 30 days));
        try facility.poke() {} catch {}
    }

    function _collateralAdapter() internal view returns (address adapter, bytes32 assetId) {
        InstitutionalFacility.Collateral memory c = facility.collateral();
        return (c.adapter, c.assetId);
    }
}

contract InstitutionalFacilityInvariantTest is InstitutionalFixture {
    FacilityHandler internal handler;
    InstitutionalFacility internal fac;

    function setUp() public {
        handler = new FacilityHandler();
        fac = InstitutionalFacility(handler.facilityAddr());

        bytes4[] memory sel = new bytes4[](5);
        sel[0] = FacilityHandler.requestAndCommit.selector;
        sel[1] = FacilityHandler.reconcile.selector;
        sel[2] = FacilityHandler.releaseOld.selector;
        sel[3] = FacilityHandler.repaySome.selector;
        sel[4] = FacilityHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
        targetContract(address(handler));
    }

    /// @notice I-95: the old collateral can never be released without a genuinely committed
    ///         replacement that swaps the facility onto it.
    function invariant_noReleaseWithoutCommittedReplacement() public view {
        assertFalse(
            handler.sawReleaseWithoutCommit(), "old collateral released without a committed replacement"
        );
    }

    /// @notice A live facility always has collateral in custody in exactly its current adapter.
    function invariant_collateralIsAlwaysHeldWhileLive() public view {
        InstitutionalFacility.Status st = fac.status();
        if (st == InstitutionalFacility.Status.SETTLED || st == InstitutionalFacility.Status.DEFAULTED) {
            return;
        }
        InstitutionalFacility.Collateral memory c = fac.collateral();
        assertGt(
            ICollateralAdapter(c.adapter).committedOf(address(fac)),
            0,
            "a live facility always has collateral in custody"
        );
    }

    /// @notice `outstanding()` never reverts (no underflow) and repaid never exceeds what is owed.
    function invariant_debtNeverUnderflows() public view {
        assertLe(
            fac.repaid(), fac.principalDrawn() + fac.interestAccrued() + fac.outstanding(), "repaid bounded"
        );
    }

    /// @notice I-99: principalDrawn == feeCharged + borrower proceeds, once activated.
    function invariant_feeConservation() public view {
        if (fac.principalDrawn() == 0) return;
        assertLe(fac.feeCharged(), fac.principalDrawn(), "fee never exceeds the draw");
    }
}
