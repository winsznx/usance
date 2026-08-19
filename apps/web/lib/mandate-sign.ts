import { detectProvider, WalletError } from "./wallet";
import { activeChain } from "./deployments";
import { maskFor, type MandateActionName } from "./mandate";

/**
 * Signing a mandate, in the browser.
 *
 * `eth_signTypedData_v4` rather than a personal-sign of a precomputed digest. That distinction has
 * already cost this repository a debugging session: `personal_sign` prefixes the payload with
 * EIP-191, so the recovered address comes out as somebody else entirely and `registerMandate`
 * reverts with a signature that looks perfectly well-formed.
 *
 * Typed data also means the wallet renders the fields. A user approving a mandate should see the
 * agent, the ceilings and the expiry in their wallet, not a hash — the wallet is the last surface
 * between them and a delegation they may not have intended.
 */

/**
 * The domain, exactly as `MandateRegistry`'s constructor declares it:
 * `EIP712("Usance Mandate", "1")`.
 *
 * Not "Usance". The first version of this file used the shorter name, which produces a signature
 * that verifies as well-formed and recovers to an address nobody controls — `registerMandate`
 * reverts and the failure looks like a wallet fault rather than a two-word typo. Pinned by a test
 * against the contract source.
 */
export const EIP712_DOMAIN_NAME = "Usance Mandate";
export const EIP712_DOMAIN_VERSION = "1";

export const MANDATE_TYPES = {
  Mandate: [
    { name: "owner", type: "address" },
    { name: "agent", type: "address" },
    { name: "accountId", type: "bytes32" },
    { name: "validFrom", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "maxDebtUsd", type: "uint256" },
    { name: "maxTradeNotionalUsd", type: "uint256" },
    { name: "maxEffectiveLeverageBps", type: "uint16" },
    { name: "maxSlippageBps", type: "uint16" },
    { name: "allowedActions", type: "uint16" },
    { name: "requiredPassportFreshness", type: "uint64" },
    { name: "allowedAssetsRoot", type: "bytes32" },
    { name: "allowedVenuesRoot", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface MandateDraft {
  owner: `0x${string}`;
  agent: `0x${string}`;
  accountId: `0x${string}`;
  validFrom: number;
  expiresAt: number;
  maxDebtUsd: bigint;
  maxTradeNotionalUsd: bigint;
  maxEffectiveLeverageBps: number;
  maxSlippageBps: number;
  allowedActions: number;
  requiredPassportFreshness: number;
  allowedAssetsRoot: `0x${string}`;
  allowedVenuesRoot: `0x${string}`;
  nonce: bigint;
}

export function draftFrom(input: {
  owner: `0x${string}`;
  agent: `0x${string}`;
  accountId: `0x${string}`;
  actions: readonly MandateActionName[];
  maxDebtUsd: bigint;
  durationDays: number;
  assetsRoot: `0x${string}`;
  now?: number;
}): MandateDraft {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  return {
    owner: input.owner,
    agent: input.agent,
    accountId: input.accountId,
    // Backdated by a minute. A mandate that becomes valid at exactly the timestamp it was signed at
    // is refused by any node whose clock is a second behind, which is most of them.
    validFrom: now - 60,
    expiresAt: now + input.durationDays * 86_400,
    maxDebtUsd: input.maxDebtUsd,
    maxTradeNotionalUsd: 0n,
    maxEffectiveLeverageBps: 30_000,
    maxSlippageBps: 50,
    allowedActions: maskFor(input.actions),
    requiredPassportFreshness: 7 * 86_400,
    allowedAssetsRoot: input.assetsRoot,
    allowedVenuesRoot: input.assetsRoot,
    // Derived from the signing moment so two mandates signed in the same session cannot collide.
    // The nonce is burned on registration, which is what makes replay impossible.
    nonce: BigInt(now),
  };
}

export class SignatureRejected extends Error {
  readonly code = "REJECTED";
  constructor() {
    super("You declined the signature in your wallet. Nothing was created and nothing changed.");
    this.name = "SignatureRejected";
  }
}

const isRejection = (e: unknown): boolean => {
  const code = (e as { code?: number })?.code;
  const msg = String((e as Error)?.message ?? "").toLowerCase();
  return code === 4001 || msg.includes("user rejected") || msg.includes("user denied");
};

export async function signMandate(
  draft: MandateDraft,
  verifyingContract: `0x${string}`,
): Promise<`0x${string}`> {
  const { provider } = detectProvider();
  if (!provider) throw new WalletError("No wallet is connected.", "NO_PROVIDER");

  const chain = activeChain();
  const payload = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...MANDATE_TYPES,
    },
    primaryType: "Mandate",
    // The domain is what binds this signature to this contract on this chain. The same typed data
    // signed for another chain recovers to nothing here, which is the point.
    domain: { name: EIP712_DOMAIN_NAME, version: EIP712_DOMAIN_VERSION, chainId: chain.id, verifyingContract },
    message: {
      ...draft,
      maxDebtUsd: draft.maxDebtUsd.toString(),
      maxTradeNotionalUsd: draft.maxTradeNotionalUsd.toString(),
      nonce: draft.nonce.toString(),
    },
  };

  try {
    return (await provider.request({
      method: "eth_signTypedData_v4",
      params: [draft.owner, JSON.stringify(payload)],
    })) as `0x${string}`;
  } catch (e) {
    if (isRejection(e)) throw new SignatureRejected();
    throw e;
  }
}

export const REGISTRY_WRITE_ABI = [
  {
    name: "registerMandate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple",
        components: MANDATE_TYPES.Mandate.map((f) => ({ name: f.name, type: f.type })),
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "pauseMandate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "resumeMandate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "revokeMandate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "bytes32" }, { name: "reason", type: "bytes32" }],
    outputs: [],
  },
] as const;
