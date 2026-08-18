/**
 * Deployment manifest index.
 *
 * GENERATED. Rewritten by `contracts/script/Deploy.s.sol` via `make deploy-testnet`.
 *
 * The web app imports this rather than reaching for `deployments/<chainId>.json` directly, so a
 * chain with no deployment is a compile-time empty record instead of a build failure — and, more
 * importantly, so the UI can say "not deployed here" truthfully instead of rendering an empty
 * portfolio that looks like a working account with no balance.
 *
 * An entry appears here only after contracts are actually broadcast and the addresses are read
 * back from the chain.
 */

export interface DeploymentManifest {
  chainId: number;
  deployedAt: string;
  commit: string;
  contracts: Record<string, `0x${string}`>;
  assets: Array<{
    assetId: `0x${string}`;
    symbol: string;
    name: string;
    token: `0x${string}`;
    decimals: number;
    isTestFixture: boolean;
  }>;
  settlementAsset: {
    assetId: `0x${string}`;
    symbol: string;
    token: `0x${string}`;
    decimals: number;
  };
}

/** Keyed by chain id. Empty until a deployment is broadcast and verified. */
export const deployments: Record<number, DeploymentManifest> = {
  1952: {
  "chainId": 1952,
  "deployedAt": "2026-08-18T00:29:25Z",
  "commit": "75042b9",
  "contracts": {
    "authority": "0x7cc008587d34081e45b4ac25d6737ea9d4eea39e",
    "assetRegistry": "0x7e4e9806045288e306a6e855cdc4c7f69cbc147c",
    "evidenceRegistry": "0xd358d5a9e922a055d91ef4e0de57f8c5385c7199",
    "passportRegistry": "0x39a9186eb635ecd66b2c228e97b68f4d323df5da",
    "riskPolicyRegistry": "0xf9a1c9d94b9c12bddfdcac686cd0d0212d5fb9e8",
    "collateralVault": "0x5f7bc75858a85e9bc830e2bb128234e485e8d997",
    "liquidityVault": "0x0b428b18b822179a684135f555d37e3cd9e7f048",
    "financingEngine": "0xadf763ca7101f4612dbd253bf43949c831149e6f",
    "clearingHouse": "0xa2c4fbcbb37855c8d32f9641ed986eb50cd052ec",
    "oracleAdapter": "0x5570f9aea65fde40c70d78da2b9d3404729f4324"
  },
  "assets": [
    {
      "assetId": "0x5ac1b6412c624d04363b3e16f9f5640bf7a810b3d9b91fe4c740887f89aa8272",
      "symbol": "tUSTB",
      "name": "USANCE TESTNET TOKENIZED T-BILL - NO REAL VALUE",
      "token": "0x9761cea4bb4ab425a32bd5f36cb14f12ba344279",
      "decimals": 18,
      "isTestFixture": true
    }
  ],
  "settlementAsset": {
    "assetId": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "symbol": "tUSD",
    "token": "0x4c1d345400bfe1088050eed665f22f730d307b34",
    "decimals": 6
  }
} as DeploymentManifest,
};
