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
    "deployedAt": "2026-08-18T10:26:06Z",
    "commit": "8061c06",
    "contracts": {
      "authority": "0xe0bac008cbe72365cb2078a0e61fbe90d038015f",
      "assetRegistry": "0x3c7c547b14361137743a86acf233960330febd72",
      "evidenceRegistry": "0x71dfb4568d156429ba17d1ed932bed034b898da5",
      "passportRegistry": "0xe74d232071f11f7ecabf354415820a75e19510cf",
      "riskPolicyRegistry": "0x244853b11e050d4a2b9ccff59bbed20e2a74dc65",
      "oracleAdapter": "0xbde32d075410896fbe7ca2511e693f4b2d19bee2",
      "collateralVault": "0x8ff79a624d8be744595055610d5f29382ed2decc",
      "liquidityVault": "0x9c5288238174d4ff590b036e2107520d2e6cd6d6",
      "financingEngine": "0x27edfc1ff415051cd8d8450e517e1f318ce08b69",
      "clearingHouse": "0xdd579d7204c429c3a1c4e5df7b96fc04fd09456f"
    },
    "assets": [
      {
        "assetId": "0xbcda623ae5e57bdc8f930c05289770c35a0339b71025bbbc319c3090b9adc400",
        "symbol": "tUSTB",
        "name": "USANCE TESTNET TOKENIZED T-BILL - NO REAL VALUE",
        "token": "0x00f5f35afdf8cb14ec9611a8359544e84fecb6f4",
        "decimals": 18,
        "isTestFixture": true
      }
    ],
    "settlementAsset": {
      "assetId": "0x39687f263f6e6ef2cb72199c30111de157b711c8b13971ef7c769578a3581eca",
      "symbol": "tUSD",
      "token": "0x3099073688d8d94c63f6b10532b19aa887c54677",
      "decimals": 6
    }
  },
};
