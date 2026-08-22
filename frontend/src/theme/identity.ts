// Avatar identity visuals — presets (emoji + gradient disc), frames (ring/glow/ornament
// treatments), badges (earned honors, pick-3 visible) and titles (one equippable line under your
// name). Pure data + lookup helpers; the Avatar component renders presets/frames, ownership and
// equipped state live server-side (profiles.avatar_preset / equipped_frame / equipped_badges /
// equipped_title). Badges and titles are NEVER purchasable — they are proof, not merchandise.
//
// FRAME/BADGE/TITLE name/blurb strings are PLAYER-FACING COPY: the honesty rules (DESIGN §7)
// apply — coins are cosmetic, locked items are goals, never cash/prize/gambling language (and
// never "player" — use field/contest language). identity.test.ts copy-guards this file with the
// same banned list as the i18n suite.

import type { CSSProperties } from "react";

export interface AvatarPreset {
  id: string;
  emoji: string;
  /** Radial-gradient disc background — shown behind the portrait (and as the emoji fallback). */
  bg: string;
  /** Line-art heraldic mark (a /avatars/*.png in public/) — the Blank pair's profile image (the
   * whole Blank skin is one line-drawing style). */
  img?: string;
  /** Illustrated human character portrait (/avatars/portraits/*.png) — the profile image on
   * every theme EXCEPT the Blank pair (Starter system + the arcade Rot Champion). */
  portrait?: string;
}

/**
 * Disc gradient builder — one identity TINT, mixed LIGHTLY over the theme's own surface.
 *
 * The disc is the visible background behind every avatar (the portrait PNGs are transparent around
 * the bust). It went through two earlier lives: hardcoded near-black stops (a dark blob on the ivory
 * themes), then fixed per-preset HEX hues mixed at 30–62% over the panel. The fixed hues were the
 * problem this fixes — several (`#4C5A7A` slate, `#1F5C6B` teal, `#6B5334` stone) washed out to a
 * muddy GREY over white, and none of them related to the equipped theme's palette, so a slate-grey
 * medallion sat oddly inside a royal-purple-and-gold room.
 *
 * Now every tint is a THEME TOKEN (or a clean two-accent blend of them), so the disc is drawn from
 * the theme's OWN colours and re-skins with it: soft harmonious pastels on the light themes, deep
 * moody medallions on the dark ones — one definition, no light/dark branching, matching by
 * construction. The mix is kept light (16→30%) so the disc stays a CHILL, minimal wash rather than a
 * saturated puck. The 30%→22% light-source keeps the original soft top-left falloff.
 */
const disc = (tint: string) =>
  `radial-gradient(120% 120% at 30% 22%, ` +
  `color-mix(in srgb, ${tint} 16%, var(--panel)) 0%, ` +
  `color-mix(in srgb, ${tint} 30%, var(--panel)) 100%)`;

/**
 * The free presets — illustrated hoodie-bust portraits (public/avatars/portraits/*.png), ids
 * validated server-side (PATCH /me/avatar). The emoji + disc gradient are the fallback shown behind
 * the portrait. `knight` is the default. To add one: drop a portrait PNG in
 * public/avatars/portraits/, add an entry here, and mirror the id in theme/cosmeticIds.json +
 * backend AVATAR_PRESETS.
 *
 * The first four also carry a line-art `img` (public/avatars/*.png) — the Blank pair's ink-on-paper
 * mark. Portrait-only presets (no `img`) fall back to the shared knight glyph on the Blank theme
 * (Avatar.tsx); they wear their full portrait on every other skin.
 */
