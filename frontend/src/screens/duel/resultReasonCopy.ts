import type { DuelResult } from "@/api/client";
import type { Dict } from "@/i18n";

/**
 * Pure mapping from a finished duel's `(winner, result_reason)` to the one-line "why" explanation
 * (acceptance #19: the result screen explains why the user won or lost). Kept out of the React
 * component so it's unit-testable and the screen stays lean. It branches on `winner` so the same
 * reason phrases correctly from each side (e.g. `first_to_4` → "First to 4 rounds!" on a win,
 * "Rival reached 4 rounds first." on a loss). Any `tiebreak_*` reason collapses to the generic
 * tiebreaker line; an unknown/abandoned reason falls back to the generic win/loss line so a new
 * server reason never blanks the UI.
 */
export function resultReasonCopy(t: Dict, result: DuelResult): string {
  const won = result.winner === "user";
  const map = won ? t.duel.reasonWin : t.duel.reasonLoss;
  const reason = result.result_reason;
  if (reason === "first_to_4") return map.first_to_4;
  if (reason === "higher_round_wins") return map.higher_round_wins;
  if (reason === "sudden_death") return map.sudden_death;
  if (reason.startsWith("tiebreak")) return map.tiebreak;
  return map.generic;
}
