# Usance Product Lock — Official Source Register

**Research freeze:** 2026-09-03  
**Purpose:** External-system facts used by the Product Lock. This is not a substitute for capability probes at build/deploy time.

## Source policy

1. Current repository state is implementation truth.
2. Official provider/protocol documentation is integration truth.
3. Program/competition pages are eligibility truth.
4. Blog/marketing pages may establish announced product availability, but exact contract addresses, APIs, privileges, limits and security properties still require technical documentation or a live probe.
5. No integration is marked production-ready merely because a provider says it exists.

## Base

- Base Request for Builders: Tokenized Stocks  
  https://blog.base.org/request-for-builders-tokenized-stocks
- Base: Stocks just got updated  
  https://blog.base.org/tokenized-stocks
- Base Stocks / issuer-address directory  
  https://www.base.org/stocks
- Base Batches 004  
  https://blog.base.org/introducing-base-batches-004  
  https://www.base.org/batches
- Base B20 / network upgrade material  
  https://chain.base.org/upgrades/

### Verified at research freeze

- Coinbase-issued tokenized stocks are live natively on Base as B20 assets and are restricted to eligible non-US users.
- Base explicitly calls out credit, stock lending, personalized indexes, productive-asset credit and agent-managed portfolios as builder opportunities.
- Base Batches 004 closes 2026-09-09; selected teams are offered a $100K Base Ecosystem Fund investment subject to diligence.
- The program is explicitly Base-first: a company may support multiple chains, but Base should be its default network.
- Aave, Morpho, Euler and other third-party venues already advertise stock lending/borrowing support on Base. Usance therefore cannot claim that stock-backed lending itself is novel.
- Exact Coinbase token contract addresses must be sourced from the official Base/Coinbase directory and pinned in generated admission manifests.

## X Layer / OKX

- X Layer  
  https://web3.okx.com/xlayer
- Exchange OS announcement  
  https://web3.okx.com/learn/exchange-os
- Current xStocks activity / xPoints article  
  https://web3.okx.com/learn/earn-xpoints-xlayer
- OKX Dev Day 2026 program material supplied by the founder in the Product Lock source set.

### Verified at research freeze

- X Layer is an EVM L2 and describes Exchange OS as an architecture where EVM anchors assets/governance while TradeZone handles high-frequency execution.
- Exchange OS rollout is staged. Usance must keep any unavailable market-deployer access behind `ACCESS_REQUIRED`.
- xStocks are live on X Layer and OKX Wallet is actively distributing/incentivizing eligible holding/liquidity activity.
- OKX Dev Day applications close 2026-09-11; the online build period is 2026-09-17 to 2026-09-25; the Singapore finale is 2026-10-06.
- The primary Usance track should remain **X Layer: Tokenized stocks and RWA**.
- Native USDC and Circle CCTP are now live on X Layer, correcting older Usance assumptions that CCTP was unavailable there.

## xStocks

- Product legal overview  
  https://docs.xstocks.fi/docs/product-legal-overview
- How xStocks work  
  https://docs.xstocks.fi/docs/how-xstocks-work
- Dividends and stock splits  
  https://docs.xstocks.fi/docs/dividends-and-stock-splits

### Verified at research freeze

- xStocks are not ordinary shareholder-equity tokens; they are issuer-defined tokenized instruments whose legal/economic rights must be represented exactly rather than inferred from ticker.
- Corporate actions use a multiplier/rebasing mechanism. On EVM networks `balanceOf()` reflects the adjusted balance.
- Protocols are advised to account for multiplier activations and pause-sensitive windows.
- This makes rebase/corporate-action accounting a **pre-mainnet gate** for any xStock held by Usance.

## ETHOnline 2026

- Event prize page  
  https://ethglobal.com/events/ethonline2026/prizes
- ENS prize page  
  https://ethglobal.com/events/ethonline2026/prizes/ens

### Verified at research freeze

- Current sponsor set includes Hedera, ENS, Privy and Chainlink.
- Privy's B2B Financial Product requirements already name organization wallets, policies, signers, quorums and intents as qualifying control primitives.
- ENSv2 beta is on Sepolia and is the current target for the ENSv2 prize.
- Chainlink's **Best Confidential Workflow** exists, but its exact qualification requirements currently say **Coming soon**. Older Usance planning that treated a particular TEE handler function as an already-final qualification rule is not authoritative.
- Before ETHOnline implementation begins, freeze the actual git baseline and re-read the prize page.

## ENSv2

- Overview  
  https://docs.ens.domains/ensv2/overview/
- Enhanced Access Control  
  https://docs.ens.domains/ensv2/enhanced-access-control/
- Universal Resolver V2  
  https://docs.ens.domains/ensv2/universal-resolver-v2/
