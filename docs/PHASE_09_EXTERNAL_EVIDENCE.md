# Phase 09 external evidence — 2026-09-08

This is a read-only evidence record. It admits no asset and authorizes no transaction.

## Circle / CCTP reconciliation

Classification: **CCTP_V2_LIVE (mainnet), with stale registry discovery**.

Circle's current X Layer product page and its August 6, 2026 launch announcement both state that
native USDC and CCTP are live on X Layer. They identify the Circle-issued USDC contracts as:

| Environment | Native USDC | Status |
| --- | --- | --- |
| X Layer mainnet (`196`) | `0xB6CEceAB302E2E4948951eE7843FC24E92933061` | Circle-confirmed |
| X Layer testnet (`1952`) | `0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3` | Circle-confirmed |
| Mainnet bridged USDC | `0x74b7f16337b8972027f6196a17a631ac6de26d22` | explicitly non-native |

The older CCTP supported-domain and contract-address documentation snapshots queried during Phase
09 omit X Layer. Those snapshots predate the August launch and must not override the newer Circle
product/launch sources. Exact `TokenMessengerV2` and `MessageTransmitterV2` addresses were not
discoverable from Circle's current public contract-address table at this capture; this is a
**contract-discovery gap**, not evidence that CCTP is unavailable. No CCTP adapter is built because
cross-domain cash movement is not part of the xStocks facility lifecycle.

Sources:

- https://www.circle.com/blog/now-available-native-usdc-cctp-on-x-layer
- https://www.circle.com/multi-chain-usdc/xlayer
- https://developers.circle.com/cctp/concepts/supported-chains-and-domains (stale/omits post-launch X Layer entry at capture)
- https://developers.circle.com/cctp/references/contract-addresses (stale/omits post-launch X Layer entry at capture)

## Issuer-confirmed xStocks candidate

Candidate: **NVIDIA xStock (`NVDAx`)**.

| Field | Value |
| --- | --- |
| Issuer API asset id | `0997ed45-6a34-4f26-be92-28d8e0f9f28a` |
| Product / ISIN | NVIDIA xStock / `CH1436219195` |
| Underlying reference | NVIDIA / `US67066G1040` |
| X Layer token | `0xc845b2894dbddd03858fd2d643b4ef725fe0849d` |
| Current wrapper (v2) | `0xa8ddb5cd96b5222afe198316e9a57caa642850d5` |
| Issuance / redemption settlement | native X Layer USDC and USDG; both marked supported by issuer API |
| Atomic swaps | issuer API reports supported on X Layer |
| Market session | issuer API: `TwentyFourFive`; underlying exchange `XNAS` |
| Chainlink oracle | pull-based, 18-decimal USD feed; verifier `0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7`; feed id `0x000a37a55df2ef907d8fa06af6632bc16da58a62b68be2e1994efaa037a0918a` |

Issuer sources:

- `https://api.xstocks.fi/api/v2/public/assets/NVDAx`
- `https://api.xstocks.fi/api/v2/public/oracles`
- `https://api.xstocks.fi/api/v2/public/assets/NVDAx/multiplier?network=XLayer`
- https://docs.xstocks.fi/developers/multipliers
- https://docs.xstocks.fi/developers/wrapped-xstocks

## X Layer mainnet read-only characterization

Captured from `https://rpc.xlayer.tech` at block `0x42db433` on chain `0xc4` (`196`):

| Probe | Result |
| --- | --- |
| Proxy runtime bytecode hash | `0xe7cbfea5a664672738dd729f7774677b0fa82dbdda74320df20eec49d2211b4c` |
| EIP-1967 implementation | `0x65c40d624af3b18c109fbf87b7deff34cdc5f19b` |
| `name()` / `symbol()` | `NVIDIA xStock` / `NVDAx` |
| `decimals()` | `18` |
| `sharesOf(address(0))` | `0`; stable-share selector is present |
| `balanceOf(address(0))` | reverted; zero-address behavior is not used to infer transferability |
| `getCurrentMultiplier()` | `(1000918075849099600, 0, 4)` from the deployed implementation ABI |

The issuer multiplier endpoint returned `currentMultiplier: 1` for the same asset/network, whereas
the contract call returns `1.000918075849099600` WAD. Until xStocks clarifies whether the API rounds
or uses a different representation, **XSTOCKS_ACCOUNTING is technical-model complete but production
admission remains blocked by external state reconciliation**. Usance will use the token's canonical
onchain conversion for custody and fail closed on reporter mismatch.

## Support levels at this capture

| Capability | Status |
| --- | --- |
| `XSTOCKS_ACCOUNTING` | `TECHNICAL_MODEL_COMPLETE` |
| `XSTOCKS_IDENTITY` | `MAINNET_READ_ONLY_PROVEN` |
| `XSTOCKS_ORACLE` | `IDENTIFIED_NOT_INTEGRATED` |
| `XSTOCKS_LIQUIDITY` | `ISSUER_PRIMARY_ROUTE_IDENTIFIED`; secondary liquidation route unproven |
| `XSTOCKS_TESTNET_FACILITY` | `BLOCKED_RESOURCE` — no deployer key/funding in this environment |
| `XSTOCKS_MAINNET_READ_ONLY` | `PROVEN` |
| `CIRCLE_USDC` | `MAINNET_AND_TESTNET_CONFIRMED` |
| `CIRCLE_CCTP` | `CCTP_V2_LIVE_MAINNET`; exact contract discovery pending |
