import { describe, expect, it } from "vitest";
import {
  buildNearMiss,
  buildResultInsight,
  buildShareText,
  computeAhead,
  computeTopPercent,
  formatSignedDelta,
  gameTitle,
  getPlacementTier,
  pickAutoRevealResult,
  placementLabel,
} from "@/lib/results";

// history rows come ordered most-recent-first (by window close, like /me/history)
const settled = (id: string, place: number | null = 1) => ({ window_id: id, state: "SETTLED", place });
const open = (id: string) => ({ window_id: id, state: "OPEN", place: null });
const closed = (id: string) => ({ window_id: id, state: "CLOSED", place: null });
const never = () => false;
const all = () => true;

describe("pickAutoRevealResult (which result, if any, auto-opens)", () => {
  it("auto-opens the most recent SETTLED result with a placement, when unseen", () => {
    const picked = pickAutoRevealResult([settled("w2"), settled("w1")], never);
    expect(picked?.window_id).toBe("w2");
  });

  it("never auto-opens an active/unsettled window", () => {
    expect(pickAutoRevealResult([open("w3"), closed("w2")], never)).toBeNull();
  });

  it("does not auto-open a SETTLED window that has no placement yet", () => {
    expect(pickAutoRevealResult([settled("w1", null)], never)).toBeNull();
  });

  it("does not auto-open when the most recent settled result was already seen (no chaining/resurfacing)", () => {
    // w2 newest+seen, w1 older+unseen → nothing auto-opens (older stays manual only).
    const hasSeen = (id: string) => id === "w2";
    expect(pickAutoRevealResult([settled("w2"), settled("w1")], hasSeen)).toBeNull();
  });

  it("returns null for empty history and when everything is seen", () => {
    expect(pickAutoRevealResult([], never)).toBeNull();
    expect(pickAutoRevealResult([settled("w1")], all)).toBeNull();
  });
});

