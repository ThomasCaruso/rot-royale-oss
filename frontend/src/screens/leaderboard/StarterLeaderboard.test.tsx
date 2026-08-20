import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StarterLeaderboard } from "./StarterLeaderboard";
import type { Me } from "@/store/session";
import type { LeaderboardRowData } from "./LeaderboardRow";

// Isolate the redesign's own logic (filter + context + podium + Your Rank) from the shared chrome.
vi.mock("@/screens/home/HomeHeader", () => ({ HomeHeader: () => null }));
vi.mock("@/screens/home/ProfileMenu", () => ({ ProfileMenu: () => null }));
// Avatar is stubbed to a marker that ECHOES the identity props it was handed, so the podium's
// wiring (which preset / which equipped frame reached which seat) is assertable without pulling in
// portrait bitmaps or the frame gradients.
vi.mock("@/screens/home/Avatar", () => ({
  Avatar: ({ preset, frame, size }: { preset?: string; frame?: string | null; size?: number }) => (
    <i data-avatar={size} data-preset={preset ?? ""} data-frame={frame ?? ""} />
  ),
}));
// Keep the REAL title lookup + flair styling (that is what is under test here); only the portrait
// helpers are stubbed.
vi.mock("@/theme/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/theme/identity")>()),
  getPreset: () => null,
  presetProfileImage: () => undefined,
}));
// Crowns are counted by size, so the seat ornament can be told apart from the score glyphs.
vi.mock("@/ui/CrownIcon", () => ({ CrownIcon: ({ size }: { size?: number }) => <i data-crown={size} /> }));
vi.mock("@/api/client", () => ({ api: { friendsBoard: () => Promise.resolve({ my_rank: null, friend_field_size: 0, played: [], yet_to_play: [] }) } }));

const me = {
  username: "T_Sniffs",
  rank: 42,
  total_players: 1204,
  division: "Bronze",
  coins_balance: 0,
  avatar_preset: "knight",
  equipped_frame: null,
  equipped_badges: [],
  equipped_title: null,
} as unknown as Me;

const field: LeaderboardRowData[] = [
  { rank: 1, username: "Alpha", score: 1000 },
  { rank: 2, username: "Beta", score: 820 },
  { rank: 3, username: "Gamma", score: 640 },
  { rank: 4, username: "Delta", score: 510 },
  { rank: 5, username: "Echo", score: 470 },
];

function render(rows: LeaderboardRowData[], windowState: string | null = "OPEN") {
  return renderToStaticMarkup(
    <StarterLeaderboard
      me={me}
      rows={rows}
      windowState={windowState}
      settleAt={null}
      openWindowId="w1"
      loading={false}
    />,
  );
}

describe("StarterLeaderboard — audience filter", () => {
  it("shows exactly the two audience segments and NO 'This Week' timeframe tab", () => {
    const html = render(field);
    expect(html).toContain("Global");
    expect(html).toContain("Friends");
    expect(html).not.toContain("This Week");
  });

  it("states one clear timeframe context (Today's Royale)", () => {
    const html = render(field);
    // react-dom/server escapes the apostrophe (') → &#x27;
    expect(html).toContain("Today&#x27;s Royale");
  });
});

describe("StarterLeaderboard — Your Rank credibility (today's field only)", () => {
  it("when the player has NOT entered today, it shows an honest 'play to rank' state — never a fake global rank", () => {
    const html = render(field); // no isMe row in the field
    expect(html).toContain("Play today&#x27;s Royale to rank");
    // The global rank (42) must NOT be presented as today's standing.
    expect(html).not.toContain(">42<");
  });

  it("when the player IS in today's field, it reflects that real standing (not the 'play to rank' CTA)", () => {
    const withMe: LeaderboardRowData[] = [
      ...field.slice(0, 2),
      { rank: 3, username: "T_Sniffs", score: 640, isMe: true },
      ...field.slice(3),
    ];
    const html = render(withMe);
    expect(html).not.toContain("Play today&#x27;s Royale to rank");
  });
});

