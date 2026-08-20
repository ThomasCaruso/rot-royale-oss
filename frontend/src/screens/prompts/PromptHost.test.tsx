// @vitest-environment jsdom
/**
 * PromptHost behaviour. The rules that matter are about RESTRAINT — when NOT to ask — because a
 * permission alert is one-shot per install and a rating ask that arrives too early is spent.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above module scope, so the spies have to be created inside vi.hoisted.
const { nextPrompt, ackPrompt, enablePush, openStoreReview } = vi.hoisted(() => ({
  nextPrompt: vi.fn(),
  ackPrompt: vi.fn(),
  enablePush: vi.fn(),
  openStoreReview: vi.fn(),
}));

vi.mock("@/api/client", () => ({ api: { nextPrompt, ackPrompt } }));
vi.mock("@/lib/push", () => ({ enablePush }));
vi.mock("@/lib/review", () => ({ openStoreReview }));

import { PromptHost } from "./PromptHost";

describe("PromptHost", () => {
  beforeEach(() => {
    nextPrompt.mockReset();
    ackPrompt.mockReset();
    ackPrompt.mockResolvedValue(undefined);
    enablePush.mockReset();
    enablePush.mockResolvedValue("subscribed");
    openStoreReview.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks nothing while a run is on screen", () => {
    nextPrompt.mockResolvedValue({ prompt: "enable_notifications", runs: 1 });
    render(<PromptHost active={false} />);
    // Not even fetched: interrupting a scored run to ask a favour is the worst possible moment.
    expect(nextPrompt).not.toHaveBeenCalled();
  });

  it("shows nothing when the server has nothing to ask", async () => {
    nextPrompt.mockResolvedValue({ prompt: null, runs: 0 });
    render(<PromptHost active={true} />);
    await waitFor(() => expect(nextPrompt).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers the notification opt-in and enables push on accept", async () => {
    nextPrompt.mockResolvedValue({ prompt: "enable_notifications", runs: 1 });
    render(<PromptHost active={true} />);

    const cta = await screen.findByText("Turn on reminders");
    await act(async () => { fireEvent.click(cta); });

    await waitFor(() => expect(enablePush).toHaveBeenCalled());
    expect(ackPrompt).toHaveBeenCalledWith("enable_notifications", true);
  });

  it("records a decline so it is never asked again", async () => {
    nextPrompt.mockResolvedValue({ prompt: "enable_notifications", runs: 1 });
    render(<PromptHost active={true} />);

    const no = await screen.findByText("Not now");
    await act(async () => { fireEvent.click(no); });

    expect(enablePush).not.toHaveBeenCalled();
    expect(ackPrompt).toHaveBeenCalledWith("enable_notifications", false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the store for the rating ask", async () => {
    nextPrompt.mockResolvedValue({ prompt: "rate_app", runs: 3 });
    render(<PromptHost active={true} />);

    const rate = await screen.findByText("Rate the app");
    await act(async () => { fireEvent.click(rate); });

    expect(openStoreReview).toHaveBeenCalled();
    expect(ackPrompt).toHaveBeenCalledWith("rate_app", true);
  });

  it("routes an unhappy player to feedback instead of burning a review prompt", async () => {
    // Apple allows only three review prompts per player per year and reports nothing about what
    // happened. Spending one on someone who says "not really" wastes it and invites a bad review.
    nextPrompt.mockResolvedValue({ prompt: "rate_app", runs: 3 });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<PromptHost active={true} />);

    const no = await screen.findByText("Not really");
    await act(async () => { fireEvent.click(no); });

    expect(openStoreReview).not.toHaveBeenCalled();
    expect(ackPrompt).not.toHaveBeenCalled(); // still open — the ask became a conversation
    const send = await screen.findByText("Send feedback");
    await act(async () => { fireEvent.click(send); });

    expect(open).toHaveBeenCalledWith("/support", "_blank");
    expect(ackPrompt).toHaveBeenCalledWith("rate_app", false); // never counted as a rating
    open.mockRestore();
  });

  it("renders nothing for a prompt id this build does not know", async () => {
    // Forward compatibility: a NEW prompt shipped to newer clients must be silently ignored here,
    // not rendered as an empty box. The reverse of this rule is what broke the shipped app in §5f.
    nextPrompt.mockResolvedValue({ prompt: "some_future_prompt", runs: 9 });
    render(<PromptHost active={true} />);
    await waitFor(() => expect(nextPrompt).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("survives the endpoint failing", async () => {
    nextPrompt.mockRejectedValue(new Error("offline"));
    render(<PromptHost active={true} />);
    await waitFor(() => expect(nextPrompt).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
