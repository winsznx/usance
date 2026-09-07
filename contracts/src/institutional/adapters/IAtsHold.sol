// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title IAtsHold
/// @notice The minimal slice of Hedera Asset Tokenization Studio the Usance collateral adapter
///         actually calls. Taken verbatim (names, argument order, return shapes) from ATS
///         `packages/ats/contracts/contracts/facets/holdByPartition/IHoldByPartition.sol` and
///         `.../complianceByPartition/IComplianceByPartition.sol` and
///         `.../balanceTrackerByPartition/IBalanceTrackerByPartition.sol` on
///         `github.com/hashgraph/asset-tokenization-studio` (ERC-1400 + Hold facets, Diamond
///         pattern).
///
/// @dev This is NOT a Usance-invented "lock" primitive (Phase 07 brief §4). The ATS **Hold** is a
///      native ATS mechanism: `createHoldFromByPartition` places part of a holder's partitioned
///      balance under a hold whose `escrow` is the only address that may execute it before
///      expiry, and whose `to` is the fixed execution recipient. A hold with no expiry
///      (`expirationTimestamp == 0`) cannot be reclaimed by the holder — it can only be released
///      (back to the holder) or executed (to `to`) by the escrow. That is exactly "replacement
///      units become irreversibly attributable to this facility before old collateral becomes
///      releasable".
interface IAtsHold {
    struct Hold {
        uint256 amount;
        uint256 expirationTimestamp; // 0 => never expires; holder cannot reclaim
        address escrow; // only this address may execute the hold before expiry
        address to; // fixed execution recipient
        bytes data;
    }

    struct HoldIdentifier {
        bytes32 partition;
        address tokenHolder;
        uint256 holdId;
    }

    /// @notice An authorised third party (operator) places a hold on `_from`'s partitioned balance.
    function createHoldFromByPartition(
        bytes32 _partition,
        address _from,
        Hold calldata _hold,
        bytes calldata _operatorData
    ) external returns (bool success_, uint256 holdId_);

    /// @notice The escrow executes the hold, transferring `_amount` to `_to` (must equal `hold.to`).
    function executeHoldByPartition(HoldIdentifier calldata _holdIdentifier, address _to, uint256 _amount)
        external
        returns (bool success_, bytes32 partition_);

    /// @notice Release held tokens back to the holder. Only before expiry.
    function releaseHoldByPartition(HoldIdentifier calldata _holdIdentifier, uint256 _amount)
        external
        returns (bool success_);

    /// @notice Held amount for one hold — the authoritative figure the adapter re-reads.
    function getHoldForByPartition(HoldIdentifier calldata _holdIdentifier)
        external
        view
        returns (
            uint256 amount_,
            uint256 expirationTimestamp_,
            address escrow_,
            address destination_,
            bytes memory data_,
            bytes memory operatorData_,
            uint8 thirdPartyType_
        );

    /// @notice Total held amount for a holder in a partition.
    function getHeldAmountForByPartition(bytes32 _partition, address _tokenHolder)
        external
        view
        returns (uint256 amount_);

    /// @notice Available (non-held) partitioned balance.
    function balanceOfByPartition(bytes32 _partition, address _tokenHolder) external view returns (uint256);

    /// @notice ATS compliance gate — KYC / allow-list / freeze / transfer restriction, all folded
    ///         into one check with an EIP-1066 status code.
    function canTransferByPartition(
        address _from,
        address _to,
        bytes32 _partition,
        uint256 _value,
        bytes calldata _data,
        bytes calldata _operatorData
    ) external view returns (bool status, bytes1 code, bytes32 reason);
}
