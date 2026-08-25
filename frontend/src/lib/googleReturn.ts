/**
 * Reading what Google's callback left in the URL fragment, and getting rid of it immediately.
 *
 * The server's callback redirects here with exactly one of:
 *
 *   #handoff=<one-time code>   a completed sign-in, waiting to be collected
 *   #auth_error=google         it did not complete, for a reason the player cannot act on
 *
 * **The fragment is stripped before anything else happens**, not after the exchange resolves. A
 * handoff code is single-use and short-lived, but it is still a credential for those seconds, and
 * leaving it in `location.href` means it rides into `history`, into any `Referer` the page emits,
 * and into whatever a crash reporter or analytics snapshot decides to record. `replaceState` rather
 * than assigning `location.hash`: assigning pushes a history entry and can re-trigger routing, and
 * we want the URL rewritten in place with no navigation at all.
 *
 * Why a fragment rather than a query string: fragments are never sent to a server. Even before we
 * clear it, the code has not travelled anywhere in a request line or a proxy log.
 *
 * Note that no access token, refresh token or ID token ever appears here. Those are minted by
 * `/auth/google/handoff` in exchange for this code, over POST, and never touch a URL.
 */

export type GoogleReturn =
  | { kind: "handoff"; code: string }
  | { kind: "error" }
  | { kind: "none" };

const HANDOFF_KEY = "handoff";
const ERROR_KEY = "auth_error";

/**
 * Read the return parameters out of the current URL and strip them from it.
 *
 * Exported for tests. Application code should call `takeGoogleReturn`, which adds the once-only
 * guarantee that matters at runtime.
 */
export function consumeGoogleReturn(): GoogleReturn {
  if (typeof window === "undefined") return { kind: "none" };

  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!raw) return { kind: "none" };

  const params = new URLSearchParams(raw);
  const code = params.get(HANDOFF_KEY);
  const failed = params.get(ERROR_KEY);
  if (!code && !failed) return { kind: "none" };

  // Strip ONLY what we put there, and keep anything else intact — the fragment is not ours alone,
  // and clobbering it would break any other consumer that happens to use one.
  params.delete(HANDOFF_KEY);
  params.delete(ERROR_KEY);
  const rest = params.toString();
  const url = window.location.pathname + window.location.search + (rest ? `#${rest}` : "");
  try {
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // A browser that refuses replaceState (very old, or an exotic sandbox) still gets a working
    // sign-in; it just keeps a spent code in its URL bar. Failing the sign-in over cosmetics would
    // be the worse trade.
  }

  if (code) return { kind: "handoff", code };
  return { kind: "error" };
}

let taken = false;

/**
 * The return parameters, exactly once per page load.
 *
 * The once-only part is the point. A handoff code is single-use at the SERVER, so a second attempt
 * to redeem the same one is refused — correctly, but the player would see a sign-in that appeared
 * to fail immediately after it worked. React's development double-effect, a remount, or a stray
 * re-render are all ordinary reasons a boot effect runs twice, and none of them should be able to
 * turn a successful sign-in into an error message. Every call after the first returns `none`.
 */
export function takeGoogleReturn(): GoogleReturn {
  if (taken) return { kind: "none" };
  taken = true;
  return consumeGoogleReturn();
}

/** Test-only: forget that the return was already taken. */
export function resetGoogleReturnForTests(): void {
  taken = false;
}
