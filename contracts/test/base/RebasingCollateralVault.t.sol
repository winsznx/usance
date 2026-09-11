// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RebasingCollateralVault} from "../../src/base/RebasingCollateralVault.sol";
import {MockXStocksAsset} from "./mocks/MockXStocksAsset.sol";

contract VaultCaller {
    function deposit(RebasingCollateralVault vault, bytes32 id, address from, address account, uint256 amount)
        external
        returns (uint256)
    {
        return vault.deposit(id, from, account, amount);
    }

    function withdraw(RebasingCollateralVault vault, bytes32 id, address account, uint256 claim)
        external
        returns (uint256)
    {
        return vault.withdrawClaim(id, account, claim);
    }
}

/// @notice Invariants for the share-based path that is deliberately distinct from B20 custody.
contract RebasingCollateralVaultTest is Test {
    address gov = makeAddr("gov");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32 constant ID = keccak256("SYNTHETIC-XSTOCK");

    MockXStocksAsset token;
    RebasingCollateralVault vault;
    VaultCaller facility;

    function setUp() public {
        token = new MockXStocksAsset("Synthetic xStock", "sxSTK", 8);
        vault = new RebasingCollateralVault(gov);
        facility = new VaultCaller();
        vm.startPrank(gov);
        vault.registerInstrument(ID, address(token));
        vault.bindFacility(address(facility));
        vm.stopPrank();

        token.mintShares(alice, 1_000e8);
        token.mintShares(bob, 1_000e8);
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        token.approve(address(vault), type(uint256).max);
    }

    function test_multiplierChangesValueWithoutChangingCustodyClaims() public {
        facility.deposit(vault, ID, alice, alice, 1_000e8);
        assertEq(vault.claimOf(ID, alice), 1_000e8);
        assertEq(vault.valuationQuantityOf(ID, alice), 1_000e8);

        token.setMultiplier(2e18);
        assertEq(vault.claimOf(ID, alice), 1_000e8, "claim is stable shares");
        assertEq(vault.valuationQuantityOf(ID, alice), 2_000e8, "factor appears in balance exactly once");
    }

    function test_twoUsersRetainProRataOwnershipAcrossRebaseAndDonation() public {
        facility.deposit(vault, ID, alice, alice, 1_000e8);
        facility.deposit(vault, ID, bob, bob, 1_000e8);
        token.setMultiplier(2e18);
        assertEq(vault.valuationQuantityOf(ID, alice), 2_000e8);
        assertEq(vault.valuationQuantityOf(ID, bob), 2_000e8);

        // A direct transfer is never minted as a user claim; it is explicitly surplus.
        token.mintShares(address(vault), 100e8);
        vault.reconcile(ID);
        assertEq(vault.surplusShares(ID), 100e8);
        assertEq(vault.claimOf(ID, alice), 1_000e8);
        assertEq(vault.claimOf(ID, bob), 1_000e8);
    }

    function test_withdrawUsesStableClaimAfterReverseSplit() public {
        facility.deposit(vault, ID, alice, alice, 1_000e8);
        token.setMultiplier(5e17);
        uint256 out = facility.withdraw(vault, ID, alice, 1_000e8);
        assertEq(out, 500e8);
        assertEq(token.balanceOf(alice), 500e8);
        assertEq(vault.claimOf(ID, alice), 0);
        assertEq(token.sharesOf(address(vault)), 0);
    }
}
