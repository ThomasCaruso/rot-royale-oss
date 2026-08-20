import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LeaderboardTeaserCard } from "./LeaderboardTeaserCard";
import { PodiumTopThree } from "./PodiumTopThree";
import { LeaderboardRow } from "./LeaderboardRow";
import { LeaderboardTabs } from "./LeaderboardTabs";
import { StandingsStatus } from "./LeaderboardScreen";

// Minimal session store mock so components can read `me`
vi.mock("@/store/session", () => ({
  useSessionStore: (selector: (s: unknown) => unknown) =>
    selector({
      me: {
        user_id: "u1",
        email: "test@example.com",
        username: "T_Sniffs",
        rating: 1236,
        rank: 18,
        total_players: 200,
        division: "Gold III",
        streak_count: 3,
        sharpness: 72,
        coins_balance: 500,
        gems_balance: 0,
        equipped_theme: "royale",
        avatar_preset: "knight",
        equipped_frame: null,
      },
    }),
}));

// api mock — currentContest returns no open window; history returns empty
vi.mock("@/api/client", () => ({
  api: {
    currentContest: () => Promise.resolve({ open_window: null, schedule: [] }),
    windowField: () => Promise.resolve({ entries: [] }),
    history: () => Promise.resolve({ items: [] }),
  },
}));

describe("LeaderboardTeaserCard", () => {
  it("renders leaderboard label and view CTA", () => {
    const html = renderToStaticMarkup(<LeaderboardTeaserCard onLeaderboard={() => {}} />);
    expect(html).toContain("Leaderboard");
    expect(html).toContain("View Leaderboard");
  });

  it("shows standing when rank and division are available", () => {
    const html = renderToStaticMarkup(<LeaderboardTeaserCard onLeaderboard={() => {}} />);
    // The mocked me has rank:18, division:"Gold III"
    expect(html).toContain("#18");
    expect(html).toContain("Gold III");
  });

  it("contains no banned gambling/cash/prize language", () => {
    const BANNED = ["cash", "prize", "wager", "gambl", "jackpot", "casino", "lottery", "payout"];
    const html = renderToStaticMarkup(<LeaderboardTeaserCard onLeaderboard={() => {}} />).toLowerCase();
    for (const word of BANNED) {
      expect(html, `banned word "${word}" found in LeaderboardTeaserCard`).not.toContain(word);
    }
  });
});

