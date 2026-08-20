import { describe, expect, it } from "vitest";
import type { CampaignArc, CampaignLevel, CampaignWorld, ClearStatus } from "@/api/client";
import { en } from "@/i18n/en";
import {
  arcCleared,
  chestState,
  clearLabel,
  clearStatusForCorrect,
  coinsToNextChest,
  currentMissionLevel,
  journeyTotals,
  medalFor,
  nextChest,
  perfectCount,
  pickCurrentWorld,
  worldFlavor,
  worldIcon,
  worldJustCompleted,
  worldState,
  worldTheme,
} from "@/lib/campaign";

// --- fixtures ---
function lvl(
  n: number,
  o: { unlocked?: boolean; cleared?: boolean; status?: ClearStatus; boss?: boolean } = {},
): CampaignLevel {
  return {
    level_number: n,
    title: `Level ${n}`,
    arc_name: "Arc",
    is_boss: o.boss ?? false,
    difficulty_mix: { easy: 0, medium: 0, hard: 0 },
    unlocked: o.unlocked ?? false,
    cleared: o.cleared ?? false,
    clear_status: o.status ?? null,
    best_correct: o.cleared ? 8 : 0,
  };
}
function arc(name: string, levels: CampaignLevel[]): CampaignArc {
  return { name, levels };
}
function world(name: string, arcs: CampaignArc[]): CampaignWorld {
  const levels = arcs.flatMap((a) => a.levels);
  return {
    world: name,
    category: name,
    arcs,
    cleared_count: levels.filter((l) => l.cleared).length,
    total_levels: levels.length,
  };
}

describe("clearStatusForCorrect", () => {
  it("mirrors the server thresholds (7=clear, 8/9=strong, 10=perfect)", () => {
    expect(clearStatusForCorrect(6)).toBeNull();
    expect(clearStatusForCorrect(7)).toBe("clear");
    expect(clearStatusForCorrect(8)).toBe("strong");
    expect(clearStatusForCorrect(9)).toBe("strong");
    expect(clearStatusForCorrect(10)).toBe("perfect");
  });

  it("treats a failing run (below 7) as not passed", () => {
    expect(clearStatusForCorrect(0)).toBeNull();
    expect(clearStatusForCorrect(6)).toBeNull();
  });
});

describe("clearLabel / medalFor", () => {
  it("labels each status", () => {
    expect(clearLabel(en, "perfect")).toBe("Perfect");
    expect(clearLabel(en, "strong")).toBe("Strong Clear");
    expect(clearLabel(en, "clear")).toBe("Clear");
    expect(clearLabel(en, null)).toBe("Keep Trying");
  });
  it("medals only cleared levels", () => {
    expect(medalFor("perfect")).toBe("👑");
    expect(medalFor("clear")).not.toBe("");
    expect(medalFor(null)).toBe("");
  });
});

describe("worldIcon", () => {
  it("maps the six worlds and falls back", () => {
    for (const w of ["Science", "History", "Sports", "Geography", "Arts", "Pop Culture"]) {
      expect(worldIcon(w)).not.toBe("🎯");
    }
    expect(worldIcon("Nonsense")).toBe("🎯");
  });
});

describe("worldTheme", () => {
  const WORLDS = ["Science", "History", "Sports", "Geography", "Arts", "Pop Culture"];

  it("gives each world a distinct glyph and a fallback for unknown worlds", () => {
    expect(worldTheme("Science").glyph).toBe("🔬");
    expect(worldTheme("Nonsense").glyph).toBe("🎯");
    const accents = WORLDS.map((w) => worldTheme(w).accent);
    expect(new Set(accents).size).toBe(6); // all six accents are distinct
  });

  it("gives every world (and the fallback) a diorama scene with exactly two props", () => {
    for (const w of [...WORLDS, "Nonsense"]) {
      const scene = worldTheme(w).scene;
      expect(scene.silhouette).toBeTruthy();
      expect(scene.props).toHaveLength(2);
      for (const p of scene.props) {
        expect(p.glyph).not.toBe("");
        expect(p.size).toBeGreaterThan(0);
      }
    }
    // the six canonical worlds use distinct silhouette compositions
    const silhouettes = WORLDS.map((w) => worldTheme(w).scene.silhouette);
    expect(new Set(silhouettes).size).toBe(6);
  });
});

describe("currentMissionLevel", () => {
  const w = world("W", [
    arc("Ch1", [lvl(1, { unlocked: true, cleared: true, status: "clear" }), lvl(2, { unlocked: true })]),
    arc("Ch2", [lvl(3), lvl(4)]),
  ]);

  it("is the first unlocked, not-yet-cleared level", () => {
    expect(currentMissionLevel(w)?.level.level_number).toBe(2);
    expect(currentMissionLevel(w)?.arcName).toBe("Ch1");
  });
  it("is null when the world is fully cleared", () => {
    const done = world("D", [arc("Ch1", [lvl(1, { unlocked: true, cleared: true, status: "perfect" })])]);
    expect(currentMissionLevel(done)).toBeNull();
  });
  it("is null when nothing is unlocked yet", () => {
    const fresh = world("F", [arc("Ch1", [lvl(1), lvl(2)])]);
    expect(currentMissionLevel(fresh)).toBeNull();
  });
});

