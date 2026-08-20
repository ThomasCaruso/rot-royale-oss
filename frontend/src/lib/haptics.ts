import { Capacitor } from "@capacitor/core";

/**
 * Touch feedback that actually fires on a phone.
 *
 * The app previously expressed haptics as `navigator.vibrate(ms)`. **iOS does not implement
 * navigator.vibrate at all** — not in Safari, not in a WKWebView — so every haptic in the app was a
 * silent no-op on iPhone. That is the gap you feel next to a native app like Duolingo: theirs go
 * through the OS feedback generators, ours went nowhere.
 *
 * So this speaks in INTENT (selection, impact, success…) rather than milliseconds. On iOS/Android
 * that maps to `@capacitor/haptics`, which calls UIImpactFeedbackGenerator / UINotificationFeedback
 * Generator — the crisp Taptic Engine taps, not a buzz. On the web it degrades to the closest
 * vibrate pattern, which is all a browser can do.
 *
 * Why intent and not duration: iOS exposes *styles*, not lengths. A duration can only be
 * approximated, and approximating it is how haptics end up feeling like a cheap rumble. The names
 * here are the vocabulary the platform actually has.
 *
 * Every call is fire-and-forget and swallows its own errors. Feedback is a garnish; it must never
 * be able to interrupt a tap, and it must never make a caller `await`.
 */

export type Feel =
  | "selection" // moving between choices — the lightest tick there is
  | "light" // a tap landed, a card flipped
  | "medium" // a commit: locked in, submitted
  | "heavy" // a big beat — placement, level clear
  | "success" // correct, unlocked, saved
  | "warning" // second chance, time running out
  | "error"; // wrong, rejected, failed

/** Web fallback only — iOS ignores these entirely, which is the whole reason this module exists. */
const WEB_PATTERN: Record<Feel, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 20,
  heavy: 35,
  success: [14, 40, 22],
  warning: [18, 60, 18],
  error: [30, 50, 30],
};

let enabled = true;

/** Mirrors the existing sound preference so one switch governs all feedback. */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

function webVibrate(feel: Feel): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    nav.vibrate?.(WEB_PATTERN[feel]);
  } catch {
    /* unsupported or blocked by the browser */
  }
}

export function feedback(feel: Feel): void {
  if (!enabled) return;
  if (!Capacitor.isNativePlatform()) {
    webVibrate(feel);
    return;
  }
  // Imported lazily so the web bundle never pulls in a native-only plugin, and so a binary built
  // before the plugin existed fails at the import rather than at module load (§7c — the shipped
  // app is always the compatibility floor).
  void import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle, NotificationType }) => {
      switch (feel) {
        case "selection":
          return Haptics.selectionStart().then(() => Haptics.selectionEnd());
        case "light":
          return Haptics.impact({ style: ImpactStyle.Light });
        case "medium":
          return Haptics.impact({ style: ImpactStyle.Medium });
        case "heavy":
          return Haptics.impact({ style: ImpactStyle.Heavy });
        case "success":
          return Haptics.notification({ type: NotificationType.Success });
        case "warning":
          return Haptics.notification({ type: NotificationType.Warning });
        case "error":
          return Haptics.notification({ type: NotificationType.Error });
      }
    })
    .catch(() => {
      /* no haptic engine on this device/build — silence is the correct degradation */
    });
}
