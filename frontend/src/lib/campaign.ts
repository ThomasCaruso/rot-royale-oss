// Campaign display helpers (pure, unit-tested). The SERVER is authoritative for unlock/clear/coins;
// these mirror its thresholds only for local labels/previews, and centralize player-facing copy so
// the honesty copy-guard can assert it (coins are cosmetic — never cash/prize/gambling language).

import type {
  CampaignArc,
  CampaignCompleteResponse,
  CampaignLadderResponse,
  CampaignLevel,
  CampaignWorld,
  ClearStatus,
} from "@/api/client";
import { cosmicArt } from "@/assets/campaign";
import type { Dict } from "@/i18n/en";

// Mirrors backend app/core/constants.py (CAMPAIGN_*_THRESHOLD).
export const CAMPAIGN_THRESHOLDS = { clear: 7, strong: 8, perfect: 10 } as const;

export function clearStatusForCorrect(correct: number): ClearStatus {
  if (correct >= CAMPAIGN_THRESHOLDS.perfect) return "perfect";
  if (correct >= CAMPAIGN_THRESHOLDS.strong) return "strong";
  if (correct >= CAMPAIGN_THRESHOLDS.clear) return "clear";
  return null;
}

/** Label for a run's outcome. `null` here means a fresh/finished run that didn't pass. */
export function clearLabel(t: Dict, status: ClearStatus): string {
  switch (status) {
    case "perfect":
      return t.campaign.clearPerfect;
    case "strong":
      return t.campaign.clearStrong;
    case "clear":
      return t.campaign.clearClear;
    default:
      return t.campaign.clearNone;
  }
}

/** A medal/crown glyph for a cleared level (empty when not cleared). */
export function medalFor(status: ClearStatus): string {
  switch (status) {
    case "perfect":
      return "👑";
    case "strong":
      return "🥇";
    case "clear":
      return "🥈";
    default:
      return "";
  }
}

// Per-world visual identity. Each world keeps its category glyph but gets a DISTINCT decorative
// surface + accent + sparkle, so the hub reads as six different worlds rather than one repeated card.
// Decorative only (like HeroCard's hardcoded gradients): coins/rewards stay gold (--amber) and the
// brand stays violet everywhere; this only tints the card/medallion surface per world.
// `decor` selects a per-world illustrated composition (orbiting sparks, stone rings, arena rays,
// globe meridians, paint dabs, neon burst) layered around the medallion on the hub world cards —
// so each world reads as a destination, not an icon tile (see WorldCard).
export type WorldDecor = "orbit" | "stone" | "rays" | "meridian" | "dabs" | "neon";

// --- Roadmap FORM selectors (so worlds differ in form, not only colour) ----------------------
// Each selector maps to a CSS/SVG treatment in the shared roadmap components (resolvers in
// components/roadStyles.ts). The geometry/progression logic is shared; only the styling varies.
export type RoadStyle = "orbital" | "trail" | "lanes" | "expedition" | "marquee" | "ribbon";
export type NodeFrame = "orbit" | "seal" | "lane" | "compass" | "spotlight" | "tome";
export type ChestStyle = "capsule" | "reliquary" | "trophy" | "cache" | "marquee" | "tome";

// Optional per-world art slots (HYBRID): the CSS/SVG roadmap looks complete with NONE of these set;
// each is a drop-in upgrade for richer art later, consumed where present with a CSS fallback always.
export interface WorldArt {
  backgroundImage?: string; // full-bleed world backdrop behind the map
  foregroundLeftImage?: string; // ambient prop pinned bottom-left
  foregroundRightImage?: string; // ambient prop pinned bottom-right
  ambientOverlayImage?: string; // soft atmosphere layer over the backdrop (haze/particles)
  pathTextureImage?: string; // texture tiled along the quest road
  chestImage?: string; // illustrated chapter chest (replaces the CSS chest)
  nodeFrameImage?: string; // illustrated frame ring around mission nodes
  currentNodeAuraImage?: string; // aura behind the current mission node
  worldIconImage?: string; // illustrated world emblem (header + hub medallion; replaces the glyph)
  /** Full illustrated node medallions per state (replaces the CSS disc + frame entirely). The art
   * carries the state iconography (check/play/lock/crown); numbers/labels stay React/CSS. */
  nodeImages?: { completed: string; current: string; locked: string; boss: string };
  layerStartImage?: string; // trailhead set piece pinned at the map's BASE (e.g. the moon launch)
  layerMidImage?: string; // drifting mid-journey layer repeated through the climb (e.g. nebula)
  layerSummitImage?: string; // finale set piece behind the boss zone at the TOP (e.g. the galaxy)
}

