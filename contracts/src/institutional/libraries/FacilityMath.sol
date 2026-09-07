// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {RiskMath} from "../../libraries/RiskMath.sol";
import {Types} from "../../libraries/Types.sol";

/// @title FacilityMath
/// @notice The institutional facility's pure arithmetic: fixed-rate linear interest, the
///         origination fee split, and the post-collateral coverage test. No storage, no oracle.
///
/// @dev Rounding is deliberate and matches `spec/institutional-facility-model.md §11`:
///
///      - interest accrued rounds **down** (the borrower is not charged dust),
///      - the origination fee rounds **up** (`spec/accounting.md §1.2` — a fee the protocol keeps
///        rounds toward the protocol; the borrower's proceeds are the residual so no unit is
///        invented),
///      - coverage is a `>=` comparison on integers, no rounding.
library FacilityMath {
    /// @notice Linear fixed-rate interest over `elapsed` seconds on `principalOutstanding`.
    /// @param principalOutstanding settlement-token units of principal still owed
    /// @param rateBps annualised rate, basis points
    /// @param elapsed seconds since the last accrual
    /// @return interest settlement-token units, rounded down
    function accruedInterest(uint256 principalOutstanding, uint16 rateBps, uint64 elapsed)
        internal
        pure
        returns (uint256 interest)
    {
        if (principalOutstanding == 0 || rateBps == 0 || elapsed == 0) return 0;
        // principal * rateBps * elapsed / (BPS * SECONDS_PER_YEAR), full-width, floored.
        interest = RiskMath.mulDiv(
            principalOutstanding, uint256(rateBps) * uint256(elapsed), Types.BPS * Types.SECONDS_PER_YEAR
        );
    }

    /// @notice Split a drawn principal into the borrower's proceeds and the origination fee.
    /// @dev `principalDrawn == borrowerProceeds + fee` exactly (invariant I-99). The fee rounds
    ///      up and the proceeds are the residual, so the identity holds with no dust anywhere.
    /// @param principalDrawn settlement-token units drawn
    /// @param originationFeeBps basis points, already bounds-checked by the caller against the ceiling
    function originationSplit(uint256 principalDrawn, uint16 originationFeeBps)
        internal
        pure
        returns (uint256 borrowerProceeds, uint256 fee)
    {
        fee = RiskMath.mulDivUp(principalDrawn, originationFeeBps, Types.BPS);
        // A fee that rounds up to more than the whole draw is only reachable with a nonsense
        // bps > BPS, which the ceiling (50) forbids. Guard anyway so the residual never underflows.
        if (fee > principalDrawn) fee = principalDrawn;
        borrowerProceeds = principalDrawn - fee;
    }

    /// @notice Does `recognisedValueUsd18` of collateral cover `outstandingUsd18` of debt at
    ///         `maintenanceLtvBps`?
    /// @dev `outstanding <= recognised * maintenanceLtv / BPS`, computed without dividing the
    ///      right-hand side (multiply `outstanding` by BPS instead) so there is no rounding on
    ///      the safety boundary.
    function coverageHolds(uint256 outstandingUsd18, uint256 recognisedValueUsd18, uint16 maintenanceLtvBps)
        internal
        pure
        returns (bool)
    {
        return outstandingUsd18 * Types.BPS <= recognisedValueUsd18 * uint256(maintenanceLtvBps);
    }
}
