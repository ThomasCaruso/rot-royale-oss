/**
 * Meta in-app-browser escape — the whole undocumented-browser-scheme surface, in one module.
 *
 * Instagram, Threads, Facebook and Messenger render links inside their own WebView, which can
 * silently drop a navigation to an App Store URL. Each app ships a private escape hatch to hand a
 * URL to the system browser; none of them is documented or guaranteed, so ALL of it is centralized
 * here (detection + URL construction + the navigation call + the success/timeout lifecycle). React
 * components never parse a user agent or build a custom scheme — they call `planEscapes` and hand
 * the plan to the watchdog. If Meta changes a scheme tomorrow, this file is the only edit.
 *
 * The ladder is ordered by OUTCOME, not by cleverness: `itms-apps://` first because it lands the
 * visitor in the App Store in one step, then the browser-escape schemes, then visible help. See
 * `buildAppStoreSchemeUrl` for why a non-http scheme escapes a WebView when an https link cannot.
 *
 * Deliberately NOT here: anything React (see `screens/download/useAppDownload`) and the canonical
 * URLs themselves (see `lib/appLinks`).
 */

/** The Meta in-app browsers we positively recognize. `null` = an ordinary browser (or anything we
 *  can't identify with confidence) — those are never intercepted. */
export type InAppBrowser = "instagram" | "threads" | "facebook" | "messenger" | null;

export type EscapePlatform = "ios" | "android";

/** How the escape URL must be fired. `location` = a synchronous `location.href` assignment;
 *  `window-open` = a synchronous `window.open(url, "_blank")`. */
export type EscapeMethod = "location" | "window-open";

/**
 * What a single attempt is trying to achieve, best outcome first:
 *   `app-store`  → opens the App Store app itself. No browser involved, no second tap. Best.
 *   `safari`     → gets the visitor out to Safari, where the https link then works normally.
 *   `extbrowser` → Instagram's own legacy "open externally" hatch. Removed from newer builds; kept
 *                  as a free last shot because a dead scheme is a silent no-op.
 *   `intent`     → the Android equivalent of `safari`.
 */
export type EscapeKind = "app-store" | "safari" | "extbrowser" | "intent";

/** One ready-to-fire attempt. `location` = a synchronous `location.href` assignment;
 *  `window-open` = a synchronous `window.open(url, "_blank")`. */
export interface EscapeAttempt {
  kind: EscapeKind;
  method: EscapeMethod;
  /** The custom-scheme URL. Never shown to the user. */
  url: string;
}

/** A fully resolved ladder for this environment. Produced by `planEscapes` (pure), walked by the
 *  watchdog. Having the plan separate from the firing is what lets the click handler decide to
 *  `preventDefault()` BEFORE anything with side effects runs. */
export interface EscapePlan {
  browser: Exclude<InAppBrowser, null>;
  platform: EscapePlatform;
  /** Ordered, non-empty. `attempts[0]` is fired synchronously from the tap. */
  attempts: EscapeAttempt[];
}

/** Lifecycle events that mean the handoff worked (the page went to the background). */
export type EscapeSignal = "visibilitychange" | "pagehide" | "blur";

/** Read the user agent, preferring an explicit one (tests / callers) over the ambient navigator.
 *  Never throws: a missing navigator or a missing userAgent both degrade to "" → no detection. */
function readUserAgent(userAgent?: string): string {
  if (typeof userAgent === "string") return userAgent;
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent ?? "";
}

export function isIOS(userAgent?: string): boolean {
  return /\b(iPhone|iPad|iPod)\b/i.test(readUserAgent(userAgent));
}

export function isAndroid(userAgent?: string): boolean {
  return /\bAndroid\b/i.test(readUserAgent(userAgent));
}