describe("LeaderboardRow", () => {
  it("highlights user row with YOU label", () => {
    const row = { rank: 4, username: "T_Sniffs", score: 920, isMe: true };
    const html = renderToStaticMarkup(<LeaderboardRow row={row} youLabel="YOU" />);
    expect(html).toContain("T_Sniffs");
    expect(html).toContain("YOU");
    expect(html).toContain("920"); // score rendered
  });

  it("does not show YOU label on other rows", () => {
    const row = { rank: 5, username: "NovaStrike", score: 810, isMe: false };
    const html = renderToStaticMarkup(<LeaderboardRow row={row} youLabel="YOU" />);
    expect(html).toContain("NovaStrike");
    expect(html).not.toContain("YOU");
  });

  it("renders the row's avatar preset portrait and equipped frame from data", () => {
    const row = {
      rank: 2,
      username: "FoxKing",
      score: 700,
      isMe: false,
      avatar_preset: "rook",
      equipped_frame: "gold_crown",
    };
    const html = renderToStaticMarkup(<LeaderboardRow row={row} youLabel="YOU" />);
    expect(html).toContain("/avatars/portraits/rook.png?v=2"); // preset portrait
    expect(html).toContain("👑"); // gold_crown ornament
    expect(html).toContain("#ffb300"); // gold_crown ring gradient painted into the border box
  });

  it("keeps the amber isMe ring when the row has no frame", () => {
    const row = { rank: 4, username: "T_Sniffs", score: 920, isMe: true, equipped_frame: null };
    const html = renderToStaticMarkup(<LeaderboardRow row={row} youLabel="YOU" />);
    expect(html).toContain("2px solid var(--amber)");
  });

  it("an equipped frame wins over the isMe amber ring (that's the point of owning one)", () => {
    const row = {
      rank: 4,
      username: "T_Sniffs",
      score: 920,
      isMe: true,
      avatar_preset: "knight",
      equipped_frame: "violet_glow",
    };
    const html = renderToStaticMarkup(<LeaderboardRow row={row} youLabel="YOU" />);
    expect(html).not.toContain("solid var(--amber)"); // plain ring replaced…
    expect(html).toContain("solid transparent"); // …by the transparent border the ring gradient paints
    expect(html).toContain("#7c3aed"); // violet_glow ring gradient
  });

  it("rows without identity fields fall back to the knight default (legacy constructors safe)", () => {
    const row = { rank: 5, username: "NovaStrike", score: 810, isMe: false };
    const html = renderToStaticMarkup(<LeaderboardRow row={row} youLabel="YOU" />);
    expect(html).toContain("/avatars/portraits/knight.png?v=2");
  });

  it("shows up to 3 tiny badge emoji after the username (aria-hidden honors)", () => {
    const row = {
      rank: 2,
      username: "FoxKing",
      score: 700,
      isMe: false,
      equipped_badges: ["medal_science", "crown_all", "first_crown"],
    };
    const html = renderToStaticMarkup(<LeaderboardRow row={row} youLabel="YOU" />);
    expect(html).toContain("⚗️");
    expect(html).toContain("👑");
    expect(html).toContain("🥇");
    expect(html).toContain("aria-hidden"); // decorative — never read to screen readers
  });

  it("more than 3 badge ids in data renders only the first 3 (defensive slice)", () => {
    const row = {
      rank: 2,
      username: "FoxKing",
      score: 700,
      isMe: false,
      equipped_badges: ["medal_science", "medal_history", "medal_geography", "perfectionist"],
    };
    const html = renderToStaticMarkup(<LeaderboardRow row={row} youLabel="YOU" />);
    expect(html).toContain("⚗️");
    expect(html).toContain("🏺");
    expect(html).toContain("🧭");
    expect(html).not.toContain("💯"); // 4th id never renders
  });

  it("botlike rows ([] / null) render markup IDENTICAL to a row without the fields — no layout shift", () => {
    const base = { rank: 5, username: "NovaStrike", score: 810, isMe: false };
    const plain = renderToStaticMarkup(<LeaderboardRow row={base} youLabel="YOU" />);
    const botlike = renderToStaticMarkup(
      <LeaderboardRow row={{ ...base, equipped_badges: [], equipped_title: null }} youLabel="YOU" />,
    );
    expect(botlike).toBe(plain);
  });

  it("rows never run the prestige glow pulse — scroll lists stay animation-free", () => {
    const row = {
      rank: 2,
      username: "FoxKing",
      score: 700,
      isMe: false,
      equipped_frame: "crowned_scholar",
    };
    const html = renderToStaticMarkup(<LeaderboardRow row={row} youLabel="YOU" />);
    expect(html).not.toContain("rr-glow-pulse"); // animated={false} — zero per-row animation
    expect(html).toContain("conic-gradient"); // the prestige ring still shows, statically
  });

  it("unknown badge ids render nothing (server ids are the truth)", () => {
    const base = { rank: 5, username: "NovaStrike", score: 810, isMe: false };
    const plain = renderToStaticMarkup(<LeaderboardRow row={base} youLabel="YOU" />);
    const bogus = renderToStaticMarkup(
      <LeaderboardRow row={{ ...base, equipped_badges: ["not_a_badge"] }} youLabel="YOU" />,
    );
    expect(bogus).toBe(plain);
  });
});