export const AVATAR_PRESETS: AvatarPreset[] = [
  // Each disc tint is a THEME TOKEN (or a clean blend of two), so every avatar's backdrop is drawn
  // from the equipped theme's palette and shifts with it — no more fixed slate/stone hues that read
  // grey on an ivory page. Curated for a pleasing spread: two violets, gold, mauve, rose, peach,
  // green, periwinkle — distinct but all in the theme's harmony. `--cyan` is deliberately unused (it
  // is a muted near-grey on several themes, exactly the tone we're moving away from).
  { id: "knight", emoji: "♞", bg: disc("var(--brand)"), img: "/avatars/knight.png?v=2", portrait: "/avatars/portraits/knight.png?v=2" },
  // ?v=2 — crescent was the ONE portrait whose artwork did not run to the bottom of its canvas
  // (17px short, against a gap of 0 on all seven others), so inside the circular crop her shoulders
  // left a band of bare disc that no other avatar had, and she read smaller than everyone else. The
  // art was re-framed: scaled to the cohort's median content height and sat flush on the bottom
  // edge. The bump is what makes anyone who already cached her actually see it — /avatars is served
  // from public/, which Vite copies WITHOUT content-hashing (docs/architecture.md §13).
  { id: "crescent", emoji: "🌙", bg: disc("var(--brand-2)"), img: "/avatars/crescent.png?v=2", portrait: "/avatars/portraits/crescent.png?v=3" },
  { id: "rook", emoji: "♜", bg: disc("var(--amber)"), img: "/avatars/rook.png?v=2", portrait: "/avatars/portraits/rook.png?v=2" },
  { id: "bishop", emoji: "♝", bg: disc("color-mix(in srgb, var(--brand) 50%, var(--pink))"), img: "/avatars/bishop.png?v=2", portrait: "/avatars/portraits/bishop.png?v=2" },
  { id: "ember", emoji: "🔥", bg: disc("var(--pink)"), portrait: "/avatars/portraits/ember.png?v=2" },
  { id: "sol", emoji: "☀️", bg: disc("color-mix(in srgb, var(--amber) 56%, var(--pink))"), portrait: "/avatars/portraits/sol.png?v=2" },
  { id: "willow", emoji: "🌿", bg: disc("var(--lime)"), portrait: "/avatars/portraits/willow.png?v=2" },
  { id: "onyx", emoji: "🌑", bg: disc("color-mix(in srgb, var(--brand-2) 55%, var(--lime))"), portrait: "/avatars/portraits/onyx.png?v=2" },
];

export const DEFAULT_AVATAR_PRESET = "knight";

/** The preset's profile image for the active skin: the Blank pair keeps the line-art mark
 * (`img`); every other theme wears the illustrated human portrait. Callers pass
 * `blankSkin = artStyle === "mono" && themeArt == null`. */
export function presetProfileImage(p: AvatarPreset, blankSkin: boolean): string | undefined {
  return blankSkin ? p.img : (p.portrait ?? p.img);
}

export interface FrameStyle {
  id: string;
  /** Player-facing display name (copy-guarded). */
  name: string;
  /** Player-facing flavor line (copy-guarded; goal-framed, no urgency). */
  blurb: string;
  /** CSS gradient painted into the avatar's border box (border-box/padding-box double
   * background). Absent → no ring treatment (frame_none). */
  ring?: string;
  /** Extra box-shadow layered on the disc. */
  glow?: string;
  /** Emoji perched on the disc's top edge (aria-hidden, decorative). */
  ornament?: string;
  /** The visibly-best frame: dual gold+violet ring + a slow glow pulse (reduced-motion safe). */
  prestige?: boolean;
}

/*
 * FRAME DESIGN LANGUAGE — every ring is machined metal, not a flat colored border.
 *
 * ring — a conic-gradient with alternating dark/specular stops (two bright "catchlights" per
 *   revolution, offset like real polished metal under a keylight). Reads as a crafted object at
 *   every size, from a 32px leaderboard row to the 96px vault preview.
 * glow — three light layers, cheapest possible (all static box-shadow):
 *   1. `inset 0 0 0 1px <bright>` — the inner rim light where the disc meets the metal;
 *   2. a tight bloom — the ring's own light on the surface around it;
 *   3. a wide soft aura — the presence layer. Tier escalation lives here: common frames carry a
 *      modest bloom, rare/epic a strong dual bloom, gem/prestige a signature multi-color aura.
 * All static → zero animation cost; the only animated frame effect stays the prestige pulse.
 */
