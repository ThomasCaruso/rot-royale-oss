import { create } from "zustand";

/** Profile shape returned by GET /me (PLAN.md §8). */
export interface Me {
  user_id: string;
  email: string;
  username: string;
  is_guest: boolean; // anonymous-first account that hasn't saved an email/password yet
  rating: number; // Elo, kept under the hood (drives placement + division)
  rank: number; // global rank among real players, #1 = best
  total_players: number;
  division: string;
  streak_count: number;
  sharpness: number;
  coins_balance: number;
  gems_balance: number;
  equipped_theme: string;
  avatar_preset: string;
  equipped_frame: string | null;
  equipped_badges: string[]; // ordered, ≤3 — earned honors pinned by the name
  equipped_title: string | null;
  // Server-side percentage rollout: when true this device may register a QUIET provisional push
  // token at launch (no prompt, Notification Center only). Absent on older servers.
  provisional_push?: boolean;
}

/**
 * - "bootstrapping": app just started, restoring session from the persisted refresh token.
 *   First render is gated on leaving this state so we never flash the login screen on cold start.
 * - "authenticated": access token in memory + profile loaded.
 * - "anonymous": no valid session.
 */
export type SessionStatus = "bootstrapping" | "authenticated" | "anonymous";

interface SessionState {
  status: SessionStatus;
  /** Access token kept in memory only — never persisted. */
  accessToken: string | null;
  me: Me | null;
  setSession: (accessToken: string, me: Me) => void;
  setAccessToken: (accessToken: string) => void;
  setMe: (me: Me) => void;
  setAnonymous: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: "bootstrapping",
  accessToken: null,
  me: null,
  setSession: (accessToken, me) => set({ accessToken, me, status: "authenticated" }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setMe: (me) => set({ me }),
  setAnonymous: () => set({ accessToken: null, me: null, status: "anonymous" }),
}));
