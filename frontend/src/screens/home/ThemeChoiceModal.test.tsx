// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted spies (defined before the vi.mock factories run).
const { mockSetMe, mockEquipVaultItem, mockMe } = vi.hoisted(() => ({
  mockSetMe: vi.fn(),
  mockEquipVaultItem: vi.fn(),
  mockMe: { user_id: "u1", equipped_theme: "starter", equipped_frame: null },
}));

vi.mock("@/store/session", () => {
  function useSessionStore(selector: (s: unknown) => unknown) {
    return selector({ me: mockMe, setMe: mockSetMe });
  }
  useSessionStore.getState = () => ({ me: mockMe, setMe: mockSetMe });
  return { useSessionStore };
});

vi.mock("@/api/client", () => ({
  api: { equipVaultItem: (...args: unknown[]) => mockEquipVaultItem(...args) },
}));

import { ThemeChoiceModal } from "./ThemeChoiceModal";

afterEach(() => {
  cleanup();
  mockSetMe.mockReset();
  mockEquipVaultItem.mockReset();
  mockMe.equipped_theme = "starter";
});

describe("ThemeChoiceModal — first-login pick-your-theme", () => {
  it("previews both default themes and offers one Continue action", () => {
    const { getByText } = render(<ThemeChoiceModal onDone={() => {}} />);
    expect(getByText("Pick your look")).toBeTruthy();
    expect(getByText("Starter")).toBeTruthy();
    expect(getByText("Minimal Light")).toBeTruthy();
    expect(getByText("Continue")).toBeTruthy();
  });

  it("picking Minimal Light equips it (equipVaultItem + setMe) and dismisses", async () => {
    mockEquipVaultItem.mockResolvedValue({ equipped_theme: "blank_light", equipped_frame: null });
    const onDone = vi.fn();
    const { getByText } = render(<ThemeChoiceModal onDone={onDone} />);

    fireEvent.click(getByText("Minimal Light"));
    fireEvent.click(getByText("Continue"));

    await waitFor(() => expect(mockEquipVaultItem).toHaveBeenCalledWith("blank_light"));
    expect(mockSetMe).toHaveBeenCalledWith(
      expect.objectContaining({ equipped_theme: "blank_light" }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("keeping the already-equipped theme skips the equip call but still dismisses", async () => {
    const onDone = vi.fn();
    const { getByText } = render(<ThemeChoiceModal onDone={onDone} />);

    // Starter is equipped by default → Continue without changing selection.
    fireEvent.click(getByText("Continue"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mockEquipVaultItem).not.toHaveBeenCalled();
  });

  it("an equip failure never traps the player — it still dismisses", async () => {
    mockEquipVaultItem.mockRejectedValue(new Error("offline"));
    const onDone = vi.fn();
    const { getByText } = render(<ThemeChoiceModal onDone={onDone} />);

    fireEvent.click(getByText("Minimal Light"));
    fireEvent.click(getByText("Continue"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
