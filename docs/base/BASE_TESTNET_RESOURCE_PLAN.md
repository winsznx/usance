# BASE_TESTNET_RESOURCE_PLAN.md

Phase 08. Every external resource the Base Sepolia work needs, requested **only at the exact step
that needs it** (§46). No mainnet capital is requested in Phase 08 (§43).

| Resource | Network | Account / address | Purpose | Required asset / credential | Approx. amount | Official acquisition source | Status |
|---|---|---|---|---|---|---|---|
| Deployer wallet key | Base Sepolia (84532) | `BASE_SEPOLIA_DEPLOYER_KEY` (env, never in chat) | deploy the Base facility stack + issue the `SYNTHETIC_TEST_B20` instruments | raw secp256k1 private key in the local `.env` | — | user-generated locally | **NEEDED at step 13** |
| RPC endpoint | Base Sepolia | `BASE_SEPOLIA_RPC_URL` (env) | JSON-RPC for deploy + lifecycle | URL | — | `https://sepolia.base.org` (public) or a provider URL | **NEEDED at step 13** |
| Base Sepolia ETH | Base Sepolia | deployer address (derived + reported, not requested as a key) | gas for ~20 deploy txs + ~30 lifecycle txs (B20 factory calls, vault, engine, facility, oracle, draws/repays) | native ETH | **~0.10 ETH** | Base Sepolia faucet (`portal.cdp.coinbase.com/products/faucet`), Alchemy/QuickNode Base Sepolia faucets | **NEEDED at step 13** (request: "fund Base Sepolia deployer 0x… with ~0.10 ETH") |
| Base Sepolia native USDC | Base Sepolia | facility + deployer | settlement capital for the live draw/repay lifecycle | native test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6dp) | **~200,000 test USDC** (facility funding for a low-cap draw; the facility limit itself is tiny) | Circle faucet `faucet.circle.com` (Base Sepolia) | **NEEDED after ETH, at the facility-funding step** — requested separately |
| Base Mainnet RPC | Base Mainnet (8453) | — | **read-only** characterization of the real B20 stocks (§32) | URL, no key | — | `https://base-rpc.publicnode.com` (used), `https://mainnet.base.org` | **SATISFIED** — `docs/base/proof/mainnet-b20-characterization.json` already produced |
| Chainlink Data Streams / API credential | — | — | not required — Base tokenized-equity oracles are **push Data Feeds**, no entitlement | — | — | — | **NOT REQUIRED** (§16 — public capability is complete without it) |
| CCTP credentials | — | — | not required this phase (§18) — native USDC settlement only | — | — | — | **NOT REQUIRED** |

## Notes

- The deployer key and RPC URL are set as **local environment variables**. The private key is
  never pasted into chat. The plan reports only the derived address and its balance before any
  write (same discipline as Phases 07 ENS/Hedera).
- `SYNTHETIC_TEST_B20` issuance goes through the real `0xB20f…` factory precompile on Base Sepolia
  — no extra credential, but the deploy harness first checks the ASSET variant is activated in the
  `ActivationRegistry` (`FeatureNotActivated` otherwise) and reports it.
- The facility **limit** on Sepolia is set to a small figure (e.g. 50,000 USD18) with
  `CANARY_PROVISIONAL` policy caps. The ~200k test-USDC facility funding is deliberately larger
  than the limit so repeat draw/repay cycles and an over-draw refusal can both be exercised.
