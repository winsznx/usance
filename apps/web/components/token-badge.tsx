/**
 * A token mark built from the symbol, not a borrowed brand logo.
 *
 * The tokens on testnet are labelled stand-ins — tUSTB is not FOBXX, tUSD is not USDC — so painting
 * a real issuer's logo on them would be the exact dishonesty this product avoids. This is a neutral,
 * on-brand badge (the symbol's initials on the warm bone ground) that reads as a token mark without
 * claiming to be anyone's. On mainnet, real admitted assets can carry their real token-list icon.
 */
export function TokenBadge({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const clean = (symbol || "?").replace(/[^A-Za-z0-9]/g, "");
  const initials = (clean.slice(0, 2) || "?").toUpperCase();
  return (
    <span
      aria-hidden
      title={symbol}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: "var(--bone)",
        color: "var(--espresso)",
        border: "1px solid var(--hairline)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
        letterSpacing: "0.02em",
        flex: "none",
      }}
    >
      {initials}
    </span>
  );
}