describe("StarterLeaderboard — podium wears the player's equipped identity", () => {
  // A podium where #1 and #3 wear earned cosmetics and #2 wears nothing — so both the present and
  // the absent case are covered by the same render.
  const dressed: LeaderboardRowData[] = [
    { rank: 1, username: "Alpha", score: 1000, equipped_frame: "gold_crown", equipped_title: "champion" },
    { rank: 2, username: "Beta", score: 820 },
    { rank: 3, username: "Gamma", score: 640, equipped_frame: "bronze_ring", equipped_title: "crown_chaser" },
    ...field.slice(3),
  ];

  it("shows each seat's equipped TITLE under the name, and nothing for a seat with none", () => {
    const html = render(dressed);
    expect(html).toContain("Champion"); // #1's title
    expect(html).toContain("Crown Chaser"); // #3's title
    // #2 equipped no title, so no title element is emitted for that seat — the column just closes
    // up. `letter-spacing:0.2px` is TitleTag's own (every other label on the screen is em-spaced),
    // so counting it counts titles: exactly two.
    expect((html.match(/letter-spacing:0\.2px/g) ?? []).length).toBe(2);
  });

  it("renders the title with its own flair (a gradient title is clipped to the glyphs)", () => {
    const html = render(dressed);
    // `champion`'s flair is a gradient → background-clip:text + transparent color, not a flat color.
    expect(html).toContain("background-clip:text");
    // `crown_chaser`'s flair is a flat colour (#ffb300) → applied as a plain color.
    expect(html.toLowerCase()).toContain("#ffb300");
  });

  it("threads each seat's equipped FRAME to its avatar", () => {
    const html = render(dressed);
    expect(html).toContain('data-frame="gold_crown"');
    expect(html).toContain('data-frame="bronze_ring"');
  });

  it("puts NO crown ornament on the champion — every crown glyph is a score marker", () => {
    const html = render(dressed);
    const sizes = [...html.matchAll(/data-crown="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    // The seat ornament was the only size-30 crown. Score crowns are 14 (champion) / 12.5 (others).
    expect(sizes).not.toContain(30);
    expect(sizes.every((s) => s <= 14)).toBe(true);
  });
});

describe("StarterLeaderboard — every surface follows the equipped theme", () => {
  // This screen serves the whole Starter SYSTEM, and roughly half of those skins are DARK (Midnight
  // Arcade, Apex, Crown Arena, Champion). It shipped painted in literal ivory and violet, so a dark
  // skin got a white leaderboard bolted into a black app. The rule that fixes it is easy to
  // re-break by eye — one `#FFFFFF` in a new card looks fine on Starter and is invisible until
  // somebody equips Midnight — so it is pinned here instead.
  //
  // Scope: FILL colours only (`background`). Shadows, `filter` and the medal metals are deliberately
  // exempt and are allowed to stay literal — see the METAL note in the component. The tint layers
  // over the podium art are `color-mix` on `--brand`, so they are covered by the same rule.
  const BACKGROUNDS = (html: string) =>
    [...html.matchAll(/background(?:-color|-image)?:((?:[^;"]|\((?:[^()]|\([^()]*\))*\))*)/g)].map(
      (m) => m[1],
    );

  it("paints no literal colour into any background — they all resolve from theme vars", () => {
    const found = BACKGROUNDS(render(field)).filter((v) => /#[0-9a-f]{3,8}\b|\brgba?\(/i.test(v));
    expect(found, `hardcoded background colour(s): ${found.join(" | ")}`).toEqual([]);
  });

  it("lets the theme's own page background through instead of painting its own", () => {
    // `body` already paints `var(--bg)` (global.css). The screen used to overpaint it with a fixed
    // ivory gradient, which is what made a dark skin's leaderboard cream.
    const main = render(field).match(/<main style="([^"]*)"/);
    expect(main, "the screen root should be a <main> with inline styles").not.toBeNull();
    expect(main?.[1]).not.toMatch(/background/);
  });

  it("wears the theme's own signature CTA surface on the selected filter and the progress bar", () => {
    const withMe: LeaderboardRowData[] = [
      ...field.slice(0, 2),
      { rank: 3, username: "T_Sniffs", score: 640, isMe: true },
      ...field.slice(3),
    ];
    // `--cta` is each theme's branded pill gradient (Daylight green, Crown Arena ember…). Both the
    // active segment and the "to next rank" fill must read it, or they stay Starter's violet on
    // every skin. Two occurrences = the tab indicator + the progress fill.
    expect((render(withMe).match(/background:var\(--cta\)/g) ?? []).length).toBe(2);
  });
});

describe("StarterLeaderboard — honesty copy", () => {
  it("contains no banned gambling/cash/prize/'player' language", () => {
    const BANNED = ["cash", "prize", "wager", "gambl", "jackpot", "casino", "lottery", "payout"];
    const html = render(field).toLowerCase();
    for (const word of BANNED) {
      expect(html, `banned word "${word}" found in StarterLeaderboard`).not.toContain(word);
    }
  });
});

describe("StarterLeaderboard — the ranked list runs from 1, not from 4", () => {
  // The list used to start below the podium, so the first card a player saw was "4". A ranking that
  // opens at fourth place reads as a numbering bug; the podium is a flourish OVER the list, not the
  // first page of it. The top three therefore appear in both places, on purpose.
  it("includes the podium three in the row list", () => {
    const html = render(field);
    for (const name of ["Alpha", "Beta", "Gamma", "Delta", "Echo"]) {
      expect(html).toContain(name);
    }
    // Every rank 1..5 is rendered as a row number — in particular 1, 2 and 3.
    for (const rank of [1, 2, 3, 4, 5]) {
      expect(html).toContain(`>${rank}<`);
    }
  });

  it("still keeps the player out of the list — their standing is the Your Rank card only", () => {
    const withMe: LeaderboardRowData[] = [
      ...field.slice(0, 2),
      { rank: 3, username: "T_Sniffs", score: 640, isMe: true },
      ...field.slice(3),
    ];
    const html = render(withMe);
    // Rendered once (the Your Rank card), never duplicated as a row in the list.
    expect(html.split("T_Sniffs").length - 1).toBe(1);
  });
});
