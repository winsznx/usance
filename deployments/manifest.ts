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
    "deployedAt": "2026-08-18T22:49:42Z",
    "commit": "cf08fa1",
    "contracts": {
      "authority": "0x263c72eabe2d0d323ea9dce71c80c75f673d5a38",
      "assetRegistry": "0x70d4fcd5414ed20538f1778f7028dc949409958d",
      "evidenceRegistry": "0xdba478bef267df507bd0726d54ac5daa0177ffdf",
      "passportRegistry": "0x3d5ce1e17451134e6748b896e6f0ab1dbae0cd50",
      "riskPolicyRegistry": "0xc1e338ab59b450738108e8643ea73e2696c8d552",
      "oracleAdapter": "0x11d4a1ed14f8883a6ca40ff01d9543cd7cc09ebc",
      "collateralVault": "0x68a29192aeac5415d991b0f72edf1ded135bcb7a",
      "liquidityVault": "0xf5a5ca0981c575a2a49e016ea7d0f69c67dd1771",
      "financingEngine": "0x002fc00ca45afd710ad333e4375402bb55e19327",
      "clearingHouse": "0xa38c072f7970d70f00c5ad9b911c222357255cc0",
      "feeController": "0x44fe9a83186c4c9fc20f14342b10b59861ad1961",
      "mandateRegistry": "0x71dd68dfc114be35d5fdb524aa21b9d699e9cf5b",
      "delegationGateway": "0x1fe2f202d0ce10d20f3a8470c4cab51d45993659",
      "intentBook": "0x35eaa2f92045eb6ced6817a296a7ddf701854442"
    },
    "assets": [
      {
        "assetId": "0x61745a589d0f9875ca3eaeae7588162918edea2e1e85670ff4703c9d75a140d8",
        "symbol": "tUSTB",
        "name": "USANCE TESTNET TOKENIZED T-BILL - NO REAL VALUE",
        "token": "0x17837c668aa0aba07b0e9129a7f849afb9c73c9b",
        "decimals": 18,
        "isTestFixture": true
      }
    ],
    "settlementAsset": {
      "assetId": "0xa2ef679d6d8194d6529915001547d13c39dc85b4b680673a909c408acf7b553f",
      "symbol": "tUSD",
      "token": "0x14494c714cb18f24a5fe68c6136203781abb2676",
      "decimals": 6
    }
  },
};
