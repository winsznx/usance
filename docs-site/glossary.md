---
description: The terms Usance uses, in plain language.
---

# Glossary

**Admitted asset.** An asset Usance recognises as collateral, because it has a committed Passport and
a price source. Admission is per-asset, and holding a token is not the same as it being admitted.

**Builder code.** An ERC-8021 attribution suffix appended to every write, decoded back out of the
transaction to prove it rather than assumed.

**Capacity.** How much you can borrow, derived from recognised value. It is kept as two separate
limits: what your collateral supports, and what lenders can currently fund.

**Evidence.** An issuer's own public filing, fetched and hashed, from which a Passport's claims are
extracted.

**Haircut.** A named reduction applied to market value, in a fixed order, on the way to recognised
value. Every haircut is shown.

**Maintenance limit.** The debt level above which an account can be liquidated. It sits below your
borrow limit, and crossing it moves the account to _margin call_.

**Mandate.** A signed, bounded delegation letting an agent act inside limits you set. It can only
narrow protocol permissions, never widen them, and never grants withdrawal.

**Passport.** The on-chain, versioned, hash-anchored record of what an asset legally is: rights,
custody, redemption, transfer rules.

**Recognised value.** The portion of market value Usance will lend against, which is market value
minus haircuts, floored at a stressed-exit estimate. It is deliberately lower than market value, and
the gap is not a fee.

**Risk epoch.** The version stamp on every quote, marking the policy and inputs it was computed
under. A quote from a stale epoch is refused rather than executed.

**Sentinel.** A bounded autonomous agent built on a mandate. It may observe and propose, and policy
and the mandate decide. It can only reduce risk and can never withdraw collateral.

**Settlement asset.** The asset borrowers draw and lenders supply (`tUSD` on testnet, a stand-in with
no real value).

**Single-source.** A Passport built from only one extraction path. It is marked as such and capped by
policy rather than trusted at full value.

**Status ladder.** Normal → No new risk → Reduce only → Margin call → Liquidating, recomputed live on
every read, never stored.

**Stressed exit.** An estimate of what a position would realise if it had to be sold quickly, and the
floor under recognised value.
