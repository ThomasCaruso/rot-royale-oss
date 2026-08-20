// @vitest-environment jsdom
/**
 * The Meta in-app-browser escape module. Three layers, all covered here:
 *   1. user-agent detection (pure)
 *   2. custom-scheme URL construction (pure, exact strings)
 *   3. the watchdog's escalation ladder (fake timers, real jsdom listeners)
 *
 * Nothing here depends on an actual Instagram/Facebook app being installed — every UA is a
 * fixture and every navigation goes through the module's `nav` seam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLE_APP_ID, APP_STORE_URL, DOWNLOAD_PAGE_URL } from "@/lib/appLinks";
import {
  buildAndroidIntentUrl,
  buildInstagramExternalBrowserUrl,
  buildSafariExternalBrowserUrl,
  buildAppStoreSchemeUrl,
  createDownloadWatchdog,
  detectInAppBrowser,
  isAndroid,
  isIOS,
  nav,
  planEscapes,
  RUNG_INTERVAL_MS,
  type EscapePlan,
} from "@/lib/downloadBrowser";

// --- User-agent fixtures ------------------------------------------------------------------
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko)";

const UA = {
  iosSafari: `${IOS} Version/17.5 Mobile/15E148 Safari/604.1`,
  iosChrome: `${IOS} CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1`,
  androidChrome: `${ANDROID} Chrome/126.0.0.0 Mobile Safari/537.36`,
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  // Capacitor's iOS WebView adds nothing of its own by default; some builds append the app name.
  capacitor: `${IOS} Mobile/15E148`,
  capacitorNamed: `${IOS} Mobile/15E148 RotRoyale/1.0`,
  instagramIOS: `${IOS} Mobile/15E148 Instagram 331.0.0.37.90 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 561118926)`,
  instagramAndroid: `${ANDROID} Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 331.0.0.37.90 Android (34/14; 420dpi; 1080x2201; Google/google; Pixel 8; shiba; en_US)`,
  // Threads ships under its internal codename "Barcelona" and still carries the Instagram token —
  // the detector must not mistake it for Instagram.
  threadsIOS: `${IOS} Mobile/15E148 Instagram 331.0.0.37.90 Barcelona (iPhone14,5; iOS 17_5; en_US)`,
  threadsNamed: `${IOS} Mobile/15E148 Threads 331.0.0.37.90`,
  // One token each, so each Facebook marker is proven independently.
  facebookFBAN: `${IOS} Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,5;FBMD/iPhone]`,
  facebookFBAV: `${IOS} Mobile/15E148 [FBAV/468.0.0.47.108;FBDV/iPhone14,5]`,
  facebookFBIAB: `${ANDROID} Chrome/126.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBLC/en_US]`,
  messengerIOS: `${IOS} Mobile/15E148 [FBAN/MessengerForiOS;FBAV/468.0.0.47.108;FBDV/iPhone14,5]`,
  messengerAndroid: `${ANDROID} Chrome/126.0.0.0 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/468.0.0.32.108]`,
} as const;

describe("device detection", () => {
  it("recognizes iOS", () => {
    expect(isIOS(UA.iosSafari)).toBe(true);
    expect(isIOS(UA.instagramIOS)).toBe(true);
    expect(isIOS(UA.androidChrome)).toBe(false);
  });

  it("recognizes Android", () => {
    expect(isAndroid(UA.androidChrome)).toBe(true);
    expect(isAndroid(UA.instagramAndroid)).toBe(true);
    expect(isAndroid(UA.iosSafari)).toBe(false);
  });

  it("fails safely on an empty user agent", () => {
    expect(isIOS("")).toBe(false);
    expect(isAndroid("")).toBe(false);
  });
});

describe("detectInAppBrowser — Meta browsers are identified", () => {
  const CASES: Array<[string, keyof typeof UA, string]> = [
    ["Instagram on iOS", "instagramIOS", "instagram"],
    ["Instagram on Android", "instagramAndroid", "instagram"],
    ["Threads on iOS (Barcelona codename)", "threadsIOS", "threads"],
    ["Threads on iOS (named)", "threadsNamed", "threads"],
    ["Facebook via FBAN", "facebookFBAN", "facebook"],
    ["Facebook via FBAV", "facebookFBAV", "facebook"],
    ["Facebook via FB_IAB on Android", "facebookFBIAB", "facebook"],
    ["Messenger on iOS", "messengerIOS", "messenger"],
    ["Messenger on Android", "messengerAndroid", "messenger"],
  ];

  it.each(CASES)("%s", (_label, key, expected) => {
    expect(detectInAppBrowser(UA[key])).toBe(expected);
  });
});

describe("detectInAppBrowser — ordinary browsers are NEVER classified as Meta", () => {
  const CASES: Array<[string, keyof typeof UA]> = [
    ["iOS Safari", "iosSafari"],
    ["iOS Chrome", "iosChrome"],
    ["Android Chrome", "androidChrome"],
    ["Android Firefox", "androidFirefox"],
    ["the Rot Royale Capacitor WebView", "capacitor"],
    ["the Rot Royale Capacitor WebView (named build)", "capacitorNamed"],
  ];

  it.each(CASES)("%s", (_label, key) => {
    expect(detectInAppBrowser(UA[key])).toBeNull();
  });

  it("fails safely when the user agent is empty or unavailable", () => {
    expect(detectInAppBrowser("")).toBeNull();
    // Shadow the prototype getter with an own property, then remove it again.
    Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => "" });
    expect(detectInAppBrowser()).toBeNull();
    expect(isIOS()).toBe(false);
    Reflect.deleteProperty(navigator, "userAgent");
  });
});

describe("URL builders — exact strings", () => {
  it("swaps https for the App Store's own itms-apps scheme", () => {
    // The load-bearing one: a WebView can't handle a non-http scheme, so iOS takes it instead.
    expect(buildAppStoreSchemeUrl(APP_STORE_URL)).toBe(
      "itms-apps://apps.apple.com/us/app/rot-royale/id6781928142",
    );
  });

  it("encodes the Instagram external-browser URL exactly", () => {
    expect(buildInstagramExternalBrowserUrl(APP_STORE_URL)).toBe(
      "instagram://extbrowser,https%3A%2F%2Fapps.apple.com%2Fus%2Fapp%2Frot-royale%2Fid6781928142",
    );
  });

  it("prefixes the Safari scheme without encoding the destination", () => {
    expect(buildSafariExternalBrowserUrl(APP_STORE_URL)).toBe(
      "x-safari-https://apps.apple.com/us/app/rot-royale/id6781928142",
    );
  });

  it("constructs the Android intent URL exactly", () => {
    expect(buildAndroidIntentUrl(APP_STORE_URL)).toBe(
      "intent://apps.apple.com/us/app/rot-royale/id6781928142#Intent;scheme=https;end",
    );
  });

  it("strips only the LEADING https:// so the rest of the URL survives", () => {
    expect(buildAndroidIntentUrl("https://rotroyale.live/go?to=https://apps.apple.com/x")).toBe(
      "intent://rotroyale.live/go?to=https://apps.apple.com/x#Intent;scheme=https;end",
    );
  });

  it("refuses unexpected destination protocols instead of building a scheme URL", () => {
    for (const bad of ["http://apps.apple.com/x", "javascript:alert(1)", "/download", "", "apps.apple.com"]) {
      expect(buildAppStoreSchemeUrl(bad)).toBeNull();
      expect(buildInstagramExternalBrowserUrl(bad)).toBeNull();
      expect(buildSafariExternalBrowserUrl(bad)).toBeNull();
      expect(buildAndroidIntentUrl(bad)).toBeNull();
    }
  });

  it("keeps the canonical links centralized and exact", () => {
    expect(APP_STORE_URL).toBe("https://apps.apple.com/us/app/rot-royale/id6781928142");
    // The link published externally. It must match the Smart App Banner's app id in download.html.
    expect(DOWNLOAD_PAGE_URL).toBe("https://rotroyale.live/download");
    expect(APP_STORE_URL.endsWith(APPLE_APP_ID)).toBe(true);
  });
});

describe("planEscapes — the ladder, best outcome first", () => {
  const APP_STORE_SCHEME = "itms-apps://apps.apple.com/us/app/rot-royale/id6781928142";
  const SAFARI_SCHEME = "x-safari-https://apps.apple.com/us/app/rot-royale/id6781928142";
  const EXTBROWSER =
    "instagram://extbrowser,https%3A%2F%2Fapps.apple.com%2Fus%2Fapp%2Frot-royale%2Fid6781928142";

  it("always leads with the App Store scheme on iOS — the only one-step rung", () => {
    for (const key of ["instagramIOS", "threadsIOS", "facebookFBAN", "messengerIOS"] as const) {
      const plan = planEscapes(APP_STORE_URL, UA[key]);
      expect(plan?.attempts[0]).toEqual({
        kind: "app-store",
        method: "location",
        url: APP_STORE_SCHEME,
      });
    }
  });

  it("Instagram/Threads on iOS: App Store → Safari → the legacy extbrowser hatch", () => {
    const plan = planEscapes(APP_STORE_URL, UA.instagramIOS);
    expect(plan?.browser).toBe("instagram");
    expect(plan?.platform).toBe("ios");
    expect(plan?.attempts).toEqual([
      { kind: "app-store", method: "location", url: APP_STORE_SCHEME },
      { kind: "safari", method: "window-open", url: SAFARI_SCHEME },
      { kind: "extbrowser", method: "location", url: EXTBROWSER },
    ]);
  });

  it("Facebook/Messenger on iOS: App Store → Safari, with no Instagram-only rung", () => {
    const plan = planEscapes(APP_STORE_URL, UA.facebookFBAN);
    expect(plan?.attempts.map((a) => a.kind)).toEqual(["app-store", "safari"]);
    expect(planEscapes(APP_STORE_URL, UA.messengerIOS)?.attempts.map((a) => a.kind)).toEqual([
      "app-store",
      "safari",
    ]);
  });

  it("Android Meta: the intent URL, exactly", () => {
    const plan = planEscapes(APP_STORE_URL, UA.instagramAndroid);
    expect(plan?.platform).toBe("android");
    expect(plan?.attempts).toEqual([
      {
        kind: "intent",
        method: "location",
        url: "intent://apps.apple.com/us/app/rot-royale/id6781928142#Intent;scheme=https;end",
      },
    ]);
  });

  it("returns null for ordinary browsers and unrecognized platforms", () => {
    expect(planEscapes(APP_STORE_URL, UA.iosSafari)).toBeNull();
    expect(planEscapes(APP_STORE_URL, UA.androidChrome)).toBeNull();
    expect(planEscapes(APP_STORE_URL, UA.capacitor)).toBeNull();
    // A Meta desktop UA: recognized app, but no escape hatch for the platform → hands off.
    expect(planEscapes(APP_STORE_URL, "Mozilla/5.0 (Windows NT 10.0) [FBAN/FBW]")).toBeNull();
    expect(planEscapes("http://apps.apple.com/x", UA.instagramIOS)).toBeNull();
  });
});


describe("download watchdog — walking the ladder", () => {
  const APP_STORE = { kind: "app-store", method: "location", url: "itms-apps://store" } as const;
  const SAFARI = { kind: "safari", method: "window-open", url: "x-safari-https://store" } as const;
  const EXT = { kind: "extbrowser", method: "location", url: "instagram://extbrowser,x" } as const;
  const PLAN: EscapePlan = {
    browser: "instagram",
    platform: "ios",
    attempts: [APP_STORE, SAFARI, EXT],
  };

  // Every test stubs the navigation seam so jsdom never tries to follow a custom scheme.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(nav, "assign").mockImplementation(() => {});
    vi.spyOn(nav, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setVisibility("visible");
  });

  function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  }

  it("fires the App Store scheme IMMEDIATELY — in the caller's own click stack", () => {
    createDownloadWatchdog().run(PLAN, { onGiveUp: vi.fn() });
    // Zero timers advanced, nothing awaited: this is the one-tap path.
    expect(vi.mocked(nav.assign)).toHaveBeenCalledWith("itms-apps://store");
    expect(vi.mocked(nav.open)).not.toHaveBeenCalled();
  });

  it("walks the remaining rungs in order, on the interval", () => {
    const onAttempt = vi.fn();
    createDownloadWatchdog().run(PLAN, { onAttempt, onGiveUp: vi.fn() });
    expect(onAttempt).toHaveBeenLastCalledWith(APP_STORE);

    vi.advanceTimersByTime(RUNG_INTERVAL_MS);
    expect(vi.mocked(nav.open)).toHaveBeenCalledWith("x-safari-https://store", "_blank");
    expect(onAttempt).toHaveBeenLastCalledWith(SAFARI);

    vi.advanceTimersByTime(RUNG_INTERVAL_MS);
    expect(vi.mocked(nav.assign)).toHaveBeenCalledWith("instagram://extbrowser,x");
    expect(onAttempt).toHaveBeenLastCalledWith(EXT);
    expect(onAttempt).toHaveBeenCalledTimes(3);
  });

  it("only gives up once EVERY rung is spent", () => {
    const onGiveUp = vi.fn();
    createDownloadWatchdog().run(PLAN, { onGiveUp });
    vi.advanceTimersByTime(RUNG_INTERVAL_MS * 3 - 1);
    expect(onGiveUp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("shows nothing while the ladder is still running", () => {
    const onGiveUp = vi.fn();
    createDownloadWatchdog().run(PLAN, { onGiveUp });
    vi.advanceTimersByTime(RUNG_INTERVAL_MS * 2);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("stops the ladder the moment the first rung works", () => {
    const onSignal = vi.fn();
    const onGiveUp = vi.fn();
    createDownloadWatchdog().run(PLAN, { onSignal, onGiveUp });
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(60_000);
    expect(onSignal).toHaveBeenCalledWith("visibilitychange");
    // Only the App Store rung ever fired — no Safari, no extbrowser, no help.
    expect(vi.mocked(nav.open)).not.toHaveBeenCalled();
    expect(vi.mocked(nav.assign)).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("a visibilitychange while still visible does NOT count as success", () => {
    const onSignal = vi.fn();
    const onGiveUp = vi.fn();
    createDownloadWatchdog().run(PLAN, { onSignal, onGiveUp });
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(RUNG_INTERVAL_MS * 3);
    expect(onSignal).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it.each(["pagehide", "blur"] as const)("a %s signal cancels the rest of the ladder", (event) => {
    const onSignal = vi.fn();
    const onGiveUp = vi.fn();
    createDownloadWatchdog().run(PLAN, { onSignal, onGiveUp });
    window.dispatchEvent(new Event(event));
    vi.advanceTimersByTime(60_000);
    expect(onSignal).toHaveBeenCalledWith(event);
    expect(vi.mocked(nav.open)).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("still catches a LATE signal that lands mid-ladder", () => {
    const onSignal = vi.fn();
    const onGiveUp = vi.fn();
    createDownloadWatchdog().run(PLAN, { onSignal, onGiveUp });
    vi.advanceTimersByTime(RUNG_INTERVAL_MS); // Safari rung fires
    window.dispatchEvent(new Event("pagehide")); // it worked, a beat later
    vi.advanceTimersByTime(60_000);
    expect(onSignal).toHaveBeenCalledWith("pagehide");
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("does not treat a null window.open return as failure", () => {
    const onGiveUp = vi.fn();
    const safariOnly: EscapePlan = { browser: "facebook", platform: "ios", attempts: [SAFARI] };
    createDownloadWatchdog().run(safariOnly, { onGiveUp });
    expect(vi.mocked(nav.open)).toHaveReturnedWith(null);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("removes every listener after a success signal", () => {
    const onSignal = vi.fn();
    const watchdog = createDownloadWatchdog();
    watchdog.run(PLAN, { onSignal, onGiveUp: vi.fn() });
    window.dispatchEvent(new Event("blur"));
    expect(watchdog.isRunning()).toBe(false);
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("pagehide"));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it("removes every listener after giving up", () => {
    const onSignal = vi.fn();
    const onGiveUp = vi.fn();
    const watchdog = createDownloadWatchdog();
    watchdog.run(PLAN, { onSignal, onGiveUp });
    vi.advanceTimersByTime(RUNG_INTERVAL_MS * 3);
    expect(watchdog.isRunning()).toBe(false);
    window.dispatchEvent(new Event("blur"));
    expect(onSignal).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("a new run supersedes the previous unfinished ladder", () => {
    const onGiveUp = vi.fn();
    const watchdog = createDownloadWatchdog();
    watchdog.run(PLAN, { onGiveUp });
    vi.advanceTimersByTime(RUNG_INTERVAL_MS); // into rung 2
    watchdog.run(PLAN, { onGiveUp }); // repeated tap restarts from the top
    vi.advanceTimersByTime(RUNG_INTERVAL_MS * 3);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("repeated taps never produce duplicate give-up callbacks", () => {
    const onGiveUp = vi.fn();
    const watchdog = createDownloadWatchdog();
    for (let i = 0; i < 5; i++) watchdog.run(PLAN, { onGiveUp });
    vi.advanceTimersByTime(60_000);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("cancel() (unmount) stops the ladder dead", () => {
    const onSignal = vi.fn();
    const onGiveUp = vi.fn();
    const watchdog = createDownloadWatchdog();
    watchdog.run(PLAN, { onSignal, onGiveUp });
    watchdog.cancel();
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("blur"));
    expect(vi.mocked(nav.open)).not.toHaveBeenCalled(); // no further rungs
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(onSignal).not.toHaveBeenCalled();
    expect(watchdog.isRunning()).toBe(false);
  });
});
