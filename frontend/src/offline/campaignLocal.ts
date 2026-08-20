// Provisional campaign progress — the levels a player cleared OFFLINE that the server hasn't
// confirmed yet. Kept in localStorage, per-user, so an offline clear can immediately show the level
// cleared + "pending" on the map and unlock the next level locally, before the campaign outbox
// (Task 8b) drains and the server catches up.
//
// WHY client-side: while offline there is no server to advance the ladder. This store is the local
// truth for "what did I clear since my last sync"; `clearProvisional` wipes it once the outbox has
// drained and the fresh server ladder is authoritative again.
//
// All access fails safe (storage blocked/full/malformed → treated as empty) — never throws. Per
// device/browser, like the rest of the offline layer.

import type { CampaignLadderResponse, CampaignLevel } from "@/api/client";

const KEY = "rot_royale_campaign_provisional";

/** A level the player cleared offline, keyed by its world short-name + level number. */
export interface ProvisionalClear {
  world: string;
  level: number;
}

/** All offline-cleared levels not yet confirmed by the server, for one user. */
export interface ProvisionalProgress {
  cleared: ProvisionalClear[];
}

/** localStorage if present (browser), else null (SSR / node tests / disabled). Never throws. */
function storage(): Storage | null {
  try {
    const s = globalThis.localStorage as Storage | undefined;
    return s ?? null;
  } catch {
    return null;
  }
}

function keyFor(userId: string): string {
  return `${KEY}:${userId}`;
}

function isProgress(v: unknown): v is ProvisionalProgress {
  if (typeof v !== "object" || v === null) return false;
  const cleared = (v as Record<string, unknown>).cleared;
  if (!Array.isArray(cleared)) return false;
  return cleared.every((c) => {
    if (typeof c !== "object" || c === null) return false;
    const o = c as Record<string, unknown>;
    return typeof o.world === "string" && typeof o.level === "number";
  });
}

/** Read this user's provisional progress, or `{ cleared: [] }` when none / storage unavailable. */
export function loadProvisional(userId: string): ProvisionalProgress {
  const s = storage();
  if (!s) return { cleared: [] };
  try {
    const raw = s.getItem(keyFor(userId));
    if (!raw) return { cleared: [] };
    const parsed: unknown = JSON.parse(raw);
    return isProgress(parsed) ? parsed : { cleared: [] };
  } catch {
    return { cleared: [] };
  }
}

/** Record an offline level clear (idempotent — a repeat clear is a no-op). Fails safe. */
export function markProvisionalClear(userId: string, world: string, level: number): void {
  const s = storage();
  if (!s) return;
  const prog = loadProvisional(userId);
  if (prog.cleared.some((c) => c.world === world && c.level === level)) return;
  const next: ProvisionalProgress = { cleared: [...prog.cleared, { world, level }] };
  try {
    s.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    // storage full / disabled — the clear simply won't be reflected offline.
  }
}

/** Drop all provisional progress for a user (call once the campaign outbox has drained). Fails safe. */
export function clearProvisional(userId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(keyFor(userId));
  } catch {
    // no-op
  }
}

/**
 * Overlay provisional progress onto a ladder for rendering. Returns a fresh copy (input untouched):
 * - a level matching a provisional `{ world, level }` becomes `cleared: true` + `pending: true`;
 * - the level immediately after it (same world, `level_number + 1`) becomes `unlocked: true`, so the
 *   player can keep advancing offline.
 *
 * The ladder is `worlds → arcs → levels`; a world's levels can span multiple arcs, so the "next
 * level" lookup is done across the whole world (by `level_number`), not just within one arc.
 */
export function overlayLadder(
  ladder: CampaignLadderResponse,
  prov: ProvisionalProgress,
): CampaignLadderResponse {
  if (prov.cleared.length === 0) {
    // Still return a shallow-cloned top level so callers can treat the result as owned.
    return { ...ladder, worlds: ladder.worlds.map((w) => ({ ...w })) };
  }

  return {
    ...ladder,
    worlds: ladder.worlds.map((world) => {
      const clearedLevels = new Set(
        prov.cleared.filter((c) => c.world === world.world).map((c) => c.level),
      );
      // A level is unlocked-by-provisional if the PREVIOUS level in this world was cleared offline.
      const unlockLevels = new Set([...clearedLevels].map((n) => n + 1));

      return {
        ...world,
        arcs: world.arcs.map((arc) => ({
          ...arc,
          levels: arc.levels.map((level): CampaignLevel => {
            if (clearedLevels.has(level.level_number)) {
              return { ...level, cleared: true, pending: true };
            }
            if (unlockLevels.has(level.level_number)) {
              return { ...level, unlocked: true };
            }
            return { ...level };
          }),
        })),
      };
    }),
  };
}
