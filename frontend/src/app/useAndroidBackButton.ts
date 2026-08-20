import { useEffect } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { runBackInterceptors } from "@/app/backInterceptors";

/**
 * Android hardware/gesture BACK.
 *
 * Android-only by construction: `@capacitor/app` only emits `backButton` on Android, so the
 * listener is inert on iOS and on the web. Nothing here changes either.
 *
 * Why it's needed: the app navigates by STATE, not routes — `campaignOpen`, `vaultOpen`,
 * `contestWindowId` and friends. There is no browser history to pop, so Capacitor's default
 * behaviour ("go back, or exit if you can't") means back exits the app from ANY screen. On Android
 * that's the first thing every user does, and mid-Daily-Royale it would burn their one attempt of
 * the day.
 *
 * The rule, in priority order:
 *   1. An immersive run (Daily Royale / practice / campaign level) SWALLOWS back. Questions are
 *      one-shot and server-scored; an accidental swipe must not drop out of one. The screen's own
 *      exit control is the way out.
 *   2. Any open overlay closes, one layer at a time.
 *   3. At the true root, back exits — the behaviour Android users expect. Swallowing it there
 *      traps people in the app, which Play reviewers do flag.
 */
export function useAndroidBackButton({
  inImmersiveRun,
  closeTopOverlay,
}: {
  /** A question flow is on screen; back must do nothing at all. */
  inImmersiveRun: boolean;
  /** Close the topmost overlay. Returns false when nothing was open. */
  closeTopOverlay: () => boolean;
}): void {
  useEffect(() => {
    const handle = CapacitorApp.addListener("backButton", () => {
      if (inImmersiveRun) return; // swallow — never drop out of a scored run
      // Child-owned layers first (results modal, live duel, sheets). They sit visually above
      // anything App-level, so they must get the press first — and without this, back on one of
      // them matched no App branch and exited the app outright.
      if (runBackInterceptors()) return;
      if (closeTopOverlay()) return; // consumed an App-level layer
      void CapacitorApp.exitApp(); // at root: behave like a normal Android app
    });
    return () => {
      // addListener resolves to a handle; remove it on re-subscribe so a stale closure (holding an
      // old `inImmersiveRun`) can't also fire and exit the app during a run.
      void handle.then((h) => h.remove());
    };
  }, [inImmersiveRun, closeTopOverlay]);
}
