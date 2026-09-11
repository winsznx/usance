# 0G capability matrix

Re-verified 2026-09-09 against the current [0G inference documentation](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference) and [Storage SDK documentation](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk). Provider catalog, price, health, and attestations are dynamic; this document is not a provider allowlist.

| Capability | Official primitive / SDK | Environment | Trust guarantee | Does not prove | Credential / funding | Failure mode | Usance use | Proof level |
|---|---|---|---|---|---|---|---|---|
| Direct inference | `@0gfoundation/0g-compute-ts-sdk`; `listService`, signed provider requests | 0G testnet or mainnet | Binds work to configured provider/model route when response proof is verified | Claim correctness or financial eligibility | Wallet, 0G ledger, provider subaccount | No extraction; no new privilege | Default evidence extraction route | UNIT_TESTED adapter |
| Router inference | Router API, unified balance, automatic failover | 0G testnet or mainnet | Honest Router provenance when surfaced | Fixed underlying provider identity / independence | Router account/API key | Read-only explanation may be unavailable | Deferred; never money-adjacent extraction | NOT_YET_PROVEN |
| TeeML | Provider-declared service verification mode | Provider-specific | Model and computation execute in TEE; TEE signs response | Document truth, semantic correctness, Passport admission | Depends on Direct service | Reject/record unavailable or invalid evidence | Recorded precisely in provenance | NOT_YET_PROVEN live |
| TeeTLS | Provider-declared service verification mode | Provider-specific | TEE broker authenticates provider TLS connection and signs provider identity plus request/response hashes | That remote output is correct | Depends on Direct service | Reject/record unavailable or invalid evidence | Recorded precisely in provenance | NOT_YET_PROVEN live |
| Service verification | `broker.inference.verifyService()` | Provider-specific | Automated signer-address and Docker Compose-hash checks | Full TEE verification, image integrity, claim truth | Provider reachable; manual verification tools for fuller review | Route unavailable/restricted | Evidence provenance status only | NOT_YET_PROVEN live |
| Storage upload/download | `@0gfoundation/0g-storage-ts-sdk`; upload root, download with proof | 0G testnet or mainnet | Root/proof binds retrieved bytes to stored commitment | Legal validity, freshness, or truth of content | Wallet/signer and storage network costs | Archive unavailable; primary evidence remains unchanged | Optional public Evidence Vault | UNIT_TESTED adapter |

## Direct versus Router

Usance uses **Direct** for evidence intelligence. The extractor configuration pins provider, model,
verification mode, and a provider/model independence identity. Router is intentionally excluded from
financially material evidence flow because failover can obscure the actual underlying provider. It
may later serve Ask Usance only as a read-only explanation path with Router provenance shown.

## Verification vocabulary

- **TeeML**: TEE execution/signature claim, not a claim that the extraction is correct.
- **TeeTLS**: TEE broker/TLS-routing integrity claim, not a claim that the remote provider answer is true.
- **`verifyService()`**: current automated signer and Compose-hash checks. The official docs require
  manual sigstore image-integrity and dstack quote checks for fuller TEE assessment.
- **Storage root**: commitment to archived bytes, not legal or financial truth.

No status in this table is a financial authorization.
