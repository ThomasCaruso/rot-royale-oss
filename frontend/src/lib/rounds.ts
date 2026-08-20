// Pure helpers for the Daily Royale run-screen round framing. V1 is a flat 8-trivia run, but the
// player experiences it as 4 named blocks of 2 (Opening Round / Pressure Round / Crown Climb / Final
// Crown Round). This is FRONTEND FRAMING ONLY — the backend has no blocks, no weighting; the streak
// multiplier provides the emergent climax. Kept pure so the block math is unit-testable away from the
// component.

/** The four block ids, in order. Each maps to an i18n key under the `contest` namespace. */
export type RoundBlockKey = "openingRound" | "pressureRound" | "crownClimb" | "finalCrownRound";

const BLOCK_KEYS: readonly RoundBlockKey[] = [
  "openingRound",
  "pressureRound",
  "crownClimb",
  "finalCrownRound",
];

export const ROUND_BLOCK_COUNT = BLOCK_KEYS.length;

export interface RoundFraming {
  /** 0-based block index (0..3). */
  block: number;
  /** i18n key for the block name. */
  blockKey: RoundBlockKey;
  /** 1-based block number for display ("Round X of 4"). */
  roundNumber: number;
  /** Total number of blocks (always ROUND_BLOCK_COUNT). */
  totalBlocks: number;
  /** Questions per block, derived from total so non-20 totals still group into 4. */
  blockSize: number;
  /** 1-based question index within the block ("Q Y of N"). */
  questionInBlock: number;
  /** Questions in THIS block (the last block may be short when total isn't a multiple of 4). */
  questionsInThisBlock: number;
  /** True when `idx` is the first question of its block — drives the round banner interstitial. */
  isBlockStart: boolean;
}

/**
 * The block size for a run of `total` questions split into ROUND_BLOCK_COUNT blocks. For the V1
 * 8-question run this is exactly 2. For any other count we group with `ceil(total / 4)` so the first
 * blocks are full and the last block absorbs the remainder (possibly fewer); a total < 4 collapses to
 * 1-per-block with empty trailing blocks (handled gracefully by the consumers). Always ≥ 1.
 */
export function blockSize(total: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / ROUND_BLOCK_COUNT));
}

/**
 * Resolve the round framing for a 0-based question index in a run of `total` questions. The block is
 * `floor(idx / blockSize)` clamped to the last block (so a short final block never overflows the
 * names). For total=8 this yields the mapping: Q1–2 Opening, Q3–4 Pressure, Q5–6 Crown Climb,
 * Q7–8 Final Crown Round (boundaries at idx 2/4/6).
 */
export function roundFraming(idx: number, total: number): RoundFraming {
  const size = blockSize(total);
  const rawBlock = Math.floor(idx / size);
  const block = Math.min(rawBlock, ROUND_BLOCK_COUNT - 1);
  const blockStartIdx = block * size;
  const questionInBlock = idx - blockStartIdx + 1;
  // The last named block stretches to cover any remainder; earlier blocks are exactly `size`.
  const questionsInThisBlock =
    block === ROUND_BLOCK_COUNT - 1 ? Math.max(1, total - blockStartIdx) : size;
  return {
    block,
    blockKey: BLOCK_KEYS[block],
    roundNumber: block + 1,
    totalBlocks: ROUND_BLOCK_COUNT,
    blockSize: size,
    questionInBlock,
    questionsInThisBlock,
    isBlockStart: idx === blockStartIdx,
  };
}
