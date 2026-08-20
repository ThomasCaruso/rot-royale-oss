// @vitest-environment jsdom
/**
 * ProfileMenu account-deletion flow (jsdom + @testing-library/react).
 *
 * This is the regression guard for Apple Guideline 5.1.1(v): the app was rejected because the
 * (already-working) "Delete account" control was too faint to find in review. These tests lock in
 * that the control is:
 *   - present and reachable by its accessible name (a real, findable button — not fine print),
 *   - a two-step confirm (Apple allows a confirmation step to prevent accidental deletion),
 *   - wired to api.deleteAccount() then signOut() on confirm, and cancellable.
 */
import { cleanup, render, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";

const { mockDeleteAccount, mockDuelStats, mockSignOut } = vi.hoisted(() => ({
  mockDeleteAccount: vi.fn(),
  mockDuelStats: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  api: {
    // Secondary status block — kept rejecting so the section stays out of the way of this test.
    duelStats: (...args: unknown[]) => mockDuelStats(...args),
    deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
  },
}));

vi.mock("@/api/session", () => ({ signOut: (...args: unknown[]) => mockSignOut(...args) }));

// Push state resolves to a benign default so the reminders block renders without native hooks.
vi.mock("@/lib/push", () => ({
  getPushState: () => Promise.resolve("default"),
  enablePush: () => Promise.resolve("subscribed"),
  disablePush: () => Promise.resolve("default"),
}));

import { ProfileMenu } from "./ProfileMenu";

function renderMenu() {
  return render(
    <ProfileMenu username="Tester" onClose={() => {}} />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileMenu — account deletion", () => {
  it("exposes a findable Delete account control by its accessible name", () => {
    mockDuelStats.mockRejectedValue(new Error("no duel stats"));
    const { getByRole } = renderMenu();
    // getByRole would throw if the control were absent or unlabeled — that is the discoverability guard.
    expect(getByRole("button", { name: en.home.deleteAccount })).toBeTruthy();
  });

  it("requires a two-step confirm and deletes then signs out", async () => {
    mockDuelStats.mockRejectedValue(new Error("no duel stats"));
    mockDeleteAccount.mockResolvedValue({ ok: true });
    const { getByRole, getByText } = renderMenu();

    fireEvent.click(getByRole("button", { name: en.home.deleteAccount }));
    // The confirm copy + the destructive action appear only after the first tap.
    expect(getByText(en.home.deleteConfirm)).toBeTruthy();
    expect(mockDeleteAccount).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(getByRole("button", { name: en.home.deleteConfirmBtn }));
    });

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  });

  it("cancels back to idle without calling the API", () => {
    mockDuelStats.mockRejectedValue(new Error("no duel stats"));
    const { getByRole, queryByText } = renderMenu();

    fireEvent.click(getByRole("button", { name: en.home.deleteAccount }));
    fireEvent.click(getByRole("button", { name: en.home.deleteCancel }));

    expect(queryByText(en.home.deleteConfirm)).toBeNull();
    expect(getByRole("button", { name: en.home.deleteAccount })).toBeTruthy();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });
});
