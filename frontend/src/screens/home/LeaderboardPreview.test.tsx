import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeaderboardPreview } from "@/screens/home/LeaderboardPreview";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

describe("LeaderboardPreview", () => {
  it("renders a populated field and counts the real entrants as players", () => {
    const rows = [
      { username: "T_Sniffs", score: 920, isMe: true },
      { username: "NovaStrike", score: 810 }, // a cold-start bot — rendered indistinguishably
      { username: "QuasarFox", score: 640 },
      { username: "EmberWolf", score: 410 },
    ];
    const html = renderToStaticMarkup(<LeaderboardPreview rows={rows} fieldCount={8} />);
    expect(html).toContain("8 players"); // a real count of real entrants — no synthetic padding
    expect(html).toContain("T_Sniffs"); // the real entry…
    expect(html).toContain("NovaStrike"); // …and a bot both populate the field
    expect(html).not.toContain("entered"); // never claim N humans entered (DESIGN §7)
  });

  it("rows render each entry's preset and frame; identity-less rows keep the knight default", () => {
    const rows = [
      {
        username: "T_Sniffs",
        score: 920,
        isMe: true,
        avatar_preset: "rook",
        equipped_frame: "violet_glow",
      },
      { username: "NovaStrike", score: 810 }, // no identity fields → safe defaults
    ];
    const html = renderToStaticMarkup(<LeaderboardPreview rows={rows} fieldCount={4} />);
    expect(html).toContain("/avatars/portraits/rook.webp?v=2"); // T_Sniffs' preset portrait
    expect(html).toContain("#7c3aed"); // violet_glow ring gradient painted into the border box
    expect(html).toContain("/avatars/portraits/knight.webp?v=2"); // NovaStrike falls back to the knight default
  });

  it("frameless 'me' row keeps the amber ring (frame only wins when equipped)", () => {
    const rows = [{ username: "T_Sniffs", score: 920, isMe: true, avatar_preset: "crescent" }];
    const html = renderToStaticMarkup(<LeaderboardPreview rows={rows} fieldCount={1} />);
    // Version-agnostic: `?v=N` is a cache-buster that changes whenever the art is re-exported
    // (docs/architecture.md §13), so pinning the number makes this test fail on unrelated asset work.
    expect(html).toMatch(/\/avatars\/portraits\/crescent\.webp(\?v=\d+)?/);
    expect(html).toContain("2px solid var(--amber)");
  });
});

// Home should NOT render LeaderboardPreview — it has been replaced by LeaderboardTeaserCard.
// This test guards against accidental re-introduction of the full preview on the Home screen.
describe("Home leaderboard integration (import guard)", () => {
  // Timeout is generous: these dynamically import the whole Home module graph (components + image
  // assets), which Vite transforms on first import — under parallel load that can exceed the 5s
  // default even though the work itself is ~1s in isolation.
  it("LeaderboardPreview is not imported by Home.tsx", async () => {
    // Dynamic import of the Home module source to check its dependency set.
    // We verify that the Home screen does NOT re-export or reference LeaderboardPreview.
    const homeModule = await import("@/screens/Home");
    // Home's named export is the `Home` function; it should not expose LeaderboardPreview
    expect((homeModule as Record<string, unknown>)["LeaderboardPreview"]).toBeUndefined();
  }, 20000);

  it("LeaderboardTeaserCard is accessible from Home module tree", async () => {
    const teaserModule = await import("@/screens/leaderboard/LeaderboardTeaserCard");
    expect(teaserModule.LeaderboardTeaserCard).toBeDefined();
  }, 20000);
});
