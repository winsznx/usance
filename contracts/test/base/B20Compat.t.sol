// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockB20Asset} from "./mocks/MockB20Asset.sol";
import {BaseB20InstrumentAdapter} from "../../src/base/BaseB20InstrumentAdapter.sol";
import {CorporateActionSnapshot} from "../../src/base/interfaces/IBaseFacility.sol";

/// @title B20Compat
/// @notice `spec/base-portfolio-facility-model.md §4`, Phase 08 §36. A compatibility probe that is
///         rerun on every Base Sepolia deploy and after any Base network upgrade. It records which
///         B20 multiplier read-path is live and asserts the adapter behaves correctly on both:
///
///          - **Beryl** (current, both networks): instant `updateMultiplier` only. The ERC-8056
///            selectors (`newUIMultiplier()` / `effectiveAt()`) revert → the adapter reports no
///            on-chain pending disclosure and derives the activation window from the token pause.
///          - **Cobalt** (Planning, not active): the ERC-8056 selectors are present → the adapter
///            reads `pendingFactorWad` / `pendingActivationAt` and fails closed during the window.
///
///         If Cobalt activates during Phase 08, the Phase-03-derived cases here must be re-run
///         against the new active semantics — do not assume a no-op.
contract B20CompatTest is Test {
    MockB20Asset token;
    BaseB20InstrumentAdapter adapter;
    bytes32 constant ID = keccak256("USANCE-TEST-COMPAT");

    function setUp() public {
        vm.warp(1_750_431_600);
        token = new MockB20Asset("USANCE-TEST Compat", "utCMP", 8);
        adapter = new BaseB20InstrumentAdapter(address(token), ID, 1);
    }

    function test_beryl_readPath_instantMultiplierOnly() public view {
        assertFalse(adapter.b20HasScheduledMultiplier(), "Beryl: ERC-8056 selectors revert");
        CorporateActionSnapshot memory s = adapter.snapshot();
        assertEq(s.accountingMode, 1, "EXTERNALLY_SCALED");
        assertEq(s.priceConvention, 1, "FACTOR_IN_PRICE");
        assertEq(s.factorWad, 1e18);
        assertEq(s.pendingFactorWad, 0, "no on-chain pending disclosure on Beryl");
        assertEq(s.feedStatus, 0, "LIVE when not paused");
    }

    function test_beryl_instantMultiplierChangeAppliesImmediately() public {
        token.updateMultiplier(3e18);
        assertEq(adapter.factorWad(), 3e18);
        assertEq(adapter.snapshot().factorWad, 3e18);
    }

    function test_beryl_tokenPauseIsFeedPausedForAction() public {
        token.setPaused(0, true);
        assertEq(adapter.snapshot().feedStatus, 1, "PAUSED_FOR_ACTION");
        (bool ok,) = adapter.transferable(address(1), address(2));
        assertFalse(ok);
    }

    function test_cobalt_readPath_pendingMultiplierDisclosed() public {
        token.enableCobalt(2e18, uint256(block.timestamp) + 1 days);
        assertTrue(adapter.b20HasScheduledMultiplier(), "Cobalt: ERC-8056 selectors present");
        CorporateActionSnapshot memory s = adapter.snapshot();
        assertEq(s.pendingFactorWad, 2e18);
        assertEq(s.pendingActivationAt, uint64(block.timestamp + 1 days));
        assertEq(s.feedStatus, 1, "activation window fails closed (I-83)");
    }

    function test_cobalt_afterActivation_windowClears() public {
        token.enableCobalt(2e18, uint256(block.timestamp) + 100);
        assertEq(adapter.snapshot().feedStatus, 1);
        vm.warp(block.timestamp + 101);
        assertEq(adapter.snapshot().feedStatus, 0, "window elapsed - LIVE again");
    }
}