// `scene` builds the three-layer "destination" composition on hub cards (see WorldCard):
// a background silhouette (temple steps, arena beams, compass ring…), an accent horizon glow
// along the card's bottom, and small foreground prop glyphs that overlap the medallion so the
// card reads as a tiny diorama, not an icon on a dark box. Purely decorative (aria-hidden).
export type WorldSilhouette = "orbit" | "temple" | "arena" | "atlas" | "gallery" | "neon";

export interface WorldProp {
  glyph: string;
  top: string; // CSS offset within the medallion stage
  left: string;
  size: number; // px
  tilt: number; // deg
}

export interface WorldScene {
  silhouette: WorldSilhouette;
  props: WorldProp[]; // exactly two foreground props per world (density without clutter)
}

export interface WorldTheme {
  glyph: string; // category emoji, framed in a medallion (never a bare emoji card)
  accent: string; // glow / ring / progress accent for this world
  spark: string; // sparkle colour
  surface: string; // card background gradient (dark cosmic family)
  medallion: string; // icon-disc gradient
  decor: WorldDecor; // which illustrated composition the hub card draws
  scene: WorldScene; // silhouette + foreground props for the diorama layers
  road: RoadStyle; // how the quest road is styled on the roadmap
  nodeFrame: NodeFrame; // how mission nodes are framed on the roadmap
  chestStyle: ChestStyle; // the chapter/boss chest form on the roadmap
  art?: WorldArt; // optional drop-in art assets (omitted today; CSS/SVG fallback always works)
}

const WORLD_THEME: Record<string, WorldTheme> = {
  Science: {
    road: "orbital",
    nodeFrame: "orbit",
    chestStyle: "capsule",
    glyph: "🔬",
    accent: "#6E8BFF",
    spark: "#B9C6FF",
    surface: "radial-gradient(125% 95% at 20% 8%, #28307e 0%, #171040 52%, #0a0618 100%)",
    medallion: "radial-gradient(120% 120% at 35% 25%, #3a47b0, #171048 70%)",
    decor: "orbit",
    scene: {
      silhouette: "orbit",
      props: [
        { glyph: "⚗️", top: "-4%", left: "-14%", size: 17, tilt: -12 },
        { glyph: "🧬", top: "66%", left: "84%", size: 15, tilt: 14 },
      ],
    },
    // The Cosmic Labs art pack — Science is the first world with the full illustrated drop-in
    // (emblem + node medallions + the moon→nebula→galaxy journey layers). Other worlds keep the
    // CSS/SVG fallback until their packs exist.
    art: {
      worldIconImage: cosmicArt.worldIcon,
      nodeImages: {
        completed: cosmicArt.nodeCompleted,
        current: cosmicArt.nodeCurrent,
        locked: cosmicArt.nodeLocked,
        boss: cosmicArt.nodeBoss,
      },
      layerStartImage: cosmicArt.layerMoon,
      layerMidImage: cosmicArt.layerNebula,
      layerSummitImage: cosmicArt.layerGalaxy,
      chestImage: cosmicArt.chest,
    },
  },
  History: {
    road: "trail",
    nodeFrame: "seal",
    chestStyle: "reliquary",
    glyph: "🏛️",
    accent: "#E0A33C",
    spark: "#FFD98A",
    surface: "radial-gradient(125% 95% at 20% 8%, #4c2e5e 0%, #241638 52%, #0c0716 100%)",
    medallion: "radial-gradient(120% 120% at 35% 25%, #7a5320, #2a1838 70%)",
    decor: "stone",
    scene: {
      silhouette: "temple",
      props: [
        { glyph: "📜", top: "-2%", left: "82%", size: 16, tilt: 12 },
        { glyph: "⚱️", top: "70%", left: "-10%", size: 14, tilt: -8 },
      ],
    },
  },
  Sports: {
    road: "lanes",
    nodeFrame: "lane",
    chestStyle: "trophy",
    glyph: "⚽",
    accent: "#2FD45E",
    spark: "#9CF7B8",
    surface: "radial-gradient(125% 95% at 20% 8%, #155045 0%, #181849 52%, #090518 100%)",
    medallion: "radial-gradient(120% 120% at 35% 25%, #1f7d4f, #14143a 70%)",
    decor: "rays",
    scene: {
      silhouette: "arena",
      props: [
        { glyph: "🏆", top: "-6%", left: "80%", size: 17, tilt: 10 },
        { glyph: "🏀", top: "72%", left: "-8%", size: 14, tilt: -14 },
      ],
    },
  },
  Geography: {
    road: "expedition",
    nodeFrame: "compass",
    chestStyle: "cache",
    glyph: "🌍",
    accent: "#36C5D6",
    spark: "#A7ECF5",
    surface: "radial-gradient(125% 95% at 20% 8%, #15455e 0%, #161a46 52%, #08051a 100%)",
    medallion: "radial-gradient(120% 120% at 35% 25%, #1d6f8a, #14163c 70%)",
    decor: "meridian",
    scene: {
      silhouette: "atlas",
      props: [
        { glyph: "🧭", top: "-4%", left: "-12%", size: 16, tilt: -10 },
        { glyph: "📍", top: "64%", left: "86%", size: 15, tilt: 12 },
      ],
    },
  },
  Arts: {
    road: "ribbon",
    nodeFrame: "tome",
    chestStyle: "tome",
    glyph: "🎨",
    accent: "#E86AD0",
    spark: "#FBC4F0",
    surface: "radial-gradient(125% 95% at 20% 8%, #54226c 0%, #271445 52%, #0c0618 100%)",
    medallion: "radial-gradient(120% 120% at 35% 25%, #8a3a96, #28113f 70%)",
    decor: "dabs",
    scene: {
      silhouette: "gallery",
      props: [
        { glyph: "🖌️", top: "-4%", left: "82%", size: 16, tilt: 24 },
        { glyph: "🗿", top: "70%", left: "-10%", size: 14, tilt: -6 },
      ],
    },
  },
  "Pop Culture": {
    road: "marquee",
    nodeFrame: "spotlight",
    chestStyle: "marquee",
    glyph: "🎬",
    accent: "#FF5C8A",
    spark: "#FFC2D4",
    surface: "radial-gradient(125% 95% at 20% 8%, #621d55 0%, #2a1240 52%, #0c0617 100%)",
    medallion: "radial-gradient(120% 120% at 35% 25%, #a23568, #2a1136 70%)",
    decor: "neon",
    scene: {
      silhouette: "neon",
      props: [
        { glyph: "🎵", top: "-6%", left: "-10%", size: 15, tilt: -14 },
        { glyph: "🎮", top: "70%", left: "84%", size: 15, tilt: 10 },
      ],
    },
  },
};

