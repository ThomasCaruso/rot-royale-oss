import type { OfflineRound, OfflineItem } from "./types";

export interface OfflineReveal { correct: boolean; correctIndex: number; explanation: string | null; }

/** Local reveal from cached answer. `chosenShuffled` is the slot the player tapped (or null = timeout). */
export function revealFor(round: OfflineRound, chosenShuffled: number | null): OfflineReveal {
  return {
    correct: chosenShuffled === round.correct_index,
    correctIndex: round.correct_index,
    explanation: round.explanation,
  };
}

/** Record the choice as a STABLE original bank index so the server can re-score it on sync. */
export function itemFor(round: OfflineRound, chosenShuffled: number | null, elapsedMs: number): OfflineItem {
  const src = chosenShuffled === null ? -1 : round.option_source_index[chosenShuffled];
  return { question_id: round.question_id, selected_source_index: src, elapsed_ms: elapsedMs };
}
