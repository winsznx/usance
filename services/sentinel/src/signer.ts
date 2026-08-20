import type { EvmAddress } from "@usance/schemas";

/**
 * The signer boundary. `address()` and (in a real adapter) a sign call are the only things that
 * cross it — never a raw key into stores, logs, workflow payloads or env-per-user. Each instance's
 * executor is a bounded delegated identity the owner's mandate names, so even a fully compromised
 * key is confined to the mandate's verbs, caps and expiry (`docs/SENTINELS_ARCHITECTURE.md §10`).
 */
export interface SignerProvider {
  readonly label: string;
  /** True when this provider cannot operate yet because real credentials are absent. */
  readonly accessRequired?: boolean;
  address(): Promise<EvmAddress>;
}

/** In-memory key for deterministic tests only; refuses a production chain so it never signs value. */
export class LocalTestSigner implements SignerProvider {
  readonly label = "local-test-signer";
  constructor(
    private readonly addr: EvmAddress,
    chainId: number,
  ) {
    if (chainId === 1 || chainId === 196) throw new Error("LocalTestSigner refuses a production chain id");
  }
  async address(): Promise<EvmAddress> {
    return this.addr;
  }
}

/** The testnet-operations signer: the key lives in a gitignored env var, read only at sign time. */
export class EnvKeySigner implements SignerProvider {
  readonly label = "env-key-signer";
  constructor(
    private readonly addr: EvmAddress,
    private readonly envVar = "SENTINEL_AGENT_KEY",
  ) {}
  async address(): Promise<EvmAddress> {
    if (!process.env[this.envVar]) throw new Error(`${this.envVar} is not set`);
    return this.addr;
  }
  /** Redacts itself in any dump — the key never appears in a log or a serialized payload. */
  toJSON(): Record<string, string> {
    return { label: this.label, address: this.addr, key: "[redacted]" };
  }
}

/** The production shape: a sign-only KMS/HSM service. Declared, not faked, until credentials exist. */
export class KmsSignerProvider implements SignerProvider {
  readonly label = "kms-signer";
  readonly accessRequired = true;
  constructor(private readonly addr: EvmAddress) {}
  async address(): Promise<EvmAddress> {
    return this.addr;
  }
}
