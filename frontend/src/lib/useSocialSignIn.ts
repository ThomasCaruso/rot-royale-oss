import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { socialSignIn } from "@/api/session";
import { AppleSignInCancelled, signInWithApple } from "@/lib/appleIdentity";
import { errorMessage } from "@/i18n/errors";
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

// Apple matches the Return URL EXACTLY against the Service ID registration. This app is also
// reachable on the platform's default *.onrender.com hostname, where a sign-in would open the
// popup and die on a generic `invalid_request`. Showing the button only on the registered origin
// means it never appears somewhere it cannot work.
const appleUsable =
  !appleRedirectUri ||
  (typeof window !== "undefined" && window.location.origin === appleRedirectUri);

const showApple = providers.includes("apple") && Boolean(appleClientId) && appleUsable;
const showGoogle = providers.includes("google") && Boolean(googleClientId);

/** Google's button hands the credential straight to us; there is no sheet to open. */
async function onGoogleCredential(idToken: string) {
  setError(null);
  setNotice(null);
  setSocialBusy("google");
  try {
    const res = await socialSignIn("google", idToken);
    if (res.passwordRetired) setNotice(t.auth.passwordRetired);
  } catch (err) {
    setError(errorMessage(err, t, t.auth.somethingWentWrong));
    setSocialBusy(null);
  }
}

/** Apple's popup returns the token directly; there is no rendered-button handoff. */
async function onApple(clientId: string, redirectURI: string | null) {
  setError(null);
  setNotice(null);
  setSocialBusy("apple");
  try {
    const { idToken, nonce } = await signInWithApple({
      clientId,
      redirectURI: redirectURI ?? undefined,
    });
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
    onGoogleCredential,
    /** Lets a caller drop Google when GIS fails to load (ad blocker, offline). */
    dropGoogle: () => setProviders((prev) => prev.filter((x) => x !== "google")),
  };
}
