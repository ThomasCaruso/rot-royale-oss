import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { api } from "@/api/client";
import { completeGoogleHandoff, socialSignIn } from "@/api/session";
import { GoogleSignInCancelled, signInWithGoogleNative } from "@/lib/googleNative";
import { AppleSignInCancelled, signInWithApple, signInWithAppleNative } from "@/lib/appleIdentity";
import { errorMessage } from "@/i18n/errors";
import { useSessionStore } from "@/store/session";
import type { Dict } from "@/i18n/en";

/** The two providers this app can verify. Mirrors `SocialProvider` in ui/SocialButton. */
export type SocialProvider = "apple" | "google";

/**
 * Everything needed to offer Apple / Google sign-in: which providers the SERVER can actually
 * verify, the credentials the browser needs to start each flow, and the two handlers.
 *
 * It is a hook because TWO screens offer these now — the sign-in screen as its main event, and the
 * Daily Royale front door as a small returning-user row under the play button. One copy of the
 * logic, so a change to the Apple nonce handling or the provider gate cannot land on one screen and
 * miss the other. The screens own only their own markup and their own busy/error presentation.
 */
export function useSocialSignIn(t: Dict) {
// Which provider buttons to show. Asked of the SERVER rather than hardcoded: it is the only
// thing that knows which providers it can actually verify, and a button that always fails is
// worse than no button. An empty list (or an unreachable call) drops straight through to the
// email form — a choice screen offering one choice is not a choice.
const [providers, setProviders] = useState<SocialProvider[]>([]);
const [resolved, setResolved] = useState(false);
const [googleClientId, setGoogleClientId] = useState<string | null>(null);
const [appleClientId, setAppleClientId] = useState<string | null>(null);
const [appleRedirectUri, setAppleRedirectUri] = useState<string | null>(null);
const [socialBusy, setSocialBusy] = useState<SocialProvider | null>(null);
const [error, setError] = useState<string | null>(null);
const [notice, setNotice] = useState<string | null>(null);

// A redirect sign-in that came back failed. The fragment is read during boot, before this hook
// exists, so the fact is parked in the session store and collected here — the words are ours to
// choose, because a raw server string must never reach a player.
const authFailed = useSessionStore((s) => s.authFailed);
const clearAuthFailed = useSessionStore((s) => s.setAuthFailed);
useEffect(() => {
  if (!authFailed) return;
  setError(t.auth.somethingWentWrong);
  // Clear it immediately: it describes one round trip, and leaving it set would re-show the same
  // message every time this row remounts for the rest of the session.
  clearAuthFailed(false);
}, [authFailed, clearAuthFailed, t]);

useEffect(() => {
  let cancelled = false;
  api
    .socialProviders()
    .then((r) => {
      if (cancelled) return;
      setProviders(r.providers.filter((p): p is SocialProvider => p === "apple" || p === "google"));
      setGoogleClientId(r.google_client_id ?? null);
      setAppleClientId(r.apple_client_id ?? null);
      setAppleRedirectUri(r.apple_redirect_uri ?? null);
    })
    .catch(() => {
      /* Offline or an older server: fall back to email-only rather than an error screen. */
    })
    .finally(() => {
      if (!cancelled) setResolved(true);
    });
  return () => {
    cancelled = true;
  };
}, []);

// ON THE WEB, Apple matches the Return URL EXACTLY against the Service ID registration. This app is
// also reachable on the platform's default *.onrender.com hostname, where a sign-in would open the
// popup and die on a generic `invalid_request`. Showing the button only on the registered origin
// means it never appears somewhere it cannot work.
//
// NATIVE IS EXEMPT FROM THAT GATE, and the exemption is the whole point of it being a gate
// about the WEB flow rather than about Apple. On iOS the sign-in is ASAuthorization: no Service ID,
// no Return URL, no origin — the OS authorizes against the bundle id in the entitlement. Applying
// the web gate there compared `capacitor://localhost` to the registered web origin, which can never
// match, so Apple silently vanished from every build of the app. The button was correct and the
// question asked of it was the wrong one.
const isNative = Capacitor.isNativePlatform();
const appleUsable =
  isNative ||
  !appleRedirectUri ||
  (typeof window !== "undefined" && window.location.origin === appleRedirectUri);

// `appleClientId` is likewise a WEB requirement (it is the Service ID the JS SDK initialises with).
// Native needs no client id, so requiring one would reintroduce the same bug by a different route.
const showApple = providers.includes("apple") && (isNative || Boolean(appleClientId)) && appleUsable;

// Google now works on BOTH, by two different routes. On the web it is a full-page redirect back to
// this origin. On native there is no origin to return to — Capacitor loads from disk — and Google
// refuses OAuth inside an embedded webview, so the app opens SFSafariViewController and the server
// redirects to a custom URL scheme that comes back as a deep link (lib/googleNative.ts).
//
// This used to read `&& !Capacitor.isNativePlatform()`, which hid the tile because the flow behind
// it could not work. That was the honest thing to render at the time — a tile that does nothing
// when tapped is worse than no tile — but it meant iOS had no Google sign-in at all.
const showGoogle = providers.includes("google");

/**
 * Google leaves the page. The tile is an ordinary button that asks the server where to go.
 *
 * Nothing is rendered by Google here and nothing is overlaid — this replaced Google Identity
 * Services, whose credential can only come from a button GIS itself draws inside a cross-origin
 * iframe. Matching that to the app's own tiles meant showing our mark with Google's invisible
 * button on top, so the control the player saw was not the control they pressed.
 *
 * The URL is built server-side because the `state` and `nonce` inside it must be recorded before
 * the browser leaves, and because the redirect URI has to match Google's console exactly. The
 * request is AUTHED: a guest's token rides along, and the server binds that identity to the
 * transaction so their progress survives the round trip.
 *
 * `socialBusy` is set and never cleared on the success path on purpose — the page is navigating
 * away, and re-enabling the tile would only invite a second tap during the hand-off.
 */
async function onGoogle() {
  setError(null);
  setNotice(null);
  setSocialBusy("google");
  try {
    if (isNative) {
      // The native flow RESOLVES here rather than navigating away, so unlike the web path there is
      // a session to establish and a busy state to clear. The handoff exchange is the same one
      // App.tsx runs when the website comes back from a redirect — one code, one endpoint, one
      // completion — so a change to what a finished sign-in means cannot land on only one platform.
      const code = await signInWithGoogleNative();
      const res = await completeGoogleHandoff(code);
      if (res?.passwordRetired) setNotice(t.auth.passwordRetired);
      return;
    }
    const { authorize_url } = await api.googleStart("web");
    window.location.assign(authorize_url);
  } catch (err) {
    setError(
      err instanceof GoogleSignInCancelled
        ? t.auth.socialCancelled
        : errorMessage(err, t, t.auth.somethingWentWrong)
    );
    setSocialBusy(null);
  }
}

/** Apple's popup returns the token directly; there is no rendered-button handoff. */
async function onApple(clientId: string, redirectURI: string | null) {
  setError(null);
  setNotice(null);
  setSocialBusy("apple");
  try {
    const { idToken, nonce } = isNative
      ? await signInWithAppleNative()
      : await signInWithApple({ clientId, redirectURI: redirectURI ?? undefined });
    const res = await socialSignIn("apple", idToken, nonce);
    if (res.passwordRetired) setNotice(t.auth.passwordRetired);
  } catch (err) {
    setError(
      err instanceof AppleSignInCancelled
        ? t.auth.socialCancelled
        : errorMessage(err, t, t.auth.somethingWentWrong)
    );
    setSocialBusy(null);
  }
}


  return {
    /** True once `/auth/providers` has answered (or failed) — callers use it to avoid a flash. */
    resolved,
    showApple,
    showGoogle,
    appleClientId,
    appleRedirectUri,
    googleClientId,
    /** Which provider is mid-flight, so a caller can disable the others. */
    socialBusy,
    /** Localized, ready to render. Never a raw server string (CLAUDE.md §7). */
    error,
    /** Not an error: the account was linked and its old password no longer applies. */
    notice,
    onApple,
    /** Starts Google's redirect. The tile is an ordinary button; nothing is rendered by Google. */
    onGoogle,
  };
}
