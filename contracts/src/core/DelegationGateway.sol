// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Authority, Authorized} from "./Authority.sol";
import {ClearingHouse} from "./ClearingHouse.sol";
import {MandateRegistry} from "./MandateRegistry.sol";
import {Types} from "../libraries/Types.sol";

/// @title DelegationGateway
/// @notice The only route by which an agent acts on somebody else's account.
/// @dev The constitutional rule this contract exists to enforce:
///
///          AllowedAction = ProtocolAllows AND MandateAllows
///
///      Never `OR`. A mandate can only narrow what the protocol already permits. The two checks are
///      sequential statements with no early return between them: `authorize` reverts on refusal,
///      and what follows is the same protocol mechanics an owner's own call runs.
///
///      It lives outside ClearingHouse because ClearingHouse crossed the 24,576-byte limit. The
///      alternative was lowering optimizer runs, degrading gas for every user forever to make room
///      for a concern that does not belong in a clearing house. Splitting was better on both
///      counts, and it produced a stronger security story than the original: the delegated-capable
///      surface of ClearingHouse is now a single function, `actOnBehalf`, whose dispatch has exactly
///      two arms — repay and add-collateral — both of which move value *into* the account.
///
///      There is no withdrawal here and there is nowhere for one to come from. `ClearingHouse` has
///      no `withdrawFor` for this contract to call, and the switch below reverts on every action it
///      does not name — including any member added to the mandate vocabulary later. An enum nobody
///      will widen is a promise about future commits; a switch that refuses everything it does not
///      name is a rule.
contract DelegationGateway is Authorized {
    ClearingHouse public immutable clearing;
    MandateRegistry public immutable mandates;

    event DelegatedExecution(
        address indexed account,
        address indexed agent,
        bytes32 indexed mandateId,
        uint8 action,
        uint256 amountUsd18,
        uint256 result
    );

    error ActionNotDelegable(uint8 action);
    error AgentIsNotTheAccount();

    constructor(Authority authority_, ClearingHouse clearing_, MandateRegistry mandates_)
        Authorized(authority_)
    {
        clearing = clearing_;
        mandates = mandates_;
    }

    /**
     * @notice Exactly the request `execute` would submit for these arguments.
     *
     * @dev Public for two reasons, the second load-bearing. A UI needs it, so a mandate page can say
     *      which bound an act would hit before anybody signs anything.
     *
     *      And the caps in it are only *checked* for actions that can trip them — the debt ceiling
     *      applies to BORROW alone, which is not delegable. A mutation replacing
     *      `projectedDebtUsd18` with a constant zero therefore breaks nothing today and everything
     *      on the day autonomous borrowing is enabled. Exposing the construction is what lets a test
     *      pin the binding to live protocol state now, rather than discovering it was severed later.
     *
     *      Every risk field is read here, never accepted from a caller. An agent that could supply
     *      its own projected debt could pass any ceiling by understating it.
     */
    function authorizationRequestFor(
        address account,
        bytes32 mandateId,
        MandateRegistry.MandateAction action,
        bytes32 assetId,
        uint256 amount,
        bytes32 venueId
    ) public view returns (MandateRegistry.AuthorizationRequest memory) {
        (Types.RiskResult memory health,) = clearing.accountHealth(account);
        return MandateRegistry.AuthorizationRequest({
            mandateId: mandateId,
            agent: msg.sender,
            action: action,
            assetId: assetId,
            venueId: venueId,
            amountUsd18: amount,
            projectedDebtUsd18: health.debtUsd18,
            grossExposureUsd18: health.totalRecognizedUsd18,
            equityUsd18: health.totalRecognizedUsd18 > health.debtUsd18
                ? health.totalRecognizedUsd18 - health.debtUsd18
                : 0,
            passportCommittedAt: uint64(block.timestamp),
            slippageBps: 0
        });
    }

    /// @notice Act on `account`'s behalf, under a mandate that account signed.
    function execute(
        address account,
        bytes32 mandateId,
        MandateRegistry.MandateAction action,
        bytes32 assetId,
        uint256 amount,
        bytes32 venueId,
        bytes32[] calldata assetProof,
        bytes32[] calldata venueProof
    ) external returns (uint256 result) {
        // An agent acting on its own account is not delegation, and routing it here would push an
        // ordinary user action through a gate that was never meant to govern them.
        if (msg.sender == account) revert AgentIsNotTheAccount();

        // ---- MandateAllows. Reverts with the exact bound that was hit.
        mandates.authorize(
            authorizationRequestFor(account, mandateId, action, assetId, amount, venueId),
            assetProof,
            venueProof
        );

        // ---- ProtocolAllows. The same mechanics an owner's own call runs, so a signature cannot
        //      reach a path the protocol would refuse.
        if (action == MandateRegistry.MandateAction.REPAY) {
            result = clearing.actOnBehalf(0, msg.sender, account, assetId, amount);
        } else if (action == MandateRegistry.MandateAction.ADD_COLLATERAL) {
            result = clearing.actOnBehalf(1, msg.sender, account, assetId, amount);
        } else {
            // Everything else, including any member added to the vocabulary later. BORROW is here
            // on purpose: autonomous debt is refused until every bound is wired end to end, and
            // shipping it half-checked to look complete is the failure this layer prevents.
            revert ActionNotDelegable(uint8(action));
        }

        emit DelegatedExecution(account, msg.sender, mandateId, uint8(action), amount, result);
    }
}