export const FRAME_STYLES: Record<string, FrameStyle> = {
  frame_none: {
    id: "frame_none",
    name: "No Frame",
    blurb: "Just your avatar. Clean and classic.",
  },
  bronze_ring: {
    id: "bronze_ring",
    name: "Bronze Ring",
    blurb: "A solid first ring for the field.",
    // Polished bronze: deep umber shadow → warm body → two creamy catchlights.
    ring: "conic-gradient(from 0deg, #6b3f18 0%, #b87b3e 8%, #ffe9c9 14%, #e8a96b 22%, #8a5426 38%, #5e3a18 50%, #9c6230 62%, #f7d9b0 70%, #b87b3e 78%, #6b3f18 100%)",
    glow: "inset 0 0 0 1px rgba(255,224,178,.35), 0 0 12px rgba(232,169,107,.45), 0 0 26px rgba(232,169,107,.2)",
  },
  violet_glow: {
    id: "violet_glow",
    name: "Violet Glow",
    blurb: "Wrapped in the royale aura.",
    // Charged amethyst: the ring is the coil, the double violet bloom is the point.
    ring: "conic-gradient(from 0deg, #4c1d95 0%, #8b5cf6 10%, #e9d5ff 16%, #a855f7 26%, #6d28d9 44%, #4c1d95 54%, #9d6bff 66%, #d8b4fe 74%, #7c3aed 84%, #4c1d95 100%)",
    glow: "inset 0 0 0 1px rgba(233,213,255,.4), 0 0 14px rgba(168,85,247,.65), 0 0 30px rgba(139,92,246,.35)",
  },
  gold_crown: {
    id: "gold_crown",
    name: "Gold Crown",
    blurb: "Gleaming gold, crowned on top.",
    // 24-karat: rich amber body with hot near-white catchlights and a double gold bloom.
    ring: "conic-gradient(from 0deg, #8a5a00 0%, #ffb300 10%, #fff6cf 16%, #ffd24a 26%, #b97700 42%, #8a5a00 52%, #ffcb2e 64%, #fff0b8 72%, #e09600 82%, #8a5a00 100%)",
    glow: "inset 0 0 0 1px rgba(255,240,184,.45), 0 0 14px rgba(255,201,30,.55), 0 0 30px rgba(255,179,0,.28)",
    ornament: "👑",
  },
  science_orbit: {
    id: "science_orbit",
    name: "Science Orbit",
    blurb: "For minds that orbit the big questions.",
    // Ionized glass: cold cyan metal with plasma-bright highlights.
    ring: "conic-gradient(from 0deg, #0b5e75 0%, #1ea8c9 10%, #d9f7ff 16%, #7fe3ff 26%, #14708c 44%, #0b5e75 54%, #3ec7ea 66%, #eafcff 74%, #1ea8c9 84%, #0b5e75 100%)",
    glow: "inset 0 0 0 1px rgba(217,247,255,.4), 0 0 13px rgba(62,199,234,.55), 0 0 28px rgba(31,168,201,.25)",
    ornament: "⚛️",
  },
  history_relic: {
    id: "history_relic",
    name: "History Relic",
    blurb: "An artifact from eras conquered.",
    // Burnished museum bronze: aged, warm, softly lit — a relic under glass.
    ring: "conic-gradient(from 0deg, #4f3a1d 0%, #8c6a3f 10%, #f2e2c4 16%, #d9b98a 26%, #6e522c 44%, #4f3a1d 54%, #a8834f 66%, #ead9b4 74%, #8c6a3f 84%, #4f3a1d 100%)",
    glow: "inset 0 0 0 1px rgba(242,226,196,.35), 0 0 12px rgba(217,185,138,.45), 0 0 24px rgba(198,166,120,.2)",
    ornament: "🏺",
  },
  geo_compass: {
    id: "geo_compass",
    name: "Compass Rose",
    blurb: "Points wherever the journey leads.",
    // Polished jade with bright meridian highlights.
    ring: "conic-gradient(from 0deg, #145c3a 0%, #2e9d6b 10%, #ddffe9 16%, #9be8c0 26%, #1d7a4e 44%, #145c3a 54%, #46c087 66%, #c8f7dd 74%, #2e9d6b 84%, #145c3a 100%)",
    glow: "inset 0 0 0 1px rgba(221,255,233,.35), 0 0 12px rgba(63,191,133,.5), 0 0 26px rgba(46,157,107,.22)",
    ornament: "🧭",
  },
  arts_brush: {
    id: "arts_brush",
    name: "Brushstroke",
    blurb: "A splash of color around every look.",
    // Iridescent enamel: a full-spectrum sweep with a lacquer-bright highlight.
    ring: "conic-gradient(from 0deg, #ff7ab8 0%, #ffd24a 16%, #fff3d0 22%, #6ee7a8 38%, #7ab8ff 56%, #b48bff 72%, #ffe1f0 80%, #ff7ab8 100%)",
    glow: "inset 0 0 0 1px rgba(255,255,255,.35), 0 0 13px rgba(255,122,184,.5), 0 0 28px rgba(122,184,255,.28)",
    ornament: "🎨",
  },
  sports_champion: {
    id: "sports_champion",
    name: "Champion Laurel",
    blurb: "Earned on the field, worn with pride.",
    // Laurel green over stadium-bright chrome highlights.
    ring: "conic-gradient(from 0deg, #3f6b14 0%, #7fb83a 10%, #eeffd0 16%, #d7f59b 26%, #558a1e 44%, #3f6b14 54%, #93cc4e 66%, #e4ffba 74%, #7fb83a 84%, #3f6b14 100%)",
    glow: "inset 0 0 0 1px rgba(238,255,208,.35), 0 0 12px rgba(127,184,58,.5), 0 0 26px rgba(158,212,94,.22)",
    ornament: "🏅",
  },
  pop_neon: {
    id: "pop_neon",
    name: "Neon Spotlight",
    blurb: "Glowing like a headline act.",
    // Marquee neon: hot magenta tube with an electric triple bloom — the loudest paid frame.
    ring: "conic-gradient(from 0deg, #8a2bbf 0%, #e86ad0 10%, #ffe3f8 16%, #ff8ae2 26%, #a63ad0 44%, #8a2bbf 54%, #f27ade 66%, #ffd7f4 74%, #e86ad0 84%, #8a2bbf 100%)",
    glow: "inset 0 0 0 1px rgba(255,227,248,.45), 0 0 16px rgba(232,106,208,.7), 0 0 34px rgba(255,138,226,.32)",
    ornament: "✨",
  },
  crowned_scholar: {
    id: "crowned_scholar",
    name: "Crowned Scholar",
    blurb: "Every world cleared. Every crown earned.",
    // The coronation piece: interleaved gold and amethyst metal with catchlights in BOTH families,
    // and a four-layer aura (rim, gold bloom, violet bloom, deep presence).
    ring: "conic-gradient(from 0deg, #ffd24a 0%, #fff6cf 6%, #ffb300 14%, #a855f7 28%, #e9d5ff 34%, #7c3aed 42%, #ffd24a 50%, #fff0b8 56%, #e09600 64%, #a855f7 78%, #d8b4fe 84%, #6d28d9 92%, #ffd24a 100%)",
    glow: "inset 0 0 0 1px rgba(255,246,207,.5), 0 0 16px rgba(255,201,30,.6), 0 0 30px rgba(168,85,247,.45), 0 0 48px rgba(124,58,237,.25)",
    ornament: "👑",
    prestige: true,
  },
  violet_duel_frame: {
    id: "violet_duel_frame",
    name: "Duelist's Edge",
    blurb: "Sharpened in the arena.",
    // Amethyst blade steel: hard bright edges, gem-tier double bloom.
    ring: "conic-gradient(from 0deg, #5a189a 0%, #9d4edd 10%, #f0e0ff 16%, #c77dff 26%, #7b2cbf 44%, #5a189a 54%, #b160f0 66%, #ead4ff 74%, #9d4edd 84%, #5a189a 100%)",
    glow: "inset 0 0 0 1px rgba(240,224,255,.45), 0 0 14px rgba(157,78,221,.6), 0 0 30px rgba(199,125,255,.3)",
    ornament: "⚔️",
  },
  crown_duel_frame: {
    id: "crown_duel_frame",
    name: "Crown Duelist",
    blurb: "Worn by the arena's best.",
    // Gold fused with amethyst — the arena's two royalties in one band, dual-color aura.
    ring: "conic-gradient(from 0deg, #ffe36a 0%, #fff6cf 8%, #ffb300 18%, #c77dff 36%, #9d4edd 48%, #5a189a 58%, #ffb300 72%, #ffe9a3 80%, #9d4edd 92%, #ffe36a 100%)",
    glow: "inset 0 0 0 1px rgba(255,246,207,.45), 0 0 15px rgba(255,201,30,.5), 0 0 30px rgba(157,78,221,.4)",
    ornament: "👑",
  },
  // --- Paired-set frames: the earned halves matching the prestige themes (apex / crown_arena).
  //     crowned_scholar (above) is the Champion set's frame. ---
  apex_frame: {
    id: "apex_frame",
    name: "Apex Crown",
    blurb: "Summit of the ladder. Top division.",
    // Diamond ice: near-white glacial highlights over deep sapphire metal.
    ring: "conic-gradient(from 0deg, #1b3a78 0%, #4c82e0 10%, #eaf6ff 16%, #cfe6ff 24%, #2d5cb0 42%, #1b3a78 52%, #6fa2ee 64%, #f4faff 72%, #4c82e0 82%, #1b3a78 100%)",
    glow: "inset 0 0 0 1px rgba(234,246,255,.5), 0 0 15px rgba(127,178,255,.6), 0 0 32px rgba(120,196,255,.3)",
    ornament: "💎",
  },
  crown_master_frame: {
    id: "crown_master_frame",
    name: "Arena Crown",
    blurb: "Ruler of the arena. Top duel tier.",
    // Molten ember: forge-hot orange metal with white-hot catchlights.
    ring: "conic-gradient(from 0deg, #7a2f0e 0%, #e0662a 10%, #ffe8d0 16%, #ffcf9b 26%, #a8451a 44%, #7a2f0e 54%, #f0803c 66%, #ffdec0 74%, #e0662a 84%, #7a2f0e 100%)",
    glow: "inset 0 0 0 1px rgba(255,232,208,.45), 0 0 15px rgba(255,138,54,.6), 0 0 32px rgba(224,102,42,.3)",
    ornament: "👑",
  },
  // --- Standalone earned frames (see backend cosmetics.py) ---
  cosmic_boss_frame: {
    id: "cosmic_boss_frame",
    name: "Cosmic Crown",
    blurb: "Cleared the Cosmic Labs boss.",
    // Nebula alloy: violet space-metal shot through with gold starlight.
    ring: "conic-gradient(from 0deg, #4c1d95 0%, #a855f7 12%, #f3e8ff 18%, #ffe36a 32%, #b97700 42%, #4c1d95 54%, #8b5cf6 66%, #ffd24a 76%, #fff0b8 82%, #7c3aed 92%, #4c1d95 100%)",
    glow: "inset 0 0 0 1px rgba(243,232,255,.4), 0 0 15px rgba(168,85,247,.6), 0 0 30px rgba(255,201,30,.3)",
    ornament: "🪐",
  },
  duelist_gold_frame: {
    id: "duelist_gold_frame",
    name: "Gold Duelist",
    blurb: "Reached the Gold duel tier.",
    // Tournament gold: brighter and hotter than the shop's gold — it was fought for.
    ring: "conic-gradient(from 0deg, #8a5a00 0%, #ffb300 10%, #fff3c4 16%, #ffe36a 26%, #b97700 44%, #8a5a00 54%, #ffcb2e 66%, #fff6cf 74%, #ffb300 84%, #8a5a00 100%)",
    glow: "inset 0 0 0 1px rgba(255,243,196,.4), 0 0 14px rgba(255,201,30,.55), 0 0 28px rgba(255,179,0,.25)",
    ornament: "⚔️",
  },
};

