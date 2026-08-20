import type { CampaignWorld } from "@/api/client";
import { currentMissionLevel } from "@/lib/campaign";

/**
 * The "chapter" number shown on the hub = the level the player is on next (the first unlocked-but-
 * uncleared level). A fully-cleared world reports its last level; an untouched world reports 1.
 * Derived from real ladder data — it never runs ahead of what the server has unlocked.
 */
export function chapterOf(world: CampaignWorld): number {
  const cm = currentMissionLevel(world);
  if (cm) return cm.level.level_number;
  if (world.total_levels > 0 && world.cleared_count >= world.total_levels) return world.total_levels;
  return Math.min(world.cleared_count + 1, Math.max(world.total_levels, 1));
}
