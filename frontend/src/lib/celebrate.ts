// Confetti gating for the reveal screens. Confetti was firing on EVERY correct answer, which made
// the celebration cheap. We reserve it for moments that actually feel earned: hitting a real streak
// milestone, or nailing the final question of the session. Every correct answer STILL gets the
// "Correct!" pop + points count-up (those are the per-question reward) — only the confetti is gated.
//
// Pure + framework-free so each host (Contest / Practice / Campaign) can track its own running
// consecutive-correct streak and the reveal components stay dumb (they just take a `celebrate` flag).

/** Consecutive-correct counts that earn a confetti burst. Tuned to celebrate real streaks without
 * spamming: a 3-in-a-row, then 5, 10, 15, 20. */
export const STREAK_MILESTONES: readonly number[] = [3, 5, 10, 15, 20];

/** True when reaching `streak` consecutive correct answers is a milestone moment. */
export function isStreakMilestone(streak: number): boolean {
  return STREAK_MILESTONES.includes(streak);
}

/**
 * Advance a running consecutive-correct streak by one answer. Correct → streak + 1; wrong → reset to
 * 0. Returns the new streak so the host can both store it and feed it to {@link shouldCelebrate}.
 */
export function nextStreak(prevStreak: number, correct: boolean): number {
  return correct ? prevStreak + 1 : 0;
}

/**
 * Whether the reveal should fire confetti for this answer. Only on a CORRECT answer, and only when
 * it's either the final question of the session OR the consecutive-correct count just hit a
 * milestone. `streak` is the count AFTER applying this answer (use {@link nextStreak}).
 */
export function shouldCelebrate({
  correct,
  streak,
  isFinal,
}: {
  correct: boolean;
  streak: number;
  isFinal: boolean;
}): boolean {
  if (!correct) return false;
  return isFinal || isStreakMilestone(streak);
}