const FALLBACK_THEME: WorldTheme = {
  road: "orbital",
  nodeFrame: "orbit",
  chestStyle: "capsule",
  glyph: "🎯",
  accent: "var(--brand-2)",
  spark: "#C9B8FF",
  surface: "radial-gradient(125% 95% at 20% 8%, #2c1d52 0%, #1b1136 52%, #0c0717 100%)",
  medallion: "radial-gradient(120% 120% at 35% 25%, #4a2e8f, #1b1136 70%)",
  decor: "orbit",
  scene: {
    silhouette: "orbit",
    props: [
      { glyph: "✦", top: "-4%", left: "-10%", size: 13, tilt: 0 },
      { glyph: "✦", top: "70%", left: "84%", size: 11, tilt: 0 },
    ],
  },
};

export function worldTheme(world: string): WorldTheme {
  return WORLD_THEME[world] ?? FALLBACK_THEME;
}

export function worldIcon(world: string): string {
  return worldTheme(world).glyph;
}

// --- Derived progression helpers (pure; SERVER data only — nothing invented) ---

/** The current mission = the first unlocked-but-not-cleared level (the one to tap next). null when
 * the world is fully cleared or nothing is unlocked yet. */
export function currentMissionLevel(
  world: CampaignWorld,
): { level: CampaignLevel; arcName: string } | null {
  for (const arc of world.arcs) {
    for (const level of arc.levels) {
      if (level.unlocked && !level.cleared) return { level, arcName: arc.name };
    }
  }
  return null;
}

export function perfectCount(world: CampaignWorld): number {
  return world.arcs
    .flatMap((a) => a.levels)
    .filter((l) => l.clear_status === "perfect").length;
}

export function arcCleared(arc: CampaignArc): boolean {
  return arc.levels.length > 0 && arc.levels.every((l) => l.cleared);
}

export type ChestState = "locked" | "ready" | "opened";

/** Chapter chest at the end of an arc: opened once every level in the arc is cleared, "ready" while
 * the arc is in progress (anticipation), locked when no level in it is unlocked yet. */
export function chestState(arc: CampaignArc): ChestState {
  if (arcCleared(arc)) return "opened";
  if (arc.levels.some((l) => l.cleared || l.unlocked)) return "ready";
  return "locked";
}

