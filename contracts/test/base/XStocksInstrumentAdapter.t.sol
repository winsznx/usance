// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {
    XStocksInstrumentAdapter,
    IXStocksCorporateActionReporter
} from "../../src/base/XStocksInstrumentAdapter.sol";
import {CorporateActionSnapshot} from "../../src/base/interfaces/IBaseFacility.sol";
import {MockXStocksAsset} from "./mocks/MockXStocksAsset.sol";

contract MockCorporateActionReporter is IXStocksCorporateActionReporter {
    struct State {
        uint256 current;
        uint256 pending;
        uint64 activation;
        uint64 sourceBlock;
        uint64 observedAt;
        bool fresh;
        bool transferable;
    }

    mapping(bytes32 id => State) internal _state;

    function set(bytes32 id, State calldata s) external {
        _state[id] = s;
    }

    function state(bytes32 id) external view returns (uint256, uint256, uint64, uint64, uint64, bool, bool) {
        State memory s = _state[id];
        return (s.current, s.pending, s.activation, s.sourceBlock, s.observedAt, s.fresh, s.transferable);
    }
}

contract XStocksInstrumentAdapterTest is Test {
    bytes32 constant ID = keccak256("SYNTHETIC-XSTOCK-NVDA");
    MockXStocksAsset token;
    MockCorporateActionReporter reporter;
    XStocksInstrumentAdapter adapter;

    function setUp() public {
        token = new MockXStocksAsset("Synthetic xStock", "sxNVDA", 8);
        reporter = new MockCorporateActionReporter();
        adapter = new XStocksInstrumentAdapter(address(token), address(reporter), ID, 1);
        _report(1e18, 0, true, true);
    }

    function test_pendingActionFailsClosedEvenBeforeActivation() public {
        _report(1e18, 2e18, true, true);
        CorporateActionSnapshot memory s = adapter.snapshot();
        assertEq(s.accountingMode, 2);
        assertEq(s.priceConvention, 2);
        assertEq(s.feedStatus, 1, "pending action pauses new risk");
    }

    function test_reporterMismatchAndStalenessAreUnknown() public {
        _report(2e18, 0, true, true);
        assertEq(adapter.snapshot().feedStatus, 3, "reported factor must match token factor");

        _report(1e18, 0, false, true);
        assertEq(adapter.snapshot().feedStatus, 3, "stale reporter is fail closed");
    }

    function test_stableSharesAreExposedInsteadOfAdjustedBalance() public {
        address holder = makeAddr("holder");
        token.mintShares(holder, 100e8);
        token.setMultiplier(2e18);
        _report(2e18, 0, true, true);
        assertEq(adapter.rawBalanceOf(holder), 100e8);
        assertEq(token.balanceOf(holder), 200e8);
        assertEq(adapter.snapshot().feedStatus, 0);
    }

    function _report(uint256 current, uint256 pending, bool fresh, bool transferable) private {
        reporter.set(
            ID,
            MockCorporateActionReporter.State({
                current: current,
                pending: pending,
                activation: uint64(block.timestamp + 900),
                sourceBlock: uint64(block.number),
                observedAt: uint64(block.timestamp),
                fresh: fresh,
                transferable: transferable
            })
        );
    }
}
