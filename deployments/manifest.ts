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
    "deployedAt": "2026-08-18T18:50:54Z",
    "commit": "0598ada",
    "contracts": {
      "authority": "0x7a92492c75407da10991a28560a2b702d72bfd47",
      "assetRegistry": "0xa86391b3f9af2ffdf4c8a9b21fb7240811fec001",
      "evidenceRegistry": "0xdfefd3538607f101b6b69489e96031adf7ac625c",
      "passportRegistry": "0x025348efb707b6412ffed7ce2e2d051e43d05903",
      "riskPolicyRegistry": "0x09bb9d58a6b4d809e547cd6daa253cc2ee26edbc",
      "oracleAdapter": "0x9b17e22b304a062b8df1f818fc4959e98a35bfae",
      "collateralVault": "0xe21ba93ab55d7631149fbd3ae20f918b12e9fc78",
      "liquidityVault": "0xb73468eeeccd90f5a09ee9f181e89513a2c288c0",
      "financingEngine": "0x4dc91fc82d04b664c7db5ff2b3a26ef93e2531c2",
      "clearingHouse": "0xb150fd3c5742586501bb2f3211d99f7c0d50f2bc",
      "feeController": "0xfe09a3fa589844ebe16d86da6b5e825def282d56"
    },
    "assets": [
      {
        "assetId": "0x2c54a8b0eab42df4b6f1da755c752d46181c434059b51d75b8d14271926250d5",
        "symbol": "tUSTB",
        "name": "USANCE TESTNET TOKENIZED T-BILL - NO REAL VALUE",
        "token": "0x3569027dfde0ab37da298c201ea9ab1aeccee88b",
        "decimals": 18,
        "isTestFixture": true
      }
    ],
    "settlementAsset": {
      "assetId": "0x03f9da84d11b079ed68b889035df547d0825da7efddf28de9c0d67d3e0dbb6cd",
      "symbol": "tUSD",
      "token": "0xc75f87e2205728a4897336efea0d783b4c07a794",
      "decimals": 6
    }
  },
};
