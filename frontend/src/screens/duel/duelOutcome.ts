import type { Dict } from "@/i18n";

/** Visual tone for the reveal banner. win → green (--lime), lose → red (--pink), neutral → muted. */
export type OutcomeTone = "win" | "lose" | "neutral";

export interface OutcomeCopy {
  title: string;
  sub: string;
  tone: OutcomeTone;
}

/**
 * Pure mapping from the server's (outcome, outcome_reason) to the reveal banner copy + tone. Kept
 * out of the React component so it's unit-testable and the screen stays lean. `outcome` is the
 * authority for tone; `outcome_reason` picks the precise sub-line. Unknown reasons fall back to the
 * generic line for that outcome so a new server reason (e.g. a `tiebreak_*`) never blanks the UI.
 */
export function outcomeCopy(
  t: Dict,
  outcome: string,
  outcomeReason: string,
): OutcomeCopy {
  const d = t.duel;
  if (outcome === "user_win") {
    if (outcomeReason === "speed_gap") {
      return { title: d.speedWin, sub: d.speedWinSub, tone: "win" };
    }
    // correct_vs_wrong + any tiebreak_* the server resolves in the user's favour.
    return { title: d.roundWon, sub: d.roundWonSub, tone: "win" };
  }
  if (outcome === "rival_win") {
    if (outcomeReason === "speed_gap") {
      return { title: d.roundLost, sub: d.roundLostSubSpeed, tone: "lose" };
    }
    return { title: d.roundLost, sub: d.roundLostSubWrong, tone: "lose" };
  }
  // no_point
  if (outcomeReason === "near_tie_correct") {
    return { title: d.noPointTie, sub: d.noPointTieSub, tone: "neutral" };
  }
  return { title: d.noPointBothWrong, sub: d.noPointBothWrongSub, tone: "neutral" };
}

/** Banner colour token for a tone. */
export function toneColor(tone: OutcomeTone): string {
  if (tone === "win") return "var(--lime)";
  if (tone === "lose") return "var(--pink)";
  return "var(--muted)";
}
