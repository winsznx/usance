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
    "deployedAt": "2026-08-18T12:09:40Z",
    "commit": "365eee5",
    "contracts": {
      "authority": "0x218b23ca83dcaba6f94fb82e0aed929fb0786590",
      "assetRegistry": "0x4f32fdc794f87af9c5436276936f0cefdc208c3f",
      "evidenceRegistry": "0xf88bdcabc98954c0c535bc2bedb3b7019267e292",
      "passportRegistry": "0x28221789a6c9352f0e1c73e619b796cfc23c15f7",
      "riskPolicyRegistry": "0x2056ab844f6e3bd6adbc6b300081c8c762de57fc",
      "oracleAdapter": "0xdc5bc167d570506cb09a2c1fbc6262383535e1a0",
      "collateralVault": "0xd1bde1b08e1007969174f251ada691a45a7c39a8",
      "liquidityVault": "0xc83d9dd8de24c2d99a5a0b1b7755a9de0455bffd",
      "financingEngine": "0x47b14f63a886bd7cd680ac9f4b61b39a4aa2f865",
      "clearingHouse": "0x5a50ddb60d93ff0acbac81a2f6589dbb5150e7ec"
    },
    "assets": [
      {
        "assetId": "0x80149cb9a489394022ab31867ddc408ced556d491821ee3065a6a3b1c5f9db2e",
        "symbol": "tUSTB",
        "name": "USANCE TESTNET TOKENIZED T-BILL - NO REAL VALUE",
        "token": "0x093c0c957ebf8cd7ceaf388cc9ab02e7580b8529",
        "decimals": 18,
        "isTestFixture": true
      }
    ],
    "settlementAsset": {
      "assetId": "0x60efbe82b1a03aa01bfe43ba9ee59aaf579bc321c6b91b9c285f50cab19afeed",
      "symbol": "tUSD",
      "token": "0x44ba9fdc97cbed8767f6ea027fc26cf440c4c8e9",
      "decimals": 6
    }
  },
};
