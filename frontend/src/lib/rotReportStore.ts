// Per-device stash of the player's latest INSTANT Rot Report, so it can be re-opened (and re-shared)
// from Home after the Contest screen — which holds the only per-round log — is gone.
//
// WHY client-side: the server never exposes a finished entry's per-round breakdown (anti-cheat —
// answers/scores never leave the server except in the live per-round reveal), so the report cannot be
// reconstructed from an API read. The finish screen builds it from a client-only log; we persist that
// built report here the moment it is shown.
//
// One slot per user (keyed by userId) holding the LATEST day's report — it self-overwrites each day,
// so nothing accumulates. `windowId` lets the reader confirm the stash is for the window in question
// (not a stale earlier day). All access fails safe (storage blocked → null, writes no-op) — never
// throws. Per device/browser, like seenResults — a re-share isn't available on another device.

import type { RotReportData } from "@/lib/rotReport";

const KEY = "rot_royale_last_rot_report";

/** The persisted finish report + the ids needed to re-mint its share link on re-open. */
export interface StoredRotReport {
  windowId: string;
  entryId: string;
  report: RotReportData;
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

function isStored(v: unknown): v is StoredRotReport {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.windowId === "string" &&
    typeof o.entryId === "string" &&
    typeof o.report === "object" &&
    o.report !== null &&
    typeof (o.report as Record<string, unknown>).score === "number" &&
    typeof (o.report as Record<string, unknown>).total === "number"
  );
}

/** Stash this user's latest finish report, overwriting any earlier day. Fails safe. */
export function saveRotReport(userId: string, value: StoredRotReport): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(keyFor(userId), JSON.stringify(value));
  } catch {
    // storage full / disabled — the report simply won't be re-openable from Home.
  }
}

/** Read this user's latest finish report, or null when there is none / storage is unavailable. */
export function loadRotReport(userId: string): StoredRotReport | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStored(parsed)) return null;
    // `rounds` (the tick/cross grid) was added after this stash shipped, so a report written by an
    // older build has none. `isStored` deliberately doesn't require it — rejecting the whole stash
    // would throw away a valid report over a missing decoration. Coerce instead: the grid hides
    // itself when empty, and the slot self-heals on the next day's run. The type guard has already
    // claimed the field, so this is a runtime narrowing of untrusted storage, not a type fix.
    const rounds: unknown = parsed.report.rounds;
    return {
      ...parsed,
      report: {
        ...parsed.report,
        rounds: Array.isArray(rounds) ? rounds.filter((r) => typeof r === "boolean") : [],
      },
    };
  } catch {
    return null;
  }
}
