/**
 * Theme schema (DESIGN.md §2, §6). One object per theme: { id, name, cost, style, blurb, vars }.
 * `style` swaps fonts/shape/texture via a root class `rr-root s-<style>`.
 *
 * ART MODEL: "Starter" is THE default and the app's main visual identity — a premium ivory world
 * with royal-purple + gold accents, a Playfair display face, and the Starter art set (the gold
 * crown, the soft brain, the star shield — repo assets under /assets/themes/starter/). Every
 * catalog theme EXCEPT the Blank pair and Rot Champion is a SKIN of the Starter system: same
 * surface language (STARTER_SHAPE), same art, different palette. The Blank pair keeps its own
 * stripped ink-on-paper minimalism (no art), and `royale` ("Rot Champion", style "arcade") stays
 * the one full-artwork cosmic skin. The "soft"/"pixel" styles are retired (no theme uses them)
 * but stay in the union for back-compat. Every theme carries the full var contract
 * (tokens.test.ts). Ownership/equip live in the DB.
 */

export type ArtStyle = "arcade" | "soft" | "pixel" | "mono";

/** The Starter art set — repo-local bitmap assets shared by the Starter theme and its skins.
 * Paths are served from frontend/public (same pattern as the /avatars presets). */
export interface ThemeArt {
  /** The Daily Royale hero showcase — the crown under a glass display dome on its podium.
   *  **Currently unread.** The home hero card used to render this; it now composes `podium` +
   *  `crownBare` instead, which drops the glass case and fits a much larger crown in the same space
   *  (see `hero/MonoDailyCard.tsx`). Kept as an art-set slot — delete it and
   *  `daily-royale-crown-showcase.png` together if the dome is never coming back. */
  crown: string;
  /** The bare marble-and-gold display podium (transparent) — both the front-door hero and the home
   *  Daily Royale card stand the plain `crownBare` crown on top of it. */
  podium: string;
  /** The plain gold "?" crown with no dome or podium — pairs with `podium`. */
  crownBare: string;
  /** The ENTIRE face of the home Daily Royale card, as one painted plate: crown, podium, halo,
   *  sparkles and the lavender sweep, with a deliberately empty left side for the copy and CTA to
   *  sit on. The painted composition is ~1.387:1; the plate is then extended downward with its own
   *  bottom gradient to ~1.121:1 so the CTA has empty plate to sit on rather than a colour band
   *  butting against the art. The card renders it `cover` + `right center`, so the crown is never
   *  distorted and any trimming comes off the empty left. */
  dailyCard: string;
  /** Which ink the card's copy must use ON `dailyCard`. The plate is a painted image, so text over
   *  it has to be coloured for the PLATE, not for the theme — a dark skin's near-white `--text` is
   *  invisible on a light plate, and the light plates' near-black ink is invisible on a dark one.
   *  Omitted = "dark" (dark ink, the light plates). Set "light" alongside a dark plate. */
  dailyCardInk?: "dark" | "light";
  /** Front-door backdrop art: the gold halo ring, sparkles and lavender cloud bank the crown-on-
   *  podium hero stands inside. Anchored to the page top and sized to cover the viewport. */
  background: string;
  /** Brain Boost — the soft 3D purple brain.
   *  Comes in two cuts, because one cannot serve both polarities: the default is drawn for an IVORY
   *  page and has real alpha gaps in its wispy upper edge that expect the page to show through, so
   *  on a dark card those gaps read as bites out of it. The dark skins override this with
   *  `brain-dark.png`, a brain authored on black (scripts/prep_brain_dark.py). Both are framed to
   *  the same body-to-canvas fraction, so the brain does not change size when you switch themes. */
  brain: string;
  /** Growth / rank — the purple-and-gold star shield. */
  shield: string;
  /** The Rot Royale brand mark — the gold crown-shield crest with the purple "R" (header lockup). */
  logo: string;
  /** Home feature-row LEFT glyphs (3D purple icons that sit inside the soft circular holder). */
  iconBattle: string;
  iconBrain: string;
  iconFriends: string;
  iconGrowth: string;
  /** Daily Royale crown medallion — same cream-disc icon family as the hub medallions. */
  iconRoyale: string;
  /** Battle Mode scene backdrop — soft gold crossed-swords + crown glow art (transparent). */
  battleScene: string;
  /** Circular cream/gold portrait frame for the Battle Mode player medallions (transparent). */
  avatarFrame: string;
  /** The diamond VS badge between the two Battle Mode players (transparent). */
  vsBadge: string;
}

