// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { FriendsTodayBoard } from "./FriendsTodayBoard";

vi.mock("@/api/client", () => ({
  api: {
    friendsBoard: vi.fn(),
    challengeFriendToDaily: vi.fn(async () => ({ ok: true, sent: true })),
    createFriendDuel: vi.fn(async () => ({})),
  },
}));

const BOARD = {
  my_rank: 2,
  friend_field_size: 3,
  played: [
    { user_id: "a", username: "maya", avatar_preset: "p1", equipped_frame: null, score: 940, rank: 1, is_me: false },
    { user_id: "me", username: "you", avatar_preset: "p2", equipped_frame: null, score: 900, rank: 2, is_me: true },
    { user_id: "b", username: "sam", avatar_preset: "p3", equipped_frame: null, score: 800, rank: 3, is_me: false },
  ],
  yet_to_play: [{ user_id: "c", username: "jordan", avatar_preset: "p4" }],
};

describe("FriendsTodayBoard", () => {
  afterEach(() => cleanup());

  it("renders ranked friends with me highlighted + a yet-to-play challenge", async () => {
    vi.mocked(api.friendsBoard).mockResolvedValue(BOARD as never);
    render(<FriendsTodayBoard windowId="w1" />);
    await waitFor(() => expect(screen.getByText("maya")).toBeTruthy());
    expect(screen.getByText("940")).toBeTruthy();
    expect(screen.getByText(/jordan/)).toBeTruthy();

    // Challenge = async "beat my Daily Royale score" nudge, NOT a live duel. Clicking it calls
    // challengeFriendToDaily, flips the label to "Challenge sent", and never starts a friend duel.
    screen.getByRole("button", { name: /challenge/i }).click();
    await waitFor(() => expect(api.challengeFriendToDaily).toHaveBeenCalledWith("jordan"));
    expect(api.createFriendDuel).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Challenge sent")).toBeTruthy());
  });

  it("renders the no-friends invite when the board is empty", async () => {
    vi.mocked(api.friendsBoard).mockResolvedValue({
      my_rank: null, friend_field_size: 0, played: [], yet_to_play: [],
    } as never);
    render(<FriendsTodayBoard windowId="w1" />);
    await waitFor(() => expect(screen.getByText(/Add friends to race them/)).toBeTruthy());
  });
});