describe("perfectCount", () => {
  it("counts only perfect-clear levels", () => {
    const w = world("W", [
      arc("Ch1", [
        lvl(1, { cleared: true, status: "perfect" }),
        lvl(2, { cleared: true, status: "strong" }),
        lvl(3, { cleared: true, status: "perfect" }),
      ]),
    ]);
    expect(perfectCount(w)).toBe(2);
  });
});

describe("arcCleared / chestState", () => {
  it("opened only when every level in the arc is cleared", () => {
    const allDone = arc("A", [lvl(1, { cleared: true, status: "clear" }), lvl(2, { cleared: true, status: "clear" })]);
    const inProgress = arc("B", [lvl(3, { cleared: true, status: "clear" }), lvl(4, { unlocked: true })]);
    const future = arc("C", [lvl(5), lvl(6)]);
    expect(arcCleared(allDone)).toBe(true);
    expect(chestState(allDone)).toBe("opened");
    expect(chestState(inProgress)).toBe("ready"); // anticipation
    expect(chestState(future)).toBe("locked");
  });
});

describe("journeyTotals / pickCurrentWorld", () => {
  const a = world("A", [arc("c", [lvl(1, { unlocked: true, cleared: true, status: "clear" }), lvl(2, { unlocked: true })])]);
  const b = world("B", [arc("c", [lvl(1), lvl(2)])]);

  it("sums cleared/total across worlds", () => {
    const t = journeyTotals([a, b]);
    expect(t.cleared).toBe(1);
    expect(t.total).toBe(4);
    expect(t.pct).toBeCloseTo(0.25);
  });
  it("spotlights the in-progress world", () => {
    expect(pickCurrentWorld([a, b])).toBe("A");
  });
  it("falls back to the first incomplete world when none are in progress", () => {
    expect(pickCurrentWorld([b])).toBe("B");
  });
});

describe("worldState", () => {
  it("classifies completed / current / started / available", () => {
    const completed = world("W", [arc("a", [lvl(1, { cleared: true, status: "clear" })])]);
    expect(worldState(completed, "X")).toBe("completed");

    const fresh = world("F", [arc("a", [lvl(1), lvl(2)])]);
    expect(worldState(fresh, "F")).toBe("current"); // spotlighted
    expect(worldState(fresh, "Other")).toBe("available"); // coming up

    const started = world("S", [arc("a", [lvl(1, { cleared: true, status: "clear" }), lvl(2)])]);
    expect(worldState(started, "Other")).toBe("started");
  });
});

describe("worldJustCompleted (frame-unlock celebration trigger)", () => {
  const done = { unlocked: true, cleared: true, status: "clear" as ClearStatus };
  const completion = (over: Partial<{ passed: boolean; first_clear: boolean; level: number }> = {}) => ({
    passed: true,
    first_clear: true,
    level: 4,
    ...over,
  });

  it("fires when THIS completion clears the last uncleared level of its world", () => {
    // Pre-refetch ladder: level 4 (the one just completed) is the only uncleared level.
    const w = world("Science", [
      arc("Ch1", [lvl(1, done), lvl(2, done)]),
      arc("Ch2", [lvl(3, done), lvl(4, { unlocked: true })]),
    ]);
    expect(worldJustCompleted(w, completion())).toBe(true);
  });

  it("is stable across the post-completion ladder refetch (completing level now cleared)", () => {
    // Post-refetch ladder: level 4 already shows cleared. Same answer — it is excluded.
    const w = world("Science", [
      arc("Ch1", [lvl(1, done), lvl(2, done)]),
      arc("Ch2", [lvl(3, done), lvl(4, done)]),
    ]);
    expect(worldJustCompleted(w, completion())).toBe(true);
  });

  it("does NOT fire on a replay of an already-cleared level (first_clear=false)", () => {
    const w = world("Science", [arc("Ch1", [lvl(1, done), lvl(2, done), lvl(3, done), lvl(4, done)])]);
    expect(worldJustCompleted(w, completion({ first_clear: false }))).toBe(false);
  });

  it("does NOT fire when other levels remain uncleared (boss cleared early)", () => {
    const w = world("Science", [
      arc("Ch1", [lvl(1, done), lvl(2, { unlocked: true })]),
      arc("Ch2", [lvl(3, done), lvl(4, { unlocked: true })]),
    ]);
    expect(worldJustCompleted(w, completion())).toBe(false);
  });

  it("does NOT fire on a failed run, even with everything else cleared", () => {
    const w = world("Science", [arc("Ch1", [lvl(1, done), lvl(2, { unlocked: true })])]);
    expect(worldJustCompleted(w, completion({ level: 2, passed: false }))).toBe(false);
  });

  it("is false for a missing or empty world", () => {
    expect(worldJustCompleted(null, completion())).toBe(false);
    expect(worldJustCompleted(world("Empty", []), completion())).toBe(false);
  });
});

