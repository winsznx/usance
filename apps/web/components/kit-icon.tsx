import Image from "next/image";

/**
 * Icons from the shipped design kit.
 *
 * Loaded as files rather than inlined so there is exactly one copy of each glyph and it cannot
 * drift from the kit. `BRAND_LOCK.md` is explicit that these are not to be regenerated, and an
 * inline redraw is a regeneration with extra steps.
 *
 * `currentColor` does not reach an <img>, so these carry their own stroke. That is the trade the
 * kit makes: exact fidelity to the source over tint-ability.
 */

export type KitIconName =
  | "wallet" | "network" | "evidence" | "passport" | "collateral"
  | "borrow" | "repay" | "withdraw" | "risk-epoch" | "liquidation"
  | "mandate" | "intent" | "earn" | "issuer" | "developer"
  | "activity" | "alerts" | "settings" | "proof" | "status";

export function KitIcon({
  name,
  size = 20,
  label,
  className,
}: {
  name: KitIconName;
  size?: number;
  /** Supply only when the icon carries meaning no adjacent text already conveys. */
  label?: string;
  className?: string;
}) {
  return (
    <Image
      src={`/assets/icons/${name}.svg`}
      width={size}
      height={size}
      alt={label ?? ""}
      className={className}
      // Decorative unless named. An icon beside its own label is noise in a screen reader.
      aria-hidden={label ? undefined : true}
      unoptimized
    />
  );
}

export type IllustrationName =
  | "evidence-to-passport" | "collateral-capacity" | "borrow-settlement"
  | "risk-epoch" | "mandate-agent-authority" | "proof-receipt-chain"
  | "onboarding-asset-discovery" | "intent-reservation" | "earn-liquidity-vault"
  | "issuer-onboarding-review" | "liquidation-keeper-split"
  | "empty-no-activity" | "empty-no-supported-assets"
  | "developer-webhook-delivery";

export function Illustration({
  name,
  width = 320,
  height = 200,
  priority,
  className,
}: {
  name: IllustrationName;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={`/assets/illustrations/svg/${name}.svg`}
      width={width}
      height={height}
      // Decorative throughout. Each illustration sits beside a heading and body that already say
      // what it depicts, so naming it again would make a screen reader repeat itself.
      alt=""
      aria-hidden
      {...(priority === undefined ? {} : { priority })}
      className={className}
      unoptimized
    />
  );
}

/** The Capacity Cut lockup. Never redrawn: BRAND_LOCK.md fixes the geometry and the gap. */
export function Lockup({ width = 112, reversed }: { width?: number; reversed?: boolean }) {
  return (
    <Image
      src={reversed ? "/assets/brand/svg/usance-lockup-horizontal-reversed.svg" : "/assets/brand/svg/usance-lockup-horizontal.svg"}
      width={width}
      height={Math.round(width * 0.26)}
      alt="Usance"
      priority
      unoptimized
    />
  );
}

export function MarkOnly({ size = 24, reversed }: { size?: number; reversed?: boolean }) {
  return (
    <Image
      src={reversed ? "/assets/brand/svg/usance-mark-reversed.svg" : "/assets/brand/svg/usance-mark-primary.svg"}
      width={size}
      height={size}
      alt=""
      aria-hidden
      unoptimized
    />
  );
}
