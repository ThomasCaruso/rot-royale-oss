// Pure helpers for the "Rot Report" — the INSTANT personal result shown the moment a player finishes
// their 8 Daily Royale questions (before the 24h window closes / settles). All derivation lives here
// so it is unit-testable without rendering, and so the component stays a thin presenter.
//
// HONESTY (DESIGN §7): this card is the player's OWN run only — score, timing, categories. It carries
// NO field/placement framing (placement isn't known until settlement), so there's nothing to fabricate
// here. Daily Royale is a Wordle-style public score flex (share how you did; friends play the same
// daily game and compare) — NOT a 1v1 challenge (that's Duel mode). Share copy must avoid money/
// gambling/"player" AND direct-challenge language (enforced by the copy guard + tests).

/** One round's outcome as the run captured it (client-side, provisional/display only). */
export interface RoundLog {
  correct: boolean;
  /** Client-measured answer time; null when the round timed out or the module reports no timing. */
  elapsedMs: number | null;
  /** The round's trivia category, when the client_spec exposed one. */
  category: string | null;
}

export interface RotReportData {
  score: number; // correct count
  total: number; // questions in the run (8 for Daily Royale)
  incorrect: number;
  /** Average answer time over ANSWERED rounds, in ms; null when nothing timed cleanly. */
  avgMs: number | null;
  /** Fastest single answer over answered rounds, in ms; null when none. */
  fastestMs: number | null;
  /**
   * Per-round outcome IN PLAY ORDER, always `total` long — the Wordle-style row of ticks and
   * crosses. Replaced the old "worst category" line: the shape of a run (where it broke, whether it
   * started strong) is both more interesting to look at and the thing that travels in a share.
   * Category weakness already has a home in Brain Boost, which tracks it across days.
   *
   * A run abandoned part-way pads with `false`, matching `incorrect = total - score` — an unplayed
   * question is not a right one.
   */
  rounds: boolean[];
}

/**
 * The deterministic score → funny-title i18n key. One key per possible score on an 8-question run
 * (0..8). The component renders `t.rotReport[rotTitleKey(score)]` so the wording stays localized.
 * Scores are clamped into range so an unexpected total never throws.
 */
export type RotTitleKey =
  | "t0"
  | "t1"
  | "t2"
  | "t3"
  | "t4"
  | "t5"
  | "t6"
  | "t7"
  | "t8";

export function rotTitleKey(score: number): RotTitleKey {
  const s = Math.max(0, Math.min(8, Math.round(score)));
  return `t${s}` as RotTitleKey;
}

/**
 * Build the instant report from the per-round log. `total` is the intended run length (8) so the
 * "X / 8" reads correctly even if a round failed to log. Timing stats use ANSWERED rounds only (a
 * timed-out round has no meaningful answer time).
 */
export function buildRotReport(log: RoundLog[], total: number): RotReportData {
  const score = log.filter((r) => r.correct).length;
  const timed = log.map((r) => r.elapsedMs).filter((ms): ms is number => typeof ms === "number");
  const avgMs = timed.length ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : null;
  const fastestMs = timed.length ? Math.min(...timed) : null;

  return {
    score,
    total,
    incorrect: Math.max(0, total - score),
    avgMs,
    fastestMs,
    // Always `total` long: a short log (walked away) pads with misses, a long one is truncated, so
    // the grid always renders exactly the run length the score is quoted against.
    rounds: Array.from({ length: total }, (_, i) => log[i]?.correct === true),
  };
}

/**
 * The server's rebuilt report (snake_case, `GET /entries/{id}/rot-report`) as `RotReportData`.
 *
 * The server derives the SAME report from the stored rounds that `buildRotReport` derives from the
 * live round log — it inverts `time_frac` back to answer times and reads categories off the stored
 * round set (`backend/app/services/rot_report.py`). This mapper is the only difference between the
 * two paths, so re-opening a report on a second device shows the numbers the player already shared.
 */
export function rotReportFromApi(res: {
  score: number;
  total: number;
  incorrect: number;
  avg_ms: number | null;
  fastest_ms: number | null;
  rounds: boolean[];
}): RotReportData {
  return {
    score: res.score,
    total: res.total,
    incorrect: res.incorrect,
    avgMs: res.avg_ms,
    fastestMs: res.fastest_ms,
    rounds: res.rounds,
  };
}

/** ms → a compact "5.8s" seconds label (one decimal). */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The run as a row of emoji boxes — "✅✅❌✅…" — for the share text.
 *
 * This is the part of a Wordle share that actually travels: it renders as a picture of the run in
 * any chat client, carries no answers (so it spoils nothing for someone who hasn't played today's
 * questions yet), and is the same information the card shows on screen. Language-free by
 * construction, so it needs no translation.
 */
export function buildRoundBoxes(rounds: boolean[]): string {
  return rounds.map((ok) => (ok ? "✅" : "❌")).join("");
}

/**
 * The Daily Royale share URL — a Wordle-style "play today's game" link, NOT a 1v1 challenge (direct
 * friend challenges are Duel mode's job, never Daily Royale). It encodes NO score and NO challenge
 * state; it simply points friends at the current app URL (today's Daily Royale). `ref` is an OPTIONAL
 * neutral attribution param (`?ref=rot_report`) — route-safe and ignored by the router; pass "" to
 * omit it entirely. `base` is the origin+path (the caller passes `location.origin + location.pathname`
 * in the browser); any existing query/hash on `base` is dropped so the link is clean.
 */
export function buildDailyShareUrl(base: string, ref = "rot_report"): string {
  const clean = base.split("#")[0].split("?")[0];
  return ref ? `${clean}?ref=${ref}` : clean;
}

/**
 * The shareable text result — Wordle-style: score/status first, then optional stat lines, then the
 * brand tagline + link last. Field-free, money-free, "player"-free, and challenge-free (copy guard).
 * `title` is the already-localized funny title; `link` is the Daily Royale link. `statLines` are
 * already-localized extra lines (e.g. "Average time: 5.8s", "Worst category: Geography"), inserted
 * before the tagline; empty/blank lines are dropped. Kept as a plain builder (not i18n) so tests can
 * assert the exact composed string; the per-line wording the component passes in IS localized.
 */
export function buildRotShareText(args: {
  heading: string; // e.g. "ROT ROYALE — Today's Rot Report"
  correctLine: string; // e.g. "6/8 correct"
  titleLine: string; // e.g. "Title: Not Cooked Yet"
  statLines?: string[]; // e.g. ["Average time: 5.8s", "Worst category: Geography"]
  taglineLink: string; // e.g. "Prove your brain isn't cooked: {link}" already interpolated
}): string {
  return [
    args.heading,
    args.correctLine,
    args.titleLine,
    ...(args.statLines ?? []),
    args.taglineLink,
  ]
    .filter((l) => l.trim().length > 0)
    .join("\n");
}
