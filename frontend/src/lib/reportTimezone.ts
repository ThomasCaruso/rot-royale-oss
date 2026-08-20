import { api } from "@/api/client";

/**
 * Tell the server which zone this device is in, so evening pushes are timed to the player's evening
 * rather than the contest's (ET). Without this every reminder is 8 PM ET — 5 PM in California, 1 AM
 * in London.
 *
 * Sent at most once per session and only when the value CHANGED (travel, a fresh install), because
 * the answer is stable and the endpoint has no business being called on every app open. Entirely
 * fire-and-forget: a failure costs a slightly mistimed notification, which is not worth surfacing
 * to a player or retrying.
 */
const CACHE_KEY = "rr-reported-tz";

export function reportTimezone(): void {
  let zone: string | undefined;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return; // no Intl, or a locked-down environment — nothing useful to report
  }
  if (!zone) return;
  try {
    if (window.localStorage.getItem(CACHE_KEY) === zone) return;
  } catch {
    /* storage unavailable (private mode) — just send it */
  }
  // try/catch around the CALL as well as .catch on the promise: a synchronous throw would escape a
  // promise handler entirely and take down whatever mounted this. Reporting a timezone must never
  // be able to break the app — a mistimed push is the whole cost of failing here.
  try {
    void api
      .setTimezone(zone)
      .then(() => {
        try {
          window.localStorage.setItem(CACHE_KEY, zone);
        } catch {
          /* nothing to cache into — resending next session is harmless */
        }
      })
      .catch(() => null);
  } catch {
    /* nothing more to do */
  }
}
