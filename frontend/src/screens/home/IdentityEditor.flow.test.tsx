// @vitest-environment jsdom
/**
 * IdentityEditor flow tests (jsdom + @testing-library/react, grown from the AvatarPicker suite —
 * same mock pattern as VaultScreen.flow.test.tsx).
 *
 * Contracts verified:
 *   Avatar tab (default — original picker behavior unchanged):
 *   - renders all 5 preset options; the current one is marked
 *   - tapping a preset calls api.setAvatar exactly once with that id
 *   - the store is patched from the SERVER response value, not the tapped id
 *   - double-tap guard; current-preset tap closes without an API call
 *   - on error, /me (+ /identity) are refetched and the store reverts to server truth
 *   Badges tab:
 *   - GET /identity is loaded on open; equipping calls setBadges exactly once with the FULL
 *     ordered pick; the store is patched from a SURPRISING server response only
 *   - the 4th-badge tap is blocked client-side: NOTHING is called, the card shakes
 *   - unequip sends the remaining ordered pick; locked badges are unresponsive
 *   - on setBadges error, /me + /identity are silently refetched
 *   Title tab:
 *   - setting a title calls setTitle once and patches from the response (surprising value wins)
 *   - "No title" clears via setTitle(null); locked titles are unresponsive
 */
import { cleanup, render, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const BADGE_IDS = [
  "medal_science",
  "medal_history",
  "medal_geography",
  "medal_arts",
  "medal_sports",
  "medal_pop",
  "crown_all",
  "perfectionist",
  "podium_finisher",
  "first_crown",
];
const TITLE_IDS = [
  "crown_chaser",
  "world_traveler",
  "perfect_clear",
  "podium_regular",
  "champion",
  "trivia_menace",
];

const { mockSetMe, mockSetAvatar, mockGetMe, mockGetIdentity, mockSetBadges, mockSetTitle, mockMe } =
  vi.hoisted(() => {
    const mockMe = {
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
      avatar_preset: "knight",
      equipped_frame: null as string | null,
      equipped_badges: [] as string[],
      equipped_title: null as string | null,
    };
    return {
      mockSetMe: vi.fn(),
      mockSetAvatar: vi.fn(),
      mockGetMe: vi.fn(),
      mockGetIdentity: vi.fn(),
      mockSetBadges: vi.fn(),
      mockSetTitle: vi.fn(),
      mockMe,
    };
  });

vi.mock("@/store/session", () => {
  function useSessionStore(selector: (s: unknown) => unknown) {
    return selector({ me: mockMe, setMe: mockSetMe });
  }
  useSessionStore.getState = () => ({ me: mockMe, setMe: mockSetMe });
  return { useSessionStore };
});

vi.mock("@/api/client", () => ({
  api: {
    setAvatar: (...args: unknown[]) => mockSetAvatar(...args),
    me: (...args: unknown[]) => mockGetMe(...args),
    getIdentity: (...args: unknown[]) => mockGetIdentity(...args),
    setBadges: (...args: unknown[]) => mockSetBadges(...args),
    setTitle: (...args: unknown[]) => mockSetTitle(...args),
  },
}));

import { IdentityEditor } from "./IdentityEditor";
import cosmeticIds from "@/theme/cosmeticIds.json";

// Derived from the cross-side parity fixture so new presets never silently drift this test.
const PRESET_IDS: string[] = cosmeticIds.presets;

/** GET /identity payload: every catalog id, earned per the given lists. */
function identityFixture(earnedBadges: string[] = [], earnedTitles: string[] = []) {
  return {
    badges: BADGE_IDS.map((id) => ({
      id,
      earned: earnedBadges.includes(id),
      equipped: mockMe.equipped_badges.includes(id),
    })),
    titles: TITLE_IDS.map((id) => ({
      id,
      earned: earnedTitles.includes(id),
      equipped: mockMe.equipped_title === id,
    })),
  };
}

function presetButtons(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("[data-preset]"));
}

function badgeButton(container: HTMLElement, id: string) {
  return container.querySelector<HTMLButtonElement>(`[data-badge="${id}"]`);
}

function titleButton(container: HTMLElement, id: string) {
  return container.querySelector<HTMLButtonElement>(`[data-title="${id}"]`);
}

