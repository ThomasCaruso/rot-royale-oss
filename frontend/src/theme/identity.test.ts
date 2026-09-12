import { describe, expect, it } from "vitest";
import {
  AVATAR_PRESETS,
  BADGE_STYLES,
  DEFAULT_AVATAR_PRESET,
  FRAME_STYLES,
  TITLE_STYLES,
  WORLD_FRAMES,
  getBadge,
  getFrame,
  getPreset,
  getTitle,
  titleFlairStyle,
} from "@/theme/identity";
// Cross-side parity contract: this JSON is the single source of truth for cosmetic ids.
// The backend reads the same file by path (backend/tests/test_cosmetics.py) so any id drift
// (backend adds a frame without a frontend FRAME_STYLES entry, or vice-versa) fails both sides.
import cosmeticIds from "@/theme/cosmeticIds.json";
import { findBannedTerms } from "@/i18n/copyGuard";

const PRESET_IDS: string[] = cosmeticIds.presets;
const FRAME_IDS: string[] = cosmeticIds.frames;
const BADGE_IDS: string[] = cosmeticIds.badges;
const TITLE_IDS: string[] = cosmeticIds.titles;
const WORLD_KEYS: string[] = cosmeticIds.worlds;

describe("avatar presets", () => {
  it("carries exactly the server-validated preset ids, unique, each with portrait + emoji + disc", () => {
    const ids = AVATAR_PRESETS.map((p) => p.id);
    expect(ids.sort()).toEqual([...PRESET_IDS].sort());
    expect(new Set(ids).size).toBe(PRESET_IDS.length);
    for (const p of AVATAR_PRESETS) {
      expect(p.emoji.length, `${p.id} emoji`).toBeGreaterThan(0);
      expect(p.bg, `${p.id} bg`).toContain("radial-gradient");
      // The path is pinned to the convention, but an OPTIONAL `?v=N` is allowed: /avatars is served
      // from public/, which Vite does not content-hash, so re-exporting art under the same URL has
      // to carry a cache-buster or every browser that already fetched it keeps the old bytes
      // (docs/architecture.md §13). Forbidding the suffix here would forbid ever re-cutting a portrait.
      expect(p.portrait, `${p.id} portrait`).toMatch(
        new RegExp(`^/avatars/portraits/${p.id}\\.webp(\\?v=\\d+)?$`),
      );
      // Only the original Blank-pair presets carry a line-art `img`; portrait-only presets omit it.
      if (p.img) expect(p.img, `${p.id} img`).toMatch(new RegExp(`^/avatars/${p.id}\\.webp(\\?v=\\d+)?$`));
    }
  });

  it("knight is the default preset and carries its portrait", () => {
    expect(DEFAULT_AVATAR_PRESET).toBe("knight");
    expect(getPreset("knight").img).toBe("/avatars/knight.webp?v=2");
    expect(getPreset("knight").bg).toContain("radial-gradient");
  });

  it("each preset disc is distinct (a different hue family per preset)", () => {
    const bgs = AVATAR_PRESETS.map((p) => p.bg);
    expect(new Set(bgs).size).toBe(AVATAR_PRESETS.length);
  });

  it("getPreset falls back to knight for unknown/missing ids (server-authoritative ids only)", () => {
    expect(getPreset(undefined).id).toBe("knight");
    expect(getPreset(null).id).toBe("knight");
    expect(getPreset("not-a-preset").id).toBe("knight");
    expect(getPreset("bishop").id).toBe("bishop");
  });
});

describe("frame styles", () => {
  it("carries exactly the 11 catalog frame ids", () => {
    expect(Object.keys(FRAME_STYLES).sort()).toEqual([...FRAME_IDS].sort());
    for (const [key, f] of Object.entries(FRAME_STYLES)) {
      expect(f.id, `${key} id mismatch`).toBe(key);
      expect(f.name.trim(), `${key} name`).not.toBe("");
      expect(f.blurb.trim(), `${key} blurb`).not.toBe("");
    }
  });

  it("every frame except frame_none has a ring; crowned_scholar is the sole prestige frame", () => {
    for (const f of Object.values(FRAME_STYLES)) {
      if (f.id === "frame_none") expect(f.ring).toBeUndefined();
      else expect(f.ring, `${f.id} ring`).toBeTruthy();
    }
    const prestige = Object.values(FRAME_STYLES).filter((f) => f.prestige);
    expect(prestige.map((f) => f.id)).toEqual(["crowned_scholar"]);
    // Visibly the best frame: dual gold+violet ring + dual glow + crown ornament.
    const cs = FRAME_STYLES.crowned_scholar;
    expect(cs.ring).toContain("#ffd24a");
    expect(cs.ring).toContain("#a855f7");
    expect(cs.glow).toContain("255,201,30");
    expect(cs.glow).toContain("168,85,247");
    expect(cs.ornament).toBe("👑");
  });

  it("getFrame: null/unknown → null (no frame); known ids resolve; frame_none has no treatment", () => {
    expect(getFrame(null)).toBeNull();
    expect(getFrame(undefined)).toBeNull();
    expect(getFrame("not-a-frame")).toBeNull();
    expect(getFrame("gold_crown")?.ornament).toBe("👑");
    const none = getFrame("frame_none");
    expect(none?.ring).toBeUndefined();
    expect(none?.glow).toBeUndefined();
    expect(none?.ornament).toBeUndefined();
  });
});

