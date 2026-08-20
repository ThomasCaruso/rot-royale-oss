// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockUpgrade, mockBeacon } = vi.hoisted(() => ({
  mockUpgrade: vi.fn(),
  mockBeacon: vi.fn(),
}));
vi.mock("@/api/session", () => ({
  upgradeAccount: (...a: unknown[]) => mockUpgrade(...a),
}));
vi.mock("@/lib/analytics", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/analytics")>();
  return {
    ...real,
    trackFunnel: (...a: unknown[]) => mockBeacon("track", ...a),
    trackFunnelOnce: (...a: unknown[]) => mockBeacon("once", ...a),
  };
});

import { RankedSaveGate } from "./RankedSaveGate";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RankedSaveGate — lock in an earned ranked score, never a wall", () => {
  it("frames the gate as saving earned progress (no hostile copy) and offers Later", () => {
    render(<RankedSaveGate onDone={() => {}} onLater={() => {}} />);
    expect(screen.getByText("Your score is ready")).toBeTruthy();
    expect(screen.getByText(/lock in your rank/)).toBeTruthy();
    expect(screen.getByText("Later")).toBeTruthy();
    // The words we promised never to show:
    expect(screen.queryByText(/account required/i)).toBeNull();
    expect(screen.queryByText(/please register/i)).toBeNull();
    expect(screen.queryByText(/login to continue/i)).toBeNull();
    // Funnel: the gate view is recorded.
    expect(mockBeacon).toHaveBeenCalledWith("once", "ranked_save_gate_viewed");
  });

  it("Later continues to the run report without touching the account", () => {
    const onLater = vi.fn();
    render(<RankedSaveGate onDone={() => {}} onLater={onLater} />);
    fireEvent.click(screen.getByText("Later"));
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(mockUpgrade).not.toHaveBeenCalled();
  });

  it("saving upgrades the account and records ranked_save_completed", async () => {
    mockUpgrade.mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<RankedSaveGate onDone={onDone} onLater={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "locked@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Username"), {
      target: { value: "LockedIn" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "super-secret-pw" },
    });
    fireEvent.click(screen.getByText("SAVE PROFILE"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mockUpgrade).toHaveBeenCalledWith(
      "locked@example.com",
      "super-secret-pw",
      "LockedIn"
    );
    expect(mockBeacon).toHaveBeenCalledWith("track", "ranked_save_completed");
  });
});
