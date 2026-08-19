import type { Page } from "@playwright/test";

/**
 * A deterministic EIP-1193 provider, injected before the app boots.
 *
 * This exists so the authenticated frame can be tested at all. It is emphatically **not** a claim
 * that live wallet execution works: it answers `eth_accounts`, `eth_chainId`, `wallet_switchEthereumChain`
 * and `personal_sign` from fixed values and refuses everything else. Any test that needs a real
 * signature or a mined transaction has to use the live scripts, not this.
 *
 * The refusal is the important part. A harness that answered `eth_sendTransaction` with a plausible
 * hash would let a test assert that a borrow succeeded when nothing left the browser, and that
 * assertion would survive the protocol being broken.
 */

export const TEST_ACCOUNT = "0x1111111111111111111111111111111111111111";
export const X_LAYER_TESTNET = 1952;

export interface HarnessOptions {
  /** Address the harness reports. Defaults to TEST_ACCOUNT. */
  account?: string;
  /** Chain the wallet claims to be on. Use a foreign id to exercise the switch prompt. */
  chainId?: number;
  /** Reject the session signature, to exercise SESSION_REJECTED. */
  rejectSignature?: boolean;
  /** Reject the network switch, to exercise NETWORK_SWITCH_REJECTED. */
  rejectSwitch?: boolean;
  /** Report no accounts, so the app treats the wallet as locked. */
  locked?: boolean;
}

/**
 * Install before the first navigation.
 *
 * `addInitScript` runs ahead of page scripts, so `window.ethereum` exists by the time the app's
 * provider detection runs. Injecting after load would race it, and the race resolves differently on
 * a cold and a warm cache.
 */
export async function installWallet(page: Page, options: HarnessOptions = {}): Promise<void> {
  await page.addInitScript((opts: HarnessOptions) => {
    const account = opts.account ?? "0x1111111111111111111111111111111111111111";
    let chainId = opts.chainId ?? 1952;
    const listeners: Record<string, Array<(payload: unknown) => void>> = {};

    const reject = (message: string) => {
      const err = new Error(message) as Error & { code: number };
      // 4001 is what every wallet returns for a user rejection, and the app branches on it.
      err.code = 4001;
      return Promise.reject(err);
    };

    const provider = {
      isMetaMask: false,
      // The app prefers an OKX provider. Saying so keeps the detection path under test the same one
      // a real OKX user takes.
      isOkxWallet: true,

      request({ method, params }: { method: string; params?: unknown[] }) {
        switch (method) {
          case "eth_accounts":
          case "eth_requestAccounts":
            return Promise.resolve(opts.locked ? [] : [account]);

          case "eth_chainId":
            return Promise.resolve(`0x${chainId.toString(16)}`);

          case "wallet_switchEthereumChain": {
            if (opts.rejectSwitch) return reject("User rejected the request.");
            const target = (params?.[0] as { chainId?: string })?.chainId;
            if (target) chainId = Number.parseInt(target, 16);
            (listeners["chainChanged"] ?? []).forEach((fn) => fn(`0x${chainId.toString(16)}`));
            return Promise.resolve(null);
          }

          case "wallet_addEthereumChain":
            return Promise.resolve(null);

          case "personal_sign":
          case "eth_signTypedData_v4":
            if (opts.rejectSignature) return reject("User rejected the request.");
            // A syntactically valid 65-byte signature. It verifies against nothing, which is
            // correct: this proves the UI advanced, never that a contract accepted anything.
            return Promise.resolve(`0x${"11".repeat(32)}${"22".repeat(32)}1b`);

          default:
            // Everything that moves money. A harness that answered these would let a test assert a
            // borrow succeeded while nothing left the browser.
            return Promise.reject(
              new Error(`The test wallet harness refuses ${method}. Use the live scripts for anything that moves value.`),
            );
        }
      },

      on(event: string, handler: (payload: unknown) => void) {
        (listeners[event] ??= []).push(handler);
      },
      removeListener(event: string, handler: (payload: unknown) => void) {
        listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
      },
    };

    Object.defineProperty(window, "ethereum", { value: provider, writable: true, configurable: true });
    Object.defineProperty(window, "okxwallet", { value: provider, writable: true, configurable: true });
  }, options);
}

/**
 * Skip straight past onboarding.
 *
 * Sets the same session marker the real flow writes, so a test about the dashboard is not also a
 * test of the connect sequence. Onboarding has its own tests.
 */
export async function signedIn(page: Page, options: HarnessOptions = {}): Promise<void> {
  await installWallet(page, options);
  await page.addInitScript((account: string) => {
    sessionStorage.setItem("usance.session", account);
  }, options.account ?? TEST_ACCOUNT);
}
