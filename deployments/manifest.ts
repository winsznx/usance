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
    "deployedAt": "2026-08-18T08:51:44Z",
    "commit": "c80523d",
    "contracts": {
      "authority": "0xccb67640f19c51ea1bb11592e1d453a7619981a9",
      "assetRegistry": "0x04c88b13d613c90823f8819421599b2f5e0d4b63",
      "evidenceRegistry": "0xfc07686b469667736142b5866dcb7dc51438e8cf",
      "passportRegistry": "0x9515918cc03e7cae64fa18d82b0785352fdbc68a",
      "riskPolicyRegistry": "0xacb8991282946b3199ee1dbc5b3aa0a4af66e010",
      "oracleAdapter": "0xe9a846636157c6b06fecdac0036334e37dcca57a",
      "collateralVault": "0x7dda63a51e2f70dfdc892de400781bcf15761a03",
      "liquidityVault": "0xf9c9b43306e3196d5b8e6bd788cb78b811e975d7",
      "financingEngine": "0x58cec150b122493c0371ed83761c93dbcad1b581",
      "clearingHouse": "0x7178ffe6acb6b7765d44ce7ad4640e3e13a646f1"
    },
    "assets": [
      {
        "assetId": "0xa626617d2c3a856c63c9861f740cb6bf21e19902577475d16cc27f418e57e01f",
        "symbol": "tUSTB",
        "name": "USANCE TESTNET TOKENIZED T-BILL - NO REAL VALUE",
        "token": "0x5afb92b98435d5e6c5287d0e18e1a8300f5e3ee1",
        "decimals": 18,
        "isTestFixture": true
      }
    ],
    "settlementAsset": {
      "assetId": "0x19b6638a953289fbe46f75b0e26d905824c3fc26b873eeadc096f7dd5e27004f",
      "symbol": "tUSD",
      "token": "0xd4cdaa20b30be672d68679789afc428f568d5605",
      "decimals": 6
    }
  },
};
