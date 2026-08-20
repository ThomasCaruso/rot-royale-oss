import { describe, expect, it } from "vitest";
import {
  buildDailyShareUrl,
  buildRotReport,
  buildRotShareText,
  buildRoundBoxes,
  formatSeconds,
  rotReportFromApi,
  type RoundLog,
  rotTitleKey,
} from "@/lib/rotReport";

const log = (correct: boolean, elapsedMs: number | null, category: string | null): RoundLog => ({
  correct,
  elapsedMs,
  category,
});

describe("rotTitleKey — deterministic score → title key (0..8)", () => {
  it("maps every possible 8-question score to its own key", () => {
    expect(rotTitleKey(0)).toBe("t0");
    expect(rotTitleKey(1)).toBe("t1");
    expect(rotTitleKey(2)).toBe("t2");
    expect(rotTitleKey(3)).toBe("t3");
    expect(rotTitleKey(4)).toBe("t4");
    expect(rotTitleKey(5)).toBe("t5");
    expect(rotTitleKey(6)).toBe("t6");
    expect(rotTitleKey(7)).toBe("t7");
    expect(rotTitleKey(8)).toBe("t8");
  });

  it("clamps and rounds out-of-range / fractional scores instead of throwing", () => {
    expect(rotTitleKey(-3)).toBe("t0");
    expect(rotTitleKey(99)).toBe("t8");
    expect(rotTitleKey(5.4)).toBe("t5");
    expect(rotTitleKey(5.6)).toBe("t6");
  });
});

describe("buildRotReport", () => {
  it("counts score/incorrect and computes avg + fastest over answered rounds", () => {
    const r = buildRotReport(
      [
        log(true, 2100, "Geography"),
        log(true, 5800, "History"),
        log(false, 9000, "Geography"),
        log(true, 4000, "Sports"),
      ],
      8,
    );
    expect(r.score).toBe(3);
    expect(r.incorrect).toBe(5); // total(8) - score(3)
    expect(r.fastestMs).toBe(2100);
    expect(r.avgMs).toBe(Math.round((2100 + 5800 + 9000 + 4000) / 4));
    expect(r.total).toBe(8);
  });

  it("records each round's outcome IN PLAY ORDER", () => {
    // The example from the brief: right, right, wrong → ✓ ✓ ✗.
    const r = buildRotReport(
      [log(true, 1000, "History"), log(true, 1000, "Sports"), log(false, 1000, "Geography")],
      3,
    );
    expect(r.rounds).toEqual([true, true, false]);
  });

  it("pads an abandoned run with misses so the grid is always `total` long", () => {
    const r = buildRotReport([log(true, 900, "History"), log(false, 900, "Sports")], 8);
    expect(r.rounds).toHaveLength(8);
    expect(r.rounds).toEqual([true, false, false, false, false, false, false, false]);
    // Consistent with the headline numbers: an unplayed question is not a right one.
    expect(r.score).toBe(1);
    expect(r.incorrect).toBe(7);
  });

  it("keeps the grid the run length even if more rounds were logged than expected", () => {
    const r = buildRotReport([log(true, 1, null), log(true, 1, null), log(true, 1, null)], 2);
    expect(r.rounds).toEqual([true, true]);
  });

  it("omits timing stats when no round logged a clean answer time", () => {
    const r = buildRotReport([log(false, null, "History"), log(true, null, "Sports")], 8);
    expect(r.avgMs).toBeNull();
    expect(r.fastestMs).toBeNull();
    expect(r.score).toBe(1);
  });
});

describe("buildRoundBoxes — the shareable row", () => {
  it("renders correct as a green tick box and wrong as a red cross box, in order", () => {
    expect(buildRoundBoxes([true, true, false])).toBe("✅✅❌");
  });

  it("is empty for an empty run rather than emitting a stray line", () => {
    expect(buildRoundBoxes([])).toBe("");
  });

  it("leaks nothing about the answers — only where the run broke", () => {
    const boxes = buildRoundBoxes([true, false, true, false, true, true, false, true]);
    // ✅ (U+2705) and ❌ (U+274C) are single BMP code points, so 8 rounds is 8 units long.
    expect(boxes).toHaveLength(8);
    expect(boxes).toMatch(/^[✅❌]+$/u);
  });
});