/** The art overrides every DARK skin of the Starter system shares. Spelled out per theme below
 *  rather than derived, because "is this theme dark?" is not something the token set records — and
 *  an explicit list is what makes it obvious, when a new theme is added, that its polarity is a
 *  decision someone has to make. */
const DARK_SKIN_ART = {
  brain: "/assets/themes/starter/brain-dark.webp?v=2",
} as const;

export const STARTER_ART: ThemeArt = {
  crown: "/assets/themes/starter/daily-royale-crown-showcase.webp?v=3",
  podium: "/assets/themes/starter/starter-podium.webp",
  crownBare: "/assets/themes/starter/crown.webp?v=3",
  dailyCard: "/assets/themes/starter/starter-daily-card.jpg?v=5",
  // ?v= is a cache-buster, and it is load-bearing: this file lives in public/, which Vite copies
  // verbatim WITHOUT content-hashing, so re-exporting the art under the same URL leaves every
  // browser that already fetched it serving the old bytes forever. Bump the number on any re-export.
  background: "/assets/themes/starter/background_art_starter.webp?v=6",
  brain: "/assets/themes/starter/brain.webp?v=2",
  shield: "/assets/themes/starter/shield.webp?v=3",
  // ?v=2 — the counter of the R shipped with the editor's transparency checkerboard flattened into
  // real pixels (an opaque white/grey grid). Re-exported transparent; the bump is what makes anyone
  // who already cached the white-holed version actually see it (same public/ no-hashing trap as
  // `background` above).
  logo: "/assets/themes/starter/starter-logo-r-mark.webp?v=3",
  iconBattle: "/assets/themes/starter/starter-icon-battle.webp?v=2",
  iconBrain: "/assets/themes/starter/starter-icon-brain.webp?v=2",
  iconFriends: "/assets/themes/starter/starter-icon-friends.webp?v=2",
  iconGrowth: "/assets/themes/starter/starter-icon-growth.webp?v=2",
  iconRoyale: "/assets/themes/starter/starter-icon-royale.webp?v=2",
  battleScene: "/assets/themes/starter/starter-battle-scene.webp?v=3",
  avatarFrame: "/assets/themes/starter/starter-avatar-frame.webp?v=2",
  vsBadge: "/assets/themes/starter/starter-vs-badge.webp?v=2",
};

/**
 * SHAPE / SPACING / TYPE contract — every theme carries these six alongside the color vars, so a
 * theme can reskin the app's physical language (density, corner radii, display face), not just its
 * palette. Shared primitives consume them (`.rr-glass`, `.display`, GoldButton, AnswerPill, the
 * Home shell): arcade keeps today's values; Starter and its skins speak the luxury language below;
 * the Blank pair keeps the mono ink-on-paper values inline.
 *   --font-display  display-heading font stack (.display)
 *   --radius-card   card corner radius (.rr-glass)
 *   --pad-card      card padding (.rr-glass)
 *   --gap-shell     the main screen stack gap (Home shell)
 *   --radius-ctl    primary control radius (GoldButton)
 *   --radius-pill   answer-pill radius (AnswerPill)
 */
