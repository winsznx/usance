// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICollateralAdapter} from "../../../src/institutional/interfaces/ICollateralAdapter.sol";
import {
    DecisionBinding,
    FacilityDecision,
    FacilityDecisionLib,
    FacilityOperation,
    IAuthorityVerifier,
    IPolicyVerifier
} from "../../../src/institutional/interfaces/IFacilityDecisions.sol";

/// @notice TEST collateral adapter. NOT PRODUCTION. Models the plain-ERC20, home-domain custody
///         case, plus the three failure shapes Phase 06 has to defend against: async settlement,
///         an adapter that lies about the committed amount, and a blocked transfer.
///
/// @dev Phase 07's real adapters (Hedera ATS, ERC-1400 tranche, native token) implement the exact
///      same `ICollateralAdapter` interface. This one exists only so the facility's invariants can
///      be exercised without a live provider.
contract TestCollateralAdapter is ICollateralAdapter {
    enum Mode {
        SYNC, //  commit takes custody and reports it immediately
        ASYNC, // commit reports 0; the units are pending until resolve()
        LIAR //   commit reports the requested amount; committedOf under-reports by `lieDelta`
    }

    IERC20 public immutable token;
    bytes32 internal _instrumentRef;
    bytes32 internal _assetId;
    uint8 internal _decimals;

    Mode public mode;
    bool public commitAllowed = true;
    bytes32 public commitBlockReason;
    bool public transferOk = true;
    bytes32 public transferBlockReason;
    uint256 public lieDelta;
    CommitmentState public pendingResolution = CommitmentState.UNKNOWN;

    mapping(address => uint256) internal _custody; //  real units held for a facility
    mapping(address => uint256) internal _pending; //  async units awaiting resolve()

    constructor(IERC20 token_, bytes32 instrumentRef_, bytes32 assetId_, uint8 decimals_) {
        token = token_;
        _instrumentRef = instrumentRef_;
        _assetId = assetId_;
        _decimals = decimals_;
    }

    // ---- test controls ----
    function setMode(Mode m) external {
        mode = m;
    }

    function setCommitAllowed(bool ok, bytes32 reason) external {
        commitAllowed = ok;
        commitBlockReason = reason;
    }

    function setTransferable(bool ok, bytes32 reason) external {
        transferOk = ok;
        transferBlockReason = reason;
    }

    function setLieDelta(uint256 d) external {
        lieDelta = d;
    }

    function resolveAsync(address facility, CommitmentState to) external {
        pendingResolution = to;
        if (to == CommitmentState.COMMITTED) {
            _custody[facility] += _pending[facility];
            _pending[facility] = 0;
        } else if (to == CommitmentState.NOT_COMMITTED) {
            // return the pending units to the borrower who fronted them
            uint256 p = _pending[facility];
            _pending[facility] = 0;
            if (p != 0) token.transfer(msg.sender, p);
        }
    }

    // ---- ICollateralAdapter ----
    function instrumentRef() external view returns (bytes32) {
        return _instrumentRef;
    }

    function assetId() external view returns (bytes32) {
        return _assetId;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function canCommit(address) external view returns (bool ok, bytes32 reason) {
        return (commitAllowed, commitAllowed ? bytes32(0) : commitBlockReason);
    }

    function commit(address facility, address from, uint256 units) external returns (uint256 committedUnits) {
        require(commitAllowed, "commit blocked");
        uint256 balBefore = token.balanceOf(address(this));
        token.transferFrom(from, address(this), units);
        uint256 got = token.balanceOf(address(this)) - balBefore; // measured delta (I-33)

        if (mode == Mode.ASYNC) {
            _pending[facility] += got;
            return 0;
        }
        _custody[facility] += got;
        if (mode == Mode.LIAR) return units; // claims the full amount regardless of `got`
        return got;
    }

    function committedOf(address facility) external view returns (uint256) {
        uint256 c = _custody[facility];
        if (mode == Mode.LIAR && c >= lieDelta) return c - lieDelta;
        return c;
    }

    function reconcile(address facility) external view returns (CommitmentState) {
        if (_custody[facility] > 0 && _pending[facility] == 0) return CommitmentState.COMMITTED;
        return pendingResolution;
    }

    function release(address facility, address rightfulOwner, uint256 units) external {
        require(_custody[facility] >= units, "insufficient custody");
        _custody[facility] -= units;
        token.transfer(rightfulOwner, units);
    }

    function transferable() external view returns (bool ok, bytes32 reason) {
        return (transferOk, transferOk ? bytes32(0) : transferBlockReason);
    }
}

/// @notice TEST verifier for both authority and policy decisions. NOT PRODUCTION.
///
/// @dev A real verifier checks an ENSv2 name, a Privy org membership, or a Chainlink CRE
///      confidential-policy attestation. This one lets a test whitelist a decision by its exact
///      hash, and models revocation, expiry and per-(facility, operation) nonce monotonicity —
///      the bindings the facility relies on. `verify` returns false, never reverts.
contract TestFacilityVerifier is IAuthorityVerifier, IPolicyVerifier {
    using FacilityDecisionLib for FacilityDecision;

    mapping(bytes32 => bool) public approved;
    mapping(bytes32 => bool) public revoked;
    mapping(bytes32 => uint64) public highestNonce; // keccak(facilityId, operation) => nonce
    bool public epochCarveOut; // permitsCurrentEpoch answer for the risk-reducing path

    function approve(FacilityDecision calldata d) external {
        approved[d.hash()] = true;
    }

    function revoke(bytes32 decisionHash) external {
        revoked[decisionHash] = true;
    }

    function setEpochCarveOut(bool v) external {
        epochCarveOut = v;
    }

    function _key(bytes32 facilityId, FacilityOperation op) internal pure returns (bytes32) {
        return keccak256(abi.encode(facilityId, op));
    }

    /// @dev Checks every bound field of `b` against `d`, then the whitelist / revocation / expiry
    ///      / nonce. `via` the exact same `DecisionBinding` the facility built.
    function verify(FacilityDecision calldata d, DecisionBinding calldata b)
        external
        view
        override(IAuthorityVerifier, IPolicyVerifier)
        returns (bool ok, bytes32 decisionHash)
    {
        decisionHash = d.hash();
        if (d.facilityId != b.facilityId || d.operation != b.operation) return (false, bytes32(0));
        if (d.subjectAssetId != b.subjectAssetId || d.subjectInstrumentRef != b.subjectInstrumentRef) {
            return (false, bytes32(0));
        }
        if (d.requestId != b.requestId) return (false, bytes32(0));
        if (d.pinnedEpoch != b.epoch || d.collateralPolicyVersion != b.collateralPolicyVersion) {
            return (false, bytes32(0));
        }
        if (!approved[decisionHash] || revoked[decisionHash]) return (false, bytes32(0));
        if (d.expiry <= block.timestamp) return (false, bytes32(0));
        if (d.nonce < highestNonce[_key(d.facilityId, d.operation)]) return (false, bytes32(0));
        return (true, decisionHash);
    }

    /// @notice Test convenience: record a nonce as consumed. The facility does not call this; a
    ///         real verifier advances its own nonce state inside an attestation flow.
    function consumeNonce(FacilityDecision calldata d) external {
        bytes32 k = _key(d.facilityId, d.operation);
        if (d.nonce >= highestNonce[k]) highestNonce[k] = d.nonce + 1;
    }

    function isRevoked(bytes32 decisionHash) external view returns (bool) {
        return revoked[decisionHash];
    }

    function permitsCurrentEpoch(bytes32, uint64, uint64) external view returns (bool) {
        return epochCarveOut;
    }
}
