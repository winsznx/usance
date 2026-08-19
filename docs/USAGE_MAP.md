# Usance Asset Usage Map

Drop `assets/` into the repository. The product agent should use the file paths below directly and must not regenerate equivalents.

## Brand identity

| Asset | Use |
|---|---|
| `assets/brand/svg/usance-lockup-horizontal.svg` | Main landing/app header and README/docs header |
| `assets/brand/svg/usance-mark-primary.svg` | Compact app header, proof stamp, loading mark source |
| `assets/brand/svg/usance-micro-mark.svg` | 16–32px contexts only |
| `assets/brand/svg/usance-wordmark.svg` | Wordmark-only editorial placements |
| `assets/brand/svg/usance-lockup-stacked.svg` | Square/vertical collateral |
| `assets/brand/svg/usance-lockup-horizontal-reversed.svg` | Only on deliberate Aubergine/Espresso field |
| `assets/brand/favicon.ico` | Browser favicon |
| `assets/brand/png/apple-touch-icon.png` | Apple touch icon |
| `assets/brand/png/usance-app-icon-light-192.png` | PWA manifest |
| `assets/brand/png/usance-app-icon-light-512.png` | PWA manifest |
| `assets/brand/png/usance-app-icon-light-1024.png` | Master app icon |
| `assets/brand/png/usance-social-avatar-400.png` | X / GitHub / Discord avatar |
| `assets/social/og-background.png` | OG card background, add real HTML/text outside the raster |
| `assets/social/x-header-background.png` | Social banner background |

## Route icons

Use the custom 24px SVGs from `assets/icons/` for navigation/actions. Do not mix another friendly rounded icon family into the same surface.

- wallet
- network
- evidence
- passport
- collateral
- borrow
- repay
- withdraw
- risk-epoch
- liquidation
- mandate
- intent
- earn
- issuer
- developer
- activity
- alerts
- settings
- proof
- status

## Product illustrations

| Asset | Route / state |
|---|---|
| `usance-hero-watercolor-master` | `/` hero only; optional onboarding intro crop |
| `onboarding-wallet-network` | `/app/onboarding` wallet/X Layer readiness |
| `onboarding-session-signature` | onboarding session signature; `/app/settings/security` |
| `onboarding-asset-discovery` | onboarding holdings discovery |
| `evidence-to-passport` | `/assets`, `/assets/[assetId]`, issuer education |
| `collateral-capacity` | `/app/collateral/add`, dashboard capacity education |
| `borrow-settlement` | `/app/borrow`, onboarding Get cash step |
| `risk-epoch` | `/app/alerts`, risk-policy change explanation |
| `mandate-agent-authority` | `/app/mandates`, `/app/mandates/new` |
| `earn-liquidity-vault` | `/earn`, `/earn/[vaultId]` |
| `liquidation-keeper-split` | margin-call / liquidation detail + proof |
| `proof-receipt-chain` | `/proof/[receiptId]`, activity receipt education |
| `remote-collateral-recognition` | remote collateral / LayerZero flow |
| `issuer-onboarding-review` | `/institutional/assets/new` and review |
| `developer-webhook-delivery` | `/developers/webhooks` |
| `empty-no-supported-assets` | no supported assets / no holdings |
| `empty-no-activity` | activity empty state |
| `state-rpc-degraded` | RPC/provider degraded state |
| `state-no-new-risk` | NO_NEW_RISK / blocked new exposure explanation |
| `withdrawal-queue` | LP queued withdrawal explanation |
| `intent-reservation` | intent reservation / partial fill education |

## Rules
- Hero watercolor is the only saturated colour moment.
- Operational illustrations are explanatory, not decoration on every card.
- Use at most one illustration in an empty/education state.
- All operational illustrations stay transparent.
- Do not recolour SVGs.
- Do not replace them with generic crypto/fintech stock art.
- Keep real financial data/actions visually primary.
