import { Capacitor } from "@capacitor/core";
import { APP_STORE_URL, APPLE_APP_ID } from "@/lib/appLinks";

/**
 * Ask for a rating — Apple's native in-app sheet where it exists, a store link everywhere else.
 *
 * On iOS this is `SKStoreReviewController` via @capacitor-community/in-app-review: the star popup
 * appears OVER the game, the player never leaves, and Apple handles the submission. It is strictly
 * better than a link — but it comes with rules that shape the code:
 *
 *  * Apple decides whether it actually appears. The system throttles it (roughly three prompts per
 *    app per year) and shows NOTHING when it declines. There is no callback, no error, and no way
 *    to detect it — `requestReview()` resolves either way. So we can never "retry with the link",
 *    because we cannot tell a silent suppression from a shown-and-dismissed sheet. Trying would
 *    show a store page to someone who just rated us.
 *  * That silence is exactly why the ASK is rationed on our side too (§7b2 — third completed run).
 *    A prompt Apple suppresses is a prompt wasted, so we only spend it on engaged players.
 *
 * Android's Play In-App Review has the same shape, so the same call covers it. The web build has no
 * native sheet at all and falls through to the store link, as does any platform where the plugin
 * fails to load (a binary built before the plugin was added — see §7c: the shipped app is always
 * the compatibility floor).
 */
const IOS_REVIEW_URL = `itms-apps://apps.apple.com/us/app/rot-royale/id${APPLE_APP_ID}?action=write-review`;
const IOS_WEB_REVIEW_URL = `${APP_STORE_URL}?action=write-review`;
const ANDROID_PACKAGE = "live.rotroyale.app"; // capacitor.config.ts appId
const ANDROID_URL = `market://details?id=${ANDROID_PACKAGE}`;
const ANDROID_WEB_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

function openStoreLink(): void {
  const platform = Capacitor.getPlatform();
  const primary =
    platform === "ios" ? IOS_REVIEW_URL : platform === "android" ? ANDROID_URL : IOS_WEB_REVIEW_URL;
  const fallback = platform === "android" ? ANDROID_WEB_URL : IOS_WEB_REVIEW_URL;
  try {
    window.open(primary, "_blank");
  } catch {
    // A custom scheme with no handler (a browser, or a device without the store app) throws or
    // no-ops; the https page renders everywhere.
    window.open(fallback, "_blank");
  }
}

export async function openStoreReview(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    openStoreLink();
    return;
  }
  try {
    // Imported lazily so the web bundle never pulls in a native-only plugin, and so a binary that
    // predates the plugin fails HERE (import throws) rather than at module load.
    const { InAppReview } = await import("@capacitor-community/in-app-review");
    await InAppReview.requestReview();
  } catch {
    openStoreLink();
  }
}
