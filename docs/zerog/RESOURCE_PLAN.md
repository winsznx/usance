# 0G resource plan

Status: **no wallet or funds requested; no live call made.**

The selected future path is 0G Compute **Direct** against one pinned chat provider/model on the
network selected by the operator. The current inference docs state that Direct requires a wallet
with 0G, creates/funds a ledger, and uses a separate per-provider inference subaccount. They state
an initial ledger deposit minimum of **3 0G** and a **1 0G** minimum locked provider balance; live
provider pricing/availability must be read from `listService()` immediately before funding.

| Resource | Exact purpose | Needed now? | Operator check before enabling |
|---|---|---:|---|
| 0G testnet wallet | Signed Direct test inference and provider subaccount | No | Network RPC, account, provider address, model, current price |
| Testnet 0G | Initial ledger + provider subaccount | No | Confirm current testnet faucet/funding instructions and live minimum |
| 0G mainnet wallet / 0G | Production Direct extraction | No | Separate controlled wallet, budget cap, provider/model allowlist, service verification report |
| Storage signer / balance | Optional approved-public archive | No | Rights classification, selected Turbo/Standard network, upload cost, retention/retrieval test |

When a live probe is authorized, the required configuration is deliberately narrow: network/RPC,
selected provider address, model identifier, verification mode, and a signer sourced from the
operator's secret manager. No private key belongs in chat or in the repository. The adapter does not
invent environment-variable names before the official SDK wiring and deployment environment are
chosen.