describe("badge styles", () => {
  it("carries exactly the 10 catalog badge ids, each with emoji + name + blurb + tint", () => {
    expect(Object.keys(BADGE_STYLES).sort()).toEqual([...BADGE_IDS].sort());
    for (const [key, b] of Object.entries(BADGE_STYLES)) {
      expect(b.id, `${key} id mismatch`).toBe(key);
      expect(b.emoji.length, `${key} emoji`).toBeGreaterThan(0);
      expect(b.name.trim(), `${key} name`).not.toBe("");
      expect(b.blurb.trim(), `${key} blurb`).not.toBe("");
      expect(b.tint.trim(), `${key} tint`).not.toBe("");
    }
  });

  it("getBadge: null/unknown → null; known ids resolve", () => {
    expect(getBadge(null)).toBeNull();
    expect(getBadge(undefined)).toBeNull();
    expect(getBadge("not-a-badge")).toBeNull();
    expect(getBadge("crown_all")?.emoji).toBe("👑");
    expect(getBadge("medal_science")?.emoji).toBe("⚗️");
  });
});

describe("title styles", () => {
  it("carries exactly the 6 catalog title ids, each with name + blurb + flair", () => {
    expect(Object.keys(TITLE_STYLES).sort()).toEqual([...TITLE_IDS].sort());
    for (const [key, s] of Object.entries(TITLE_STYLES)) {
      expect(s.id, `${key} id mismatch`).toBe(key);
      expect(s.name.trim(), `${key} name`).not.toBe("");
      expect(s.blurb.trim(), `${key} blurb`).not.toBe("");
      expect(s.flair.trim(), `${key} flair`).not.toBe("");
    }
  });

  it("getTitle: null/unknown → null; known ids resolve", () => {
    expect(getTitle(null)).toBeNull();
    expect(getTitle(undefined)).toBeNull();
    expect(getTitle("not-a-title")).toBeNull();
    expect(getTitle("champion")?.name).toBe("Champion");
  });

  it("titleFlairStyle: solid colors color the text, gradients clip to the glyphs", () => {
    expect(titleFlairStyle("#ffb300")).toEqual({ color: "#ffb300" });
    const grad = titleFlairStyle("linear-gradient(90deg, #ffe36a, #ffb300)");
    expect(grad.backgroundImage).toContain("linear-gradient");
    expect(grad.backgroundClip).toBe("text");
    expect(grad.color).toBe("transparent");
  });
});

describe("world frames (celebration map)", () => {
  it("keys are exactly the fixture worlds and every value is a fixture frame id", () => {
    expect(Object.keys(WORLD_FRAMES).sort()).toEqual([...WORLD_KEYS].sort());
    for (const [world, frameId] of Object.entries(WORLD_FRAMES)) {
      expect(FRAME_IDS, `${world} → ${frameId}`).toContain(frameId);
    }
  });
});

describe("copy guard — frame/badge/title names+blurbs are player-facing (DESIGN §7)", () => {
  // Money/gambling/wagering policy is the shared copyGuard (single source of truth with i18n.test).
  // No scarcity/urgency framing either — locked frames are goals, not fear-of-missing-out.
  const URGENCY = ["hurry", "limited time", "last chance", "expires", "act now", "only today"];

  it("no banned or urgency words in any frame/badge/title name/blurb", () => {
    const offenders: string[] = [];
    const entries = [
      ...Object.values(FRAME_STYLES),
      ...Object.values(BADGE_STYLES),
      ...Object.values(TITLE_STYLES),
    ];
    for (const f of entries) {
      const text = `${f.name} ${f.blurb}`;
      const hits = findBannedTerms(text);
      const low = text.toLowerCase();
      for (const u of URGENCY) if (low.includes(u)) hits.push(u);
      if (hits.length) offenders.push(`${f.id}: "${text}" (${hits.join(", ")})`);
    }
    expect(offenders).toEqual([]);
  });
});
