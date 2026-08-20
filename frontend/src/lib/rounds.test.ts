import { describe, expect, it } from "vitest";
import { blockSize, roundFraming, ROUND_BLOCK_COUNT } from "./rounds";

describe("blockSize", () => {
  it("splits the V1 8-question run into 4 blocks of 2", () => {
    expect(blockSize(8)).toBe(2);
  });

  it("still splits a legacy 20-question run into 4 blocks of 5", () => {
    expect(blockSize(20)).toBe(5);
  });

  it("always yields at least 1 and handles small/zero totals gracefully", () => {
    expect(blockSize(0)).toBe(1);
    expect(blockSize(1)).toBe(1);
    expect(blockSize(3)).toBe(1); // ceil(3/4) = 1
  });

  it("groups a non-multiple into 4 with the remainder in the last block", () => {
    expect(blockSize(18)).toBe(5); // ceil(18/4) = 5 → blocks 5,5,5,3
    expect(blockSize(22)).toBe(6); // ceil(22/4) = 6 → blocks 6,6,6,4
  });
});

describe("roundFraming — the V1 8-question mapping (4 blocks of 2)", () => {
  const names: Record<number, string> = {
    0: "openingRound",
    2: "pressureRound",
    4: "crownClimb",
    6: "finalCrownRound",
  };

  it("maps the four 2-question blocks to their names with boundaries at Q2/Q3, Q4/Q5, Q6/Q7", () => {
    // 0-based index. Block of i = floor(i/2).
    expect(roundFraming(0, 8).blockKey).toBe("openingRound"); // Q1
    expect(roundFraming(1, 8).blockKey).toBe("openingRound"); // Q2
    expect(roundFraming(2, 8).blockKey).toBe("pressureRound"); // Q3 — boundary
    expect(roundFraming(3, 8).blockKey).toBe("pressureRound"); // Q4
    expect(roundFraming(4, 8).blockKey).toBe("crownClimb"); // Q5 — boundary
    expect(roundFraming(5, 8).blockKey).toBe("crownClimb"); // Q6
    expect(roundFraming(6, 8).blockKey).toBe("finalCrownRound"); // Q7 — boundary
    expect(roundFraming(7, 8).blockKey).toBe("finalCrownRound"); // Q8
  });

  it("marks isBlockStart only at the first question of each block", () => {
    for (let i = 0; i < 8; i++) {
      expect(roundFraming(i, 8).isBlockStart).toBe(i % 2 === 0);
    }
  });

  it("reports round number (1..4) and per-block question position", () => {
    const f3 = roundFraming(2, 8); // Q3: block 2, first of block
    expect(f3.roundNumber).toBe(2);
    expect(f3.totalBlocks).toBe(ROUND_BLOCK_COUNT);
    expect(f3.questionInBlock).toBe(1);
    expect(f3.questionsInThisBlock).toBe(2);

    const f8 = roundFraming(7, 8); // Q8: last of block 4
    expect(f8.roundNumber).toBe(4);
    expect(f8.questionInBlock).toBe(2);
  });

  it("always uses each name exactly once for the 4 anchor indices", () => {
    for (const [idx, name] of Object.entries(names)) {
      expect(roundFraming(Number(idx), 8).blockKey).toBe(name);
    }
  });
});

describe("roundFraming — legacy 20-question mapping (history replay)", () => {
  const names: Record<number, string> = {
    0: "openingRound",
    5: "pressureRound",
    10: "crownClimb",
    15: "finalCrownRound",
  };

  it("maps the four 5-question blocks to their names with boundaries at Q5/Q6, Q10/Q11, Q15/Q16", () => {
    // 0-based index. Block of i = floor(i/5).
    expect(roundFraming(0, 20).blockKey).toBe("openingRound"); // Q1
    expect(roundFraming(4, 20).blockKey).toBe("openingRound"); // Q5
    expect(roundFraming(5, 20).blockKey).toBe("pressureRound"); // Q6 — boundary
    expect(roundFraming(9, 20).blockKey).toBe("pressureRound"); // Q10
    expect(roundFraming(10, 20).blockKey).toBe("crownClimb"); // Q11 — boundary
    expect(roundFraming(14, 20).blockKey).toBe("crownClimb"); // Q15
    expect(roundFraming(15, 20).blockKey).toBe("finalCrownRound"); // Q16 — boundary
    expect(roundFraming(19, 20).blockKey).toBe("finalCrownRound"); // Q20
  });

  it("marks isBlockStart only at the first question of each block", () => {
    for (let i = 0; i < 20; i++) {
      expect(roundFraming(i, 20).isBlockStart).toBe(i % 5 === 0);
    }
  });

  it("reports round number (1..4) and per-block question position", () => {
    const f6 = roundFraming(5, 20); // Q6: block 2, first of block
    expect(f6.roundNumber).toBe(2);
    expect(f6.totalBlocks).toBe(ROUND_BLOCK_COUNT);
    expect(f6.questionInBlock).toBe(1);
    expect(f6.questionsInThisBlock).toBe(5);

    const f20 = roundFraming(19, 20); // Q20: last of block 4
    expect(f20.roundNumber).toBe(4);
    expect(f20.questionInBlock).toBe(5);
  });

  it("always uses each name exactly once for the 4 anchor indices", () => {
    for (const [idx, name] of Object.entries(names)) {
      expect(roundFraming(Number(idx), 20).blockKey).toBe(name);
    }
  });
});

describe("roundFraming — non-20 graceful fallback (still 4 blocks)", () => {
  it("clamps an overshooting index to the last named block", () => {
    // total=18, blockSize=5 → blocks at idx 0,5,10,15. idx 17 is in the last (Final Crown) block.
    const f = roundFraming(17, 18);
    expect(f.blockKey).toBe("finalCrownRound");
    expect(f.roundNumber).toBe(4);
    // last block covers idx 15..17 → 3 questions
    expect(f.questionsInThisBlock).toBe(3);
  });

  it("never overflows past 4 blocks even if rawBlock would exceed", () => {
    const f = roundFraming(99, 8); // blockSize=2 → rawBlock 49, clamped to 3
    expect(f.block).toBe(ROUND_BLOCK_COUNT - 1);
    expect(f.blockKey).toBe("finalCrownRound");
  });
});
