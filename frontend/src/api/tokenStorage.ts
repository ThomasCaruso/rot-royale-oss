import { Preferences } from "@capacitor/preferences";

/**
 * Refresh-token persistence via Capacitor Preferences (PLAN.md M1 token handling).
 * On native iOS/Android this is Keychain/Keystore-adjacent device storage and survives app
 * restarts; on web it is backed by localStorage. The access token is NEVER persisted — it lives
 * only in memory (see store/session.ts). We use the Preferences API rather than touching
 * localStorage/cookies directly so the native build gets secure device storage for free.
 */
const REFRESH_TOKEN_KEY = "rr.refresh_token";

export const tokenStorage = {
  async getRefreshToken(): Promise<string | null> {
    const { value } = await Preferences.get({ key: REFRESH_TOKEN_KEY });
    return value;
  },
  async setRefreshToken(token: string): Promise<void> {
    await Preferences.set({ key: REFRESH_TOKEN_KEY, value: token });
  },
  async clearRefreshToken(): Promise<void> {
    await Preferences.remove({ key: REFRESH_TOKEN_KEY });
  },
};
