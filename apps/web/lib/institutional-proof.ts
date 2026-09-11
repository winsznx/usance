import deployment from "../../../docs/ethonline-2026/proof/hedera-facility-deployment.json";
import positive from "../../../docs/ethonline-2026/proof/hedera-substitution-positive.json";
import negative from "../../../docs/ethonline-2026/proof/hedera-substitution-negative.json";
import ens from "../../../docs/ethonline-2026/proof/ensv2-authority.json";
import privy from "../../../docs/ethonline-2026/proof/privy-org-signer.json";
import cre from "../../../docs/ethonline-2026/proof/cre-workflow.json";

/**
 * The institutional read model is projected only from generated Phase 07 proof artifacts. It does
 * not represent a browser session, an operator key, or a current write authority.
 */
export const HEDERA_FACILITY = {
  id: deployment.facilityId,
  type: "TERM_SECURED_CREDIT",
  homeDomain: "Hedera testnet (296)",
  proofLevel: "LIVE_TESTNET",
  status: "ACTIVE",
  controller: deployment.contracts.InstitutionalFacility,
  borrower: deployment.terms.borrower,
  lender: deployment.terms.lender,
  settlement: { token: deployment.terms.settlementToken, decimals: deployment.terms.settlementDecimals, label: "Test USD" },
  riskEpoch: "Not emitted by the preserved public proof artifact",
  maturityAt: Number(deployment.terms.maturityAt),
  initialCollateral: { series: "A", ...deployment.atsSecurities.A, committed: positive.collateralBefore.A },
  currentCollateral: { series: "B", ...deployment.atsSecurities.B, committed: positive.collateralAfter.B },
  pausedCandidate: { series: "C", ...deployment.atsSecurities.C },
  proof: {
    deployment: "/docs/ethonline-2026/proof/hedera-facility-deployment.json",
    positive: "/docs/ethonline-2026/proof/hedera-substitution-positive.json",
    negative: "/docs/ethonline-2026/proof/hedera-substitution-negative.json",
  },
} as const;

export const SUCCESSFUL_SUBSTITUTION = {
  proofLevel: "LIVE_TESTNET",
  before: positive.collateralBefore,
  committed: positive.collateralMid,
  after: positive.collateralAfter,
  steps: [
    "REQUESTED",
    "ENS AUTHORITY RESOLVED",
    "PRIVY ORGANIZATION APPROVED",
    "CRE POLICY ALLOWED",
    "REPLACEMENT COMMITTING",
    "REPLACEMENT COMMITTED",
    "OLD COLLATERAL RELEASED",
    "ACTIVE",
  ],
  result: positive.result,
} as const;

export const AUTHORITY_PROOFS = {
  ens: {
    provider: "ENSv2",
    proofLevel: "LIVE_TESTNET",
    name: ens.name,
    resource: ens.resource,
    role: ens.roleNames.join(" + "),
    observedBlock: ens.authorityEvidence.sepoliaBlock,
    currentStatus: "REVOKED_AFTER_PROOF",
    limitation: "The original role evidence was live for the completed operation. A later revoke blocks new substitutions; it does not reverse settled Hedera state.",
  },
  privy: {
    provider: "Privy",
    proofLevel: "EXTERNAL_INTEGRATION",
    wallet: privy.walletAddress,
    quorum: `${privy.authorizationThreshold}-key quorum`,
    limitation: "The browser does not hold quorum keys or create approval signatures.",
  },
  cre: {
    provider: "Chainlink CRE",
    proofLevel: "LIVE_SIMULATION",
    decision: cre.probeVerdict.Allow ? "ELIGIBLE" : "NOT ELIGIBLE",
    policyCommitment: cre.policyCommitment,
    workflowVersion: cre.workflowVersion,
    limitation: "The private policy remains confidential. The current proof is a CRE workflow simulation, not a deployed DON workflow.",
  },
} as const;

export const REFUSED_SUBSTITUTION = {
  proofLevel: "LIVE_TESTNET",
  reason: "ATS security series C is paused",
  currentCollateral: negative.collateralAfter.current,
  candidateCollateral: negative.collateralAfter.C,
  facilityStatus: "ACTIVE",
  result: negative.result,
} as const;
