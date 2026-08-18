// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "./Fixture.sol";
import {EvidenceRegistry} from "../src/core/EvidenceRegistry.sol";
import {PassportRegistry} from "../src/core/PassportRegistry.sol";
import {MerkleLib} from "../src/libraries/MerkleLib.sol";
import {Types} from "../src/libraries/Types.sol";

/**
 * Evidence must exist before the Passport that rests on it.
 *
 * `evidenceRoot` used to be 32 opaque bytes the caller asserted, checked only for being non-zero.
 * A Passport could therefore commit to a root over evidence that was never filed, or was filed
 * against a different asset, and nothing on chain could tell the difference — which hollows out
 * the one claim the whole protocol makes, that what it believes about an asset is traceable to
 * documents somebody can go and read.
 *
 * The caller now cites the evidence ids, each is checked, and the root is recomputed from them.
 */
contract EvidenceOrderingTest is Fixture {
    bytes32 constant NEW_ASSET = keccak256("SOME-OTHER-ASSET");

    function setUp() public {
        deployProtocol();
    }

    function _register(bytes32 assetId, string memory tag) internal returns (bytes32 id) {
        vm.prank(admission);
        id = evidenceReg.commit(
            assetId,
            keccak256(abi.encodePacked(tag, "-content")),
            keccak256(abi.encodePacked(tag, "-source")),
            uint64(block.timestamp),
            uint64(block.timestamp),
            Types.SourceClass.REGULATORY_FILING
        );
    }

    function _sorted(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](2);
        (out[0], out[1]) = uint256(a) < uint256(b) ? (a, b) : (b, a);
    }

    // ------------------------------------------------------------------ the invariant

    function test_passportCannotCiteEvidenceThatWasNeverCommitted() public {
        bytes32 fabricated = keccak256("A DOCUMENT NOBODY FILED");
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = fabricated;

        vm.prank(admission);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.EvidenceNotCommitted.selector, fabricated));
        passportReg.commitPassport(USTB_ID, 2, ids, fabricated, keccak256("CLAIMS"), 0, true, 9900, false);
    }

    function test_passportCannotCiteAnotherAssetsEvidence() public {
        bytes32 foreign = _register(NEW_ASSET, "FOREIGN");
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = foreign;

        // The evidence is genuinely committed. It just does not belong to this asset, which is the
        // subtler and more dangerous case: a real document lending its authority to the wrong thing.
        vm.prank(admission);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.EvidenceNotCommitted.selector, foreign));
        passportReg.commitPassport(USTB_ID, 2, ids, foreign, keccak256("CLAIMS"), 0, true, 9900, false);
    }

    function test_passportCannotCiteInvalidatedEvidence() public {
        bytes32 id = _register(USTB_ID, "RETRACTED");
        vm.prank(admission);
        evidenceReg.invalidate(id, "issuer retracted the filing");

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = id;

        vm.prank(admission);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.EvidenceNotCommitted.selector, id));
        passportReg.commitPassport(USTB_ID, 2, ids, id, keccak256("CLAIMS"), 0, true, 9900, false);
    }

    function test_passportCannotClaimARootTheEvidenceDoesNotProduce() public {
        bytes32 id = _register(USTB_ID, "REAL");
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = id;
        bytes32 lie = keccak256("A ROOT I PREFER");

        vm.prank(admission);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.EvidenceRootMismatch.selector, lie, id));
        passportReg.commitPassport(USTB_ID, 2, ids, lie, keccak256("CLAIMS"), 0, true, 9900, false);
    }

    function test_passportCannotCiteNoEvidenceAtAll() public {
        bytes32[] memory none = new bytes32[](0);
        vm.prank(admission);
        vm.expectRevert(PassportRegistry.NoEvidenceCited.selector);
        passportReg.commitPassport(
            USTB_ID, 2, none, keccak256("X"), keccak256("CLAIMS"), 0, true, 9900, false
        );
    }

    /// The same document cited twice would otherwise let one source produce a root that looks like
    /// two, which is the corroboration lie in its most compact form.
    function test_theSameDocumentCannotBeCitedTwice() public {
        bytes32 id = _register(USTB_ID, "ONCE");
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = id;
        ids[1] = id;

        vm.prank(admission);
        vm.expectRevert(abi.encodeWithSelector(MerkleLib.LeavesNotStrictlyAscending.selector, uint256(1)));
        passportReg.commitPassport(USTB_ID, 2, ids, id, keccak256("CLAIMS"), 0, true, 9900, false);
    }

    function test_citationsMustArriveInAscendingOrder() public {
        bytes32 a = _register(USTB_ID, "A");
        bytes32 b = _register(USTB_ID, "B");
        bytes32[] memory ascending = _sorted(a, b);

        bytes32[] memory descending = new bytes32[](2);
        descending[0] = ascending[1];
        descending[1] = ascending[0];

        vm.prank(admission);
        vm.expectRevert(abi.encodeWithSelector(MerkleLib.LeavesNotStrictlyAscending.selector, uint256(1)));
        passportReg.commitPassport(
            USTB_ID, 2, descending, MerkleLib.root(ascending), keccak256("CLAIMS"), 0, true, 9900, false
        );
    }

    // ------------------------------------------------------------------ the happy path

    function test_aPassportBackedByRealEvidenceCommits() public {
        bytes32 a = _register(USTB_ID, "FILING-A");
        bytes32 b = _register(USTB_ID, "FILING-B");
        bytes32[] memory ids = _sorted(a, b);
        bytes32 root = MerkleLib.root(_sorted(a, b));

        vm.prank(admission);
        bytes32 passportId =
            passportReg.commitPassport(USTB_ID, 2, ids, root, keccak256("CLAIMS_V2"), 0, true, 9900, false);

        assertEq(passportReg.currentVersion(USTB_ID), 2, "version did not advance");
        assertEq(passportReg.getPassport(USTB_ID, 2).evidenceRoot, root, "root not stored");
        assertTrue(passportId != bytes32(0));
    }

    /// Superseded evidence stays usable. A superseded document was true when it was filed, and the
    /// Passport version citing it is a historical record rather than a live assertion. Invalidation
    /// is the state that means "this should never have counted".
    function test_supersededEvidenceRemainsCitable() public {
        bytes32 old = _register(USTB_ID, "OLD");
        bytes32 fresh = _register(USTB_ID, "FRESH");
        vm.prank(admission);
        evidenceReg.supersede(old, fresh);

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = old;

        vm.prank(admission);
        passportReg.commitPassport(USTB_ID, 2, ids, old, keccak256("CLAIMS"), 0, true, 9900, false);
        assertEq(passportReg.currentVersion(USTB_ID), 2);
    }

    // ------------------------------------------------------------------ the registry index

    function test_evidenceIsBoundToExactlyOneAsset() public {
        bytes32 id = _register(USTB_ID, "BOUND");
        assertEq(evidenceReg.evidenceAsset(id), USTB_ID);
        assertTrue(evidenceReg.isUsableFor(USTB_ID, id));
        assertFalse(evidenceReg.isUsableFor(USDC_ID, id));
        assertFalse(evidenceReg.isUsableFor(USTB_ID, keccak256("never filed")));
    }
}
