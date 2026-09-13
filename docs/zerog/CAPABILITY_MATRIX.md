# 0G capability matrix

Re-verified 2026-09-09 against the current [0G inference documentation](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference) and [Storage SDK documentation](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk). Provider catalog, price, health, and attestations are dynamic; this document is not a provider allowlist.

| Capability | Official primitive / SDK | Environment | Trust guarantee | Does not prove | Credential / funding | Failure mode | Usance use | Proof level |
|---|---|---|---|---|---|---|---|---|
| Direct inference | `@0gfoundation/0g-compute-ts-sdk`; `listService`, signed provider requests | 0G testnet or mainnet | Binds work to configured provider/model route when response proof is verified | Claim correctness or financial eligibility | Wallet, 0G ledger, provider subaccount | No extraction; no new privilege | Default evidence extraction route | UNIT_TESTED adapter |
| Router inference | Router API (`https://router-api.0g.ai/v1`, OpenAI-compatible), unified USD balance | 0G mainnet (this account's balance) | Per-response `x_0g_trace.provider` names the actual onchain provider address that served the call | Fixed provider identity across a *future* failover — only this response's provider is known | Router account/API key (`ZEROG_ROUTER_API_KEY`) | ROUTER_NOT_CONFIGURED / ROUTER_UNAVAILABLE / MALFORMED_RESPONSE, reported explicitly, never silently degraded | Ask Usance read-only explanation only; never money-adjacent extraction | **LIVE_READ_ONLY** — proven 2026-09-13 with a real HTTP 200 call, model `0gm-1.0-35b-a3b`, provider `0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9` |
| TeeML | Provider-declared service verification mode | Provider-specific | Model and computation execute in TEE; TEE signs response | Document truth, semantic correctness, Passport admission | Depends on Direct service | Reject/record unavailable or invalid evidence | Recorded precisely in provenance | NOT_YET_PROVEN live |
| TeeTLS | Provider-declared service verification mode | Provider-specific | TEE broker authenticates provider TLS connection and signs provider identity plus request/response hashes | That remote output is correct | Depends on Direct service | Reject/record unavailable or invalid evidence | Recorded precisely in provenance | NOT_YET_PROVEN live |
| Service verification | `broker.inference.verifyService()` | Provider-specific | Automated signer-address and Docker Compose-hash checks | Full TEE verification, image integrity, claim truth | Provider reachable; manual verification tools for fuller review | Route unavailable/restricted | Evidence provenance status only | NOT_YET_PROVEN live |
| Storage upload/download | `@0gfoundation/0g-storage-ts-sdk`; upload root, download with proof | 0G testnet or mainnet | Root/proof binds retrieved bytes to stored commitment | Legal validity, freshness, or truth of content | Wallet/signer and storage network costs | Archive unavailable; primary evidence remains unchanged | Optional public Evidence Vault | UNIT_TESTED adapter |

## Direct versus Router

Usance uses **Direct** for evidence intelligence — not yet live; see the Direct row above
(`UNIT_TESTED adapter`, no SDK installed, no wallet funded as of this writing). Router is
intentionally excluded from financially material evidence flow because failover can obscure the
actual underlying provider across separate calls. It now serves exactly one live product surface:
**Ask Usance** (`/api/ask-usance`), a read-only explanation endpoint over existing Usance facility
state. Every Router response's `x_0g_trace.provider` is surfaced to the caller as evidence, and a
financial-action pattern check runs against both the incoming question and the model's own answer
— either one matching produces `REFUSED_FINANCIAL_REQUEST` rather than an answer. Ask Usance has no
wallet, no signature path, and no way to mutate any Usance state; it can only return text.

A live 0G Foundation model (`0gm-1.0-35b-a3b`) defaults to visible "thinking" (a `reasoning_content`
field) before its final answer, and a token budget that's too small returns `finish_reason: "length"`
with an *empty* final `content` — confirmed live at 200, 700, and 1200 max_tokens before 3000
reliably produced a real answer. The client treats empty final content as `MALFORMED_RESPONSE`,
never as a fabricated answer built from the reasoning trace.

## Verification vocabulary

- **TeeML**: TEE execution/signature claim, not a claim that the extraction is correct.
- **TeeTLS**: TEE broker/TLS-routing integrity claim, not a claim that the remote provider answer is true.
- **`verifyService()`**: current automated signer and Compose-hash checks. The official docs require
  manual sigstore image-integrity and dstack quote checks for fuller TEE assessment.
- **Storage root**: commitment to archived bytes, not legal or financial truth.

No status in this table is a financial authorization.
