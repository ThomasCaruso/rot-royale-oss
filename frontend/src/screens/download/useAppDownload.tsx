import { useCallback, useEffect, useRef, useState } from "react";
import { trackFunnel } from "@/lib/analytics";
import { APP_STORE_URL } from "@/lib/appLinks";
import { AppStoreBlockedNotice } from "./AppStoreBlockedNotice";
import {
  createDownloadWatchdog,
  detectInAppBrowser,
  planEscapes,
  type EscapePlan,
  type InAppBrowser,
} from "@/lib/downloadBrowser";

/**
 * The whole download-CTA behavior behind one hook, so a caller keeps a REAL anchor:
 *
 *   const { handleDownloadClick, helpPanel } = useAppDownload();
 *   <a href={APP_STORE_URL} onClick={handleDownloadClick}>Download on the App Store</a>
 *   {helpPanel}
 *
 * **Ordinary browsers are never touched.** No `preventDefault()`, no scripted navigation, no UI —
 * the anchor does exactly what an anchor does, and in Safari/Chrome that opens the App Store.
 *
 * **Inside a Meta in-app browser the click is ALSO not intercepted** — deliberately, after
 * intercepting it made things worse on a real device. Preventing the default meant that when the
 * scheme handoff was refused the visitor got NOTHING; letting the anchor go means the worst case is
 * the App Store web page rendering inside the WebView, which still has a Get button. The escape
 * ladder then runs behind it on a short delay: if the anchor navigation worked we are already
 * unloaded, and if it was swallowed the rungs fire into a page that is still alive.
 *
 * Inside a Meta WebView the explanation appears IN THE SAME TAP. A device trace (Instagram 440 /
 * iOS 26) showed every rung firing with no lifecycle signal coming back at all, so we already know
 * the App Store is unreachable there — making the visitor watch a dead button for two seconds
 * before saying so just reads as an unresponsive page.
 *
 * The escape ladder still runs underneath, silently. Other Meta builds may honour a rung, and if
 * one ever does the handoff simply happens and `onSignal` retracts the notice on the way out. So
 * the visitor gets an instant answer AND still gets the App Store if it turns out to be reachable.
 *
 * Every step is recorded in `debugLog` so `/download?debug=1` can show, on the device, exactly
 * what fired and what came back. Two rounds of guessing at this from a laptop were two too many.
 */
/** How long the anchor's own navigation gets before the escape ladder starts firing into the page. */
const ANCHOR_GRACE_MS = 400;

export function useAppDownload() {
  // One watchdog per mounted caller; created lazily so it is never rebuilt across renders.
  const watchdogRef = useRef<ReturnType<typeof createDownloadWatchdog> | null>(null);
  if (watchdogRef.current === null) watchdogRef.current = createDownloadWatchdog();
  const watchdog = watchdogRef.current;

  // Set the moment a Meta-WebView visitor taps Download — never on arrival, and never in an
  // ordinary browser, where the tap simply works.
  const [blocked, setBlocked] = useState(false);
  // Read once: the user agent cannot change during a page view.
  const [inAppBrowser] = useState<InAppBrowser>(() => detectInAppBrowser());
  // On-device trace for ?debug=1. Never sent anywhere — it only renders on this page.
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const note = useCallback((line: string) => {
    setDebugLog((log) => [...log, line]);
  }, []);

  // Unmount kills any in-flight ladder — no timer left to fire into a dead component.
  useEffect(() => () => watchdog.cancel(), [watchdog]);

  const callbacks = useCallback(
    (plan: EscapePlan) => ({
      onSignal: (signal: string) => {
        trackFunnel("download_meta_escape_signal", plan.browser);
        note(`signal: ${signal} — handoff worked`);
        // It worked after all — retract the notice rather than leave it behind them.
        setBlocked(false);
      },
      onAttempt: (attempt: { kind: string }) => {
        trackFunnel("download_meta_escape_attempt", plan.browser);
        note(`fired: ${attempt.kind}`);
      },
      // The notice is already up by now; this only records that no rung ever landed, which is
      // the number worth watching if Meta's behaviour ever changes.
      onGiveUp: () => {
        trackFunnel("download_fallback_shown", plan.browser);
        note("every rung spent, no handoff");
      },
    }),
    [note],
  );

  const handleDownloadClick = useCallback(() => {
    trackFunnel("download_cta_tap", inAppBrowser ?? undefined);
    note("tap — letting the anchor navigate");
    const plan = planEscapes(APP_STORE_URL);
    // Ordinary browser: nothing to do. The anchor navigates natively — that is the fast path.
    if (!plan) return;
    // Meta WebView: answer immediately, in this tap. Idempotent, so repeated taps never stack.
    setBlocked(true);
    note("Meta WebView — showing the explanation now, ladder running underneath");
    // Do NOT preventDefault. Give the real navigation first refusal, then run the ladder a beat
    // later for the case where the WebView swallowed it. If any rung lands, onSignal retracts.
    watchdog.run(plan, { ...callbacks(plan), initialDelayMs: ANCHOR_GRACE_MS });
  }, [watchdog, callbacks, inAppBrowser, note]);

  // The help panel's retry — re-walks the ladder from the top in its OWN click stack, so the
  // strongest rung again gets a trusted gesture behind it.
  return {
    handleDownloadClick,
    /** Rendered only after a tap has visibly failed; null until then. */
    blockedNotice:
      blocked && inAppBrowser ? <AppStoreBlockedNotice browser={inAppBrowser} /> : null,
    /** Which Meta in-app browser this visitor is inside, if any. */
    inAppBrowser,
    /** Ordered trace of what happened, for the ?debug=1 panel. */
    debugLog,
  };
}
