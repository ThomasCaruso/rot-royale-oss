// Push opt-in — platform-aware. On a native build (Capacitor iOS/Android) we register for real
// APNs/FCM notifications via @capacitor/push-notifications and send the device token to the server.
// On the web/PWA we use the Web Push (VAPID) path. Every branch returns a state the UI can render
// and never throws on an unsupported path.

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { api } from "@/api/client";

export type PushState =
  | "unsupported" // web: no SW/PushManager/Notification (or server VAPID off)
  | "ios-needs-pwa" // web on iOS: push works only when added to the Home Screen
  | "default" // supported, not yet subscribed
  | "denied" // permission blocked
  | "subscribed"; // active subscription

// Native: remember our own opt-in + the last device token (OS permission alone can't tell us
// whether the server currently has this device registered).
const NATIVE_ENABLED_KEY = "rr.push_native_enabled";
const NATIVE_TOKEN_KEY = "rr.push_native_token";

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// ─────────────────────────── native (Capacitor / APNs) ───────────────────────────
async function nativeState(): Promise<PushState> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive === "denied") return "denied";
  const { value } = await Preferences.get({ key: NATIVE_ENABLED_KEY });
  return perm.receive === "granted" && value === "1" ? "subscribed" : "default";
}

async function registerAndGetToken(): Promise<string | null> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.removeAllListeners();
  return new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      void PushNotifications.removeAllListeners();
      resolve(v);
    };
    void PushNotifications.addListener("registration", (t: { value: string }) => finish(t.value));
    void PushNotifications.addListener("registrationError", () => finish(null));
    void PushNotifications.register();
    // Never hang the UI if the OS/APNs is slow or unavailable.
    setTimeout(() => finish(null), 8000);
  });
}

async function nativeEnable(): Promise<PushState> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive === "denied") return "denied";
  if (perm.receive !== "granted") return "default";

  const token = await registerAndGetToken();
  if (!token) return "default"; // registration didn't complete — leave it re-tappable

  const platform = Capacitor.getPlatform() === "android" ? "android" : "ios";
  // provisional:false — this token came from the REAL prompt, so it clears any earlier quiet
  // registration of the same device and retires the upgrade ask.
  await api.pushSubscribeNative({ device_token: token, platform, provisional: false });
  await Preferences.set({ key: NATIVE_TOKEN_KEY, value: token });
  await Preferences.set({ key: NATIVE_ENABLED_KEY, value: "1" });
  return "subscribed";
}

async function nativeDisable(): Promise<PushState> {
  const { value: token } = await Preferences.get({ key: NATIVE_TOKEN_KEY });
  if (token) await api.pushUnsubscribe({ device_token: token }).catch(() => undefined);
  await Preferences.remove({ key: NATIVE_ENABLED_KEY });
  await Preferences.remove({ key: NATIVE_TOKEN_KEY });
  return nativeState();
}

// ─────────────────────────── web (Web Push / VAPID) ───────────────────────────
interface MaybeStandaloneNavigator extends Navigator {
  standalone?: boolean; // non-standard, iOS Safari only
}

function isStandalone(): boolean {
  const mm = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return mm || (navigator as MaybeStandaloneNavigator).standalone === true;
}

function isIOSWeb(): boolean {
  const ua = navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function apisPresent(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * The service-worker registration, tolerating the first-load race: `getRegistration()` resolves
 * `undefined` while `vite-plugin-pwa`'s injected `window.load` registration is still in flight,
 * so fall back to `serviceWorker.ready`. Bounded, because `ready` never settles when nothing
 * ever registers (dev builds set `devOptions.enabled: false`) and the UI must not hang.
 */
async function activeRegistration(
  timeoutMs = 3000,
): Promise<ServiceWorkerRegistration | undefined> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
}

async function webState(): Promise<PushState> {
  if (isIOSWeb() && !isStandalone()) return "ios-needs-pwa";
  if (!apisPresent()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "default";
  const sub = await reg.pushManager.getSubscription();
  return sub ? "subscribed" : "default";
}

async function webEnable(): Promise<PushState> {
  if (isIOSWeb() && !isStandalone()) return "ios-needs-pwa";
  if (!apisPresent()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "default";

  const reg = await activeRegistration();
  // No registration YET is not the same as "this browser can't do push" — the PWA plugin
  // registers on window load, so an early tap can arrive first. Report the retryable state
  // instead of the terminal one, or a first-time visitor gets told push is unsupported on a
  // browser that fully supports it.
  if (!reg) return "default";

  const { public_key } = await api.vapidPublicKey();
  if (!public_key) return "unsupported";

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(public_key),
  });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "default";
  await api.pushSubscribe({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return "subscribed";
}

async function webDisable(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe({ endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return webState();
}

// ─────────────────────────── public API (platform-routed) ───────────────────────────
/** Current opt-in state, safe to call anytime (read-only, no permission prompt). */
export async function getPushState(): Promise<PushState> {
  return isNative() ? nativeState() : webState();
}

/** Request permission (only on explicit user action) and subscribe. Returns the new state. */
export async function enablePush(): Promise<PushState> {
  return isNative() ? nativeEnable() : webEnable();
}

/** Unsubscribe on the server (and locally on web). Returns the new state. */
export async function disablePush(): Promise<PushState> {
  return isNative() ? nativeDisable() : webDisable();
}


/**
 * Register the QUIET (provisional) token, if iOS granted one at launch.
 *
 * The native side asks for provisional authorization in AppDelegate — silent, no prompt — and calls
 * registerForRemoteNotifications. That produces a device token, but the token only reaches us if a
 * JS listener is attached when it lands, which is why this runs at startup rather than on demand.
 *
 * Registering it is what makes a player REACHABLE from day one. It is deliberately NOT recorded as
 * an opt-in: `NATIVE_ENABLED_KEY` stays unset, so the ProfileMenu toggle still reads "off" and the
 * server still raises the upgrade prompt. Quiet delivery is reach, not consent.
 *
 * Entirely best-effort. Any failure just means the player isn't reachable yet, which is exactly
 * where they were before.
 */
export async function primeProvisionalPush(): Promise<void> {
  if (!isNative() || Capacitor.getPlatform() !== "ios") return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.checkPermissions();
    // `granted` covers provisional too (the plugin maps .provisional to granted). If the player
    // already opted in for real, nativeEnable owns the token and there is nothing to do here.
    if (perm.receive !== "granted") return;
    const { value: existing } = await Preferences.get({ key: NATIVE_ENABLED_KEY });
    if (existing === "1") return;

    const token = await registerAndGetToken();
    if (!token) return;
    const { value: known } = await Preferences.get({ key: NATIVE_TOKEN_KEY });
    if (known === token) return; // already registered this device quietly
    await api.pushSubscribeNative({ device_token: token, platform: "ios", provisional: true });
    await Preferences.set({ key: NATIVE_TOKEN_KEY, value: token });
  } catch {
    /* no quiet delivery for this device — the status quo, not a failure worth surfacing */
  }
}
