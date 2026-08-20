// Per-user snapshot of category -> mastery level, so a level-up since last look is celebrated once.
// Read (pendingLevelUps) and write (markMasterySeen) are SEPARATE on purpose: the reader must be
// idempotent (React re-renders / dev StrictMode double-invoke an effect), so we only advance the
// snapshot once the level-ups have actually been shown — never inside the detect step.
const KEY = "rr-mastery-seen";

type Snapshot = Record<string, number>;

function read(userId: string): Snapshot | null {
  try {
    const raw = globalThis.localStorage?.getItem(`${KEY}:${userId}`);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

/**
 * Categories whose mastery level increased since the last recorded look. Read-only — safe to call
 * repeatedly. First-ever look (no baseline yet) returns none (call markMasterySeen to set the base).
 */
export function pendingLevelUps(
  userId: string,
  items: { category: string; level: number }[],
): Set<string> {
  const prev = read(userId);
  const leveled = new Set<string>();
  if (!prev) return leveled;
  for (const m of items) {
    if (m.level > (prev[m.category] ?? 0)) leveled.add(m.category);
  }
  return leveled;
}

/** Record the current levels as "seen" so they are not celebrated again. Fails safe. */
export function markMasterySeen(
  userId: string,
  items: { category: string; level: number }[],
): void {
  const next: Snapshot = {};
  for (const m of items) next[m.category] = m.level;
  try {
    globalThis.localStorage?.setItem(`${KEY}:${userId}`, JSON.stringify(next));
  } catch {
    /* storage blocked — no celebration persistence, harmless */
  }
}
