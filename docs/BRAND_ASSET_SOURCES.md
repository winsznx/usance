# Infrastructure rail — asset sourcing status

The homepage infrastructure rail (`Infrastructure across Usance`) currently renders each vendor
name as a plain typographic wordmark (`.infra-mark` in `apps/web/app/globals.css`), not a vector
logo.

This is a deliberate interim choice, not an oversight: sourcing and verifying official SVG brand
assets for six vendors — confirming the current monochrome variant, usage restrictions, and
minimum clear space for each — is real work this unit did not have time to do correctly. Rendering
an unverified or recreated logo would risk violating a vendor's brand guidelines, which is worse
than a plain text row.

## What the rail currently includes

Base, X Layer, Hedera, ENS, Privy, Chainlink — matching the current claims matrix at the time this
was written. 0G is excluded (`LIVE_PROOF_PENDING`, not yet a live integration); Circle is excluded
(no implementation evidence in the repo).

## Before shipping real SVGs

For each vendor, before swapping in a real logo:

1. Locate the vendor's official brand/press kit page.
2. Confirm the monochrome (single-colour) variant exists and is permitted for this kind of
   attribution use — most vendors restrict recolouring, distortion, and use inside offers that
   suggest endorsement.
3. Save the SVG under `apps/web/public/assets/infrastructure/<vendor>.svg` with a comment noting
   the source URL and fetch date.
4. Update this file with the source URL, license/usage note, and confirmation date for each mark.
5. Replace the `.infra-mark` text span for that vendor with the SVG, keeping the same ~22–24px
   optical height and spacing already defined in `.infra-rail-row`.

| Vendor | Source verified | SVG in repo |
| --- | --- | --- |
| Base | No | No |
| X Layer | No | No |
| Hedera | No | No |
| ENS | No | No |
| Privy | No | No |
| Chainlink | No | No |
