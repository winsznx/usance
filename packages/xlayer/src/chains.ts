/**
 * X Layer network configuration.
 *
 * Every value here was verified against the live network on 2026-08-17 and the transcript is in
 * docs/INTEGRATIONS.md. RPC endpoints are overridable by environment so that no deployment is
 * pinned to a public endpoint's availability, and no repo-relative script ever hardcodes one.
 */

export const X_LAYER_MAINNET_ID = 196 as const;
export const X_LAYER_TESTNET_ID = 1952 as const;

export interface ChainConfig {
  readonly id: number;
  readonly name: string;
  readonly network: "xlayer" | "xlayer-testnet";
  readonly nativeCurrency: { name: string; symbol: string; decimals: number };
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  /** LayerZero V2 endpoint id. Verified from the LayerZero metadata service. */
  readonly layerZeroEid: number;
  readonly layerZeroEndpoint: `0x${string}`;
  readonly testnet: boolean;
}

const env = (key: string): string | undefined => {
  // Works under Node, and under a bundler that inlines process.env, without assuming either.
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[key];
};

export const xLayerMainnet: ChainConfig = {
  id: X_LAYER_MAINNET_ID,
  name: "X Layer",
  network: "xlayer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrl: env("XLAYER_RPC_URL") ?? "https://rpc.xlayer.tech",
  explorerUrl: "https://www.oklink.com/xlayer",
  layerZeroEid: 30274,
  layerZeroEndpoint: "0x1a44076050125825900e736c501f859c50fe728c",
  testnet: false,
};

export const xLayerTestnet: ChainConfig = {
  id: X_LAYER_TESTNET_ID,
  name: "X Layer Testnet",
  network: "xlayer-testnet",
  nativeCurrency: { name: "Test OKB", symbol: "OKB", decimals: 18 },
  rpcUrl: env("XLAYER_TESTNET_RPC_URL") ?? "https://testrpc.xlayer.tech",
  explorerUrl: "https://www.oklink.com/x-layer-testnet",
  layerZeroEid: 40269,
  layerZeroEndpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
  testnet: true,
};

export const chains = {
  [X_LAYER_MAINNET_ID]: xLayerMainnet,
  [X_LAYER_TESTNET_ID]: xLayerTestnet,
} as const;

export function chainById(id: number): ChainConfig | undefined {
  return chains[id as keyof typeof chains];
}

export function isXLayer(id: number | undefined): boolean {
  return id === X_LAYER_MAINNET_ID || id === X_LAYER_TESTNET_ID;
}

export function txUrl(chainId: number, hash: string): string {
  const c = chainById(chainId);
  return c ? `${c.explorerUrl}/tx/${hash}` : hash;
}

export function addressUrl(chainId: number, address: string): string {
  const c = chainById(chainId);
  return c ? `${c.explorerUrl}/address/${address}` : address;
}

/**
 * Parameters for `wallet_addEthereumChain`.
 *
 * The user never types an RPC URL or a chain id. If their wallet does not know X Layer, the app
 * adds it for them and then switches — that is the whole reason this shape is exported.
 */
export function addChainParams(c: ChainConfig) {
  return {
    chainId: `0x${c.id.toString(16)}`,
    chainName: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: [c.rpcUrl],
    blockExplorerUrls: [c.explorerUrl],
  };
}

/**
 * Chainlink Data Feed aggregators on X Layer mainnet, read back from the chain on 2026-08-17.
 *
 * Data Streams is not available on X Layer (see docs/INTEGRATIONS.md); these are the push-based
 * Data Feeds, which is what `ChainlinkFeedAdapter` consumes.
 */
export const CHAINLINK_FEEDS_XLAYER_MAINNET = {
  "ETH/USD": "0x8b85b50535551F8E8cDAF78dA235b5Cf1005907b",
  "BTC/USD": "0x4D6f6488a2B3a5f7b088f276887f608a1e9805c4",
  "USDC/USD": "0xB8a08c178D96C315FbFB5661ABD208477391BC40",
  "USDT/USD": "0xb928a0678352005a2e51F614efD0b54C9830dB80",
  "OKB/USD": "0x4Ff345b18a2bF894F8627F41501FBf30d5C5e7BE",
  "LINK/USD": "0x98aD882fCc7981B86F10D7252d334EE25BF1507f",
  "SOL/USD": "0xF959E1B5cA535C28aD24F7f672Bf1A93900810cF",
} as const satisfies Record<string, `0x${string}`>;
