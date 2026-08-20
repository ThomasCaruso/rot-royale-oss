// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockUpgrade } = vi.hoisted(() => ({ mockUpgrade: vi.fn() }));
vi.mock("@/api/session", () => ({
  upgradeAccount: (...a: unknown[]) => mockUpgrade(...a),
}));

import { SaveProfileScreen } from "./SaveProfileScreen";
import { useSessionStore } from "@/store/session";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useSessionStore.setState({ me: null } as never);
});

describe("SaveProfileScreen — saving progress, not SaaS signup", () => {
  it("frames the action as saving (streak/rank/Brain Profile) and asks for the three fields", () => {
    render(<SaveProfileScreen onDone={() => {}} onSkip={() => {}} />);
    expect(screen.getByText("Save your Brain Profile")).toBeTruthy();
    // useAiReady defaults to false in tests (no live server) → soft copy shown
    expect(
      screen.getByText(/streak, rank, and your Brain Profile/)
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Username")).toBeTruthy();
    expect(screen.getByPlaceholderText("Password")).toBeTruthy();
    expect(screen.getByText("Not now")).toBeTruthy(); // always skippable
  });

  it("submit upgrades the guest account and completes", async () => {
    mockUpgrade.mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<SaveProfileScreen onDone={onDone} onSkip={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "saved@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Username"), {
      target: { value: "ChosenName" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "super-secret-pw" },
    });
    fireEvent.click(screen.getByText("SAVE PROFILE"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mockUpgrade).toHaveBeenCalledWith(
      "saved@example.com",
      "super-secret-pw",
      "ChosenName"
    );
  });

  it("pre-fills the username with the handle the guest is already playing under", async () => {
    useSessionStore.setState({ me: { username: "rot_swift_fox" } as never });
    render(<SaveProfileScreen onDone={() => {}} onSkip={() => {}} />);
    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText("Username") as HTMLInputElement).value
      ).toBe("rot_swift_fox")
    );
  });

  it("Not now skips without touching the account", () => {
    const onSkip = vi.fn();
    render(<SaveProfileScreen onDone={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByText("Not now"));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(mockUpgrade).not.toHaveBeenCalled();
  });
});