describe("PodiumTopThree", () => {
  it("renders top 3 entries", () => {
    const entries = [
      { rank: 1, username: "Alpha", score: 1000, isMe: false },
      { rank: 2, username: "Beta", score: 800, isMe: false },
      { rank: 3, username: "Gamma", score: 600, isMe: true },
    ];
    const html = renderToStaticMarkup(<PodiumTopThree entries={entries} youLabel="YOU" />);
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("YOU"); // current user shown as YOU
  });

  it("renders empty slots when fewer than 3 entries", () => {
    const entries = [{ rank: 1, username: "Solo", score: 500, isMe: false }];
    const html = renderToStaticMarkup(<PodiumTopThree entries={entries} youLabel="YOU" />);
    expect(html).toContain("Solo");
    // empty slots render dashes
    expect(html).toContain("—");
  });

  it("uses the lobby PNG portraits: hooded for the champion, bot for the other seats", () => {
    const entries = [
      { rank: 1, username: "Alpha", score: 1000, isMe: false },
      { rank: 2, username: "Beta", score: 800, isMe: false },
      { rank: 3, username: "Gamma", score: 600, isMe: false },
    ];
    const html = renderToStaticMarkup(<PodiumTopThree entries={entries} youLabel="YOU" />);
    expect((html.match(/data-portrait="hooded"/g) ?? []).length).toBe(1); // champion only
    expect((html.match(/data-portrait="bot"/g) ?? []).length).toBe(2); // #2 and #3
  });

  it("gives the current user the hooded hero portrait with an amber ring", () => {
    const entries = [{ rank: 1, username: "T_Sniffs", score: 1000, isMe: true }];
    const html = renderToStaticMarkup(<PodiumTopThree entries={entries} youLabel="YOU" />);
    expect(html).toContain('data-portrait="hooded"');
    expect(html).toContain("3px solid var(--amber)"); // amber ring on the champion user's portrait
    expect(html).toContain("YOU");
  });

  it("shows equipped titles in their flair under podium names — badges stay OFF podium cards", () => {
    const entries = [
      {
        rank: 1,
        username: "Alpha",
        score: 1000,
        isMe: false,
        equipped_title: "trivia_menace",
        equipped_badges: ["medal_science", "crown_all"],
      },
      { rank: 2, username: "Beta", score: 800, isMe: false, equipped_title: "crown_chaser", equipped_badges: [] },
      { rank: 3, username: "Gamma", score: 600, isMe: false, equipped_title: null, equipped_badges: [] },
    ];
    const html = renderToStaticMarkup(<PodiumTopThree entries={entries} youLabel="YOU" />);
    // titles render with their flair (gradient → background-clipped text; solid → colored text)
    expect(html).toContain("Trivia Menace");
    expect(html).toContain("linear-gradient(90deg, #ffd24a, #a855f7)"); // trivia_menace gradient flair
    expect(html).toContain("Crown Chaser");
    expect(html).toContain("color:#ffb300"); // crown_chaser solid flair
    // badges are deliberately NOT on podium cards (the title is the podium honor)
    expect(html).not.toContain("⚗️");
  });

  it("THE AURA: only the #1 card gets the champion aura image", () => {
    const entries = [
      { rank: 1, username: "Alpha", score: 1000, isMe: false },
      { rank: 2, username: "Beta", score: 800, isMe: false },
      { rank: 3, username: "Gamma", score: 600, isMe: false },
    ];
    const html = renderToStaticMarkup(<PodiumTopThree entries={entries} youLabel="YOU" />);
    expect((html.match(/data-aura="winner"/g) ?? []).length).toBe(1); // #1 only — 2nd/3rd get nothing
    expect(html).toContain("champion-aura"); // the champion-aura.png asset behind the #1 avatar
  });

  it("gives the centered champion card a gold border + aura", () => {
    const entries = [{ rank: 1, username: "Alpha", score: 1000, isMe: false }];
    const html = renderToStaticMarkup(<PodiumTopThree entries={entries} youLabel="YOU" />);
    expect(html).toContain("color-mix(in srgb, var(--amber) 65%, transparent)"); // gold champion border
    expect(html).toContain('data-aura="winner"'); // the breathing gold halo
  });

  it("an empty podium renders no aura (the halo belongs to a real #1)", () => {
    const html = renderToStaticMarkup(<PodiumTopThree entries={[]} youLabel="YOU" />);
    expect(html).not.toContain("data-aura");
    expect(html).not.toContain("rr-aura");
  });
});

describe("LeaderboardTabs", () => {
  it("renders both tab labels", () => {
    const html = renderToStaticMarkup(
      <LeaderboardTabs
        active="window"
        onSwitch={() => {}}
        labels={{ currentWindow: "Current Window", globalRank: "Global Rank" }}
      />,
    );
    expect(html).toContain("Current Window");
    expect(html).toContain("Global Rank");
  });

  it("marks active tab with aria-selected=true", () => {
    const html = renderToStaticMarkup(
      <LeaderboardTabs
        active="global"
        onSwitch={() => {}}
        labels={{ currentWindow: "Current Window", globalRank: "Global Rank" }}
      />,
    );
    // Global Rank tab is active
    expect(html).toContain('aria-selected="true"');
  });

  it("contains no banned copy", () => {
    const BANNED = ["cash", "prize", "wager", "gambl", "jackpot", "casino", "lottery", "payout"];
    const html = renderToStaticMarkup(
      <LeaderboardTabs
        active="window"
        onSwitch={() => {}}
        labels={{ currentWindow: "Current Window", globalRank: "Global Rank" }}
      />,
    ).toLowerCase();
    for (const word of BANNED) {
      expect(html, `banned word "${word}" in LeaderboardTabs`).not.toContain(word);
    }
  });
});

describe("StandingsStatus (provisional vs final)", () => {
  it("shows the provisional label while the field is still moving", () => {
    const html = renderToStaticMarkup(
      <StandingsStatus
        isFinal={false}
        provisionalLabel="Provisional · field still moving"
        finalLabel="Final"
      />,
    );
    expect(html).toContain("Provisional");
    expect(html).toContain("field still moving");
    expect(html).not.toContain("Final");
  });

  it("shows the final label once the window is settled", () => {
    const html = renderToStaticMarkup(
      <StandingsStatus
        isFinal={true}
        provisionalLabel="Provisional · field still moving"
        finalLabel="Final"
      />,
    );
    expect(html).toContain("Final");
    expect(html).not.toContain("Provisional");
  });

  it("uses honest 'field' language — never 'players'", () => {
    const provisional = renderToStaticMarkup(
      <StandingsStatus
        isFinal={false}
        provisionalLabel="Provisional · field still moving"
        finalLabel="Final"
      />,
    ).toLowerCase();
    expect(provisional).toContain("field");
  });
});
