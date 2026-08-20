// @vitest-environment jsdom
/**
 * VaultScreen flow tests — screen-level buy/equip interaction tests.
 *
 * Contracts verified:
 *   - api.buyVaultItem called exactly once; balance updates from server response (not client math)
 *   - api.equipVaultItem called once; setMe patched with server response.equipped_theme
 *   - Double-submit guard: busy gate prevents a second call while the first is in flight
 *
 * Uses @testing-library/react with jsdom (per-file pragma above). The static card-level
 * tests live in VaultScreen.test.tsx and run in the node environment.
 */
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { VaultItem, VaultResponse } from "@/api/client";

// ---------------------------------------------------------------------------
// Hoisted spies (must be defined before vi.mock factories run)
// ---------------------------------------------------------------------------

const { mockSetMe, mockVault, mockBuyVaultItem, mockEquipVaultItem, mockMe } = vi.hoisted(() => {
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
    avatar_preset: "fox",
    equipped_frame: null,
  };
  return {
    mockSetMe: vi.fn(),
    mockVault: vi.fn(),
    mockBuyVaultItem: vi.fn(),
    mockEquipVaultItem: vi.fn(),
    mockMe,
  };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/store/session", () => {
  // The hook: supports selector-based access (useSessionStore((s) => s.setMe))
  function useSessionStore(selector: (s: unknown) => unknown) {
    return selector({ me: mockMe, setMe: mockSetMe });
  }
  // Imperative getter: useSessionStore.getState().me (used by Fix 4 in VaultScreen)
  useSessionStore.getState = () => ({ me: mockMe, setMe: mockSetMe });
  return { useSessionStore };
});

vi.mock("@/api/client", () => ({
  api: {
    // The 5ms delay is deliberate. A mock that resolves in a microtask lets the catalog appear
    // almost synchronously, so a bad wait-guard passes by luck on an idle machine and only fails
    // under a loaded CI run — which is exactly how this file came to be intermittently red.
    // Forcing a real macrotask makes every run behave like the slow case, so the async path is
    // always exercised and the failure mode can't come back silently. Costs ~5ms per render.
    vault: async (...args: unknown[]) => {
      await new Promise((r) => setTimeout(r, 5));
      return mockVault(...args);
    },
    buyVaultItem: (...args: unknown[]) => mockBuyVaultItem(...args),
    equipVaultItem: (...args: unknown[]) => mockEquipVaultItem(...args),
  },
}));

// Confetti uses canvas APIs not available in jsdom — replace with a no-op
vi.mock("@/ui/Confetti", () => ({ Confetti: () => null }));

// ---------------------------------------------------------------------------
// Component import (after mock declarations)
// ---------------------------------------------------------------------------

import { VaultScreen } from "./VaultScreen";

/**
 * Wait-guard for "the catalog has actually rendered".
 *
 * The previous guard was `section.children.length > 0`, which is TRUE ON FIRST RENDER: VaultScreen
 * renders `{visible === null ? <div>…</div> : cards}` inside that section, so the loading
 * placeholder is itself a child. `waitFor` resolved instantly, before the mocked fetch landed, and
 * the synchronous assertions after it raced — passing alone, failing intermittently under a loaded
 * full-suite run.
 *
 * The loading placeholder is a skeleton block marked `aria-busy`, so "no aria-busy node inside the
 * section" is the precise signal, and it works on every tab (unlike asserting specific card text,
 * which differs between Themes and Frames).
 *
 * Deliberately does NOT also assert the section is non-empty: the gem-frame specs mount with only
 * frame fixtures, so the default Themes tab is legitimately empty until they switch tabs. Emptiness
 * is a valid loaded state; the skeleton is the only thing that means "not ready yet".
 */
