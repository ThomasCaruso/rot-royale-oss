// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { FriendsTodayModal } from "./FriendsTodayModal";

vi.mock("@/api/client", () => ({
  api: { friendsBoard: vi.fn(), createFriendDuel: vi.fn(async () => ({})) },
}));

const BOARD = {
  my_rank: 1,
  friend_field_size: 2,
  played: [
    { user_id: "me", username: "you", avatar_preset: "knight", equipped_frame: null, score: 900, rank: 1, is_me: true },
    { user_id: "b", username: "sam", avatar_preset: "rook", equipped_frame: null, score: 800, rank: 2, is_me: false },
  ],
  yet_to_play: [],
};

describe("FriendsTodayModal", () => {
  afterEach(() => cleanup());

  it("renders the daily board inside the popup", async () => {
    vi.mocked(api.friendsBoard).mockResolvedValue(BOARD as never);
    render(<FriendsTodayModal windowId="w1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("sam")).toBeTruthy());
    expect(api.friendsBoard).toHaveBeenCalledWith("w1");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes via the ✕ button", async () => {
    vi.mocked(api.friendsBoard).mockResolvedValue(BOARD as never);
    const onClose = vi.fn();
    render(<FriendsTodayModal windowId="w1" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    vi.mocked(api.friendsBoard).mockResolvedValue(BOARD as never);
    const onClose = vi.fn();
    render(<FriendsTodayModal windowId="w1" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
