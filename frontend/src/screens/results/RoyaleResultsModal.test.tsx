import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HistoryItem } from "@/api/client";
import type { FieldRow } from "@/lib/results";
import {
  PreRevealCurtain,
  ResultReveal,
  RoyaleResultsModal,
} from "@/screens/results/RoyaleResultsModal";
import type { Me } from "@/store/session";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// The results screen is now the quiet mono report; these specs check its minimal contract.
primeArcadeTheme();

// Money/gambling language that must never appear in player-facing copy (DESIGN §7). "players" is
// NOT banned any more — the field is real entries only, so naming them is the honest wording.
const BANNED = /\b(cash|prize|jackpot|bet|wager|gambling)\b/i;

function result(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    window_id: "w1",
    contest_date: "2026-06-09",
    slot: "royale",
    state: "SETTLED",
    total_score: 8420,
    place: 1,
    field_size: 12,
    coins_awarded: 104,
    rating_before: 1204,
    rating_after: 1236,
    ...over,
  };
}

const me: Me = {
  user_id: "u1",
  email: "you@example.com",
  username: "You",
  is_guest: false,
  rating: 1236,
  rank: 3,
  total_players: 50,
  division: "gold",
  streak_count: 2,
  sharpness: 40,
  coins_balance: 500,
  gems_balance: 0,
  equipped_theme: "royale",
  avatar_preset: "knight",
  equipped_frame: null,
  equipped_badges: [],
  equipped_title: null,
};

// FINAL_STAGE is 2 (0 calculating · 1 hero · 2 the rest); default to the fully-revealed state.
const reveal = (
  r: HistoryItem,
  stage = 2,
  over: { me?: Me; field?: FieldRow[] | null } = {},
) =>
  renderToStaticMarkup(
    <ResultReveal
      stage={stage}
      result={r}
      me={over.me ?? me}
      field={over.field ?? null}
      onClose={() => {}}
      onPractice={() => {}}
      onShare={() => {}}
      shared={false}
    />,
  );

describe("RoyaleResultsModal — quiet minimal results report", () => {
  it("opens to the pre-reveal curtain (results ready), NOT the staged content", () => {
    const html = renderToStaticMarkup(
      <RoyaleResultsModal result={result()} me={me} onClose={() => {}} onPractice={() => {}} />,
    );
    expect(html).toContain("Final Results Ready");
    expect(html).toContain("Your Royale Results Are In");
    expect(html).toContain("Reveal Results"); // the gesture that starts the reveal + unlocks audio
    // the results themselves must NOT show until the player taps Reveal Results
    expect(html).not.toContain("Final standings");
  });

  it("the curtain offers a Reveal Results action and a way back out, with clean copy", () => {
    const html = renderToStaticMarkup(<PreRevealCurtain onReveal={() => {}} onClose={() => {}} />);
    expect(html).toContain("Reveal Results");
    expect(html).toContain("Back to hub");
    expect(html).not.toMatch(BANNED);
  });

  it("the reveal leads with the score + placement, field-framed, with clean copy", () => {
    const html = reveal(result());
    expect(html).toContain("DAILY ROYALE"); // a royale result reveals the localized Daily Royale title
    expect(html).toContain("Jun 9, 2026"); // viewer-local contest-date label (no ET)
    expect(html).toContain("Score"); // the hero score label
    expect(html).toContain("#1"); // the placement, shown as #N
    expect(html).toContain("players"); // "#7 of 50 players" — a real count of real entrants
    expect(html).toContain("Final results are in.");
    expect(html).not.toMatch(BANNED);
    expect(html).not.toContain("ET");
  });

  it("a legacy night result reveals its truthful 'Legacy Night Game' title, NOT Daily Royale", () => {
    const html = reveal(result({ slot: "night" }));
    expect(html).toContain("LEGACY NIGHT GAME");
    expect(html).not.toContain("DAILY ROYALE");
    expect(html).not.toMatch(BANNED);
  });

  it("shows the compact 3-column rating summary: change, new rating, division", () => {
    const html = reveal(result()); // +32 → new rating 1236, gold division
    expect(html).toContain("Rating change");
    expect(html).toContain("+32");
    expect(html).toContain("Rating");
    expect(html).toContain("1,236"); // the new (after) rating, shown compactly
    expect(html).toContain("Division");
    expect(html).toContain("gold"); // capitalized in CSS; raw text is the division id
  });

  it("a rating loss renders a restrained negative delta", () => {
    const html = reveal(result({ place: 7, rating_before: 1100, rating_after: 1088 }));
    expect(html).toContain("#7");
    expect(html).toContain("−12"); // −12, real minus sign
    expect(html).not.toMatch(BANNED);
  });

  it("solo-field reveal copy is neutral — no banned words, no invented competitors", () => {
    const html = reveal(result({ place: 1, field_size: 1 }));
    expect(html).not.toMatch(BANNED);
    expect(html).toMatch(/played solo today/i);
  });

  it("before its stages advance, the reveal shows the calculating beat, not the results", () => {
    const html = reveal(result(), 0);
    expect(html).toContain("Calculating final results");
    expect(html).not.toContain("#1");
    expect(html).not.toContain("Final standings");
  });

  it("final standings show the top 3 and the player's row, flat and text-only", () => {
    const field: FieldRow[] = [
      { username: "KettleSky", score: 1759 },
      { username: "MarbleFox", score: 1657 },
      { username: "FableNox", score: 1253 },
      { username: "Ghost", score: 900 },
      { username: "You", score: 758, isMe: true },
    ];
    const html = reveal(result({ place: 5, total_score: 758 }), 2, { field });
    expect(html).toContain("Final standings");
    expect(html).toContain("KettleSky");
    expect(html).toContain("1,759");
    expect(html).toContain("You"); // the player's own row (outside the top 3) still appears
    expect(html).not.toContain("Ghost"); // 4th place is not shown — only top 3 + you
    expect(html).not.toMatch(BANNED);
  });

  it("wires the primary and secondary actions", () => {
    const html = reveal(result());
    expect(html).toContain("Back to hub"); // shared common key (kept as-is)
    expect(html).toContain("Practice");
    // Share is gated on navigator.share/clipboard (absent under static SSR), so it's not asserted here.
  });
});