// Order matters below — Messenger's UA also carries FBAN/FBAV, and Threads' also carries the
// Instagram token, so the more specific app has to be tested first.
//
// Messenger: `FBAN/MessengerForiOS` (iOS), `FB_IAB/MESSENGER` (Android).
const MESSENGER_RE = /FBAN\/Messenger|FB_IAB\/MESSENGER|\bMessenger(ForiOS|LiteForiOS)?\b/i;
// Threads: ships under its internal codename "Barcelona" in the UA; some builds say "Threads".
const THREADS_RE = /\bThreads\b|\bBarcelona\b/i;
// Instagram: the literal app token, on both iOS and Android.
const INSTAGRAM_RE = /\bInstagram\b/i;
// Facebook: FBAN (iOS app id), FBAV (app version), FB_IAB (Android in-app browser).
const FACEBOOK_RE = /\bFBAN\b|\bFBAV\b|\bFB_IAB\b/i;

/**
 * Positively identify a Meta in-app browser. Returns structured information rather than a boolean
 * so the caller can pick the right escape hatch (Instagram and Facebook use different schemes).
 *
 * Ordinary Safari / Chrome / Firefox and the Rot Royale Capacitor WebView carry none of these
 * tokens and return `null` — they are never intercepted. Weak evidence is not enough: if we can't
 * name the app, the real HTTPS anchor is left alone.
 */
export function detectInAppBrowser(userAgent?: string): InAppBrowser {
  const value = readUserAgent(userAgent);
  if (!value) return null;
  if (MESSENGER_RE.test(value)) return "messenger";
  if (THREADS_RE.test(value)) return "threads";
  if (INSTAGRAM_RE.test(value)) return "instagram";
  if (FACEBOOK_RE.test(value)) return "facebook";
  return null;
}

/** Only https destinations get a custom-scheme rewrite. Anything else (http, a custom scheme, a
 *  relative path, an empty string) is refused so a bad destination can never be smuggled into a
 *  scheme handler — the caller falls back to plain anchor behavior. */
const HTTPS_PREFIX_RE = /^https:\/\//i;

/**
 * THE ONE THAT ACTUALLY GETS THROUGH — `itms-apps://apps.apple.com/…`, the App Store's own scheme.
 *
 * The mechanism, which is why this beats every other rung: a WKWebView (what every in-app browser
 * is) handles `http`/`https` navigations ITSELF. That is the whole problem — Instagram's WebView
 * takes an `apps.apple.com` link and renders/blocks it in place instead of handing it to iOS, and
 * a Universal Link only fires for a genuine tap the host app chooses to pass along.
 *
 * A NON-http(s) scheme is different: the WebView cannot handle it, so iOS takes it and opens
 * whichever app claims it — here, the App Store. Nothing is being bypassed or exploited; this is
 * Apple's own scheme going through Apple's own handler. It is the same mechanism `tel:` and
 * `mailto:` use to escape a WebView, and it is why an in-app browser can't swallow it the way it
 * swallows an https link.
 *
 * Status: `itms-apps` is a long-standing iOS scheme that Apple's CURRENT docs no longer mention
 * (they only document the https form) — so treat it as de-facto rather than contractual, and keep
 * the Safari rungs below it as backup. It has been honoured by every iOS release to date.
 */
export function buildAppStoreSchemeUrl(destination: string): string | null {
  if (!HTTPS_PREFIX_RE.test(destination)) return null;
  return destination.replace(HTTPS_PREFIX_RE, "itms-apps://");
}

/**
 * Instagram / Threads on iOS. `instagram://extbrowser,<encoded https url>` asked the Instagram app
 * to open the URL in the system browser. LEGACY: newer Instagram builds appear to have dropped it
 * (a real-device test showed no handoff), which is why it sits at the BOTTOM of the ladder now
 * rather than being the primary escape. An unhandled scheme is a silent no-op, so it stays as a
 * free extra shot for older builds.
 */
export function buildInstagramExternalBrowserUrl(destination: string): string | null {
  if (!HTTPS_PREFIX_RE.test(destination)) return null;
  return `instagram://extbrowser,${encodeURIComponent(destination)}`;
}

