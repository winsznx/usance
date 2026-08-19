import { detectProvider } from "./wallet";

/**
 * Whether this browser has completed onboarding, as opposed to merely having a wallet attached.
 *
 * The distinction is the one `/security` spends a page explaining, and the app got it wrong: it
 * gated on `eth_accounts`, which returns an address for any site the wallet has *ever* been
 * connected to. A returning visitor was therefore dropped straight into the dashboard having never
 * seen onboarding, never been told what Usance is, and never signed anything.
 *
 * A session is the signature. It is held in `sessionStorage` rather than `localStorage` on purpose:
 * it should not outlive the browser session, because a signature proving control of an address is
 * exactly the thing that should be re-established on a new visit.
 *
 * It is bound to the address it was signed for. A wallet that switches accounts has a session for
 * somebody else, and continuing would show one person another person's position.
 */

const KEY = "usance.session";

export function recordSession(address: `0x${string}`): void {
  sessionStorage.setItem(KEY, address.toLowerCase());
}

export function clearSession(): void {
  sessionStorage.removeItem(KEY);
}

export type SessionState =
  | { status: "ACTIVE"; address: `0x${string}` }
  /** A wallet is attached but this browser has not signed in. Onboarding, not an error. */
  | { status: "NO_SESSION" }
  /** No wallet at all. Also onboarding, which explains what one is. */
  | { status: "NO_WALLET" }
  /** Signed in as one address, wallet now reports another. The session is void. */
  | { status: "ACCOUNT_CHANGED" };

export async function readSession(): Promise<SessionState> {
  const { provider } = detectProvider();
  if (!provider) return { status: "NO_WALLET" };

  const stored = sessionStorage.getItem(KEY);
  if (!stored) return { status: "NO_SESSION" };

  let account: string | undefined;
  try {
    // `eth_accounts` never prompts. It reports what the wallet already permits, which is what makes
    // it safe to call on load; `eth_requestAccounts` would open a dialog on every navigation.
    account = ((await provider.request({ method: "eth_accounts" })) as string[])[0];
  } catch {
    return { status: "NO_WALLET" };
  }

  if (!account) return { status: "NO_SESSION" };
  if (account.toLowerCase() !== stored) {
    // Cleared rather than silently re-pointed. Re-signing is one click; showing somebody another
    // account's debt is not recoverable by an apology.
    clearSession();
    return { status: "ACCOUNT_CHANGED" };
  }

  return { status: "ACTIVE", address: account as `0x${string}` };
}