describe("formatSeconds", () => {
  it("renders ms as a one-decimal seconds label", () => {
    expect(formatSeconds(5800)).toBe("5.8s");
    expect(formatSeconds(2100)).toBe("2.1s");
    expect(formatSeconds(0)).toBe("0.0s");
  });
});

describe("buildDailyShareUrl — Wordle-style daily link (NOT a 1v1 challenge)", () => {
  it("points at today's Daily Royale with a neutral ?ref param — no challenge/score encoding", () => {
    const url = buildDailyShareUrl("https://rotroyale.live/");
    expect(url).toBe("https://rotroyale.live/?ref=rot_report");
    expect(url).not.toContain("challenge");
    expect(url).not.toMatch(/score_\d/);
  });

  it("strips any existing query/hash so the link is clean", () => {
    expect(buildDailyShareUrl("https://rotroyale.live/play?foo=1#x")).toBe(
      "https://rotroyale.live/play?ref=rot_report",
    );
  });

  it("omits the ref param entirely when passed an empty ref", () => {
    expect(buildDailyShareUrl("https://rotroyale.live/", "")).toBe("https://rotroyale.live/");
  });
});

describe("buildRotShareText", () => {
  it("composes a Wordle-style multi-line share string (score first, link last)", () => {
    const text = buildRotShareText({
      heading: "ROT ROYALE: Today's Rot Report",
      correctLine: "6/8 correct",
      titleLine: "Title: Not Cooked Yet",
      taglineLink: "Prove your brain isn't cooked: https://rotroyale.live/?ref=rot_report",
    });
    expect(text).toBe(
      "ROT ROYALE: Today's Rot Report\n6/8 correct\nTitle: Not Cooked Yet\nProve your brain isn't cooked: https://rotroyale.live/?ref=rot_report",
    );
    expect(text).not.toContain("challenge");
  });

  it("inserts optional stat lines between the title and the tagline/link", () => {
    const text = buildRotShareText({
      heading: "ROT REPORT",
      correctLine: "6/8 today",
      titleLine: "Title: Not Cooked Yet",
      statLines: ["Average time: 5.8s", "Worst category: Geography"],
      taglineLink: "Play today's Rot Royale: https://rotroyale.live/?ref=rot_report",
    });
    expect(text).toBe(
      "ROT REPORT\n6/8 today\nTitle: Not Cooked Yet\nAverage time: 5.8s\nWorst category: Geography\nPlay today's Rot Royale: https://rotroyale.live/?ref=rot_report",
    );
  });

  it("omits the tagline/link line when there is no link", () => {
    const text = buildRotShareText({
      heading: "ROT ROYALE: Today's Rot Report",
      correctLine: "6/8 correct",
      titleLine: "Title: Not Cooked Yet",
      taglineLink: "",
    });
    expect(text).toBe("ROT ROYALE: Today's Rot Report\n6/8 correct\nTitle: Not Cooked Yet");
  });
});

describe("rotReportFromApi — the server's rebuilt report", () => {
  it("maps the snake_case response onto the same shape buildRotReport produces", () => {
    const mapped = rotReportFromApi({
      score: 6,
      total: 8,
      incorrect: 2,
      avg_ms: 5800,
      fastest_ms: 3100,
      rounds: [true, true, false, true, true, false, true, true],
    });
    expect(mapped).toEqual({
      score: 6,
      total: 8,
      incorrect: 2,
      avgMs: 5800,
      fastestMs: 3100,
      rounds: [true, true, false, true, true, false, true, true],
    });
  });

  it("produces exactly the fields buildRotReport does, so the two paths are interchangeable", () => {
    // Home swaps one for the other depending on whether this device holds the stash. A field the
    // mapper forgot (or spelled the server's way) would render as a missing stat, not a type error.
    const local = buildRotReport([log(true, 2100, "History"), log(false, 4000, "Sports")], 8);
    const fromServer = rotReportFromApi({
      score: 1,
      total: 8,
      incorrect: 7,
      avg_ms: 3050,
      fastest_ms: 2100,
      rounds: [true, false],
    });
    expect(Object.keys(fromServer).sort()).toEqual(Object.keys(local).sort());
  });

  it("carries the nullable timing/category fields through as null", () => {
    expect(
      rotReportFromApi({
        score: 8,
        total: 8,
        incorrect: 0,
        avg_ms: null,
        fastest_ms: null,
        rounds: [],
      }),
    ).toEqual({ score: 8, total: 8, incorrect: 0, avgMs: null, fastestMs: null, rounds: [] });
  });
});