/**
 * Facebook / Messenger on iOS. `x-safari-<https url>` (note: the destination is NOT encoded — the
 * scheme is a literal prefix on the real URL) handed to `window.open(..., "_blank")`.
 */
export function buildSafariExternalBrowserUrl(destination: string): string | null {
  if (!HTTPS_PREFIX_RE.test(destination)) return null;
  return `x-safari-${destination}`;
}

/**
 * Meta in-app browsers on Android. Android intent URLs carry the scheme as a parameter instead of
 * inline, so the `https://` prefix is stripped from the front (and ONLY from the front — a URL
 * that happens to contain "https://" later in a query string survives intact).
 */
export function buildAndroidIntentUrl(destination: string): string | null {
  if (!HTTPS_PREFIX_RE.test(destination)) return null;
  return `intent://${destination.replace(HTTPS_PREFIX_RE, "")}#Intent;scheme=https;end`;
}

/**
 * Build the ordered ladder of attempts for this environment. PURE — no side effects, no DOM access
 * beyond reading the user agent — so a click handler can call it before deciding to intercept.
 *
 * `null` means "don't touch the click": an ordinary browser, an unrecognized in-app browser, a
 * Meta browser on a platform we have no escape hatch for, or a destination we refuse to rewrite.
 *
 * ORDER IS THE PRODUCT DECISION. `app-store` goes first because it is the only rung that lands the
 * visitor on the App Store in ONE step — every other rung merely relocates them to a browser where
 * they still have to tap again.
 */
export function planEscapes(destination: string, userAgent?: string): EscapePlan | null {
  const value = readUserAgent(userAgent);
  const browser = detectInAppBrowser(value);
  if (!browser) return null;

  const attempt = (
    kind: EscapeKind,
    method: EscapeMethod,
    url: string | null,
  ): EscapeAttempt[] => (url ? [{ kind, method, url }] : []);

  if (isIOS(value)) {
    const attempts: EscapeAttempt[] = [
      // 1. Straight to the App Store app. See buildAppStoreSchemeUrl for why this one gets through.
      ...attempt("app-store", "location", buildAppStoreSchemeUrl(destination)),
      // 2. Out to Safari, where the plain https link behaves normally.
      ...attempt("safari", "window-open", buildSafariExternalBrowserUrl(destination)),
      // 3. Instagram's own legacy hatch, for the builds that still honour it.
      ...(browser === "instagram" || browser === "threads"
        ? attempt("extbrowser", "location", buildInstagramExternalBrowserUrl(destination))
        : []),
    ];
    return attempts.length ? { browser, platform: "ios", attempts } : null;
  }

  // Rot Royale is iPhone-only today, but an Android visitor must still not be trapped in Meta's
  // WebView — the intent URL hands them to Chrome, where the App Store page at least renders.
  if (isAndroid(value)) {
    const attempts = attempt("intent", "location", buildAndroidIntentUrl(destination));
    return attempts.length ? { browser, platform: "android", attempts } : null;
  }

  return null;
}

/**
 * The single seam through which this module touches the browser's navigation APIs. Everything else
 * is pure, so tests observe the exact call (`nav.assign` / `nav.open`) instead of fighting jsdom.
 */
export const nav = {
  assign(url: string): void {
    window.location.href = url;
  },
  open(url: string, target: string): Window | null {
    return window.open(url, target);
  },
};



/** Gap between rungs. This no longer gates how fast the visitor gets an answer — the page explains
 *  itself in the tap — so it is tuned purely to give a slow handoff room to register before the
 *  next rung stomps it. */
export const RUNG_INTERVAL_MS = 1200;

