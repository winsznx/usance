// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title ICollateralAdapter
/// @notice The provider-neutral shape the institutional facility speaks to for one instrument's
///         custody. Phase 07 implements this over Hedera ATS partitions, an ERC-20 lock, an
///         ERC-1400 tranche, a native hashgraph token — the facility does not know which.
///
/// @dev Obligations, identical to every Usance adapter (`system.md §1`):
///
///      1. **No per-account financial accounting as authority.** The adapter may cache what it
///         observed, but the facility's committed-units figure is re-read from `committedOf`
///         before any release. The adapter translates custody state; it does not decide safety.
///
///      2. **No arbitrary recipient.** `release` takes no `to` parameter. The destination is
///         fixed by the facility's own semantics (the borrower, or the lender on default) and
///         passed as `rightfulOwner`; an adapter that sends elsewhere is non-conforming and the
///         facility's post-release `committedOf` / balance check catches it.
///
///      3. **A failure degrades to a restrictive reading, never a brick.** `transferable`
///         returning `(false, reason)` and `reconcile` returning `UNKNOWN` are ordinary answers.
///         A revert in `committedOf` is treated by the facility as "not enough committed".
///
///      4. **`commit` is the only place units move into custody for this facility.** It credits
///         by measured delta where the underlying token can lie about amounts (I-33 discipline).
interface ICollateralAdapter {
    /// @notice Outcome of reconciling an external / previously-unknown commitment.
    enum CommitmentState {
        NOT_COMMITTED, // the transfer did not land, or was reversed
        COMMITTED, //     the transfer is final and the units are in custody for `facility`
        UNKNOWN //        the adapter cannot yet tell — the facility keeps the old collateral locked
    }

    /// @notice The domain-neutral identity this adapter fronts. bytes32 canonical reference,
    ///         `identity-model.md` shape (EVM: left-padded address; native: keccak of native id).
    function instrumentRef() external view returns (bytes32);

    /// @notice The Usance financial `assetId` (`keccak256(abi.encode(chainId, token))` or the
    ///         registered fixture id) this adapter's instrument is bound to for calldata.
    function assetId() external view returns (bytes32);

    /// @notice Token-native decimals for the committed-units figure.
    function decimals() external view returns (uint8);

    /// @notice Can this exact instrument be committed to `facility` right now?
    /// @return ok        false blocks a new commitment (compliance window, freeze, pause)
    /// @return reason    a short machine reason when `ok` is false; `bytes32(0)` when ok
    function canCommit(address facility) external view returns (bool ok, bytes32 reason);

    /// @notice Lock `units` of this instrument from `from` into custody for `facility`.
    /// @dev Pulls via an allowance `from` granted to the adapter. Credits the measured delta.
    /// @return committedUnits the amount actually taken into custody in this call, by measured
    ///         delta. A synchronous adapter returns `>= units`; an adapter whose settlement is
    ///         asynchronous MAY return `0` and later report through `reconcile`.
    function commit(address facility, address from, uint256 units) external returns (uint256 committedUnits);

    /// @notice Total units currently in custody for `facility` under this instrument.
    /// @dev The authoritative figure the facility re-reads before every release. A revert here is
    ///      read by the facility as zero.
    function committedOf(address facility) external view returns (uint256);

    /// @notice Reconcile a commitment the facility marked `COMMITMENT_UNKNOWN`.
    /// @dev Queries authoritative custody state. `UNKNOWN` is a valid, non-failing answer and
    ///      keeps the facility's old collateral locked (I-97).
    function reconcile(address facility) external returns (CommitmentState);

    /// @notice Release `units` from `facility`'s custody to the facility-chosen rightful owner.
    /// @dev No recipient parameter beyond `rightfulOwner`, which the facility sets from its own
    ///      lifecycle (borrower on a normal substitution / settlement; lender on default). The
    ///      facility checks `committedOf` before and after.
    function release(address facility, address rightfulOwner, uint256 units) external;

    /// @notice Current transfer restriction on the instrument itself (issuer pause, freeze,
    ///         compliance window). Advisory to the facility's eligibility check.
    function transferable() external view returns (bool ok, bytes32 reason);
}