export interface BadgeStyle {
  id: string;
  /** Decorative glyph rendered on the badge disc and in tiny emoji rows. */
  emoji: string;
  /** Player-facing display name (copy-guarded). */
  name: string;
  /** Player-facing proof line (copy-guarded; goal-framed, no urgency). */
  blurb: string;
  /** Accent color from the world/brand palette — drives the badge disc + glow. */
  tint: string;
}

/**
 * The 10 auto-granted badges (ids locked; earned state is server-computed via GET /identity).
 * World medals carry their world's palette; the honors row (crown/perfect/podium/first) rides
 * the gold + violet brand family.
 */
export const BADGE_STYLES: Record<string, BadgeStyle> = {
  medal_science: {
    id: "medal_science",
    emoji: "⚗️",
    name: "Science Medal",
    blurb: "Every Science level, cleared.",
    tint: "#3ec7ea",
  },
  medal_history: {
    id: "medal_history",
    emoji: "🏺",
    name: "History Medal",
    blurb: "Every History level, cleared.",
    tint: "#d9b98a",
  },
  medal_geography: {
    id: "medal_geography",
    emoji: "🧭",
    name: "Geography Medal",
    blurb: "Every Geography level, cleared.",
    tint: "#3fbf85",
  },
  medal_arts: {
    id: "medal_arts",
    emoji: "🎨",
    name: "Arts Medal",
    blurb: "Every Arts level, cleared.",
    tint: "#ff7ab8",
  },
  medal_sports: {
    id: "medal_sports",
    emoji: "🏅",
    name: "Sports Medal",
    blurb: "Every Sports level, cleared.",
    tint: "#9ed45e",
  },
  medal_pop: {
    id: "medal_pop",
    emoji: "✨",
    name: "Pop Culture Medal",
    blurb: "Every Pop Culture level, cleared.",
    tint: "#e86ad0",
  },
  crown_all: {
    id: "crown_all",
    emoji: "👑",
    name: "Grand Crown",
    blurb: "All six worlds, fully cleared.",
    tint: "#ffd24a",
  },
  perfectionist: {
    id: "perfectionist",
    emoji: "💯",
    name: "Perfectionist",
    blurb: "One world, perfect on every level.",
    tint: "#a855f7",
  },
  podium_finisher: {
    id: "podium_finisher",
    emoji: "🏆",
    name: "Podium Finisher",
    blurb: "Stood on a ranked podium.",
    tint: "#ffb300",
  },
  first_crown: {
    id: "first_crown",
    emoji: "🥇",
    name: "First Crown",
    blurb: "Took first in a ranked contest.",
    tint: "#ffe36a",
  },
};

