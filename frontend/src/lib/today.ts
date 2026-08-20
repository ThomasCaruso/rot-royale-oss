// Pure view-model helpers for the Today Command Center (engagement layer). Kept out of the
// components so they're unit-testable, and they return data/keys — never English copy — so the
// i18n copy-guard covers the rendered strings.

import { getFrame } from "@/theme/identity";
import { THEMES } from "@/theme/tokens";

export interface StreakRung {
  day: number;
  reached: boolean;
  isNext: boolean;
}

/** The streak ladder rungs with reached/next flags — drives the StreakBanner pips. */
export function streakRungs(
  current: number,
  milestones: number[],
  nextMilestone: number | null,
): StreakRung[] {
  return milestones.map((day) => ({
    day,
    reached: current >= day,
    isNext: day === nextMilestone,
  }));
}

export type RewardKind = "coins" | "gems";

export interface RewardLike {
  coins: number;
  gems: number;
}

/** Which currency a fixed reward pays (gems take precedence — a reward is one or the other in v1). */
export function rewardKind(reward: RewardLike): RewardKind {
  return reward.gems > 0 ? "gems" : "coins";
}

/** The headline amount for a reward (the non-zero currency). */
export function rewardAmount(reward: RewardLike): number {
  return reward.gems > 0 ? reward.gems : reward.coins;
}

/** Emoji per daily mission id (kept here so the card and its tests share one source). */
export const MISSION_ICON: Record<string, string> = {
  play_royale: "👑",
  complete_duel: "⚔️",
  clear_campaign: "🗺️",
};

/** Chest fill toward the "open" threshold (required of three). Clamped to 0..1. */
export function chestProgress(completed: number, required: number): number {
  if (required <= 0) return 1;
  return Math.min(completed / required, 1);
}

/** Resolve a cosmetic id to its display name (frame or theme), falling back to the id. */
export function cosmeticName(id: string, kind: string): string {
  if (kind === "frame") return getFrame(id)?.name ?? id;
  if (kind === "theme") return THEMES.find((t) => t.id === id)?.name ?? id;
  return id;
}