/** The reward the player is working toward next on this world's road: the nearest arc whose chest is
 * not yet opened AND that has at least one reachable (unlocked or cleared) level — i.e. the chapter
 * in progress. Drives the header's "next reward" anticipation line and the on-path next-chest accent.
 * null when every reachable chest is opened (world complete) or nothing is unlocked yet. */
export interface NextChest {
  arcIndex: number;
  arcName: string;
  isFinal: boolean; // the world's last arc → the boss reward
  levelsRemaining: number; // uncleared levels left in that arc
}

export function nextChest(world: CampaignWorld): NextChest | null {
  for (let i = 0; i < world.arcs.length; i++) {
    const arc = world.arcs[i];
    if (chestState(arc) !== "opened" && arc.levels.some((l) => l.unlocked || l.cleared)) {
      return {
        arcIndex: i,
        arcName: arc.name,
        isFinal: i === world.arcs.length - 1,
        levelsRemaining: arc.levels.filter((l) => !l.cleared).length,
      };
    }
  }
  return null;
}

/** Per-world flavour copy (display title + subtitle + chest names) — routed through i18n so the
 * honesty copy-guard covers it. `title` is the THEMED display name (e.g. Science → "Cosmic Labs");
 * the server world key stays canonical for routing/data. Unknown worlds fall back to a blank
 * subtitle + the generic chest labels (callers fall back to the server name for the title). */
export interface WorldFlavor {
  title?: string;
  subtitle: string;
  chest: string;
  bossChest: string;
}

export function worldFlavor(t: Dict, world: string): WorldFlavor {
  const flavor = (t.campaign.worldFlavor as Record<string, WorldFlavor | undefined>)[world];
  return (
    flavor ?? {
      subtitle: "",
      chest: t.campaign.chapterChest,
      bossChest: t.campaign.bossChest,
    }
  );
}

export interface JourneyTotals {
  cleared: number;
  total: number;
  pct: number; // 0..1
}

export function journeyTotals(worlds: CampaignWorld[]): JourneyTotals {
  const cleared = worlds.reduce((s, w) => s + w.cleared_count, 0);
  const total = worlds.reduce((s, w) => s + w.total_levels, 0);
  return { cleared, total, pct: total ? cleared / total : 0 };
}

/** The world to spotlight as "current" on the hub: the first in-progress world, else the first
 * not-yet-complete world, else the first world. */
export function pickCurrentWorld(worlds: CampaignWorld[]): string | null {
  const inProgress = worlds.find((w) => w.cleared_count > 0 && w.cleared_count < w.total_levels);
  if (inProgress) return inProgress.world;
  const firstIncomplete = worlds.find((w) => w.cleared_count < w.total_levels);
  return (firstIncomplete ?? worlds[0])?.world ?? null;
}

// World board states (NOT a rules lock — worlds are always enterable). "current" is the spotlighted
// world from pickCurrentWorld; "available" worlds get the calmer "coming up" anticipatory styling.
export type WorldState = "completed" | "current" | "started" | "available";

export function worldState(world: CampaignWorld, currentWorldName: string | null): WorldState {
  if (world.total_levels > 0 && world.cleared_count >= world.total_levels) return "completed";
  if (world.world === currentWorldName) return "current";
  if (world.cleared_count > 0) return "started";
  return "available";
}

/** Coins still needed to fill today's daily chest (the daily campaign coin cap). 0 = already full. */
export function coinsToNextChest(ladder: CampaignLadderResponse): number {
  return Math.max(0, ladder.daily_coins_cap - ladder.daily_coins_earned);
}

/**
 * True iff THIS completion just finished its world for the FIRST time — the trigger for the
 * frame-unlock celebration. Three server facts must agree:
 *  - `passed`: the run cleared the level;
 *  - `first_clear`: the level had never been cleared before (replays of an already-cleared
 *    level — including any level of an already-complete world — can never fire);
 *  - every OTHER level in the world is already cleared (clearing the boss while earlier levels
 *    remain open does not fire).
 * The completing level is EXCLUDED from the sweep, so the answer is identical whether the
 * post-completion ladder refetch has landed or not — this completion changes only its own
 * level's `cleared` flag, never the others'.
 */
export function worldJustCompleted(
  world: Pick<CampaignWorld, "arcs"> | null | undefined,
  completion: Pick<CampaignCompleteResponse, "passed" | "first_clear" | "level">,
): boolean {
  if (!world || !completion.passed || !completion.first_clear) return false;
  const levels = world.arcs.flatMap((a) => a.levels);
  return levels.length > 0 && levels.every((l) => l.level_number === completion.level || l.cleared);
}