const ARCADE_SHAPE = {
  "--font-display": '"Luckiest Guy", "Sora", cursive',
  "--radius-card": "22px",
  "--pad-card": "20px",
  "--gap-shell": "clamp(10px, 3vw, 13px)",
  "--radius-ctl": "16px",
  "--radius-pill": "18px",
  // Text color on --brand surfaces (Equip CTAs, answer letter badges). Every classic theme uses
  // white; the dark Blank flips it to ink because its brand surface IS white.
  "--brandText": "#FFFFFF",
  // The glass top-edge light-catch (specular inset highlight on cards). Classic themes keep it
  // subtle; the mono skins tune it per polarity (bright liquid-glass gloss on light, a whisper
  // rim on OLED dark).
  "--sheen": "rgba(255,255,255,.10)",
  // Primary CTA surface + its text. Classic themes alias their gold (values may be var() refs —
  // they resolve at use). Starter and its skins repaint the CTA as a rich brand-gradient pill;
  // the Blank pair keeps its polarity ink pills.
  "--cta": "var(--amber)",
  "--ctaText": "var(--btnText)",
} as const;

// The Starter shape/type contract — shared by the Starter theme and EVERY skin of it (all themes
// except Rot Champion and the Blank pair). Modern luxury: an elegant Playfair display face over
// the Manrope body, generously rounded cards, polished spacing. Rides the `s-mono` root class
// (the calm liquid-glass surface language), so no component branching changes.
const STARTER_SHAPE = {
  "--font-display": '"Playfair Display", "Manrope", "Sora", serif',
  "--radius-card": "26px",
  "--pad-card": "26px",
  "--gap-shell": "clamp(18px, 5vw, 22px)",
  "--radius-ctl": "18px",
  "--radius-pill": "16px",
  // Text on --brand surfaces (equip CTAs, answer letter badges): white reads on every saturated
  // accent this catalog uses.
  "--brandText": "#FFFFFF",
} as const;

export interface Theme {
  id: string;
  name: string;
  // kept in sync with the server catalog (app/core/cosmetics.py) but NEVER used for purchases — the server price is the source of truth.
  cost: number;
  style: ArtStyle;
  blurb: string;
  vars: Record<string, string>;
  /** Bitmap art set (Starter + its skins). Absent → the theme renders pure-CSS (the Blank pair);
   * the arcade skin carries its own staged art and never reads this. */
  art?: ThemeArt;
}

// "Starter" is THE default — the app's main visual identity. The Blank pair stays as the free
// minimalist alternative; the original arcade skin lives on as "Rot Champion" (id `royale`, kept
// for stored equips) — a first-200-accounts founder exclusive, never buyable.
export const DEFAULT_THEME_ID = "starter";

/**
 * THE UNIQUE THEMES — their look is FROZEN. Do not restyle them.
 *
 * These three are not skins of anything: they carry no `art` set and their own surface language, so
 * they render through different branches entirely (`useThemeArt()` returns null for them, which is
 * what makes `MonoDailyCard` fall to its plain typography card and keeps the arcade skin on its own
 * hero). That is deliberate — each is a distinct identity somebody chose ON PURPOSE:
 *
 *   blank_light  "Minimal Light"  — art-less ink-on-paper
 *   blank        "Minimal Dark"   — art-less ink-on-paper, inverted
 *   royale       "Rot Champion"   — the original dark-violet arcade skin, founder exclusive
 *
 * A redesign of the Starter system must NOT reach them. When a change is described as "the app" or
 * "the card", it means the Starter system and its skins; these three change only when they are named
 * explicitly. If a change here looks unavoidable, ask first — do not infer permission from a broad
 * instruction.
 *
 * Also the reason a preview of one of these can never be produced by re-painting Starter's CSS
 * variables: the difference is structural, not palette-deep.
 */
export const UNIQUE_THEME_IDS: readonly string[] = ["blank_light", "blank", "royale"];

/** True for a frozen, one-off identity (see UNIQUE_THEME_IDS) rather than a Starter skin. */
export function isUniqueTheme(id: string): boolean {
  return UNIQUE_THEME_IDS.includes(id);
}

