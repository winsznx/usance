// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IAtsHold} from "../../../src/institutional/adapters/IAtsHold.sol";

/// @notice TEST double for a Hedera ATS security token — the Hold + ComplianceByPartition +
///         BalanceTracker slice the Usance adapter calls. NOT PRODUCTION.
///
/// @dev Models the real ATS semantics the adapter depends on: a partitioned balance, a hold that
///      moves balance from "available" to "held", an escrow-only execute, a holder-return release,
///      and a compliance gate keyed by an allow-list. The negative lifecycle (asset C) is driven
///      by leaving a holder off the allow-list.
contract MockAtsSecurityToken is IAtsHold {
    mapping(bytes32 partition => mapping(address => uint256)) public available;
    mapping(bytes32 partition => mapping(address => uint256)) public held;
    mapping(address => bool) public compliant; // ATS KYC / allow-list (global)
    mapping(bytes32 partition => mapping(address => bool)) public partitionBlocked; // per-series restriction

    struct H {
        uint256 amount;
        uint256 expiration;
        address escrow;
        address to;
        bool exists;
    }

    mapping(bytes32 => mapping(address => mapping(uint256 => H))) internal _holds;
    mapping(bytes32 => mapping(address => uint256)) internal _nextHoldId;

    // ---- test setup ----
    function mint(bytes32 partition, address to, uint256 amount) external {
        available[partition][to] += amount;
    }

    function setCompliant(address who, bool ok) external {
        compliant[who] = ok;
    }

    function setPartitionBlocked(bytes32 partition, address who, bool blocked) external {
        partitionBlocked[partition][who] = blocked;
    }

    // ---- IAtsHold ----

    function createHoldFromByPartition(bytes32 _partition, address _from, Hold calldata _hold, bytes calldata)
        external
        returns (bool, uint256 holdId_)
    {
        require(_hold.amount > 0, "InvalidHoldAmount");
        require(available[_partition][_from] >= _hold.amount, "insufficient available");
        available[_partition][_from] -= _hold.amount;
        held[_partition][_from] += _hold.amount;
        holdId_ = _nextHoldId[_partition][_from]++;
        _holds[_partition][_from][holdId_] = H({
            amount: _hold.amount,
            expiration: _hold.expirationTimestamp,
            escrow: _hold.escrow,
            to: _hold.to,
            exists: true
        });
        return (true, holdId_);
    }

    function executeHoldByPartition(HoldIdentifier calldata id, address _to, uint256 _amount)
        external
        returns (bool, bytes32)
    {
        H storage h = _holds[id.partition][id.tokenHolder][id.holdId];
        require(h.exists, "WrongHoldId");
        require(msg.sender == h.escrow, "IsNotEscrow");
        require(_to == h.to, "InvalidDestinationAddress");
        require(h.amount >= _amount, "InsufficientHoldBalance");
        h.amount -= _amount;
        held[id.partition][id.tokenHolder] -= _amount;
        available[id.partition][_to] += _amount;
        return (true, id.partition);
    }

    function releaseHoldByPartition(HoldIdentifier calldata id, uint256 _amount) external returns (bool) {
        H storage h = _holds[id.partition][id.tokenHolder][id.holdId];
        require(h.exists, "WrongHoldId");
        require(msg.sender == h.escrow, "IsNotEscrow");
        require(h.expiration == 0 || block.timestamp < h.expiration, "HoldExpirationReached");
        require(h.amount >= _amount, "InsufficientHoldBalance");
        h.amount -= _amount;
        held[id.partition][id.tokenHolder] -= _amount;
        available[id.partition][id.tokenHolder] += _amount;
        return true;
    }

    function getHoldForByPartition(HoldIdentifier calldata id)
        external
        view
        returns (uint256, uint256, address, address, bytes memory, bytes memory, uint8)
    {
        H storage h = _holds[id.partition][id.tokenHolder][id.holdId];
        return (h.amount, h.expiration, h.escrow, h.to, "", "", 0);
    }

    function getHeldAmountForByPartition(bytes32 _partition, address _tokenHolder)
        external
        view
        returns (uint256)
    {
        return held[_partition][_tokenHolder];
    }

    function balanceOfByPartition(bytes32 _partition, address _tokenHolder) external view returns (uint256) {
        return available[_partition][_tokenHolder];
    }

    function canTransferByPartition(
        address _from,
        address _to,
        bytes32 _partition,
        uint256,
        bytes calldata,
        bytes calldata
    ) external view returns (bool status, bytes1 code, bytes32 reason) {
        if (!compliant[_from]) return (false, 0x50, "FROM_NOT_COMPLIANT");
        if (!compliant[_to]) return (false, 0x50, "TO_NOT_COMPLIANT");
        if (partitionBlocked[_partition][_from]) return (false, 0x50, "SERIES_RESTRICTED");
        return (true, 0x51, bytes32(0));
    }
}