async function openTab(r: ReturnType<typeof render>, name: string) {
  fireEvent.click(r.getByRole("tab", { name }));
  // Identity data resolves on mount; wait until the tab's content is actually rendered.
  await waitFor(() => expect(r.container.querySelector("[data-badge], [data-title]")).toBeTruthy());
}

// No vitest globals in this repo → RTL auto-cleanup is off; unmount between tests so the
// document-bound role queries (getByRole("tab")) never see a previous render's sheet.
afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockMe.avatar_preset = "knight";
  mockMe.equipped_badges = [];
  mockMe.equipped_title = null;
  mockSetAvatar.mockResolvedValue({ avatar_preset: "bishop" });
  mockGetMe.mockResolvedValue({ ...mockMe });
  mockGetIdentity.mockResolvedValue(identityFixture());
  mockSetBadges.mockResolvedValue({ equipped_badges: [] });
  mockSetTitle.mockResolvedValue({ equipped_title: null });
});

describe("IdentityEditor — avatar tab (default)", () => {
  it("renders all 5 preset options with the current one marked, and loads /identity on open", async () => {
    const { container } = render(<IdentityEditor onClose={() => {}} />);
    const btns = presetButtons(container);
    expect(btns.map((b) => b.getAttribute("data-preset")).sort()).toEqual([...PRESET_IDS].sort());
    const current = btns.filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(current.map((b) => b.getAttribute("data-preset"))).toEqual(["knight"]);
    await waitFor(() => expect(mockGetIdentity).toHaveBeenCalledTimes(1));
  });

  it("tapping a preset calls api.setAvatar once with the id and patches the store from the SERVER response", async () => {
    // Surprising server response: tap "bishop" but the server says "rook" — the store must get "rook".
    mockSetAvatar.mockResolvedValue({ avatar_preset: "rook" });
    const onClose = vi.fn();
    const { container } = render(<IdentityEditor onClose={onClose} />);

    const bishop = presetButtons(container).find((b) => b.getAttribute("data-preset") === "bishop")!;
    fireEvent.click(bishop);

    await waitFor(() => expect(mockSetAvatar).toHaveBeenCalledTimes(1));
    expect(mockSetAvatar).toHaveBeenCalledWith("bishop");

    await waitFor(() =>
      expect(mockSetMe).toHaveBeenCalledWith(expect.objectContaining({ avatar_preset: "rook" })),
    );
    // Never patched with the tapped id — the server value is the only truth.
    expect(mockSetMe).not.toHaveBeenCalledWith(expect.objectContaining({ avatar_preset: "bishop" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("double-tap guard: two rapid taps while the first PATCH is in flight call setAvatar once", async () => {
    let resolvePatch!: (v: { avatar_preset: string }) => void;
    mockSetAvatar.mockImplementation(
      () => new Promise<{ avatar_preset: string }>((resolve) => (resolvePatch = resolve)),
    );
    const { container } = render(<IdentityEditor onClose={() => {}} />);

    const bishop = presetButtons(container).find((b) => b.getAttribute("data-preset") === "bishop")!;
    const crescent = presetButtons(container).find((b) => b.getAttribute("data-preset") === "crescent")!;
    fireEvent.click(bishop);
    fireEvent.click(bishop); // same option again
    fireEvent.click(crescent); // a different option while busy

    await act(async () => {
      resolvePatch({ avatar_preset: "bishop" });
    });

    await waitFor(() => expect(mockSetAvatar).toHaveBeenCalledTimes(1));
  });

  it("the freshly confirmed option pops (rr-pop on the SERVER-confirmed id) during the close beat", async () => {
    mockSetAvatar.mockResolvedValue({ avatar_preset: "rook" });
    const { container } = render(<IdentityEditor onClose={() => {}} />);

    fireEvent.click(presetButtons(container).find((b) => b.getAttribute("data-preset") === "bishop")!);

    await waitFor(() => {
      const rook = presetButtons(container).find((b) => b.getAttribute("data-preset") === "rook")!;
      expect(rook.className).toContain("rr-pop");
    });
    const bishop = presetButtons(container).find((b) => b.getAttribute("data-preset") === "bishop")!;
    expect(bishop.className).not.toContain("rr-pop");
  });

  it("tapping the CURRENT preset closes without any API call", async () => {
    const onClose = vi.fn();
    const { container } = render(<IdentityEditor onClose={onClose} />);
    const knight = presetButtons(container).find((b) => b.getAttribute("data-preset") === "knight")!;
    fireEvent.click(knight);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockSetAvatar).not.toHaveBeenCalled();
  });

  it("on PATCH failure, /me is refetched and the store reverts to server truth", async () => {
    mockSetAvatar.mockRejectedValue(new Error("422 unknown_preset"));
    mockGetMe.mockResolvedValue({ ...mockMe, avatar_preset: "knight" });
    const onClose = vi.fn();
    const { container } = render(<IdentityEditor onClose={onClose} />);

    const bishop = presetButtons(container).find((b) => b.getAttribute("data-preset") === "bishop")!;
    fireEvent.click(bishop);

    await waitFor(() => expect(mockGetMe).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockSetMe).toHaveBeenCalledWith(expect.objectContaining({ avatar_preset: "knight" })),
    );
    // Editor stays open on error so the user can try again.
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("IdentityEditor — badges tab", () => {
  it("equips via setBadges exactly once with the FULL ordered pick; store patched from a SURPRISING response", async () => {
    mockMe.equipped_badges = ["medal_science"];
    mockGetIdentity.mockResolvedValue(identityFixture(["medal_science", "crown_all"]));
    // Surprising server echo — the store must take THIS, not the optimistic pick.
    mockSetBadges.mockResolvedValue({ equipped_badges: ["podium_finisher"] });
    const r = render(<IdentityEditor onClose={() => {}} />);
    await openTab(r, "Badges");

    fireEvent.click(badgeButton(r.container, "crown_all")!);

    await waitFor(() => expect(mockSetBadges).toHaveBeenCalledTimes(1));
    // Full new pick, ordered: existing equip first, the new tap appended.
    expect(mockSetBadges).toHaveBeenCalledWith(["medal_science", "crown_all"]);
    await waitFor(() =>
      expect(mockSetMe).toHaveBeenCalledWith(
        expect.objectContaining({ equipped_badges: ["podium_finisher"] }),
      ),
    );
    expect(mockSetMe).not.toHaveBeenCalledWith(
      expect.objectContaining({ equipped_badges: ["medal_science", "crown_all"] }),
    );
  });

  it("the 4th badge tap calls NOTHING (client-side guard) and shakes the card", async () => {
    mockMe.equipped_badges = ["medal_science", "medal_history", "medal_geography"];
    mockGetIdentity.mockResolvedValue(
      identityFixture(["medal_science", "medal_history", "medal_geography", "crown_all"]),
    );
    const r = render(<IdentityEditor onClose={() => {}} />);
    await openTab(r, "Badges");

    const crown = badgeButton(r.container, "crown_all")!;
    fireEvent.click(crown);

    expect(crown.className).toContain("rr-shake"); // gentle refusal, not a dead tap
    expect(mockSetBadges).not.toHaveBeenCalled();
    expect(mockSetTitle).not.toHaveBeenCalled();
    expect(mockSetAvatar).not.toHaveBeenCalled();
    expect(mockSetMe).not.toHaveBeenCalled();
  });

  it("tapping an equipped badge unequips it: setBadges gets the remaining ordered pick", async () => {
    mockMe.equipped_badges = ["medal_science", "crown_all"];
    mockGetIdentity.mockResolvedValue(identityFixture(["medal_science", "crown_all"]));
    mockSetBadges.mockResolvedValue({ equipped_badges: ["crown_all"] });
    const r = render(<IdentityEditor onClose={() => {}} />);
    await openTab(r, "Badges");

    fireEvent.click(badgeButton(r.container, "medal_science")!);

    await waitFor(() => expect(mockSetBadges).toHaveBeenCalledTimes(1));
    expect(mockSetBadges).toHaveBeenCalledWith(["crown_all"]);
    await waitFor(() =>
      expect(mockSetMe).toHaveBeenCalledWith(
        expect.objectContaining({ equipped_badges: ["crown_all"] }),
      ),
    );
  });

  it("locked (unearned) badges are unresponsive — no API call", async () => {
    mockGetIdentity.mockResolvedValue(identityFixture([])); // nothing earned
    const r = render(<IdentityEditor onClose={() => {}} />);
    await openTab(r, "Badges");

    const locked = badgeButton(r.container, "first_crown")!;
    expect(locked.disabled).toBe(true);
    fireEvent.click(locked);
    expect(mockSetBadges).not.toHaveBeenCalled();
    expect(mockSetMe).not.toHaveBeenCalled();
  });

  it("on setBadges failure, /me + /identity are silently refetched (server truth wins)", async () => {
    mockMe.equipped_badges = [];
    mockGetIdentity.mockResolvedValue(identityFixture(["crown_all"]));
    mockSetBadges.mockRejectedValue(new Error("403 not_earned"));
    mockGetMe.mockResolvedValue({ ...mockMe, equipped_badges: [] });
    const r = render(<IdentityEditor onClose={() => {}} />);
    await openTab(r, "Badges");

    fireEvent.click(badgeButton(r.container, "crown_all")!);

    await waitFor(() => expect(mockGetMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetIdentity).toHaveBeenCalledTimes(2)); // mount + recovery
    await waitFor(() =>
      expect(mockSetMe).toHaveBeenCalledWith(expect.objectContaining({ equipped_badges: [] })),
    );
  });
});

describe("IdentityEditor — title tab", () => {
  it("setting a title calls setTitle once and patches the store from the SERVER response", async () => {
    mockGetIdentity.mockResolvedValue(identityFixture([], ["crown_chaser", "champion"]));
    // Surprising echo: tapped crown_chaser, server says champion — champion wins.
    mockSetTitle.mockResolvedValue({ equipped_title: "champion" });
    const r = render(<IdentityEditor onClose={() => {}} />);
    await openTab(r, "Title");

    fireEvent.click(titleButton(r.container, "crown_chaser")!);

    await waitFor(() => expect(mockSetTitle).toHaveBeenCalledTimes(1));
    expect(mockSetTitle).toHaveBeenCalledWith("crown_chaser");
    await waitFor(() =>
      expect(mockSetMe).toHaveBeenCalledWith(
        expect.objectContaining({ equipped_title: "champion" }),
      ),
    );
    expect(mockSetMe).not.toHaveBeenCalledWith(
      expect.objectContaining({ equipped_title: "crown_chaser" }),
    );
  });

  it('"No title" clears via setTitle(null) and patches from the response', async () => {
    mockMe.equipped_title = "champion";
    mockGetIdentity.mockResolvedValue(identityFixture([], ["champion"]));
    mockSetTitle.mockResolvedValue({ equipped_title: null });
    const r = render(<IdentityEditor onClose={() => {}} />);
    await openTab(r, "Title");

    fireEvent.click(titleButton(r.container, "none")!);

    await waitFor(() => expect(mockSetTitle).toHaveBeenCalledTimes(1));
    expect(mockSetTitle).toHaveBeenCalledWith(null);
    await waitFor(() =>
      expect(mockSetMe).toHaveBeenCalledWith(expect.objectContaining({ equipped_title: null })),
    );
  });

  it("tapping the CURRENT title does nothing (no API call)", async () => {
    mockMe.equipped_title = "champion";
    mockGetIdentity.mockResolvedValue(identityFixture([], ["champion"]));
    const r = render(<IdentityEditor onClose={() => {}} />);
    await openTab(r, "Title");

    fireEvent.click(titleButton(r.container, "champion")!);
    expect(mockSetTitle).not.toHaveBeenCalled();
  });

  it("locked (unearned) titles are unresponsive — no API call", async () => {
    mockGetIdentity.mockResolvedValue(identityFixture([], [])); // nothing earned
    const r = render(<IdentityEditor onClose={() => {}} />);
    await openTab(r, "Title");

    const locked = titleButton(r.container, "trivia_menace")!;
    expect(locked.disabled).toBe(true);
    fireEvent.click(locked);
    expect(mockSetTitle).not.toHaveBeenCalled();
    expect(mockSetMe).not.toHaveBeenCalled();
  });
});