export const THEMES: Theme[] = [
  {
    // THE default — the Rot Royale identity: a premium ivory room, royal purple and refined gold,
    // elegant serif display type, and the Starter art set (crown / brain / shield). Luxury but
    // still fun — not dark arcade, not casino, not flat.
    id: "starter",
    name: "Starter",
    cost: 0,
    style: "mono",
    blurb: "The Rot Royale look: ivory, royal purple & gold.",
    vars: {
      // A soft warm-ivory field lit from the top (the "gallery wall" read), with a faint royal-
      // purple pool low-right and a whisper of gold low-left — the two accent energies living in
      // the room without tinting the cards.
      "--bg":
        "radial-gradient(820px 480px at 50% -12%, rgba(255,255,255,.65), transparent 62%), radial-gradient(720px 540px at 88% 110%, rgba(108,63,197,.06), transparent 60%), radial-gradient(560px 420px at 6% 102%, rgba(193,146,42,.05), transparent 55%), linear-gradient(180deg, #FAF7F1 0%, #F3EDE2 100%)",
      "--panel": "#FFFFFF",
      "--panel2": "#F6F1FB",
      "--line": "rgba(84,64,120,.13)",
      "--brand": "#6C3FC5",
      "--brand-2": "#8B5CF6",
      "--cyan": "#9C8FB8",
      "--lime": "#2E9E56",
      "--amber": "#C9932B",
      "--pink": "#C13540",
      "--text": "#241A3E",
      "--muted": "#6F678A",
      "--faint": "#A69EBD",
      "--btnText": "#FFFFFF",
      // Soft royal-purple ambience — presence, not neon.
      "--glow": "rgba(108,63,197,.07)",
      ...STARTER_SHAPE,
      // Bright specular gloss along the card top edge — polished ivory glass.
      "--sheen": "rgba(255,255,255,.75)",
      // The signature CTA: a rich royal-purple pill (the mockup's ENTER DAILY ROYALE button).
      "--cta": "linear-gradient(180deg, #7A4FD0 0%, #5C36AC 100%)",
      "--ctaText": "#FFFFFF",
    },
    art: STARTER_ART,
  },
  {
    // "Rot Champion" — the original arcade skin, now the first-200 founder exclusive (server
    // requirement founder:200). The id stays `royale` because equips/ownership rows store it.
    id: "royale",
    name: "Rot Champion",
    cost: 0,
    style: "arcade",
    blurb: "The original arcade, worn by the first 200.",
    vars: {
      // Four light layers over the base: the big violet keylight, the cool counter-glow, a faint
      // top-centre white sheen (the "lit room" read), and the gold treasure warmth at the floor.
      "--bg":
        "radial-gradient(1100px 620px at 78% -12%, rgba(140,76,255,.48), transparent 60%), radial-gradient(960px 720px at -12% 112%, rgba(120,40,210,.38), transparent 58%), radial-gradient(520px 380px at 50% -8%, rgba(255,255,255,.05), transparent 60%), radial-gradient(700px 500px at 50% 120%, rgba(255,201,30,.09), transparent 60%), linear-gradient(180deg, #170D30 0%, #0C061E 100%)",
      "--panel": "#1D1239",
      "--panel2": "#2A1B50",
      "--line": "#3E2C69",
      "--brand": "#7C3AED",
      "--brand-2": "#A855F7",
      "--cyan": "#A855F7",
      "--lime": "#2FD45E",
      "--amber": "#FFC91E",
      "--pink": "#FF2E4D",
      "--text": "#FFFFFF",
      "--muted": "#B3A4D6",
      "--faint": "#7E6FA6",
      "--btnText": "#1B1136",
      // Per-theme ambient glow tone (used by GlassCard + the root aura). Royale = a cosmic violet
      // neon bloom so cards read as lit glass in a dark arcade.
      "--glow": "rgba(124,58,237,.38)",
      ...ARCADE_SHAPE,
    },
  },
  {
    // Starter skin, daylight palette: the ivory system warmed toward meadow green.
    id: "daylight",
    name: "Daylight",
    cost: 0,
    style: "mono",
    blurb: "Calm daylight green & gold (light mode)",
    vars: {
      "--bg":
        "radial-gradient(820px 460px at 50% -10%, rgba(255,255,255,.5), transparent 62%), radial-gradient(680px 520px at 86% 108%, rgba(21,168,95,.06), transparent 60%), linear-gradient(180deg, #F6F7F0 0%, #EDF1E6 100%)",
      "--panel": "#ffffff",
      "--panel2": "#eef4ea",
      "--line": "rgba(40,60,44,.12)",
      "--brand": "#15a85f",
      "--brand-2": "#37b87c",
      "--cyan": "#8a8b7f",
      "--lime": "#15a85f",
      "--amber": "#f5a524",
      "--pink": "#e0574d",
      "--text": "#1c2a20",
      "--muted": "#7a857a",
      "--faint": "#a9b3a6",
      "--btnText": "#ffffff",
      "--glow": "rgba(21,168,95,.06)",
      ...STARTER_SHAPE,
      "--sheen": "rgba(255,255,255,.7)",
      "--cta": "linear-gradient(180deg, #1FB56B 0%, #12854B 100%)",
      "--ctaText": "#FFFFFF",
    },
    // Daylight shares the whole Starter art set EXCEPT its hero plate: the crown/podium card is
    // repainted in this theme's green-and-gold colourway (same artwork, same composition, same
    // 900x803 processing) so the hero belongs to the palette instead of importing Starter's violet.
    art: {
      ...STARTER_ART,
      dailyCard: "/assets/themes/starter/background-hero-card-daylight.jpg?v=3",
    },
  },
  {
    // Starter skin, candy palette: the ivory system tinted candy pink.
    id: "bubblegum",
    name: "Bubblegum",
    cost: 400,
    style: "mono",
    blurb: "Candy pink & violet, extra bouncy",
    vars: {
      "--bg":
        "radial-gradient(820px 460px at 50% -10%, rgba(255,255,255,.55), transparent 62%), radial-gradient(680px 520px at 86% 108%, rgba(255,96,184,.07), transparent 60%), linear-gradient(180deg, #FDF3FA 0%, #F8E6F2 100%)",
      "--panel": "#ffffff",
      "--panel2": "#ffe7f4",
      "--line": "rgba(120,40,90,.12)",
      "--brand": "#c65cff",
      "--brand-2": "#d98bff",
      "--cyan": "#b884ab",
      "--lime": "#2e9e56",
      "--pink": "#e94f97",
      "--amber": "#ffc23d",
      "--text": "#46243f",
      "--muted": "#a0728f",
      "--faint": "#d0a9c4",
      "--btnText": "#ffffff",
      "--glow": "rgba(198,92,255,.07)",
      ...STARTER_SHAPE,
      "--sheen": "rgba(255,255,255,.7)",
      "--cta": "linear-gradient(180deg, #C65CFF 0%, #9C3FD1 100%)",
      "--ctaText": "#FFFFFF",
    },
    // Same one-token override as Daylight: Bubblegum keeps the whole Starter art set except its
    // hero plate, which is repainted in this theme's pink-lavender colourway (same artwork, same
    // composition, same 900x803 pipeline).
    art: {
      ...STARTER_ART,
      dailyCard: "/assets/themes/starter/background-hero-card-bubblegum.webp?v=3",
    },
  },
  {
    // Starter skin, evergreen palette: the ivory system over mossy green.
    id: "forest",
    name: "Evergreen",
    cost: 600,
    style: "mono",
    blurb: "Mossy greens & amber, easy on the eyes",
    vars: {
      "--bg":
        "radial-gradient(820px 460px at 50% -10%, rgba(255,255,255,.5), transparent 62%), radial-gradient(680px 520px at 86% 108%, rgba(31,179,126,.06), transparent 60%), linear-gradient(180deg, #F2F8EE 0%, #E4EFE4 100%)",
      "--panel": "#ffffff",
      "--panel2": "#e7f3ea",
      "--line": "rgba(30,70,52,.12)",
      "--brand": "#1fb37e",
      "--brand-2": "#42d29c",
      "--cyan": "#9a7b4f",
      "--lime": "#1fb37e",
      "--pink": "#e0674a",
      "--amber": "#f0ad33",
      "--text": "#1b3527",
      "--muted": "#73907f",
      "--faint": "#a2bcaa",
      "--btnText": "#ffffff",
      "--glow": "rgba(31,179,126,.06)",
      ...STARTER_SHAPE,
      "--sheen": "rgba(255,255,255,.7)",
      "--cta": "linear-gradient(180deg, #23BC85 0%, #158257 100%)",
      "--ctaText": "#FFFFFF",
    },
    art: STARTER_ART,
  },
  {
    // Starter skin, midnight palette: the Starter system flipped to a deep violet night.
    id: "midnight",
    name: "Midnight Arcade",
    cost: 900,
    style: "mono",
    blurb: "Neon glow on black (the old look)",
    vars: {
      "--bg":
        "radial-gradient(900px 520px at 50% -8%, rgba(168,107,255,.08), transparent 60%), linear-gradient(180deg, #0D0B14 0%, #08070E 100%)",
      "--panel": "#16131f",
      "--panel2": "#1d1a2c",
      "--line": "rgba(255,255,255,.10)",
      "--brand": "#a86bff",
      "--brand-2": "#c89bff",
      "--cyan": "#8d88a8",
      "--lime": "#34c759",
      "--pink": "#ff2e88",
      "--amber": "#ffb02e",
      "--text": "#f6f3ff",
      "--muted": "#928db4",
      "--faint": "#716c92",
      "--btnText": "#08070f",
      "--glow": "rgba(168,107,255,.06)",
      ...STARTER_SHAPE,
      "--sheen": "rgba(255,255,255,.07)",
      "--cta": "linear-gradient(180deg, #A86BFF 0%, #7A3BE0 100%)",
      "--ctaText": "#FFFFFF",
    },
    // Midnight is the first DARK plate: same artwork and pipeline as the light ones, repainted
    // for this skin. `dailyCardInk: "light"` flips the card's copy to light ink, because that
    // ink is chosen for the plate rather than the theme.
    art: {
      ...STARTER_ART,
      ...DARK_SKIN_ART,
      dailyCard: "/assets/themes/starter/background-hero-card-midnight.jpg?v=3",
      dailyCardInk: "light",
    },
  },
  {
    // EARNED-ONLY (not purchasable) — the Apex set, unlocked by reaching the top Royale division.
    // Starter skin, glacial palette: icy platinum / diamond-blue prestige over deep space.
    id: "apex",
    name: "Apex",
    cost: 0,
    style: "mono",
    blurb: "Diamond ice at the summit of the ladder",
    vars: {
      "--bg":
        "radial-gradient(900px 520px at 50% -8%, rgba(120,180,255,.09), transparent 60%), linear-gradient(180deg, #0C1830 0%, #060B18 100%)",
      "--panel": "#152238",
      "--panel2": "#1E3050",
      "--line": "rgba(210,230,255,.12)",
      "--brand": "#5B93F0",
      "--brand-2": "#7FB2FF",
      "--cyan": "#8AA0C0",
      "--lime": "#2FD45E",
      "--amber": "#FFC91E",
      "--pink": "#FF2E4D",
      "--text": "#EAF2FF",
      "--muted": "#9FB4D6",
      "--faint": "#6E82A6",
      "--btnText": "#081120",
      "--glow": "rgba(120,180,255,.06)",
      ...STARTER_SHAPE,
      "--sheen": "rgba(255,255,255,.07)",
      "--cta": "linear-gradient(180deg, #5B93F0 0%, #3A66BE 100%)",
      "--ctaText": "#FFFFFF",
    },
    // Apex keeps the whole Starter art set except its hero plate, repainted in this skin's deep
    // navy and diamond-blue (same artwork, same composition, same 900x803 pipeline —
    // scripts/prep_hero_plate.py). The second DARK plate, so like Midnight it flips the card's copy
    // to light ink: that ink is chosen for the PLATE, not for the theme.
    art: {
      ...STARTER_ART,
      ...DARK_SKIN_ART,
      dailyCard: "/assets/themes/starter/background-hero-card-apex.webp?v=5",
      dailyCardInk: "light",
    },
  },
  {
    // EARNED-ONLY (not purchasable) — the Crown Arena set, unlocked at the top DUEL tier.
    // Starter skin, ember palette: hot arena orange over black.
    id: "crown_arena",
    name: "Crown Arena",
    cost: 0,
    style: "mono",
    blurb: "Ember and gold of the champion's arena",
    vars: {
      "--bg":
        "radial-gradient(900px 520px at 50% -8%, rgba(255,138,54,.08), transparent 60%), linear-gradient(180deg, #1B0E07 0%, #100704 100%)",
      "--panel": "#2A1810",
      "--panel2": "#3A2214",
      "--line": "rgba(255,220,190,.12)",
      "--brand": "#E0662A",
      "--brand-2": "#FF9A4F",
      "--cyan": "#C0917A",
      "--lime": "#2FD45E",
      "--amber": "#FFC91E",
      "--pink": "#FF2E4D",
      "--text": "#FFF1E6",
      "--muted": "#D6B29A",
      "--faint": "#96745E",
      "--btnText": "#1E0F06",
      "--glow": "rgba(255,138,54,.06)",
      ...STARTER_SHAPE,
      "--sheen": "rgba(255,255,255,.07)",
      "--cta": "linear-gradient(180deg, #F08A3C 0%, #C05A1C 100%)",
      "--ctaText": "#FFFFFF",
    },
    // Crown Arena keeps the whole Starter art set except its hero plate, repainted in this skin's
    // ember-and-gold-over-black (same artwork, same composition, same 900x803 pipeline —
    // scripts/prep_hero_plate.py). A DARK plate, so like Midnight/Apex it flips the card's copy to
    // light ink: that ink is chosen for the PLATE, not for the theme.
    art: {
      ...STARTER_ART,
      ...DARK_SKIN_ART,
      dailyCard: "/assets/themes/starter/background-hero-card-crown_arena.webp?v=4",
      dailyCardInk: "light",
    },
  },
  {
    // EARNED-ONLY (not purchasable) — the Champion set, unlocked by clearing the ENTIRE campaign
    // (all worlds). Starter skin, garnet palette: a regal throne-room red with gold.
    id: "champion",
    name: "Champion",
    cost: 0,
    style: "mono",
    blurb: "Garnet throne room, crowned in gold",
    vars: {
      "--bg":
        "radial-gradient(900px 520px at 50% -8%, rgba(176,50,95,.09), transparent 60%), linear-gradient(180deg, #1B0C13 0%, #110609 100%)",
      "--panel": "#2A1420",
      "--panel2": "#3A1B2C",
      "--line": "rgba(255,215,230,.12)",
      "--brand": "#C23A6A",
      "--brand-2": "#E0578A",
      "--cyan": "#C08DA0",
      "--lime": "#2FD45E",
      "--amber": "#FFC91E",
      "--pink": "#FF2E4D",
      "--text": "#FDEEF3",
      "--muted": "#CFA6B6",
      "--faint": "#96697C",
      "--btnText": "#1E0A12",
      "--glow": "rgba(176,50,95,.06)",
      ...STARTER_SHAPE,
      "--sheen": "rgba(255,255,255,.07)",
      "--cta": "linear-gradient(180deg, #D14A7C 0%, #A02D57 100%)",
      "--ctaText": "#FFFFFF",
    },
    // Champion keeps the whole Starter art set except its hero plate, repainted in this skin's
    // garnet-and-gold-over-black (same artwork, same composition, same 900x803 pipeline —
    // scripts/prep_hero_plate.py). A DARK plate, so like Crown Arena/Apex/Midnight it flips the
    // card's copy to light ink: that ink is chosen for the PLATE, not for the theme.
    art: {
      ...STARTER_ART,
      ...DARK_SKIN_ART,
      dailyCard: "/assets/themes/starter/background-hero-card-champion.webp?v=5",
      dailyCardInk: "light",
    },
  },
  {
    // Minimal Dark (id stays `blank` for stored equips) — deep neutral minimalism, deliberately
    // OUTSIDE the Starter system (no art, its own ink-on-paper shape values). More than a palette:
    // style "mono" swaps the app's whole surface language (flat hairline cards on charcoal, a slim
    // display face, no glow/starfield/shine, airier spacing via the shape vars).
    id: "blank",
    name: "Minimal Dark",
    cost: 0,
    style: "mono",
    blurb: "Lights out. Nothing but the game.",
    // Premium-iOS dark: a solid NEUTRAL dark-grey world (not black, not warm/brown), near-white
    // type, and purple as a restrained accent (--brand: progress fill, live dots, small accents)
    // with a dark-purple-glass CTA pill (--cta). Calm, native, no neon.
    vars: {
      "--bg": "#1A1A1C",
      "--panel": "#232326",
      "--panel2": "#292A2D",
      "--line": "rgba(255,255,255,.11)",
      "--brand": "#A970FF",
      "--brand-2": "#8B5CF6",
      "--cyan": "#9A9188",
      "--lime": "#34C759",
      "--amber": "#F7EFE2",
      "--pink": "#E5484D",
      "--text": "#F1F1F3",
      "--muted": "#9A9AA0",
      "--faint": "#6C6C72",
      "--btnText": "#1A1A1C",
      // Blank = no bloom: the faintest purple breath (the accent's presence, not neon).
      "--glow": "rgba(169,112,255,.05)",
      "--font-display": '"Manrope", "Sora", system-ui, sans-serif',
      "--radius-card": "18px",
      "--pad-card": "26px",
      "--gap-shell": "clamp(16px, 4.5vw, 22px)",
      "--radius-ctl": "12px",
      "--radius-pill": "14px",
      "--brandText": "#FFFFFF",
      // Dark liquid glass catches only a whisper of neutral rim light.
      "--sheen": "rgba(255,255,255,.07)",
      "--cta": "#2B2140",
      "--ctaText": "#F1F1F3",
    },
  },
  {
    // Minimal Light (id stays `blank_light` for stored equips) — the Starter default's minimalist
    // sibling, also OUTSIDE the Starter system (no art, its own ink-on-paper shape values). A WARM
    // cream world (never stark white) with slightly-lighter cream glass cards floating on it —
    // closer to a native finance/control-center dashboard than a game. Near-black warm ink type,
    // purple as a restrained accent, a near-black CTA pill.
    id: "blank_light",
    name: "Minimal Light",
    cost: 0,
    style: "mono",
    blurb: "Warm cream, frosted glass, calm.",
    vars: {
      // Warm cream field with a soft light pool at the top — the room the glass floats in. The
      // premium read comes from panel-vs-background CONTRAST, not brightness.
      "--bg":
        "radial-gradient(820px 460px at 50% -10%, rgba(255,255,255,.55), transparent 62%), radial-gradient(700px 520px at 88% 108%, rgba(80,65,45,.05), transparent 60%), linear-gradient(180deg, #F8F3EA 0%, #F1EADC 100%)",
      "--panel": "#FFFBF3",
      "--panel2": "#F7F0E2",
      "--line": "rgba(80,65,45,.12)",
      "--brand": "#7C3AED",
      "--brand-2": "#8B5CF6",
      "--cyan": "#8A8177",
      "--lime": "#2E9E56",
      "--amber": "#171310",
      "--pink": "#C13540",
      "--text": "#161311",
      "--muted": "#706A63",
      "--faint": "#A79F93",
      "--btnText": "#FFFBF3",
      // The light Blank's "glow" is a barely-there warm shadow (soft daylight, not neon).
      "--glow": "rgba(80,65,45,.06)",
      "--font-display": '"Manrope", "Sora", system-ui, sans-serif',
      "--radius-card": "18px",
      "--pad-card": "26px",
      "--gap-shell": "clamp(16px, 4.5vw, 22px)",
      "--radius-ctl": "12px",
      "--radius-pill": "14px",
      "--brandText": "#FFFFFF",
      // Light liquid glass: a bright specular gloss along the top edge.
      "--sheen": "rgba(255,255,255,.7)",
      "--cta": "#171310",
      "--ctaText": "#F8F3EA",
    },
  },
];

export function getTheme(id: string | null | undefined): Theme {
  return (
    THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID) ?? THEMES[0]
  );
}
