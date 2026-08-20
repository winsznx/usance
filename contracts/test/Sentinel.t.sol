// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Authority} from "../src/core/Authority.sol";
import {MandateRegistry} from "../src/core/MandateRegistry.sol";
import {SentinelTemplateRegistry} from "../src/core/SentinelTemplateRegistry.sol";
import {SentinelInstanceRegistry} from "../src/core/SentinelInstanceRegistry.sol";

/**
 * The two Sentinel registries.
 *
 * They authorise no money and hold no role: the only thing they can do wrong is let a template
 * mutate an installed instance, let a disabled template start a run, drop the pause asymmetry, or
 * drift from the mandate vocabulary the money layer enforces. Each of those is pinned here.
 */
contract SentinelRegistriesTest is Test {
    Authority internal authority;
    SentinelTemplateRegistry internal templates;
    SentinelInstanceRegistry internal instances;

    address internal governance = makeAddr("governance");
    address internal guardian = makeAddr("guardian");
    address internal publisher = makeAddr("publisher");
    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant TID = keccak256("safety-buffer");
    bytes32 internal constant MANIFEST = keccak256("manifest-v1");
    bytes32 internal constant MANDATE = keccak256("mandate-1");

    // REPAY (bit 1) + ADD_COLLATERAL (bit 2)
    uint16 internal constant REDUCING_ACTIONS = (uint16(1) << 1) | (uint16(1) << 2);
    // BORROW (bit 0)
    uint16 internal constant BORROW_BIT = uint16(1) << 0;

    function setUp() public {
        authority = new Authority(governance);
        // Read the role id before pranking: an external call in the argument list would otherwise
        // consume the prank, and grantRole would run as this test contract, not as governance.
        bytes32 guardianRole = authority.GUARDIAN();
        vm.prank(governance);
        authority.grantRole(guardianRole, guardian);

        templates = new SentinelTemplateRegistry(authority);
        instances = new SentinelInstanceRegistry(authority, templates);
    }

    function _params(SentinelTemplateRegistry.RiskClass rc, uint16 actions)
        internal
        pure
        returns (SentinelTemplateRegistry.CommitParams memory)
    {
        return SentinelTemplateRegistry.CommitParams({
            manifestHash: MANIFEST,
            configSchemaHash: keccak256("config"),
            triggerSchemaHash: keccak256("trigger"),
            planSchemaHash: keccak256("plan"),
            riskClass: rc,
            requiredActions: actions,
            requiredTriggerClasses: uint16(1) << 1,
            feePerSuccessfulRunBps: 100,
            feeFlatPerRunUsd18: 0,
            auditStatus: SentinelTemplateRegistry.AuditStatus.UNAUDITED
        });
    }

    function _commitV1() internal {
        vm.prank(publisher);
        templates.commitTemplate(TID, 1, _params(SentinelTemplateRegistry.RiskClass.RISK_REDUCING_ONLY, REDUCING_ACTIONS));
    }

    // ------------------------------------------------------------------ template versioning

    function test_versionsAreSequentialAndImmutable() public {
        _commitV1();
        assertEq(templates.latestVersion(TID), 1);

        // Re-committing v1 is rejected: version must be latest + 1.
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(SentinelTemplateRegistry.VersionNotSequential.selector, uint64(2), uint64(1)));
        templates.commitTemplate(TID, 1, _params(SentinelTemplateRegistry.RiskClass.RISK_REDUCING_ONLY, REDUCING_ACTIONS));

        // Skipping to v3 is rejected.
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(SentinelTemplateRegistry.VersionNotSequential.selector, uint64(2), uint64(3)));
        templates.commitTemplate(TID, 3, _params(SentinelTemplateRegistry.RiskClass.RISK_REDUCING_ONLY, REDUCING_ACTIONS));

        // v2 by the family publisher is accepted.
        vm.prank(publisher);
        templates.commitTemplate(TID, 2, _params(SentinelTemplateRegistry.RiskClass.RISK_REDUCING_ONLY, REDUCING_ACTIONS));
        assertEq(templates.latestVersion(TID), 2);
    }

    function test_onlyFamilyPublisherMayAddVersions() public {
        _commitV1();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SentinelTemplateRegistry.NotFamilyPublisher.selector, publisher, stranger));
        templates.commitTemplate(TID, 2, _params(SentinelTemplateRegistry.RiskClass.RISK_REDUCING_ONLY, REDUCING_ACTIONS));
    }

    function test_feePolicyBoundedByCeilings() public {
        SentinelTemplateRegistry.CommitParams memory p =
            _params(SentinelTemplateRegistry.RiskClass.MARKET_NEUTRAL, REDUCING_ACTIONS);
        p.feePerSuccessfulRunBps = templates.MAX_FEE_BPS() + 1;
        vm.prank(publisher);
        vm.expectRevert(SentinelTemplateRegistry.FeeAboveCeiling.selector);
        templates.commitTemplate(TID, 1, p);

        p.feePerSuccessfulRunBps = 100;
        p.feeFlatPerRunUsd18 = templates.MAX_FLAT_FEE_USD18() + 1;
        vm.prank(publisher);
        vm.expectRevert(SentinelTemplateRegistry.FeeAboveCeiling.selector);
        templates.commitTemplate(TID, 1, p);
    }

    function test_rejectsActionBitOutsideVocabulary() public {
        SentinelTemplateRegistry.CommitParams memory p =
            _params(SentinelTemplateRegistry.RiskClass.MARKET_NEUTRAL, uint16(1) << uint16(templates.MANDATE_ACTION_COUNT()));
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(SentinelTemplateRegistry.ActionBitOutsideVocabulary.selector, uint16(64)));
        templates.commitTemplate(TID, 1, p);
    }

    function test_riskReducingCannotRequireRiskIncreasingAction() public {
        SentinelTemplateRegistry.CommitParams memory p =
            _params(SentinelTemplateRegistry.RiskClass.RISK_REDUCING_ONLY, REDUCING_ACTIONS | BORROW_BIT);
        vm.prank(publisher);
        vm.expectRevert(SentinelTemplateRegistry.RiskReducingRequiresNonIncreasing.selector);
        templates.commitTemplate(TID, 1, p);
    }

    /// The bound this registry enforces must equal the vocabulary the money layer enforces (I-61).
    function test_mandateActionCountMatchesMandateRegistry() public {
        MandateRegistry mandate = new MandateRegistry(authority);
        assertEq(templates.MANDATE_ACTION_COUNT(), mandate.ACTION_COUNT());
    }

    // ------------------------------------------------------------------ status ladder

    function test_statusLadderOnlyRestrictsExceptGovernance() public {
        _commitV1();

        // Publisher may deprecate their own template.
        vm.prank(publisher);
        templates.setStatus(TID, 1, SentinelTemplateRegistry.TemplateStatus.DEPRECATED);
        assertEq(uint8(templates.getVersion(TID, 1).status), uint8(SentinelTemplateRegistry.TemplateStatus.DEPRECATED));

        // Neither publisher nor guardian may lift it back to ACTIVE.
        vm.prank(publisher);
        vm.expectRevert(SentinelTemplateRegistry.StatusMayOnlyRestrict.selector);
        templates.setStatus(TID, 1, SentinelTemplateRegistry.TemplateStatus.ACTIVE);

        // Guardian may restrict further to SECURITY_DISABLED.
        vm.prank(guardian);
        templates.setStatus(TID, 1, SentinelTemplateRegistry.TemplateStatus.SECURITY_DISABLED);

        // A stranger may not set status at all.
        vm.prank(stranger);
        vm.expectRevert(SentinelTemplateRegistry.NotAuthorizedToSetStatus.selector);
        templates.setStatus(TID, 1, SentinelTemplateRegistry.TemplateStatus.SECURITY_DISABLED);

        // Only GOVERNANCE may lift.
        vm.prank(governance);
        templates.setStatus(TID, 1, SentinelTemplateRegistry.TemplateStatus.ACTIVE);
        assertEq(uint8(templates.getVersion(TID, 1).status), uint8(SentinelTemplateRegistry.TemplateStatus.ACTIVE));
    }

    // ------------------------------------------------------------------ instances

    function test_registrationPinsManifestAndRefusesMissingOrDisabled() public {
        // No template yet → registration reverts inside getVersion.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SentinelTemplateRegistry.UnknownTemplateVersion.selector, TID, uint64(1)));
        instances.registerInstance(TID, 1, MANIFEST, executor, MANDATE, keccak256("cfg"));

        _commitV1();

        // Manifest mismatch is refused (I-62 defence in depth).
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SentinelInstanceRegistry.ManifestMismatch.selector, MANIFEST, keccak256("wrong")));
        instances.registerInstance(TID, 1, keccak256("wrong"), executor, MANDATE, keccak256("cfg"));

        // A well-formed registration lands, and its id matches the derivation.
        vm.prank(owner);
        bytes32 id = instances.registerInstance(TID, 1, MANIFEST, executor, MANDATE, keccak256("cfg"));
        assertEq(id, instances.instanceIdFor(owner, 0));
        assertEq(uint8(instances.getInstance(id).status), uint8(SentinelInstanceRegistry.InstanceStatus.REGISTERED));

        // Disable the template; new registrations are refused (I-68).
        vm.prank(guardian);
        templates.setStatus(TID, 1, SentinelTemplateRegistry.TemplateStatus.SECURITY_DISABLED);
        vm.prank(owner);
        vm.expectRevert(SentinelInstanceRegistry.TemplateDisabled.selector);
        instances.registerInstance(TID, 1, MANIFEST, executor, MANDATE, keccak256("cfg"));
    }

    function test_pauseAsymmetry() public {
        _commitV1();
        vm.prank(owner);
        bytes32 id = instances.registerInstance(TID, 1, MANIFEST, executor, MANDATE, keccak256("cfg"));

        // Owner pauses and resumes their own pause.
        vm.prank(owner);
        instances.pause(id);
        vm.prank(owner);
        instances.resume(id);

        // Guardian pauses; the owner cannot lift it.
        vm.prank(guardian);
        instances.pause(id);
        assertTrue(instances.getInstance(id).pausedByGuardian);
        vm.prank(owner);
        vm.expectRevert(SentinelInstanceRegistry.OwnerCannotLiftGuardianPause.selector);
        instances.resume(id);

        // Guardian may lift the guardian pause.
        vm.prank(guardian);
        instances.resume(id);
        assertEq(uint8(instances.getInstance(id).status), uint8(SentinelInstanceRegistry.InstanceStatus.REGISTERED));
    }

    function test_revokeIsTerminalAndOwnerOnly() public {
        _commitV1();
        vm.prank(owner);
        bytes32 id = instances.registerInstance(TID, 1, MANIFEST, executor, MANDATE, keccak256("cfg"));

        // A guardian cannot revoke — revocation is the owner's decision, not a restriction.
        vm.prank(guardian);
        vm.expectRevert(SentinelInstanceRegistry.NotOwnerOrGovernance.selector);
        instances.revoke(id);

        vm.prank(owner);
        instances.revoke(id);
        assertEq(uint8(instances.getInstance(id).status), uint8(SentinelInstanceRegistry.InstanceStatus.REVOKED));

        // Terminal: no further transition, in any direction.
        vm.prank(owner);
        vm.expectRevert(SentinelInstanceRegistry.InstanceIsRevoked.selector);
        instances.pause(id);
        vm.prank(owner);
        vm.expectRevert(SentinelInstanceRegistry.InstanceIsRevoked.selector);
        instances.revoke(id);
    }

    // ------------------------------------------------------------------ I-61 and size

    function test_registriesHoldNoRoleOverMoney() public view {
        assertFalse(authority.hasRole(authority.CLEARING(), address(templates)));
        assertFalse(authority.hasRole(authority.CLEARING(), address(instances)));
        assertFalse(authority.hasRole(authority.ADMISSION(), address(templates)));
        assertFalse(authority.hasRole(authority.ADMISSION(), address(instances)));
        assertFalse(authority.hasRole(authority.LIQUIDATOR(), address(instances)));
        assertFalse(authority.hasRole(authority.GOVERNANCE(), address(templates)));
    }

    function test_bothRegistriesFitUnderEip170() public view {
        assertLe(address(templates).code.length, 24_576, "template registry over EIP-170");
        assertLe(address(instances).code.length, 24_576, "instance registry over EIP-170");
    }

    /// A publisher shipping v2 must not mutate v1, nor the instance that pinned v1 (I-62/I-68). This
    /// is the mutation guard for "a template update widens an existing installation".
    function test_newVersionDoesNotMutateEarlierVersionOrItsInstances() public {
        _commitV1(); // v1: RISK_REDUCING_ONLY, REPAY|ADD_COLLATERAL, manifest MANIFEST
        vm.prank(owner);
        bytes32 id = instances.registerInstance(TID, 1, MANIFEST, executor, MANDATE, keccak256("cfg"));

        // v2 changes risk class and manifest hash.
        SentinelTemplateRegistry.CommitParams memory p2 =
            _params(SentinelTemplateRegistry.RiskClass.MARKET_NEUTRAL, REDUCING_ACTIONS);
        p2.manifestHash = keccak256("manifest-v2");
        vm.prank(publisher);
        templates.commitTemplate(TID, 2, p2);

        // v1 is untouched.
        SentinelTemplateRegistry.TemplateVersion memory v1 = templates.getVersion(TID, 1);
        assertEq(v1.manifestHash, MANIFEST, "v1 manifest mutated");
        assertEq(uint8(v1.riskClass), uint8(SentinelTemplateRegistry.RiskClass.RISK_REDUCING_ONLY), "v1 risk class mutated");

        // The instance still pins v1 and v1's manifest — adopting v2 would be a fresh registration.
        SentinelInstanceRegistry.Instance memory inst = instances.getInstance(id);
        assertEq(inst.templateVersion, 1, "instance version drifted");
        assertEq(inst.manifestHash, MANIFEST, "instance manifest drifted");
    }
}
