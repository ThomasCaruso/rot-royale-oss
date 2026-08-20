// Per-device record of which settled contest results the user has already had auto-revealed, so the
// dramatic Royale Results modal pops exactly once per settled contest (not on every refresh).
//
// LIMITATION: this is localStorage, so it is per device/browser — a user may see the same reveal
// again on another device or after clearing storage. There is no backend seen-state field; this is
// the v1 trade-off. Keys are composite `userId:windowId` so one account's seen state never suppresses
// another account's result on a shared device. All access fails safe (storage blocked → "unseen",
// writes no-op) — never throws.

const KEY = "rot_royale_seen_result_ids";

/** localStorage if present (browser), else null (SSR / node tests / disabled). Never throws. */
function storage(): Storage | null {
  try {
    const s = globalThis.localStorage as Storage | undefined;
    return s ?? null;
  } catch {
    return null;
  }
}

function read(): string[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(ids));
  } catch {
    // localStorage full / disabled — fail safe (the reveal just won't persist "seen").
  }
}

export function seenKey(userId: string, windowId: string): string {
  return `${userId}:${windowId}`;
}

export function hasSeenResult(userId: string, windowId: string): boolean {
  return read().includes(seenKey(userId, windowId));
}

export function markResultSeen(userId: string, windowId: string): void {
  const key = seenKey(userId, windowId);
  const ids = read();
  if (ids.includes(key)) return;
  ids.push(key);
  write(ids);
}
