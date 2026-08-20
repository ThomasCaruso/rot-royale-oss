// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Friend } from "@/api/client";
import { RivalCard } from "./RivalCard";

const rival: Friend = {
  user_id: "r1", username: "ava", avatar_preset: "ninja", wins: 3, losses: 1,
  streak: 3, last_result: "won", last_played: new Date().toISOString(), duels_14d: 4,
  equipped_frame: null, equipped_title: null,
};

describe("RivalCard", () => {
  afterEach(() => cleanup());

  it("shows the rival record, streak, and a settle-the-score button", () => {
    const onSettle = vi.fn();
    render(<RivalCard rival={rival} onSettle={onSettle} />);
    expect(screen.getByText("ava")).toBeTruthy();
    expect(screen.getByText(/You lead 3.1/)).toBeTruthy();
    expect(screen.getByText(/won 3 straight/)).toBeTruthy();
    screen.getByRole("button", { name: /settle the score/i }).click();
    expect(onSettle).toHaveBeenCalled();
  });
});