function expectCatalogLoaded(container: HTMLElement): void {
  expect(container.querySelector("section [aria-busy]")).toBeNull();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItems(opts?: { midnightOwned?: boolean; midnightEquipped?: boolean }): VaultItem[] {
  return [
    { id: "royale",    kind: "theme", currency: "coins", cost: 0,   owned: true,  equipped: true,                      locked: false, coming_soon: false, requirement: null },
    { id: "daylight",  kind: "theme", currency: "coins", cost: 0,   owned: true,  equipped: false,                     locked: false, coming_soon: false, requirement: null },
    { id: "bubblegum", kind: "theme", currency: "coins", cost: 120, owned: false, equipped: false,                     locked: false, coming_soon: false, requirement: null },
    { id: "forest",    kind: "theme", currency: "coins", cost: 120, owned: false, equipped: false,                     locked: false, coming_soon: false, requirement: null },
    {
      id: "midnight",
      kind: "theme",
      currency: "coins",
      cost: 150,
      owned:    opts?.midnightOwned    ?? false,
      equipped: opts?.midnightEquipped ?? false,
      locked: false,
      coming_soon: false,
      requirement: null,
    },
  ];
}

/** Frame catalog slice: frame_none (free, equipped by default), one paid frame, one gated. */
function makeFrameItems(opts?: {
  noneEquipped?: boolean;
  bronzeOwned?: boolean;
  bronzeEquipped?: boolean;
}): VaultItem[] {
  return [
    {
      id: "frame_none",
      kind: "frame",
      currency: "coins",
      cost: 0,
      owned: true,
      equipped: opts?.noneEquipped ?? true,
      locked: false,
      coming_soon: false,
      requirement: null,
    },
    {
      id: "bronze_ring",
      kind: "frame",
      currency: "coins",
      cost: 60,
      owned:    opts?.bronzeOwned    ?? false,
      equipped: opts?.bronzeEquipped ?? false,
      locked: false,
      coming_soon: false,
      requirement: null,
    },
    { id: "science_orbit", kind: "frame", currency: "coins", cost: 150, owned: false, equipped: false, locked: true, coming_soon: false, requirement: "world:Science" },
  ];
}

/** Gem-priced duel frames (currency "gems"): violet_duel_frame (25), crown_duel_frame (60). */
function makeGemFrameItems(opts?: { violetOwned?: boolean }): VaultItem[] {
  return [
    {
      id: "violet_duel_frame",
      kind: "frame",
      currency: "gems",
      cost: 25,
      owned: opts?.violetOwned ?? false,
      equipped: false,
      locked: false,
      coming_soon: false,
      requirement: null,
    },
    { id: "crown_duel_frame", kind: "frame", currency: "gems", cost: 60, owned: false, equipped: false, locked: false, coming_soon: false, requirement: null },
  ];
}

function vaultResp(items: VaultItem[], balance: number, gems = 0): VaultResponse {
  return { items, coins_balance: balance, gems_balance: gems };
}

/** Click the Frames tab (the segmented control under the header). */
function switchToFrames(container: HTMLElement) {
  const framesTab = Array.from(container.querySelectorAll('button[role="tab"]')).find(
    (b) => b.textContent === "Frames",
  );
  expect(framesTab).toBeDefined();
  fireEvent.click(framesTab!);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default vault: balance 200, midnight affordable (costs 150), daylight owned+unequipped,
  // plus the frame slice (frame_none equipped, bronze_ring affordable, science_orbit gated).
  mockVault.mockResolvedValue(
    vaultResp([...makeItems(), ...makeFrameItems(), ...makeGemFrameItems()], 200, 40),
  );
  mockBuyVaultItem.mockResolvedValue({
    item_id: "midnight",
    currency: "coins",
    coins_balance: 57,
    gems_balance: 40,
  });
  mockEquipVaultItem.mockResolvedValue({ equipped_theme: "midnight", equipped_frame: null });
});

// ---------------------------------------------------------------------------
// 1. Buy flow
// ---------------------------------------------------------------------------

