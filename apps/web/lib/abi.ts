/**
 * Contract ABIs, hand-written as viem const tuples.
 *
 * Deliberately not generated from Foundry output. The web app only ever calls a small, stable
 * subset of the protocol surface, and a generated ABI dump would pull hundreds of unused entries
 * into the bundle while making it harder to see at a glance what the front end is actually
 * allowed to do. Every entry here is a deliberate decision that the UI may touch this function.
 *
 * There are no write functions for anything a mandate could not authorise, and no admin
 * functions at all. The front end cannot reach guardian or governance surfaces even by accident.
 */

export const clearingHouseAbi = [
  {
    type: "function",
    name: "accountHealth",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "totalRecognizedUsd18", type: "uint256" },
          { name: "borrowLimitUsd18", type: "uint256" },
          { name: "maintenanceLimitUsd18", type: "uint256" },
          { name: "liquidationLimitUsd18", type: "uint256" },
          { name: "debtUsd18", type: "uint256" },
          { name: "availableBorrowUsd18", type: "uint256" },
          { name: "healthFactorWad", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "gates", type: "uint32" },
        ],
      },
      {
        name: "vals",
        type: "tuple[]",
        components: [
          { name: "assetId", type: "bytes32" },
          { name: "marketValueUsd18", type: "uint256" },
          { name: "haircutMarkUsd18", type: "uint256" },
          { name: "stressedExitUsd18", type: "uint256" },
          { name: "redemptionFloorUsd18", type: "uint256" },
          { name: "recognizedUsd18", type: "uint256" },
          { name: "cappedUsd18", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "availableBorrow",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "amountUsd18", type: "uint256" },
      { name: "limitedByLiquidity", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "heldAssets",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "debtOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "reservedOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxWithdrawable",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "assetId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "addCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    // expectedEpoch is not optional in spirit. The UI always passes the epoch it quoted under so
    // a policy change between preview and signature reverts instead of silently repricing.
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountUsd18", type: "uint256" },
      { name: "expectedEpoch", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountUsd18", type: "uint256" },
      { name: "repayAll", type: "bool" },
    ],
    outputs: [{ name: "applied", type: "uint256" }],
  },
  // Errors are decoded so the UI can show the protocol's own reason and exact maximum rather
  // than "transaction reverted".
  {
    type: "error",
    name: "RiskLimitExceeded",
    inputs: [
      { name: "requested", type: "uint256" },
      { name: "maximum", type: "uint256" },
    ],
  },
  { type: "error", name: "AccountNotHealthy", inputs: [{ name: "status", type: "uint8" }] },
  {
    type: "error",
    name: "WithdrawWouldBreachMaintenance",
    inputs: [{ name: "maxSafe", type: "uint256" }],
  },
  {
    type: "error",
    name: "StaleRiskEpoch",
    inputs: [
      { name: "expected", type: "uint64" },
      { name: "got", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "InsufficientProtocolLiquidity",
    inputs: [
      { name: "available", type: "uint256" },
      { name: "requested", type: "uint256" },
    ],
  },
  { type: "error", name: "AssetNotCollateral", inputs: [{ name: "assetId", type: "bytes32" }] },
  { type: "error", name: "ReservationOutstanding", inputs: [] },
  { type: "error", name: "NoDebt", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
] as const;

export const riskPolicyRegistryAbi = [
  {
    type: "function",
    name: "riskEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

export const passportRegistryAbi = [
  {
    type: "function",
    name: "currentVersion",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "effectiveStatus",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "getCurrentPassport",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "passportId", type: "bytes32" },
          { name: "assetId", type: "bytes32" },
          { name: "version", type: "uint64" },
          { name: "evidenceRoot", type: "bytes32" },
          { name: "claimsRoot", type: "bytes32" },
          { name: "createdAt", type: "uint64" },
          { name: "expiresAt", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "redemptionSupported", type: "bool" },
          { name: "redemptionFloorBps", type: "uint16" },
          { name: "singleSource", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const collateralVaultAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const liquidityVaultAbi = [
  {
    type: "function",
    name: "availableCash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "utilizationBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxWithdraw",
    stateMutability: "view",
    inputs: [{ name: "lender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "badDebt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalPrincipal",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "error",
    name: "InsufficientCash",
    inputs: [
      { name: "available", type: "uint256" },
      { name: "requested", type: "uint256" },
    ],
  },
] as const;

export const financingEngineAbi = [
  {
    type: "function",
    name: "currentRateBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "debtOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
