// Contest pacing state machine (Phase A) — the per-round rhythm, as a pure reducer so the timing
// logic is unit-testable away from rendering/network. The component drives side effects (timers, the
// per-round answer request) and dispatches events; the reducer owns the transitions.
//
// Per round: splash → playing → holding → reveal → (next | finished). The screen advances to
// `reveal` as soon as the player locks AND the server's answer arrives — no artificial delay, so
// right/wrong shows immediately on answer. `holding` is just the brief network wait, and gates the
// reveal-before-lock guard. The running leaderboard is shown once at the end (the lobby post-play
// state), not between rounds.

export interface RevealData {
  idx: number;
  correct: boolean;
  valid: boolean;
  points: number;
  answer: Record<string, unknown>; // server answer for this round (post-lock)
  total_score: number; // running total through this round
  finished: boolean; // entry is now SUBMITTED (last round)
  // §5f second-chance: a WRONG first pick offers a retry instead of finalizing (see the reducer).
  retry_available?: boolean;
  eliminated?: number | null; // the greyed, now-unclickable option
  retry_ms?: number; // the retry window
}

export type PacingPhase = "splash" | "playing" | "holding" | "reveal" | "finished";

export interface PacingState {
  phase: PacingPhase;
  idx: number;
  total: number;
  reveal: RevealData | null; // server outcome for the current round
  // §5f: set while re-armed for a second pick (wrong first try); null on a fresh/normal round.
  retry: { eliminated: number; retryMs: number } | null;
}

export type PacingEvent =
  | { type: "SPLASH_DONE" }
  | { type: "LOCKED" } // player committed a choice, or the round timed out
  | { type: "RETRY"; eliminated: number; retryMs: number } // §5f: wrong first pick → re-arm
  | { type: "REVEAL_READY"; reveal: RevealData } // the per-round answer response arrived
  | { type: "REVEAL_DONE" }; // the reveal display elapsed

export function initialPacing(total: number): PacingState {
  return { phase: "splash", idx: 0, total, reveal: null, retry: null };
}

// While holding, advance to reveal the moment the server answer is present — no extra delay.
function settle(s: PacingState): PacingState {
  if (s.phase === "holding" && s.reveal !== null) {
    return { ...s, phase: "reveal" };
  }
  return s;
}

export function pacingReducer(s: PacingState, e: PacingEvent): PacingState {
  switch (e.type) {
    case "SPLASH_DONE":
      return s.phase === "splash" ? { ...s, phase: "playing" } : s;
    case "LOCKED":
      // Lock the round and wait on the server answer. Ignore if not playing (double-advance guard).
      return s.phase === "playing" ? settle({ ...s, phase: "holding" }) : s;
    case "RETRY":
      // §5f: the wrong first pick came back with a retry offer — re-arm the SAME round (back to
      // playing) with the option greyed + the retry window, instead of revealing. No reveal set.
      if (s.phase !== "holding") return s;
      return { ...s, phase: "playing", retry: { eliminated: e.eliminated, retryMs: e.retryMs } };
    case "REVEAL_READY":
      // Only meaningful once the round is locked (holding) — this is the reveal-before-lock guard.
      if (s.phase !== "holding") return s;
      return settle({ ...s, reveal: e.reveal });
    case "REVEAL_DONE":
      // Reveal elapsed → straight to the next round (no per-round leaderboard), or finish.
      if (s.phase !== "reveal") return s;
      if (s.idx + 1 >= s.total) return { ...s, phase: "finished" };
      return { ...s, phase: "splash", idx: s.idx + 1, reveal: null, retry: null };
    default:
      return s;
  }
}
