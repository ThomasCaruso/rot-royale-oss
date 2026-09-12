/**
 * Identity chrome pins (static markup, node env).
 *
 * Locked decision (avatar-identity-v1): the language selector lives ONLY on unauthenticated
 * screens (App.tsx floating fallback) and inside the ProfileMenu — NOT in HomeHeader (or
 * CampaignHero). These pins fail if anyone reintroduces it to the header or drops the
 * ProfileMenu rows. Also pins that both surfaces render the player's real identity.
 *
 * The LanguageSelector chip is identified by its aria-haspopup="menu" trigger — the only
 * menu-popup control in either tree.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FRAME_STYLES } from "@/theme/identity";
import { HomeHeader } from "./HomeHeader";
import { ProfileMenu } from "./ProfileMenu";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

describe("HomeHeader", () => {
  it("contains NO LanguageSelector", () => {
    const html = renderToStaticMarkup(
      <HomeHeader coins={120} onOpenMenu={() => {}} onOpenVault={() => {}} />,
    );
    expect(html).not.toContain('aria-haspopup="menu"');
  });

  it("avatar chip renders the illustrated portrait wearing the equipped frame (no emoji face)", () => {
    // Locked decision (home-audit): the header chip shows the illustrated player portrait (the
    // Battle "You" art family), NEVER a platform emoji — emoji beside the illustrated Battle
    // portraits read as a placeholder. The equipped frame (ring + ornament) still applies; the
    // preset emoji remains the identity on ProfileMenu / leaderboard / editor.
    const html = renderToStaticMarkup(
      <HomeHeader
        coins={120}

        avatarPreset="fox"
        equippedFrame="gold_crown"
        onOpenMenu={() => {}}
        onOpenVault={() => {}}
      />,
    );
    expect(html).toContain("avatar-hooded"); // the illustrated portrait img
    expect(html).not.toContain("🦊"); // the emoji face never renders in the header chip
    expect(html).toContain("👑"); // gold_crown ornament still worn
  });

  it("defaults (no identity props) render the illustrated portrait, not the legacy ninja emoji", () => {
    const html = renderToStaticMarkup(
      <HomeHeader coins={120} onOpenMenu={() => {}} onOpenVault={() => {}} />,
    );
    expect(html).toContain("avatar-hooded");
    expect(html).not.toContain("🥷");
  });

  it("coin pill at ZERO balance shows the EARN affordance, never a bare plus", () => {
    const zero = renderToStaticMarkup(
      <HomeHeader coins={0} onOpenMenu={() => {}} onOpenVault={() => {}} />,
    );
    expect(zero).toContain("Earn"); // t.home.earnCoins (CSS uppercases it)
    expect(zero).not.toContain(">+<"); // no plus chip beside a 0 (reads as buy-coins)
    const funded = renderToStaticMarkup(
      <HomeHeader coins={120} onOpenMenu={() => {}} onOpenVault={() => {}} />,
    );
    expect(funded).toContain(">+<"); // funded balance keeps the quiet add-affordance
  });
});

describe("ProfileMenu", () => {
  const base = {
    username: "Tester",
    onClose: () => {},
  };

  it("contains the language row hosting the inline LanguageSelector", () => {
    const html = renderToStaticMarkup(<ProfileMenu {...base} />);
    expect(html).toContain("Language"); // t.identity.language row label
    expect(html).toContain('aria-haspopup="menu"'); // the inline selector chip
  });

  it("promotes edit-identity to a card that names what's inside", () => {
    const html = renderToStaticMarkup(<ProfileMenu {...base} />);
    expect(html).toContain("Edit identity");
    // The sub-line is the whole point of the promotion: without it nobody knows the avatar
    // picker lives behind this control.
    expect(html).toContain("Avatar · Badges · Title");
  });

  it("no longer surfaces global rank (standings belong to the Leaderboard)", () => {
    const html = renderToStaticMarkup(<ProfileMenu {...base} />);
    expect(html).not.toContain("Global rank");
  });

  it("avatar at the top renders the real identity (preset + frame)", () => {
    const html = renderToStaticMarkup(
      <ProfileMenu {...base} avatarPreset="crescent" equippedFrame="violet_glow" />,
    );
    // Version-agnostic: `?v=N` is a cache-buster that changes whenever the art is re-exported
    // (docs/architecture.md §13), so pinning the number makes this test fail on unrelated asset work.
    expect(html).toMatch(/\/avatars\/portraits\/crescent\.webp(\?v=\d+)?/);
    // The violet_glow ring gradient, read from the source of truth so a visual retune never
    // breaks this wiring pin (which only asserts the frame is actually worn).
    expect(html).toContain((FRAME_STYLES.violet_glow.ring as string).slice(0, 40));
  });

  it("keeps sign-out and game reminders intact", () => {
    const html = renderToStaticMarkup(<ProfileMenu {...base} />);
    expect(html).toContain("Sign out");
    expect(html).toContain("Game reminders");
  });

  it("shows the equipped title (flair-colored) and the pinned badge emoji row from me", () => {
    const html = renderToStaticMarkup(
      <ProfileMenu
        {...base}
        equippedTitle="champion"
        equippedBadges={["medal_science", "crown_all"]}
      />,
    );
    expect(html).toContain("Champion"); // TITLE_STYLES.champion.name
    expect(html).toContain("linear-gradient(90deg, #ffe36a, #ffb300)"); // champion flair on the text
    expect(html).toContain("⚗️"); // medal_science badge emoji
    expect(html).toContain("👑"); // crown_all badge emoji
  });

  it("with no title equipped, falls back to the signed-in line and renders no badge row", () => {
    const html = renderToStaticMarkup(<ProfileMenu {...base} />);
    expect(html).toContain("signed in"); // t.home.signedIn
    expect(html).not.toContain("⚗️");
  });
});
