import type { VerificationMode } from "@usance/schemas";

export interface ZeroGDirectServiceConfig {
  /** Onchain Compute provider address/identifier, not a display name. */
  readonly provider: string;
  readonly model: string;
  readonly verificationMode: VerificationMode;
  /** Stable identity of the actual provider/model path used for corroboration. */
  readonly underlyingProviderModel: string;
  readonly enabled: boolean;
}

export function zeroGIndependenceGroup(config: Pick<ZeroGDirectServiceConfig, "underlyingProviderModel">): string {
  return `provider-model:${config.underlyingProviderModel.toLowerCase()}`;
}