export interface TitleStyle {
  id: string;
  /** Player-facing display name (copy-guarded) — worn under the username. */
  name: string;
  /** Player-facing proof line (copy-guarded; goal-framed, no urgency). */
  blurb: string;
  /** CSS color OR gradient for the title text (gradients are background-clipped to the glyphs —
   * see titleFlairStyle). */
  flair: string;
}

/** The 6 earned titles (ids locked; one equippable at a time, null = no title). */
export const TITLE_STYLES: Record<string, TitleStyle> = {
  crown_chaser: {
    id: "crown_chaser",
    name: "Crown Chaser",
    blurb: "Stepped into the ranked field.",
    flair: "#ffb300",
  },
  world_traveler: {
    id: "world_traveler",
    name: "World Traveler",
    blurb: "Three worlds cleared and counting.",
    flair: "#6ee7a8",
  },
  perfect_clear: {
    id: "perfect_clear",
    name: "Perfect Clear",
    blurb: "Flawless through a whole world.",
    flair: "#a855f7",
  },
  podium_regular: {
    id: "podium_regular",
    name: "Podium Regular",
    blurb: "Three podium finishes banked.",
    flair: "#7ab8ff",
  },
  champion: {
    id: "champion",
    name: "Champion",
    blurb: "Took the crown against the field.",
    flair: "linear-gradient(90deg, #ffe36a, #ffb300)",
  },
  trivia_menace: {
    id: "trivia_menace",
    name: "Trivia Menace",
    blurb: "Every world cleared. The field knows.",
    flair: "linear-gradient(90deg, #ffd24a, #a855f7)",
  },
};

