/**
 * LevelComplete tests — world-complete FRAME UNLOCKED celebration.
 *
 * Static markup (renderToStaticMarkup, node env) like the other screen suites. The replay-safety
 * of the trigger itself lives in lib/campaign.test.ts (worldJustCompleted); here we pin that the
 * screen renders the celebration exactly when the container says the world just completed, wears
 * the right world frame on the player's own preset, and keeps the economy copy honest (the frame
 * is unlocked TO BUY in the Vault — never implied as granted).
 */
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CampaignCompleteResponse } from "@/api/client";
import { LevelComplete } from "./LevelComplete";

vi.mock("@/store/session", () => ({
  useSessionStore: (selector: (s: unknown) => unknown) =>
    selector({
      me: {
        user_id: "u1",
        email: "test@example.com",
        username: "Tester",
        rating: 1200,
        rank: 5,
        total_players: 100,
        division: "Bronze",
        streak_count: 0,
        sharpness: 50,
        coins_balance: 200,
        gems_balance: 0,
        equipped_theme: "royale",
        avatar_preset: "rook", // the celebration avatar must wear THIS preset portrait
        equipped_frame: null,
        equipped_badges: [],
        equipped_title: null,
      },
    }),
}));

function completion(over: Partial<CampaignCompleteResponse> = {}): CampaignCompleteResponse {
  return {
    world: "Science",
    level: 12,
    title: "Final Hypothesis",
    is_boss: true,
    correct: 9,
    total: 10,
    passed: true,
    clear_status: "strong",
    coins_awarded: 25,
    daily_cap_reached: false,
    first_clear: true,
    next_level_unlocked: false,
    best_correct: 9,
    ...over,
  };
}

function render(
  over: Partial<CampaignCompleteResponse> = {},
  props: Partial<React.ComponentProps<typeof LevelComplete>> = {},
) {
  return renderToStaticMarkup(
    <LevelComplete
      completion={completion(over)}
      worldIconName="Science"
      dailyEarned={25}
      dailyCap={300}
      onReplay={() => {}}
      onBackToCampaign={() => {}}
      onPractice={() => {}}
      {...props}
    />,
  );
}

describe("LevelComplete — frame-unlock celebration", () => {
  it("renders the FRAME UNLOCKED moment when the completion finished the world", () => {
    const html = render({}, { worldComplete: true });
    expect(html).toContain("FRAME UNLOCKED");
    expect(html).toContain("Science · World Complete");
    expect(html).toContain("Science Orbit"); // FRAME_STYLES[WORLD_FRAMES.Science].name
    expect(html).toContain("⚛️"); // science_orbit ornament on the avatar
    expect(html).toContain("/avatars/portraits/rook.webp?v=2"); // the player's OWN preset portrait wears the frame
    expect(html).toContain("Unlocked in the Vault"); // honest copy: unlocked to buy, not granted
  });

  it("maps each world to its own frame", () => {
    const html = render({ world: "Pop Culture" }, { worldComplete: true });
    expect(html).toContain("Neon Spotlight"); // pop_neon
    expect(html).not.toContain("Science Orbit");
  });

  it("does NOT render the celebration without worldComplete (replay / non-final clear)", () => {
    for (const html of [render(), render({ first_clear: false }, { worldComplete: false })]) {
      expect(html).not.toContain("FRAME UNLOCKED");
      expect(html).not.toContain("Unlocked in the Vault");
      expect(html).toContain("BOSS DEFEATED"); // the normal completion screen still renders
    }
  });

  it("keeps the regular level-complete content intact alongside the celebration", () => {
    const html = render({}, { worldComplete: true });
    expect(html).toContain("BOSS DEFEATED");
    expect(html).toContain("Strong Clear");
    expect(html).toContain("coins earned");
  });

  it("adds the 💯 accent only on a perfect clear", () => {
    expect(render({ correct: 10, clear_status: "perfect" }, { worldComplete: true })).toContain(
      "Perfect clear. Every answer right",
    );
    expect(render({}, { worldComplete: true })).not.toContain("Perfect clear. Every answer right");
  });

  it("shows the Vault CTA only when a navigation path exists", () => {
    expect(render({}, { worldComplete: true, onVault: () => {} })).toContain("View in the Vault");
    expect(render({}, { worldComplete: true })).not.toContain("View in the Vault");
  });

  it("celebration copy stays honest — no cash/prize/gambling/granted language", () => {
    const html = render(
      { correct: 10, clear_status: "perfect" },
      { worldComplete: true, onVault: () => {} },
    ).toLowerCase();
    for (const banned of [
      "cash",
      "prize",
      "wager",
      "gambl",
      "jackpot",
      "casino",
      "payout",
      "free", // the frame costs coins — never imply it was given
      "yours now",
      "granted",
    ]) {
      expect(html, `banned word "${banned}"`).not.toContain(banned);
    }
  });
});