export interface WatchOptions {
  /** The page backgrounded — something took over. Nothing further should happen. */
  onSignal?: (signal: EscapeSignal) => void;
  /** A rung just fired. Telemetry only — the visitor is shown nothing. */
  onAttempt?: (attempt: EscapeAttempt) => void;
  /** Every rung is spent and we are still here. Time to show a quiet way out. */
  onGiveUp: () => void;
  intervalMs?: number;
  /**
   * Delay before the FIRST rung. Default 0 = fire synchronously in the caller's click stack (max
   * gesture context). Set a small positive value to let the anchor's own https navigation go first,
   * so the worst case is "the App Store web page loads here" rather than "nothing happens at all".
   */
  initialDelayMs?: number;
}

export interface DownloadWatchdog {
  /**
   * Fire `attempts[0]` SYNCHRONOUSLY (call this from inside the trusted tap), then walk the
   * remaining rungs on a timer until one of them works or they run out.
   */
  run(plan: EscapePlan, options: WatchOptions): void;
  cancel(): void;
  isRunning(): boolean;
}

/** Fire one attempt. Synchronous by construction — never call from a promise continuation. */
function fire(attempt: EscapeAttempt): void {
  if (attempt.method === "window-open") {
    // A null return is NOT proof of failure — Meta's WebView commonly returns null even when it
    // does hand the URL over. Only the lifecycle signals decide.
    nav.open(attempt.url, "_blank");
  } else {
    nav.assign(attempt.url);
  }
}

/**
 * Walks the escalation ladder produced by `planEscapes`, best outcome first.
 *
 * Why the first rung fires INSIDE the tap rather than after a delay: Meta's WebViews only honour a
 * scheme handoff that still carries the trusted-gesture context, so the strongest attempt has to
 * go out in the click's own call stack. Later rungs are fired from timers and may well be ignored
 * for exactly that reason — they are bonus shots, not the plan.
 *
 * On iOS that means: `itms-apps://` (App Store, one step) → `x-safari-` (out to Safari) →
 * `instagram://extbrowser` (legacy) → hand back to the caller for visible help. Any backgrounding
 * signal at any point cancels the rest of the ladder, including one that lands late.
 *
 * One ladder at a time: a new `run` supersedes the previous one, so repeated taps never stack
 * timers, listeners or callbacks.
 */
export function createDownloadWatchdog(): DownloadWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detach: (() => void) | null = null;

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (detach) {
      detach();
      detach = null;
    }
  }

  function listen(onSignal?: (signal: EscapeSignal) => void): void {
    const succeed = (signal: EscapeSignal) => {
      cancel(); // clears the timer AND removes every listener before notifying
      onSignal?.(signal);
    };
    const onVisibility = () => {
      // Only a transition to "hidden" counts. A visibilitychange that leaves the document visible
      // is not a handoff (and fires on plenty of unrelated occasions).
      if (document.visibilityState === "hidden") succeed("visibilitychange");
    };
    const onPageHide = () => succeed("pagehide");
    const onBlur = () => succeed("blur");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("blur", onBlur);
    detach = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("blur", onBlur);
    };
  }

  function run(plan: EscapePlan, options: WatchOptions): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    cancel(); // supersede whatever was in flight

    const {
      onSignal,
      onAttempt,
      onGiveUp,
      intervalMs = RUNG_INTERVAL_MS,
      initialDelayMs = 0,
    } = options;
    listen(onSignal);

    let index = 0;
    const step = () => {
      if (index >= plan.attempts.length) {
        cancel();
        onGiveUp();
        return;
      }
      const attempt = plan.attempts[index++];
      fire(attempt);
      onAttempt?.(attempt);
      // The listeners stay attached across the whole ladder, so a handoff that lands late still
      // cancels whatever is left.
      timer = setTimeout(step, intervalMs);
    };

    // Rung 0 either goes out synchronously (max gesture context) or after a short delay (lets the
    // anchor's real navigation have first refusal). If the anchor navigation succeeds we are
    // unloaded before the timer ever fires, which is the desired outcome.
    if (initialDelayMs > 0) {
      timer = setTimeout(step, initialDelayMs);
    } else {
      step();
    }
  }

  return { run, cancel, isRunning: () => timer !== null };
}
