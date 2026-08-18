// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title MerkleLib
/// @notice Sorted-pair keccak Merkle root, matching `merkleRoot` in @usance/schemas exactly.
/// @dev Both implementations are load-bearing: the offchain pipeline computes the root it will
///      commit, and this contract recomputes it from the evidence the caller cites. If they
///      disagree by one bit, an honest Passport is rejected. `MerkleConformance.t.sol` pins them
///      together against the canonical vectors.
library MerkleLib {
    /// @dev The caller supplies leaves in strictly ascending order rather than having the contract
    ///      sort them. Sorting in Solidity costs gas to arrive at a result the caller already
    ///      knows, and verifying the order is O(n) with a free bonus: strict ascent proves every
    ///      leaf is distinct, so a duplicated evidence id cannot pad a root.
    error LeavesNotStrictlyAscending(uint256 index);
    error NoLeaves();

    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        uint256 n = leaves.length;
        if (n == 0) revert NoLeaves();

        for (uint256 i = 1; i < n; i++) {
            if (uint256(leaves[i]) <= uint256(leaves[i - 1])) revert LeavesNotStrictlyAscending(i);
        }

        // Hashing in place. `leaves` is memory owned by the caller for the duration of this call,
        // and each level is strictly shorter than the last, so the prefix being overwritten has
        // already been consumed.
        while (n > 1) {
            uint256 out = 0;
            for (uint256 i = 0; i < n; i += 2) {
                // An odd node is promoted unchanged, never duplicated. Duplicating it makes a tree
                // with a repeated last leaf indistinguishable from one without — the classic
                // second-preimage footgun.
                leaves[out++] = i + 1 == n ? leaves[i] : _hashPair(leaves[i], leaves[i + 1]);
            }
            n = out;
        }
        return leaves[0];
    }

    /// @dev Sorting the pair drops the left/right distinction, so a proof needs no direction
    ///      bitmap and the root does not depend on sibling order.
    ///
    ///      `abi.encode` rather than `abi.encodePacked`. For two bytes32 operands the two produce
    ///      identical bytes, so this is not a correctness fix today — it matches
    ///      `encodeAbiParameters` on the TypeScript side and stays correct if a leaf type ever
    ///      stops being exactly one word, which is where packed encoding starts colliding.
    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return uint256(a) <= uint256(b) ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}