describe("nextChest (the reward the player is climbing toward)", () => {
  it("is the first not-yet-opened reachable chapter chest, with levels remaining", () => {
    const w = world("W", [
      arc("Ch1", [
        lvl(1, { unlocked: true, cleared: true, status: "clear" }),
        lvl(2, { unlocked: true, cleared: true, status: "clear" }),
      ]),
      arc("Ch2", [lvl(3, { unlocked: true }), lvl(4)]),
    ]);
    const n = nextChest(w);
    expect(n?.arcIndex).toBe(1);
    expect(n?.arcName).toBe("Ch2");
    expect(n?.isFinal).toBe(true);
    expect(n?.levelsRemaining).toBe(2);
  });

  it("marks a single in-progress arc as the (final) next chest", () => {
    const w = world("S", [arc("Ch1", [lvl(1, { unlocked: true }), lvl(2)])]);
    expect(nextChest(w)).toEqual({ arcIndex: 0, arcName: "Ch1", isFinal: true, levelsRemaining: 2 });
  });

  it("is null when every reachable chest is opened (world complete)", () => {
    const done = world("D", [arc("Ch1", [lvl(1, { unlocked: true, cleared: true, status: "perfect" })])]);
    expect(nextChest(done)).toBeNull();
  });

  it("is null when nothing is unlocked yet", () => {
    const fresh = world("F", [arc("Ch1", [lvl(1), lvl(2)])]);
    expect(nextChest(fresh)).toBeNull();
  });
});

describe("roadmap form config (worlds differ in form, not only colour)", () => {
  const WORLDS = ["Science", "History", "Sports", "Geography", "Arts", "Pop Culture"];

  it("gives every world (and the fallback) a road, node frame, and chest style", () => {
    for (const w of [...WORLDS, "Nonsense"]) {
      const th = worldTheme(w);
      expect(th.road).toBeTruthy();
      expect(th.nodeFrame).toBeTruthy();
      expect(th.chestStyle).toBeTruthy();
    }
  });

  it("uses a distinct road style for each of the six worlds", () => {
    expect(new Set(WORLDS.map((w) => worldTheme(w).road)).size).toBe(6);
    expect(new Set(WORLDS.map((w) => worldTheme(w).nodeFrame)).size).toBe(6);
  });

  it("art slots stay optional — Science ships the Cosmic Labs pack, other worlds keep the CSS fallback", () => {
    // Science carries the full illustrated drop-in (emblem + node states + journey layers)…
    const science = worldTheme("Science").art;
    expect(science?.worldIconImage).toBeTruthy();
    expect(science?.nodeImages?.completed).toBeTruthy();
    expect(science?.nodeImages?.current).toBeTruthy();
    expect(science?.nodeImages?.locked).toBeTruthy();
    expect(science?.nodeImages?.boss).toBeTruthy();
    expect(science?.layerStartImage).toBeTruthy();
    expect(science?.layerMidImage).toBeTruthy();
    expect(science?.layerSummitImage).toBeTruthy();
    // …while every other world still renders the CSS/SVG fallback with no assets.
    for (const w of WORLDS.filter((x) => x !== "Science")) expect(worldTheme(w).art).toBeUndefined();
  });
});

describe("worldFlavor (per-world subtitle + chest names via i18n)", () => {
  const WORLDS = ["Science", "History", "Sports", "Geography", "Arts", "Pop Culture"];

  it("returns non-empty flavour for every canonical world", () => {
    for (const w of WORLDS) {
      const f = worldFlavor(en, w);
      expect(f.subtitle.trim().length).toBeGreaterThan(0);
      expect(f.chest.trim().length).toBeGreaterThan(0);
      expect(f.bossChest.trim().length).toBeGreaterThan(0);
    }
  });

  it("falls back to a blank subtitle + generic chest labels for unknown worlds", () => {
    const f = worldFlavor(en, "Nonsense");
    expect(f.subtitle).toBe("");
    expect(f.chest).toBe(en.campaign.chapterChest);
    expect(f.bossChest).toBe(en.campaign.bossChest);
  });
});

describe("coinsToNextChest", () => {
  it("is the remaining coins to the daily cap, floored at 0", () => {
    const mk = (earned: number, cap: number) => ({
      worlds: [],
      daily_coins_earned: earned,
      daily_coins_cap: cap,
    });
    expect(coinsToNextChest(mk(40, 300))).toBe(260);
    expect(coinsToNextChest(mk(300, 300))).toBe(0);
    expect(coinsToNextChest(mk(999, 300))).toBe(0);
  });
});