describe("results utils", () => {
  it("tiers placement: winner / podium / normal", () => {
    expect(getPlacementTier(1)).toBe("winner");
    expect(getPlacementTier(2)).toBe("podium");
    expect(getPlacementTier(3)).toBe("podium");
    expect(getPlacementTier(7)).toBe("normal");
  });

  it("labels the podium with the placePodium key + ordinal, lower places with placeNum + rank", () => {
    expect(placementLabel(1)).toEqual({ key: "placePodium", ord: "1ST" });
    expect(placementLabel(3)).toEqual({ key: "placePodium", ord: "3RD" });
    expect(placementLabel(7)).toEqual({ key: "placeNum", rank: 7 });
  });

  it("computes field-relative metrics", () => {
    expect(computeAhead(1, 12)).toBe(11);
    expect(computeAhead(12, 12)).toBe(0);
    expect(computeTopPercent(1, 12)).toBe(9);
    expect(computeTopPercent(6, 12)).toBe(50);
  });

  it("formats signed deltas with a real minus sign", () => {
    expect(formatSignedDelta(32)).toBe("+32");
    expect(formatSignedDelta(-8)).toBe("−8");
    expect(formatSignedDelta(0)).toBe("+0");
  });

  // buildResultInsight / buildShareText / placementLabel now return STABLE KEYS (+ pre-formatted
  // params) instead of English — the component renders them via `t.results.<key>` + `fmt`. The
  // English wording moved to the i18n dictionaries (which this lib can't import). To keep the
  // honesty assertions alive (DESIGN §7), we mirror the en `results` templates locally here and
  // run the same no-money-word checks on the resolved strings.

  it("insight: a win returns the wonBy key with the pre-formatted margin", () => {
    const field = [
      { username: "me", score: 8420, isMe: true },
      { username: "rival", score: 8180 },
    ];
    expect(buildResultInsight(1, 8, 8420, field)).toEqual({ key: "wonBy", points: "240" });
  });

  it("insight: a non-win returns the behindFirst key with the gap to 1st", () => {
    const field = [
      { username: "leader", score: 9000 },
      { username: "me", score: 8760, isMe: true },
    ];
    expect(buildResultInsight(2, 8, 8760, field)).toEqual({ key: "behindFirst", points: "240" });
  });

  it("insight: a solo field is banked, never 'you beat 0'", () => {
    expect(buildResultInsight(1, 1, 500, null)).toEqual({ key: "soloBanked" });
  });

  it("insight: falls back to a field-percentile key without scores", () => {
    expect(buildResultInsight(2, 10, 700, null)).toEqual({ key: "topPct", pct: 20 });
  });

  it("share text uses field framing keys, no money words", () => {
    expect(buildShareText(1, 12)).toEqual({ key: "sharePlaced", rank: 1, fieldSize: 12 });
    expect(buildShareText(1, 1)).toEqual({ key: "shareTopped" });
    expect(buildShareText(null, 12)).toEqual({ key: "shareBanked" });
  });

  it("gameTitle is legacy-aware: royale → Daily Royale, legacy → Legacy * Game, never relabels", () => {
    expect(gameTitle("royale")).toBe("Daily Royale");
    expect(gameTitle("night")).toBe("Legacy Night Game");
    expect(gameTitle("midday")).toBe("Legacy Midday Game");
    expect(gameTitle("morning")).toBe("Legacy Morning Game");
    expect(gameTitle("weekend")).toBe("Past Ranked Game");
    // a legacy slot must NEVER read as Daily Royale (locked correction #1)
    expect(gameTitle("night")).not.toBe("Daily Royale");
  });

  describe("buildNearMiss (only when real field data supports the gap)", () => {
    it("computes the points short of the Top 3 when the player finished just outside", () => {
      const field = [
        { username: "a", score: 9000 },
        { username: "b", score: 8800 },
        { username: "c", score: 8600 }, // 3rd-place cutoff
        { username: "me", score: 8500, isMe: true }, // 4th
      ];
      expect(buildNearMiss(4, 8, 8500, field)).toEqual({ key: "nearMiss", points: "100", topN: 3 });
    });

    it("for 2nd place targets the rank above (Top 1)", () => {
      const field = [
        { username: "leader", score: 9000 },
        { username: "me", score: 8760, isMe: true },
      ];
      expect(buildNearMiss(2, 8, 8760, field)).toEqual({ key: "nearMiss", points: "240", topN: 1 });
    });

    it("returns null with no field data (no fabrication)", () => {
      expect(buildNearMiss(4, 8, 8500, null)).toBeNull();
      expect(buildNearMiss(4, 8, 8500, [{ username: "me", score: 8500, isMe: true }])).toBeNull();
    });

    it("returns null for a solo field, a winner, or a non-positive gap", () => {
      expect(buildNearMiss(1, 12, 9000, [{ username: "me", score: 9000 }])).toBeNull();
      expect(buildNearMiss(1, 1, 500, null)).toBeNull();
      // player already at/above the target cutoff → no near-miss
      const field = [
        { username: "me", score: 9000, isMe: true },
        { username: "b", score: 8000 },
      ];
      expect(buildNearMiss(2, 8, 9000, field)).toBeNull();
    });
  });

  // Local mirror of the en `results` honesty-reviewed templates (kept in sync with i18n/en.ts).
  // We resolve each returned key against these and assert the same honesty properties as before.
  const RESULTS_EN: Record<string, string> = {
    placePodium: "{ord} PLACE",
    placeNum: "#{rank}",
    soloBanked: "You played solo today. Your result is banked.",
    wonBy: "You won by {points} points.",
    behindFirst: "{points} points behind 1st.",
    topPct: "Top {pct}% of players.",
    shareBanked: "I banked a result in Rot Royale {title} 👑",
    shareTopped: "I topped the field in Rot Royale {title} 👑",
    sharePlaced: "I placed #{rank} of {fieldSize} in Rot Royale {title} 👑",
  };
  const resolve = (r: { key: string } & Record<string, unknown>): string =>
    RESULTS_EN[r.key].replace(/\{(\w+)\}/g, (_, k: string) => String(r[k] ?? `{${k}}`));

  it("HONESTY: no insight, label, or share copy uses money or gambling language", () => {
    // Every row here is a real entrant (the cold-start bot fill is gone), so counting them as
    // "players" is honest — what must never appear is money/gambling framing.
    const field = [
      { username: "me", score: 100, isMe: true },
      { username: "rival", score: 90 },
    ];
    const strings = [
      resolve({ ...placementLabel(1) }),
      resolve({ ...placementLabel(7) }),
      resolve({ ...buildResultInsight(1, 8, 100, field) }),
      resolve({ ...buildResultInsight(5, 12, 80, field) }),
      resolve({ ...buildResultInsight(1, 1, 100, null) }),
      resolve({ ...buildShareText(1, 12), title: gameTitle("royale") }),
      resolve({ ...buildShareText(1, 1), title: gameTitle("night") }),
    ];
    for (const s of strings) {
      expect(s.toLowerCase()).not.toMatch(/cash|prize|jackpot|bet|wager/);
    }
  });

  it("HONESTY: resolved share copy uses field framing and a crown, no money words", () => {
    // Share text now carries the legacy-aware title (correction #1): "Daily Royale" for the new slot,
    // "Legacy Night Game" for an old night result — never relabeling legacy as Daily Royale.
    expect(resolve({ ...buildShareText(1, 12), title: gameTitle("royale") })).toBe(
      "I placed #1 of 12 in Rot Royale Daily Royale 👑",
    );
    expect(resolve({ ...buildShareText(1, 1), title: gameTitle("night") })).toBe(
      "I topped the field in Rot Royale Legacy Night Game 👑",
    );
  });
});