describe("VaultScreen — buy flow", () => {
  it("calls api.buyVaultItem exactly once and shows server balance (57, not 200-150=50)", async () => {
    // First call: initial load. Second call: post-buy refetch (midnight now owned, balance 57).
    mockVault
      .mockResolvedValueOnce(vaultResp(makeItems(), 200))
      .mockResolvedValueOnce(vaultResp(makeItems({ midnightOwned: true }), 57));

    const { container } = render(<VaultScreen onBack={() => {}} />);

    // Wait for items to render
    await waitFor(() => {
      expectCatalogLoaded(container);
    });

    // Click midnight's Unlock CTA (opens confirm sheet)
    const unlockBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent?.includes("Unlock") && !b.disabled,
    );
    expect(unlockBtns.length).toBeGreaterThan(0);
    fireEvent.click(unlockBtns[unlockBtns.length - 1]);

    // Wait for confirm sheet; click the confirm Unlock button inside it
    const confirmBtn = await waitFor(() => {
      const btns = Array.from(container.querySelectorAll("button")).filter(
        (b) => b.textContent?.includes("Unlock") && !b.disabled,
      );
      expect(btns.length).toBeGreaterThanOrEqual(1);
      return btns[btns.length - 1];
    });
    fireEvent.click(confirmBtn);

    // Assert: buyVaultItem called exactly once with "midnight"
    await waitFor(() => {
      expect(mockBuyVaultItem).toHaveBeenCalledTimes(1);
    });
    expect(mockBuyVaultItem).toHaveBeenCalledWith("midnight");

    // Balance pill must show 57 (server value), not the arithmetic result 200-150=50
    await waitFor(() => {
      const spans = Array.from(container.querySelectorAll("span"));
      expect(spans.some((s) => s.textContent?.trim() === "57")).toBe(true);
    });

    // setMe must have been called with coins_balance: 57
    expect(mockSetMe).toHaveBeenCalledWith(expect.objectContaining({ coins_balance: 57 }));
  });

  it("double-submit guard: clicking confirm twice calls buyVaultItem exactly once", async () => {
    // Buy hangs (pending promise) so we can click a second time before it resolves
    let resolveBuy!: (v: {
      item_id: string;
      currency: string;
      coins_balance: number;
      gems_balance: number;
    }) => void;
    mockVault.mockResolvedValue(vaultResp(makeItems(), 200));
    mockBuyVaultItem.mockImplementation(
      () =>
        new Promise<{
          item_id: string;
          currency: string;
          coins_balance: number;
          gems_balance: number;
        }>((resolve) => {
          resolveBuy = resolve;
        }),
    );

    const { container } = render(<VaultScreen onBack={() => {}} />);

    await waitFor(() => {
      expectCatalogLoaded(container);
    });

    const unlockBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent?.includes("Unlock") && !b.disabled,
    );
    fireEvent.click(unlockBtns[unlockBtns.length - 1]);

    const confirmBtn = await waitFor(() => {
      const btns = Array.from(container.querySelectorAll("button")).filter(
        (b) => b.textContent?.includes("Unlock") && !b.disabled,
      );
      return btns[btns.length - 1];
    });

    // First click — buy starts, button becomes disabled
    fireEvent.click(confirmBtn);
    // Second click — button is disabled (busy=true), so this should be a no-op
    fireEvent.click(confirmBtn);

    // Resolve the pending buy
    await act(async () => {
      resolveBuy({ item_id: "midnight", currency: "coins", coins_balance: 57, gems_balance: 200 });
    });

    // buyVaultItem must have been called exactly once despite two clicks
    await waitFor(() => {
      expect(mockBuyVaultItem).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Equip flow
// ---------------------------------------------------------------------------

describe("VaultScreen — equip flow", () => {
  it("calls api.equipVaultItem once and patches setMe with server equipped_theme", async () => {
    // daylight is owned+unequipped → shows an Equip button
    mockVault
      .mockResolvedValueOnce(vaultResp(makeItems(), 200))
      .mockResolvedValueOnce(vaultResp(makeItems(), 200)); // post-equip refetch

    const { container } = render(<VaultScreen onBack={() => {}} />);

    await waitFor(() => {
      expectCatalogLoaded(container);
    });

    // Find the Equip button (daylight is owned+unequipped)
    const equipBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Equip",
    );
    expect(equipBtns.length).toBeGreaterThan(0);
    fireEvent.click(equipBtns[0]);

    await waitFor(() => {
      expect(mockEquipVaultItem).toHaveBeenCalledTimes(1);
    });
    expect(mockEquipVaultItem).toHaveBeenCalledWith("daylight");

    // setMe must carry BOTH server-returned fields (the equip response is the full post-equip
    // profile slice) — a theme equip also re-asserts the frame from the server.
    expect(mockSetMe).toHaveBeenCalledWith(
      expect.objectContaining({ equipped_theme: "midnight", equipped_frame: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Frames tab
// ---------------------------------------------------------------------------

describe("VaultScreen — frames tab", () => {
  it("switching to the Frames tab swaps the list to frame cards (with a per-tab spotlight)", async () => {
    const { container } = render(<VaultScreen onBack={() => {}} />);

    await waitFor(() => {
      expectCatalogLoaded(container);
    });

    // Themes tab (default): theme cards, no frame names
    expect(container.textContent).toContain("Midnight Arcade");
    expect(container.textContent).not.toContain("Bronze Ring");

    switchToFrames(container);

    // Frames tab: frame cards (names from identity.ts), themes gone
    expect(container.textContent).toContain("Bronze Ring");
    expect(container.textContent).not.toContain("Midnight Arcade");
    // bronze_ring (60) is the cheapest affordable unowned FRAME → it gets this tab's spotlight
    expect(container.textContent).toContain("Next unlock");
    // The gated frame shows its goal-framed requirement copy
    expect(container.textContent).toContain("Complete the Science campaign");
  });

  it("buying a frame calls buyVaultItem once and shows the SERVER balance (31, not 200-60=140)", async () => {
    mockVault
      .mockResolvedValueOnce(vaultResp([...makeItems(), ...makeFrameItems()], 200))
      .mockResolvedValueOnce(
        vaultResp([...makeItems(), ...makeFrameItems({ bronzeOwned: true })], 31),
      );
    mockBuyVaultItem.mockResolvedValue({
      item_id: "bronze_ring",
      currency: "coins",
      coins_balance: 31,
      gems_balance: 0,
    });

    const { container } = render(<VaultScreen onBack={() => {}} />);
    await waitFor(() => {
      expectCatalogLoaded(container);
    });
    switchToFrames(container);

    // Click bronze_ring's Unlock CTA (the card button carries the cost "60")
    const unlockBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Unlock") && b.textContent.includes("60") && !b.disabled,
    );
    expect(unlockBtn).toBeDefined();
    fireEvent.click(unlockBtn!);

    // Confirm sheet → its GoldButton says exactly "Unlock"
    const confirmBtn = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Unlock" && !b.disabled,
      );
      expect(btn).toBeDefined();
      return btn!;
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockBuyVaultItem).toHaveBeenCalledTimes(1);
    });
    expect(mockBuyVaultItem).toHaveBeenCalledWith("bronze_ring");

    // Balance pill shows the surprising server value 31, never client math (200-60=140)
    await waitFor(() => {
      const spans = Array.from(container.querySelectorAll("span"));
      expect(spans.some((s) => s.textContent?.trim() === "31")).toBe(true);
    });
    expect(mockSetMe).toHaveBeenCalledWith(expect.objectContaining({ coins_balance: 31 }));
  });

  it("equipping a frame calls equipVaultItem once and setMe receives BOTH fields from the response", async () => {
    // bronze_ring owned+unequipped → shows Equip on the frames tab
    mockVault.mockResolvedValue(
      vaultResp([...makeItems(), ...makeFrameItems({ bronzeOwned: true })], 140),
    );
    mockEquipVaultItem.mockResolvedValue({
      equipped_theme: "royale",
      equipped_frame: "bronze_ring",
    });

    const { container } = render(<VaultScreen onBack={() => {}} />);
    await waitFor(() => {
      expectCatalogLoaded(container);
    });
    switchToFrames(container);

    const equipBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Equip",
    );
    expect(equipBtns.length).toBe(1); // only bronze_ring is owned+unequipped on this tab
    fireEvent.click(equipBtns[0]);

    await waitFor(() => {
      expect(mockEquipVaultItem).toHaveBeenCalledTimes(1);
    });
    expect(mockEquipVaultItem).toHaveBeenCalledWith("bronze_ring");

    // The store patch must carry BOTH fields from the server response — this is what makes the
    // header avatar re-render with the new frame instantly.
    expect(mockSetMe).toHaveBeenCalledWith(
      expect.objectContaining({ equipped_theme: "royale", equipped_frame: "bronze_ring" }),
    );
  });

  it("equipping frame_none patches setMe with equipped_frame: null (server clears the frame)", async () => {
    // bronze_ring equipped → frame_none is owned+unequipped and shows the only Equip button
    mockVault.mockResolvedValue(
      vaultResp(
        [...makeItems(), ...makeFrameItems({ noneEquipped: false, bronzeOwned: true, bronzeEquipped: true })],
        140,
      ),
    );
    mockEquipVaultItem.mockResolvedValue({ equipped_theme: "royale", equipped_frame: null });

    const { container } = render(<VaultScreen onBack={() => {}} />);
    await waitFor(() => {
      expectCatalogLoaded(container);
    });
    switchToFrames(container);

    const equipBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Equip",
    );
    expect(equipBtns.length).toBe(1); // frame_none
    fireEvent.click(equipBtns[0]);

    await waitFor(() => {
      expect(mockEquipVaultItem).toHaveBeenCalledTimes(1);
    });
    expect(mockEquipVaultItem).toHaveBeenCalledWith("frame_none");
    expect(mockSetMe).toHaveBeenCalledWith(
      expect.objectContaining({ equipped_frame: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Gem-priced frames — the duel-cosmetic tier (currency "gems")
// ---------------------------------------------------------------------------

describe("VaultScreen — Gem frames", () => {
  it("renders the two Gem frames under the distinct Gem-tier header on the Frames tab", async () => {
    mockVault.mockResolvedValue(
      vaultResp([...makeItems(), ...makeFrameItems(), ...makeGemFrameItems()], 200, 100),
    );

    const { container } = render(<VaultScreen onBack={() => {}} />);
    await waitFor(() => {
      expectCatalogLoaded(container);
    });
    switchToFrames(container);

    // The Gem tier section header (t.vault.rarity.gem = "Duel Gems") + both Gem frame names.
    expect(container.textContent).toContain("Duel Gems");
    expect(container.textContent).toContain("Duelist's Edge"); // violet_duel_frame
    expect(container.textContent).toContain("Crown Duelist"); // crown_duel_frame
  });

  it("a Gem frame is affordable from the Gem wallet even when coins are 0", async () => {
    // coins 0, gems 100 → the 25-Gem violet frame is affordable; its Unlock CTA is enabled.
    mockVault.mockResolvedValue(vaultResp([...makeGemFrameItems()], 0, 100));

    const { container } = render(<VaultScreen onBack={() => {}} />);
    await waitFor(() => {
      expectCatalogLoaded(container);
    });
    switchToFrames(container);

    const unlockBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Unlock") && b.textContent.includes("25") && !b.disabled,
    );
    expect(unlockBtn).toBeDefined();
  });

  it("a Gem frame shows the Gem shortfall (not coins) when Gems are short, regardless of coins", async () => {
    // coins 9999 (irrelevant), gems 10 → the 25-Gem frame is locked behind a Gem shortfall of 15.
    mockVault.mockResolvedValue(vaultResp([...makeGemFrameItems()], 9999, 10));

    const { container } = render(<VaultScreen onBack={() => {}} />);
    await waitFor(() => {
      expectCatalogLoaded(container);
    });
    switchToFrames(container);

    expect(container.textContent).toContain("more Gems"); // Gem shortfall copy
    // Massive coin balance must NOT make the Gem frame affordable.
    const enabledUnlock = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Unlock") && b.textContent.includes("25") && !b.disabled,
    );
    expect(enabledUnlock).toBeUndefined();
  });

  it("buying a Gem frame patches the Gem balance from the response (gem pill updates to 75)", async () => {
    // Start: gems 100. Buy violet_duel_frame (25 Gems) → server returns gems_balance 75.
    mockVault
      .mockResolvedValueOnce(vaultResp([...makeGemFrameItems()], 0, 100))
      .mockResolvedValueOnce(vaultResp([...makeGemFrameItems({ violetOwned: true })], 0, 75));
    mockBuyVaultItem.mockResolvedValue({
      item_id: "violet_duel_frame",
      currency: "gems",
      coins_balance: 0,
      gems_balance: 75,
    });

    const { container } = render(<VaultScreen onBack={() => {}} />);
    await waitFor(() => {
      expectCatalogLoaded(container);
    });
    switchToFrames(container);

    // The gem pill starts at 100.
    await waitFor(() => {
      const spans = Array.from(container.querySelectorAll("span"));
      expect(spans.some((s) => s.textContent?.trim() === "100")).toBe(true);
    });

    // Click the 25-Gem Unlock CTA, then confirm.
    const unlockBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Unlock") && b.textContent.includes("25") && !b.disabled,
    );
    expect(unlockBtn).toBeDefined();
    fireEvent.click(unlockBtn!);

    const confirmBtn = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Unlock" && !b.disabled,
      );
      expect(btn).toBeDefined();
      return btn!;
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockBuyVaultItem).toHaveBeenCalledTimes(1);
    });
    expect(mockBuyVaultItem).toHaveBeenCalledWith("violet_duel_frame");

    // The gem pill now shows the server's post-debit Gem balance, 75.
    await waitFor(() => {
      const spans = Array.from(container.querySelectorAll("span"));
      expect(spans.some((s) => s.textContent?.trim() === "75")).toBe(true);
    });
    // setMe patched with the new gem balance (coins untouched at 0).
    expect(mockSetMe).toHaveBeenCalledWith(
      expect.objectContaining({ coins_balance: 0, gems_balance: 75 }),
    );
  });
});