/** Campaign world key → the frame its completion unlocks (used by the world-complete
 * celebration; tested against the cross-side parity fixture). */
export const WORLD_FRAMES: Record<string, string> = {
  Science: "science_orbit",
  History: "history_relic",
  Geography: "geo_compass",
  Arts: "arts_brush",
  Sports: "sports_champion",
  "Pop Culture": "pop_neon",
};

/** Safe preset lookup: unknown/missing id → the knight default (server-validated ids only). */
export function getPreset(id?: string | null): AvatarPreset {
  return AVATAR_PRESETS.find((p) => p.id === id) ?? AVATAR_PRESETS[0];
}

/** Safe frame lookup: null/unknown → null (no frame). `frame_none` resolves to its (ringless)
 * entry so passing it to Avatar renders exactly like no frame. */
export function getFrame(id?: string | null): FrameStyle | null {
  if (!id) return null;
  return FRAME_STYLES[id] ?? null;
}

/** Safe badge lookup: unknown/missing id → null (render nothing — server ids are the truth). */
export function getBadge(id?: string | null): BadgeStyle | null {
  if (!id) return null;
  return BADGE_STYLES[id] ?? null;
}

/** Safe title lookup: unknown/missing id → null (no title line). */
export function getTitle(id?: string | null): TitleStyle | null {
  if (!id) return null;
  return TITLE_STYLES[id] ?? null;
}

/** Text style for a title's flair: solid colors color the text, gradients are clipped to the
 * glyphs (background-clip: text) so gradient titles shimmer without extra elements. */
export function titleFlairStyle(flair: string): CSSProperties {
  if (flair.includes("gradient")) {
    return {
      backgroundImage: flair,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    };
  }
  return { color: flair };
}
