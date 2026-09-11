import lifecycle from "../../../docs/base/proof/base-sepolia-lifecycle.json";

/** Historical lifecycle evidence only; current finance state belongs to the Base read adapter. */
export const BASE_SEPOLIA_PROOF = {
  environment: "BASE SEPOLIA · TEST CAPITAL", proofLevel: lifecycle.proofLevel,
  facility: { id: "Base Sepolia portfolio revolving credit", contract: lifecycle.contracts.PortfolioRevolvingCredit, policy: "CANARY_PROVISIONAL", calibration: "TESTNET_CALIBRATION", settlement: "Native test USDC" },
  instruments: Object.values(lifecycle.instruments).map((instrument) => ({ symbol: instrument.symbol, id: instrument.instrumentId })),
  lifecycle: [
    { state: "Facility activated", detail: "Two synthetic B20 instruments were committed under the canary policy." },
    { state: "Draw confirmed", detail: "A test-USDC draw proved the facility lifecycle and origination-fee path." },
    { state: "Market session became unknown", detail: "A new draw was refused without guessing the existing facility state." },
    { state: "Repayment confirmed", detail: "The recorded test lifecycle repaid its draw in full." },
    { state: "Safe withdrawal confirmed", detail: "A collateral withdrawal occurred only after the facility was safe." },
  ],
  evidence: { lifecycle: "/docs/base/proof/base-sepolia-lifecycle.json", explorer: `https://sepolia.basescan.org/address/${lifecycle.contracts.PortfolioRevolvingCredit}` },
} as const;

export const BASE_SEPOLIA_DEPLOYMENT = {
  chainId: lifecycle.chainId,
  facility: lifecycle.contracts.PortfolioRevolvingCredit as `0x${string}`,
  policyRegistry: lifecycle.contracts.PortfolioRiskPolicyRegistry as `0x${string}`,
  vault: lifecycle.contracts.ScaledCollateralVault as `0x${string}`,
  instruments: Object.values(lifecycle.instruments).map((instrument) => ({ id: instrument.instrumentId as `0x${string}`, symbol: instrument.symbol })),
} as const;
