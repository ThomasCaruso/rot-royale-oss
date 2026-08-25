// Session orchestration: ties the API client, in-memory store, and persisted refresh token
// together. Screens call these; they don't touch storage or tokens directly.

import { api, ApiError } from "@/api/client";
import { tokenStorage } from "@/api/tokenStorage";
import { useSessionStore } from "@/store/session";

async function establish(tokens: {
  access_token: string;
  refresh_token: string;
}): Promise<void> {
  await tokenStorage.setRefreshToken(tokens.refresh_token);
  useSessionStore.getState().setAccessToken(tokens.access_token);
  const me = await api.me();
  useSessionStore.getState().setSession(tokens.access_token, me);
}

export async function registerAndLogin(
  email: string,
  username: string,
  password: string
): Promise<void> {
  await establish(await api.register({ email, username, password }));
}

export async function login(email: string, password: string): Promise<void> {
  await establish(await api.login({ email, password }));
}

/** Sign in (or up) with Apple/Google.
 *
 * Returns what the player needs telling. `passwordRetired` means this account previously had a
 * password and linking a verified identity replaced it — surfaced rather than swallowed, because
 * otherwise they discover it at some later login with no idea why it stopped working.
 *
 * If the caller is currently a GUEST their token rides along on the request, so the identity
 * attaches to the row they have been playing on and their progress carries over. */
export async function socialSignIn(
  provider: string,
  idToken: string,
  nonce?: string
): Promise<{ created: boolean; passwordRetired: boolean }> {
  const res = await api.socialSignIn({ provider, id_token: idToken, nonce: nonce || undefined });
  await establish(res);
  return { created: Boolean(res.created), passwordRetired: Boolean(res.password_retired) };
}

/** Redeem the one-time handoff code Google's callback left in the URL fragment.
 *
 * The guest upgrade already happened server-side, during the callback — this only collects the
 * finished session, so there is no token to attach and nothing to merge here. Returns the same two
 * facts as `socialSignIn` so the caller renders the same things.
 *
 * Deliberately NOT authed: by the time this runs the account is resolved, and sending a stale guest
 * token would be meaningless at best. */
export async function completeGoogleHandoff(
  handoffCode: string
): Promise<{ created: boolean; passwordRetired: boolean }> {
  const res = await api.googleHandoff(handoffCode);
  await establish(res);
  return { created: Boolean(res.created), passwordRetired: Boolean(res.password_retired) };
}

/** Anonymous-first: create a guest account and enter the app in one tap (Brain Boost onboarding).
 * The session persists via the ordinary refresh token, so the guest survives app restarts. */
export async function startGuest(): Promise<void> {
  await establish(await api.guest());
}

/** "Save your Brain Profile": attach email + password to the current guest account. Same user —
 * every bit of progress (checks, streak, coins, taste profile) is kept automatically. */
export async function upgradeAccount(
  email: string,
  password: string,
  username?: string
): Promise<void> {
  // `username` is optional so a caller that only has credentials keeps the guest handle; the save
  // screen always sends it (pre-filled with the handle the player already has).
  await establish(
    await api.upgrade({ email, password, ...(username ? { username } : {}) })
  );
}

/** A failure that says nothing about the token itself: the server was unreachable (status 0),
 * errored (5xx), or something non-HTTP threw. Only a definitive 401/403 means the token is bad. */
function isTransientAuthFailure(err: unknown): boolean {
  const status = err instanceof ApiError ? err.status : null;
  return status === null || status === 0 || status >= 500;
}

const RESTORE_RETRY_DELAY_MS = 2_000;

/** Restore a session on cold start from the persisted refresh token. */
export async function restoreSession(): Promise<void> {
  const { setSession, setAnonymous } = useSessionStore.getState();
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!refreshToken) {
    setAnonymous();
    return;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const accessToken = await api.refresh();
      const me = await api.me();
      setSession(accessToken, me);
      return;
    } catch (err) {
      // Discriminate WHY restore failed before deleting the persisted refresh token. A network
      // failure or server error on a cold start used to be treated like a real 401 — one flaky
      // launch silently signed the player out and dropped them on the intro screen. For those,
      // retry once (covers a blip), then enter anonymous for this launch KEEPING the token;
      // recoverSessionIfNeeded() picks it back up on reconnect/foreground or next launch.
      if (isTransientAuthFailure(err)) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, RESTORE_RETRY_DELAY_MS));
          continue;
        }
        setAnonymous();
        return;
      }
      await tokenStorage.clearRefreshToken();
      setAnonymous();
      return;
    }
  }
}

/** After a transient restore failure left us anonymous-with-a-token, try again quietly.
 * Called on the offline→online edge and on app foreground; a no-op for true anonymous users. */
export async function recoverSessionIfNeeded(): Promise<void> {
  if (useSessionStore.getState().status !== "anonymous") return;
  const refreshToken = await tokenStorage.getRefreshToken();
  if (refreshToken) await restoreSession();
}

/** Re-fetch the current profile into the store (e.g. after practice nudges sharpness). */
export async function refreshMe(): Promise<void> {
  useSessionStore.getState().setMe(await api.me());
}

export async function signOut(): Promise<void> {
  await tokenStorage.clearRefreshToken();
  useSessionStore.getState().setAnonymous();
}
