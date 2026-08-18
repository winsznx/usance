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
    "deployedAt": "2026-08-18T21:01:55Z",
    "commit": "1263f50",
    "contracts": {
      "authority": "0x0210bb312ac9b4e97608c50a60fcf7dcc5c51df3",
      "assetRegistry": "0x5d6dfcd68ca2d9b46f11e962cb3a3416c289695e",
      "evidenceRegistry": "0x3f3221e784b447ca507b18d542f0045bbd989ae2",
      "passportRegistry": "0x6a7cd1c819d37fa8694bb37986975d3113bcc0a9",
      "riskPolicyRegistry": "0xcc099f3b6bdb0e3d326f36451170336f655e5d0d",
      "oracleAdapter": "0xf3e28618b09d407b08a4faca619f4c809c584320",
      "collateralVault": "0x56d3adae6288cdef02302cc5516cc0f6332ea004",
      "liquidityVault": "0x3cfa6cc61a0f4c3494d514d9c83433c22c6c7264",
      "financingEngine": "0xc93642fe6199f48ce1490b81c36013335e509a00",
      "clearingHouse": "0x2684f427b4c485736039709519a6b87cd271fcf0",
      "feeController": "0xc2b91a850cf70add019c23bda3e5a04e97f5f0e5"
    },
    "assets": [
      {
        "assetId": "0xa79f06b2e84b1d15736003bcc6acdd7bb31736bef6adf0e6577e63c7a221bb23",
        "symbol": "tUSTB",
        "name": "USANCE TESTNET TOKENIZED T-BILL - NO REAL VALUE",
        "token": "0xb5b0cdb568bbb73d8091fceb1931d7f25de1b00a",
        "decimals": 18,
        "isTestFixture": true
      }
    ],
    "settlementAsset": {
      "assetId": "0xfb98b7d06d7a4f85087a974212a1ac77a0acf14dcd673573562db7aaf0dce1cd",
      "symbol": "tUSD",
      "token": "0x18837a706f350f7d8f7895594936fa58f74b1b9e",
      "decimals": 6
    }
  },
};
