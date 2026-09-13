/**
 * Sign in with Google inside the native app.
 *
 * WHY THIS EXISTS AT ALL. Google's flow is a redirect out to accounts.google.com and back, and the
 * web build gets that for free because it has an origin to return to. Capacitor has none — it loads
 * from disk — so the tile simply hid itself on native, and iOS had no Google sign-in. This closes
 * that without touching the web path.
 *
 * WHAT IS DELIBERATELY NOT CHANGED: Google's own configuration. The `redirect_uri` registered in the
 * Google console is still the SERVER's callback, exactly as it is for the website. Only where the
 * callback sends the browser AFTERWARDS differs, and that is our own redirect to our own URL scheme.
 * So no new Google client, no iOS client id, no client secret on the device — the secret stays on
 * the server, which is the entire reason to reuse the existing authorization-code flow rather than
 * bolt a native SDK on beside it.
 *
 * WHY AN IN-APP BROWSER AND NOT A WEBVIEW. Google refuses OAuth inside an embedded webview
 * (`disallowed_useragent`), and it is right to: an app hosting the login page can read the password
 * out of it. `Browser.open` is SFSafariViewController on iOS — a real Safari, out of this app's
 * reach, with its own cookie jar — which is the presentation Google explicitly permits.
 *
 * THE RETURN IS A DEEP LINK. The server redirects to `<scheme>://auth#handoff=<code>`; iOS hands
 * that to the app as `appUrlOpen`. The code stays in the FRAGMENT for the same reason it does on
 * the web: fragments are never sent to a server, so it never reaches a log on its way back.
 */

import { api } from "@/api/client";

/** Thrown when the player closes the sign-in sheet. A normal outcome, never an error to show. */
export class GoogleSignInCancelled extends Error {
  constructor() {
    super("google sign-in cancelled");
    this.name = "GoogleSignInCancelled";
  }
}

/** The fragment keys the server's callback uses. Must match `googleReturn.ts` and the backend. */
const HANDOFF_KEY = "handoff";
const ERROR_KEY = "auth_error";

/**
 * Pull the handoff code out of a deep-link URL.
 *
 * Exported for tests, and written against a STRING rather than `window.location` because that is
 * the shape a deep link arrives in — there is no navigation here and nothing to read off `location`.
 */
export function readHandoffFromUrl(url: string): { code: string } | { error: true } | null {
  const hash = url.indexOf("#");
  if (hash < 0) return null;
  const params = new URLSearchParams(url.slice(hash + 1));
  const code = params.get(HANDOFF_KEY);
  if (code) return { code };
  if (params.get(ERROR_KEY)) return { error: true };
  return null;
}

/**
 * Run the native Google sign-in and return the one-time handoff code.
 *
 * Resolves only once the deep link arrives. Rejects with `GoogleSignInCancelled` if the player
 * dismisses the sheet, and with an ordinary Error if the server reported a failure.
 */
export async function signInWithGoogleNative(): Promise<string> {
  const [{ App }, { Browser }] = await Promise.all([
    import("@capacitor/app"),
    import("@capacitor/browser"),
  ]);

  // Asked for FIRST, before anything is presented: this is the call that records the state, the
  // nonce and — the part that saves a guest's progress — their identity, against the transaction.
  // "native" is what makes the server redirect to our scheme instead of the website.
  const { authorize_url } = await api.googleStart("native");

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const listeners: { remove: () => Promise<void> | void }[] = [];

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      // Remove listeners BEFORE closing: `Browser.close()` emits `browserFinished`, which would
      // otherwise arrive after a success and report a cancellation over the top of it.
      for (const l of listeners) void l.remove();
      void Browser.close().catch(() => {
        /* already closed by the redirect on some iOS versions — not an error */
      });
      fn();
    };

    void App.addListener("appUrlOpen", ({ url }) => {
      const ret = readHandoffFromUrl(url ?? "");
      if (!ret) return; // some other deep link — leave it for whoever owns it
      if ("error" in ret) finish(() => reject(new Error("google sign-in failed")));
      else finish(() => resolve(ret.code));
    }).then((l) => listeners.push(l));

    // The player dismissed the sheet. Indistinguishable from any other close at this layer, so it
    // is only treated as a cancellation because no deep link arrived first — `finish` makes that
    // race safe in one direction.
    void Browser.addListener("browserFinished", () => {
      finish(() => reject(new GoogleSignInCancelled()));
    }).then((l) => listeners.push(l));

    void Browser.open({ url: authorize_url, presentationStyle: "popover" }).catch((err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
  });
}
