"use client";

import { activeChain } from "@/lib/deployments";
import { Copyable } from "@/components/copyable";

/**
 * Anything that identifies something on chain, rendered as something you can go and check.
 *
 * The rule this exists to enforce: **every hash and every address on any surface is reachable.**
 * An abbreviated hash that is only text asks the reader to trust it, which is the opposite of what
 * a proof surface is for. One transposed character while retyping produces a lookup that silently
 * finds nothing, so copy is offered alongside the link rather than instead of it.
 *
 * Both are offered because they answer different questions. The link answers "did this happen".
 * Copy answers "let me take this somewhere else" — a block explorer of their choosing, a support
 * thread, a spreadsheet.
 */

type Kind = "tx" | "address" | "block";

function explorerPath(kind: Kind, value: string): string {
  const base = activeChain().explorerUrl?.replace(/\/$/, "") ?? "";
  if (!base) return "";
  if (kind === "tx") return `${base}/tx/${value}`;
  if (kind === "block") return `${base}/block/${value}`;
  return `${base}/address/${value}`;
}

function abbreviate(kind: Kind, value: string): string {
  if (kind === "block") return value;
  // Enough characters that two different hashes cannot look identical at a glance, which is the
  // whole job of an abbreviation on a page that may show several.
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

export function OnChain({
  kind,
  value,
  label,
  copyable = true,
}: {
  kind: Kind;
  value: string;
  /** Names it for assistive technology, e.g. "liquidation transaction". */
  label?: string;
  copyable?: boolean;
}) {
  const href = explorerPath(kind, value);
  const shown = abbreviate(kind, value);
  const named = label ?? (kind === "tx" ? "transaction" : kind === "block" ? "block" : "address");

  // Without an explorer for this chain the value is still shown and still copyable. Rendering
  // nothing, or a dead link, would be worse than plain text.
  const body = href ? (
    <a
      className="hashlink mono"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`View ${named} ${value} on the block explorer`}
    >
      {shown}
    </a>
  ) : (
    <span className="mono">{shown}</span>
  );

  if (!copyable) return body;

  return (
    <span className="row" style={{ gap: 6, alignItems: "center" }}>
      {body}
      <Copyable value={value} display="" label={named} />
    </span>
  );
}
