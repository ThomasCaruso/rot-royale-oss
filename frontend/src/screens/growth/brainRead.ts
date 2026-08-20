/**
 * The Read — the composition engine behind the AI-analysis hero on "Your Growth".
 *
 * A PURE, testable function that turns the latest BrainBoostSummary into a structured read: it
 * SELECTS the signals (which categories to name, which band the player is in, what to nudge toward)
 * but renders NOTHING. The card owns the sentences so category/topic nouns can carry emphasis.
 */

import type { BrainBoostSummary } from "@/api/client";

export type Band = "elite" | "solid" | "rookie";

export interface BrainRead {
  /** true when there's no real data yet (null summary / no categories) → the invite state. */
  isEmpty: boolean;
  /** the backend rot_type string, e.g. "Market Menace" — the big hook. */
  headline: string;
  band: Band;
  /** full category name — the card shortens + emphasizes it. */
  topStrength: string | null;
  /** full category name; null if only one category answered. */
  secondStrength: string | null;
  /** weak_spot_topic if present, else the weakest CATEGORY name; null if none distinct. */
  weakSpot: string | null;
  /** true when weakSpot is a human-text topic (already prose) vs a category (card shortens it). */
  weakIsTopic: boolean;
  /** the category with the largest positive movement since last check, else null. */
  risingCategory: string | null;
  firstCheck: boolean;
}

function bandFor(accuracy: number): Band {
  if (accuracy >= 0.75) return "elite";
  if (accuracy >= 0.45) return "solid";
  return "rookie";
}

export function composeBrainRead(summary: BrainBoostSummary | null): BrainRead {
  const cats = summary?.categories ?? [];

  if (!summary || cats.length === 0) {
    return {
      isEmpty: true,
      headline: "",
      band: "rookie",
      topStrength: null,
      secondStrength: null,
      weakSpot: null,
      weakIsTopic: false,
      risingCategory: null,
      firstCheck: false,
    };
  }

  const byScore = cats.slice().sort((a, b) => b.score - a.score);
  const topStrength = byScore[0]?.category ?? null;
  const secondStrength = byScore.length >= 2 ? byScore[1].category : null;

  // Weak spot: prefer the human-readable topic; else the lowest-scoring category that isn't
  // already named as a strength (so a 1–2 category profile that's all strong has no weak spot).
  let weakSpot: string | null = null;
  let weakIsTopic = false;
  if (summary.weak_spot_topic) {
    weakSpot = summary.weak_spot_topic;
    weakIsTopic = true;
  } else {
    const lowest = byScore[byScore.length - 1];
    if (lowest && lowest.category !== topStrength && lowest.category !== secondStrength) {
      weakSpot = lowest.category;
      weakIsTopic = false;
    }
  }

  // Rising: the category with the largest strictly-positive movement.
  let risingCategory: string | null = null;
  let bestMove = 0;
  for (const [cat, delta] of Object.entries(summary.movements ?? {})) {
    if (delta > bestMove) {
      bestMove = delta;
      risingCategory = cat;
    }
  }

  return {
    isEmpty: false,
    headline: summary.rot_type,
    band: bandFor(summary.accuracy),
    topStrength,
    secondStrength,
    weakSpot,
    weakIsTopic,
    risingCategory,
    firstCheck: summary.first_check,
  };
}
