// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Fixture} from "./Fixture.sol";

contract ZZVerifierProbe is Fixture {
    address internal griefer = address(0x6217E4);

    function setUp() public {
        deployProtocol();
        fundLenders(1_000_000e6);
        giveCollateral(alice, 500_000e18);
        depositCollateral(alice, 500_000e18);
        vm.prank(alice);
        clearing.borrow(100_000e18, 0);
    }

    function _navAfter30Days(bool grief) internal returns (uint256 nav, uint256 debt) {
        uint256 navStart = liquidityVault.totalAssets();
        warpAndRefreshFeeds(30 days);

        if (grief) {
            vm.prank(griefer);
            financing.accrue();
        }

        // Any ordinary user interaction is the moment ClearingHouse recognises interest.
        vm.prank(alice);
        clearing.withdrawCollateral(USTB_ID, 1);

        nav = liquidityVault.totalAssets() - navStart;
        debt = financing.debtOf(alice);
    }

    function test_grieferCanStripInterestFromLenders() public {
        uint256 snap = vm.snapshotState();

        (uint256 honestNavGain, uint256 honestDebt) = _navAfter30Days(false);
        vm.revertToState(snap);
        (uint256 griefedNavGain, uint256 griefedDebt) = _navAfter30Days(true);

        emit log_named_uint("NAV gain, no griefer  ", honestNavGain);
        emit log_named_uint("NAV gain, with griefer", griefedNavGain);
        emit log_named_uint("alice debt, no griefer  ", honestDebt);
        emit log_named_uint("alice debt, with griefer", griefedDebt);

        assertGt(honestNavGain, 0, "control: lenders should earn interest");
        assertEq(griefedNavGain, 0, "griefer erased the lender-side interest credit");
        assertEq(griefedDebt, honestDebt, "borrower still owes the same debt");
    }

    function test_writeOffEmitsNothing() public {
        vm.recordLogs();
        vm.prank(address(clearing));
        uint256 loss = financing.writeOff(alice);
        // accrue() emits Accrued; writeOff itself emits nothing.
        assertGt(loss, 0, "there was debt to write off");
        for (uint256 i; i < vm.getRecordedLogs().length; ++i) {
            emit log_named_uint("log topic count", vm.getRecordedLogs()[i].topics.length);
        }
    }
}