- App-developer guide  
  https://docs.ens.domains/ensv2/tutorial-app-developers/

### Verified at research freeze

- ENSv2 is deployed on Sepolia for testing.
- Enhanced Access Control supports resource-scoped roles and root roles.
- Universal Resolver V2 traverses hierarchical registries and exposes canonical-hierarchy discovery functions.
- ENSv2 contracts/interfaces are explicitly not final and may change before mainnet.
- Usance must therefore version-pin/capability-probe ENS writes and must not make irreversible core financial accounting depend on a beta interface.

## Privy

- Quorum approvals  
  https://docs.privy.io/controls/common-use-cases/quorum-approval
- Privy documentation root  
  https://docs.privy.io/

### Verified at research freeze

- Privy supports key quorums and its TEE infrastructure enforces the configured threshold for wallet actions.
- For Usance, Privy is an **institutional wallet-control and signing plane**. Do not describe it generically as the legal custodian of an institution's assets unless a specific custodial configuration and agreement establish that.

## Chainlink

- Developer docs  
  https://docs.chain.link/
- ETHOnline prize page  
  https://ethglobal.com/events/ethonline2026/prizes
- U.S. equities Data Streams overview  
  https://chain.link/blog/chainlink-data-streams-us-equities-etfs

### Verified at research freeze

- CRE is Chainlink's current workflow/orchestration direction; ETHGlobal explicitly tells builders to use CRE rather than deprecated Functions/Automation for those workflow needs.
- Data Feeds and Data Streams are different products and both may be relevant to Usance.
- Do **not** make “Data Streams” or “Data Feeds” a global architectural constant. The `OracleProvider` is resolved per domain, instrument and environment.
- Chainlink has publicly stated that OKX/X Layer adopted Chainlink infrastructure for RWA applications, while Usance's earlier testnet work found Data Feeds available in the specific environment it inspected.
- Production launch requires exact feed/stream identifiers, freshness semantics, market-session handling and fail-closed behavior per asset.

## Hedera / ATS

- Asset Tokenization Studio  
  https://docs.hedera.com/solutions/tokenization/ats
- ETHOnline sponsor requirements  
  https://ethglobal.com/events/ethonline2026/prizes

### Verified at research freeze

- ATS is Hedera's open-source digital-security tokenization stack and uses ERC-1400-family concepts, role controls, approval/block lists, pause/lock/snapshot mechanisms and asset lifecycle modules.
- ETHOnline's Hedera track explicitly values real asset lifecycle operations, not a static minted token.
- Usance's ETHOnline path should use ATS-issued testnet assets in a consequential collateral lifecycle.

## 0G

- Documentation  
  https://docs.0g.ai/
- Compute inference  
  https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference
- Storage SDK  
  https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk

### Verified at research freeze

- 0G currently exposes Router and Direct inference paths.
- Direct mode uses provider sub-accounts and signed requests; provider/model catalog and pricing are dynamic.
- Current documented TEE modes include `TeeML` and `TeeTLS`; they prove different things.
- `TeeML`: model/computation are run inside a TEE and responses are TEE-signed.
- `TeeTLS`: a TEE broker proves authenticated routing to a centralized provider and binds request/response hashes; this does **not** prove the model's answer is true.
- `verifyService()` automates signer/compose-hash checks but the docs explicitly state this is not full provider verification; additional manual attestation/image checks are required.
- Direct inference currently requires funding the 0G ledger and provider sub-accounts; the docs specify minimum funding requirements.
- 0G Storage can be an integrity-bound archive. A storage root proves bytes/commitment, not legal truth.

## Circle / USDC

- CCTP docs  
  https://developers.circle.com/cctp
- X Layer launch  
  https://www.circle.com/blog/now-available-native-usdc-cctp-on-x-layer

### Verified at research freeze

- CCTP is native burn-and-mint transport for USDC and supported assets.
- Base supports CCTP.
- **X Layer now supports native USDC and CCTP**, announced 2026-08-06. This supersedes older Usance notes that treated CCTP on X Layer as unavailable.
- Hedera CCTP support is not assumed. The `CashTransport` adapter remains domain-specific.

## Re-verification rule

Every one of the following must be re-probed at implementation/deployment time:

- exact contract addresses;
- SDK/API versions;
- chain IDs and domains;
- feed/stream IDs and heartbeat/session semantics;
- issuer asset addresses;
- transfer/compliance behavior;
- current venue liquidity;
- sponsor eligibility requirements;
- staged-access products such as Exchange OS;
- TEE/provider attestations;
- CCTP testnet/mainnet availability.

A website announcement is evidence that a product exists. It is not permission to hard-code a production dependency.
