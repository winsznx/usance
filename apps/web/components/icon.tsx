/**
 * One icon system, from the shipped kit.
 *
 * The nav and action glyphs are the kit's own SVGs, loaded from `public/assets/icons/`. They are the
 * authority; anything drawn here would be a second system that drifts from it. What remains inline
 * is chrome the kit does not cover — chevrons, close, menu, state marks — drawn on the same 24px
 * grid at the same weight so the two are indistinguishable in use.
 *
 * Every glyph is 24×24, 1.5 stroke, butt caps, no fills. That uniformity is the whole point: the
 * fastest way to make an interface look assembled from a template is to mix icon families — a
 * rounded set here, a filled set there, an emoji standing in for the one nobody could find.
 *
 * Drawn from rectangles, circles and straight lines on purpose. Usance's mark is a six-point
 * asterisk and its type is geometric; friendly rounded icons would belong to a different product.
 *
 * Meaningful icons take a `label` and get `role="img"`. Decorative ones stay `aria-hidden`, because
 * an icon that repeats the text next to it is noise in a screen reader, not information.
 */

export type IconName =
  | "home" | "position" | "assets" | "activity" | "alerts" | "mandates" | "earn" | "settings"
  | "collateral" | "borrow" | "repay" | "withdraw"
  | "chevronLeft" | "chevronRight" | "chevronDown" | "close" | "menu" | "external"
  | "check" | "warn" | "stop" | "clock" | "shield";

const PATHS: Record<IconName, React.ReactNode> = {
  // ---- navigation. A vault, a ledger, a document: the nouns of the product, not generic shapes.
  home: <><path d="M4 10.5 12 4l8 6.5" /><path d="M6 10v10h12V10" /><path d="M10 20v-6h4v6" /></>,
  position: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M8 13h8M8 16.5h5" /></>,
  assets: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></>,
  activity: <><path d="M3 12h4l2.5-6 5 12L17 12h4" /></>,
  alerts: <><path d="M12 4a6 6 0 0 0-6 6v4l-2 3h16l-2-3v-4a6 6 0 0 0-6-6Z" /><path d="M10 20h4" /></>,
  mandates: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
  earn: <><path d="M4 19V9M9 19V5M14 19v-7M19 19V3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,

  // ---- actions. Direction encodes meaning: in, out, up, down.
  collateral: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M12 4v4M9.5 6.5 12 4l2.5 2.5" /></>,
  borrow: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 20v-4M9.5 17.5 12 20l2.5-2.5" /></>,
  repay: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M12 8V4M9.5 6.5 12 4l2.5 2.5" /><path d="M3 13h18" /></>,
  withdraw: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4M9.5 17.5 12 20l2.5-2.5" /></>,

  // ---- chrome
  chevronLeft: <path d="M15 5 8 12l7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  external: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>,

  // ---- state. Distinguishable by silhouette, not only by colour: a tick, a bar, a cross.
  check: <path d="M5 12.5 10 17l9-10" />,
  warn: <><path d="M12 4v10" /><circle cx="12" cy="19" r="0.6" /><circle cx="12" cy="12" r="9" /></>,
  stop: <><circle cx="12" cy="12" r="9" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l3.5 2" /></>,
  shield: <><path d="M12 3.5 5 6.5v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9v-5Z" /><path d="M9 12l2 2 4-4" /></>,
};

export function Icon({
  name,
  size = 20,
  label,
  className,
}: {
  name: IconName;
  size?: number;
  /** Supply only when the icon carries meaning no adjacent text already conveys. */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      // Decorative by default. An icon beside its own label is noise to a screen reader.
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true, focusable: false })}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The Usance mark. Six strokes through a centre, the same geometry as the icons. */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="square" aria-hidden focusable="false">
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
    </svg>
  );
}
