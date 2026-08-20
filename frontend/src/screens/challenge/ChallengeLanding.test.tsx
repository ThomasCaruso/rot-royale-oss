// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChallengeLanding } from "./ChallengeLanding";
import type { ChallengePublic } from "@/api/client";
import { getTheme } from "@/theme/tokens";

const mockGet = vi.fn();
vi.mock("@/api/client", () => ({
  api: { getChallenge: (...a: unknown[]) => mockGet(...a) },
  ApiError: class ApiError extends Error {},
}));

afterEach(() => {
  cleanup();
  mockGet.mockReset();
});

const snapshot = (over: Partial<ChallengePublic> = {}): ChallengePublic => ({
  id: "aZ3k",
  username: "Tommy",
  contest_no: 142,
  contest_date: "2026-07-09",
  score: 742,
  place: 3,
  field_size: 100,
  percentile: 97,
  playable_window_id: "win-1",
  theme: "starter",
  ...over,
});

describe("ChallengeLanding", () => {
  it("shows the sharer's spoiler-free result + Play CTA, and starts play on tap", async () => {
    mockGet.mockResolvedValue(snapshot());
    const onPlay = vi.fn().mockResolvedValue(undefined);
    render(<ChallengeLanding challengeId="aZ3k" onPlay={onPlay} onSkip={() => {}} />);

    expect(await screen.findByText("Tommy")).toBeTruthy();
    expect(screen.getByText("742")).toBeTruthy();
    expect(screen.getByText(/Top 97% today/i)).toBeTruthy();
    // no spoilers ever
    expect(document.body.textContent).not.toMatch(/\b(answer|option|correct)\b/i);

    fireEvent.click(screen.getByText(/play today's daily royale/i));
    await waitFor(() => expect(onPlay).toHaveBeenCalledWith("win-1"));
  });

  it("offers 'open app' (no Play) when there's no open window to play", async () => {
    mockGet.mockResolvedValue(snapshot({ playable_window_id: null }));
    const onSkip = vi.fn();
    render(<ChallengeLanding challengeId="aZ3k" onPlay={vi.fn()} onSkip={onSkip} />);

    expect(await screen.findByText(/open rot royale/i)).toBeTruthy();
    expect(screen.queryByText(/play today's daily royale/i)).toBeNull();
    fireEvent.click(screen.getByText(/open rot royale/i));
    expect(onSkip).toHaveBeenCalled();
  });

  it("degrades to a friendly 'not found' on a bad id", async () => {
    mockGet.mockRejectedValue(new Error("404"));
    render(<ChallengeLanding challengeId="nope" onPlay={vi.fn()} onSkip={() => {}} />);
    expect(await screen.findByText(/expired or never existed/i)).toBeTruthy();
  });

  it("paints the page in the SHARER's equipped theme, not the visitor's default", async () => {
    mockGet.mockResolvedValue(snapshot({ theme: "royale" }));
    render(<ChallengeLanding challengeId="aZ3k" onPlay={vi.fn()} onSkip={() => {}} />);
    await screen.findByText("Tommy");

    const root = document.documentElement;
    // `royale` is the dark arcade skin — its brand token must be live on the root, and the art
    // style class must follow so shape/typography match too.
    expect(root.style.getPropertyValue("--brand")).toBe(getTheme("royale").vars["--brand"]);
    expect(document.querySelector("main")?.className).toContain("s-arcade");
  });

  it("restores the visitor's own theme when the landing unmounts", async () => {
    // App owns the root vars; the landing must put back exactly what it found, or the sharer's
    // colours leak into the visitor's session (App's theme effect will not re-run).
    document.documentElement.style.setProperty("--brand", "#123456");
    mockGet.mockResolvedValue(snapshot({ theme: "royale" }));
    const view = render(<ChallengeLanding challengeId="aZ3k" onPlay={vi.fn()} onSkip={() => {}} />);
    await screen.findByText("Tommy");
    expect(document.documentElement.style.getPropertyValue("--brand")).not.toBe("#123456");

    view.unmount();
    expect(document.documentElement.style.getPropertyValue("--brand")).toBe("#123456");
  });
});
