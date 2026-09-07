// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ICollateralAdapter} from "../interfaces/ICollateralAdapter.sol";
import {IAtsHold} from "./IAtsHold.sol";

/// @title HederaAtsCollateralAdapter
/// @notice `ICollateralAdapter` over one Hedera ATS security token, one partition.
///
/// @dev Phase 07. The Phase 06 interface is implemented unchanged.
///
///      Commitment = an ATS **Hold** (`IAtsHold.createHoldFromByPartition`) with no expiry, this
///      adapter as `escrow`, and a facility-fixed `to`. Once held:
///        - the borrower cannot transfer the units (they are held),
///        - the borrower cannot reclaim them (no expiry — `reclaimHoldByPartition` reverts),
///        - only this adapter, as escrow, can release (back to the borrower) or execute (to `to`).
///      That is the "irreversibly attributable to this facility" property the substitution
///      invariant needs, expressed in a native ATS primitive rather than an invented `lock()`.
///
///      `committedOf` sums the live held amounts from `getHoldForByPartition` — authoritative
///      on-chain ATS state, never a cached number. Measured-delta discipline (I-33): `commit`
///      credits the amount the hold actually records, which can be less than requested if the ATS
///      token applied a restriction, and `commit` returns that measured amount.
///
///      Compliance is load-bearing (§7): `commit` runs `canTransferByPartition` first, so a
///      replacement whose holder fails the ATS KYC / allow-list / freeze check cannot be committed
///      and the substitution cannot release the old collateral.
contract HederaAtsCollateralAdapter is ICollateralAdapter {
    IAtsHold public immutable token;
    bytes32 public immutable partition;
    bytes32 internal immutable _instrumentRef;
    bytes32 internal immutable _assetId;
    uint8 internal immutable _decimals;

    /// @notice The facility this adapter serves. Set once, by the deployer, right after the
    ///         facility exists. Only the facility may drive `commit` / `release`.
    address public facility;
    address public immutable admin;

    /// @notice The fixed execution recipient of every hold — a facility-controlled address. A
    ///         normal release routes back to the borrower (the holder); a default routes here and
    ///         the facility settles onward. No caller-supplied recipient, ever.
    address public immutable holdDestination;

    struct Committed {
        IAtsHold.HoldIdentifier id;
        uint256 recorded; // the measured amount credited at commit time
    }

    mapping(address facility => Committed[]) internal _committed;

    /// @notice Set true by the admin only when an out-of-band ATS query could not confirm the
    ///         hold state. Drives `reconcile` to `UNKNOWN`. Cleared once resolved.
    bool public reconciliationPending;

    event FacilityBound(address indexed facility);
    event Committed_(
        address indexed facility, address indexed from, uint256 requested, uint256 measured, uint256 holdId
    );
    event Released(address indexed facility, address indexed to, uint256 units);
    event ReconciliationPendingSet(bool pending);

    error NotAdmin();
    error NotFacility();
    error FacilityAlreadyBound();
    error ComplianceRejected(bytes1 code, bytes32 reason);
    error ZeroUnits();
    error NothingCommitted();
    error HoldNotCreated();
    error HoldOpFailed();

    constructor(
        IAtsHold token_,
        bytes32 partition_,
        bytes32 instrumentRef_,
        bytes32 assetId_,
        uint8 decimals_,
        address holdDestination_,
        address admin_
    ) {
        token = token_;
        partition = partition_;
        _instrumentRef = instrumentRef_;
        _assetId = assetId_;
        _decimals = decimals_;
        holdDestination = holdDestination_;
        admin = admin_;
    }

    function bindFacility(address facility_) external {
        if (msg.sender != admin) revert NotAdmin();
        if (facility != address(0)) revert FacilityAlreadyBound();
        facility = facility_;
        emit FacilityBound(facility_);
    }

    function setReconciliationPending(bool pending) external {
        if (msg.sender != admin) revert NotAdmin();
        reconciliationPending = pending;
        emit ReconciliationPendingSet(pending);
    }

    // ---------------------------------------------------------------------------------
    // ICollateralAdapter
    // ---------------------------------------------------------------------------------

    function instrumentRef() external view returns (bytes32) {
        return _instrumentRef;
    }

    function assetId() external view returns (bytes32) {
        return _assetId;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function canCommit(address facility_) external view returns (bool ok, bytes32 reason) {
        if (facility_ != facility) return (false, "WRONG_FACILITY");
        if (reconciliationPending) return (false, "RECONCILING");
        return (true, bytes32(0));
    }

    /// @notice Place `units` of `from`'s partitioned balance under an ATS Hold for `facility`.
    /// @return committedUnits the amount the hold actually recorded (measured, not requested).
    function commit(address facility_, address from, uint256 units)
        external
        returns (uint256 committedUnits)
    {
        if (msg.sender != facility || facility_ != facility) {
            revert NotFacility();
        }
        if (units == 0) revert ZeroUnits();

        // Compliance is load-bearing: an ineligible holder cannot commit (§7).
        (bool okC, bytes1 code, bytes32 reason) =
            token.canTransferByPartition(from, holdDestination, partition, units, "", "");
        if (!okC) revert ComplianceRejected(code, reason);

        uint256 heldBefore = token.getHeldAmountForByPartition(partition, from);
        (bool okH, uint256 holdId) = token.createHoldFromByPartition(
            partition,
            from,
            IAtsHold.Hold({
                amount: units,
                expirationTimestamp: 0, // never expires => the holder cannot reclaim
                escrow: address(this),
                to: holdDestination,
                data: abi.encode("USANCE_FACILITY_COMMIT", facility, from)
            }),
            ""
        );
        if (!okH) revert HoldNotCreated();

        // Measured delta (I-33): credit what the hold recorded, not what was asked for.
        uint256 heldAfter = token.getHeldAmountForByPartition(partition, from);
        committedUnits = heldAfter > heldBefore ? heldAfter - heldBefore : 0;

        _committed[facility].push(
            Committed({
                id: IAtsHold.HoldIdentifier({partition: partition, tokenHolder: from, holdId: holdId}),
                recorded: committedUnits
            })
        );
        emit Committed_(facility, from, units, committedUnits, holdId);
    }

    /// @notice Sum of live held amounts across this facility's holds — authoritative ATS state.
    function committedOf(address facility_) external view returns (uint256 total) {
        Committed[] storage cs = _committed[facility_];
        for (uint256 i; i < cs.length; ++i) {
            (uint256 amount,,,,,,) = token.getHoldForByPartition(cs[i].id);
            total += amount;
        }
    }

    /// @notice Re-derive commitment state from ATS. `reconciliationPending` (set by the admin when
    ///         an out-of-band ATS query was inconclusive) forces `UNKNOWN` — which releases
    ///         nothing (I-97).
    function reconcile(address facility_) external view returns (CommitmentState) {
        if (reconciliationPending) return CommitmentState.UNKNOWN;
        Committed[] storage cs = _committed[facility_];
        if (cs.length == 0) return CommitmentState.NOT_COMMITTED;
        uint256 total = 0;
        for (uint256 i; i < cs.length; ++i) {
            (uint256 amount,,,,,,) = token.getHoldForByPartition(cs[i].id);
            total += amount;
        }
        return total > 0 ? CommitmentState.COMMITTED : CommitmentState.NOT_COMMITTED;
    }

    /// @notice Release the facility's held collateral to the facility-selected rightful owner.
    /// @dev The facility passes the borrower on a normal substitution / settlement, and the lender
    ///      on a default. A release to a hold's own token holder goes back through
    ///      `releaseHoldByPartition`; any other destination is executed to `holdDestination` (a
    ///      facility-controlled address) and settled onward by the facility. No arbitrary
    ///      recipient — `rightfulOwner` is the only routing input and it comes from the facility's
    ///      own lifecycle, not from a caller.
    function release(address facility_, address rightfulOwner, uint256 units) external {
        if (msg.sender != facility || facility_ != facility) revert NotFacility();
        if (units == 0) revert ZeroUnits();

        Committed[] storage cs = _committed[facility];
        uint256 remaining = units;
        for (uint256 i; i < cs.length && remaining > 0; ++i) {
            (uint256 amount,,, address dest,,,) = token.getHoldForByPartition(cs[i].id);
            if (amount == 0) continue;
            uint256 take = amount < remaining ? amount : remaining;

            if (rightfulOwner == cs[i].id.tokenHolder) {
                if (!token.releaseHoldByPartition(cs[i].id, take)) revert HoldOpFailed(); // back to the holder
            } else {
                (bool okX,) = token.executeHoldByPartition(cs[i].id, dest, take); // to the facility-controlled dest
                if (!okX) revert HoldOpFailed();
            }
            remaining -= take;
        }
        if (remaining == units) revert NothingCommitted();
        emit Released(facility, rightfulOwner, units - remaining);
    }

    function transferable() external view returns (bool ok, bytes32 reason) {
        // A holder-agnostic transfer probe: can the hold destination itself hold this instrument.
        (bool okC, bytes1 code, bytes32 r) =
            token.canTransferByPartition(holdDestination, holdDestination, partition, 0, "", "");
        return okC ? (true, bytes32(0)) : (false, r == bytes32(0) ? bytes32(code) : r);
    }
}
