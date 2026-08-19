"use client";

import { useCallback, useState } from "react";
import { Icon } from "@/components/icon";

/**
 * A value somebody will need to paste somewhere.
 *
 * Addresses, transaction hashes and receipt ids are all things a person verifies by taking them
 * elsewhere. Abbreviating one without giving a way to copy the whole thing means retyping 66
 * characters by eye, and a single transposed character produces a lookup that silently finds
 * nothing.
 *
 * The confirmation is a word, not a colour change. "Copied" is legible to somebody who cannot see
 * the icon shift, and it announces itself politely rather than interrupting.
 */
export function Copyable({
  value,
  display,
  label,
}: {
  value: string;
  /** What is shown. Defaults to an abbreviation of `value`. */
  display?: string;
  /** Names the thing for assistive technology, e.g. "transaction hash". */
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused outright. Saying nothing would look like the button is
      // broken, so the value is selected instead and the user can copy it themselves.
      const el = document.getElementById(`copyable-${value}`);
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  }, [value]);

  const shown = display ?? (value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value);

  return (
    <span className="copyable">
      <span className="mono" id={`copyable-${value}`}>{shown}</span>
      <button type="button" className="copyable-button" onClick={copy} aria-label={`Copy ${label}`}>
        <Icon name={copied ? "check" : "external"} size={13} />
      </button>
      <span role="status" aria-live="polite" className="copyable-status">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
