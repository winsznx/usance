"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Simple and Advanced, with one rule that decides every judgement call.
 *
 *     Advanced adds detail. It never removes risk.
 *
 * Simple hides provenance: Passport versions, evidence roots, exit curves, contract addresses,
 * block numbers. Things a reader needs to *verify* a number. It does not hide the number, the
 * status, the shortfall, or why an action is unavailable — a mode that could conceal a margin call
 * would be a mode that gets somebody liquidated for using the default.
 *
 * Sticky per browser, because switching it back on every visit teaches people the toggle does not
 * work.
 */

type Mode = "simple" | "advanced";

const ModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({
  mode: "simple",
  setMode: () => {},
});

const KEY = "usance.mode";

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>("simple");

  useEffect(() => {
    if (localStorage.getItem(KEY) === "advanced") setModeState("advanced");
  }, []);

  const setMode = useCallback((m: Mode) => {
    localStorage.setItem(KEY, m);
    setModeState(m);
  }, []);

  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export const useMode = () => useContext(ModeContext);

/**
 * Detail that only exists to let somebody check a number.
 *
 * Never wrap a risk figure, a status, or the reason an action is blocked in this. If hiding it
 * could change what a user decides to do, it is not provenance.
 */
export function Advanced({ children }: { children: React.ReactNode }) {
  const { mode } = useMode();
  if (mode !== "advanced") return null;
  return <>{children}</>;
}

export function ModeToggle() {
  const { mode, setMode } = useMode();
  return (
    <div className="mode-toggle" role="group" aria-label="Detail level">
      {(["simple", "advanced"] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={`mode-option${mode === m ? " mode-option-active" : ""}`}
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
        >
          {m === "simple" ? "Simple" : "Advanced"}
        </button>
      ))}
    </div>
  );
}
