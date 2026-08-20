/**
 * The two destinations behind the centre Play button. Daily Royale is the main event — while
 * today's attempt is available, Play routes there. Once the score is locked (or no royale window is
 * reachable), Play becomes the fun replay loop: Quick Play, an 8-question mixed-category trivia run
 * on the practice path — never ranked, never wagered, no coins at stake.
 */
export const PLAY_MODES = {
  DAILY_ROYALE: { id: "daily_royale", questionCount: 8, ranked: true, wagered: false },
  QUICK_PLAY: { id: "quick_play", questionCount: 8, ranked: false, wagered: false },
} as const;

/** Where the centre Play button routes right now. */
export type PlayTarget = "royale" | "quick";

/** The /practice/start `mode` value that serves a Quick Play session. */
export const QUICK_PLAY_MODE = "quick" as const;
export type PracticeMode = typeof QUICK_PLAY_MODE | null;
