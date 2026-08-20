// @vitest-environment jsdom
/**
 * Daily Royale run-screen framing tests. RoundProgress (4 segments) and RoundBanner render via static
 * markup; ScoreBanked uses jsdom + testing-library so the effect resolves settle_at → a viewer-local
 * "Results at {time}" line (no "ET"). The block math itself is unit-tested in lib/rounds.test.ts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentContest } from "@/api/client";

// jsdom doesn't implement matchMedia; useReducedMotion (in RoundBanner) reads it. Stub a non-reduced
// matcher so the banner renders its animated path.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const { mockCurrentContest } = vi.hoisted(() => ({ mockCurrentContest: vi.fn() }));

vi.mock("@/api/client", () => ({
  api: { currentContest: mockCurrentContest },
  ApiError: class ApiError extends Error {},
}));

import type { RevealData } from "@/lib/pacing";
import { RevealView, RoundProgress, RoundBanner, ScoreBanked } from "@/screens/Contest";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RoundProgress", () => {
  it("renders exactly 4 segments for a 20-round entry (not 20 dots)", () => {
    const html = renderToStaticMarkup(<RoundProgress total={20} current={0} />);
    // Each segment is an outer track div with an inner fill bar. Count the lime/amber fill bars by
    // counting border-radius:4 tracks — assert 4 outer segments via the fixed maxWidth:64 marker.
    const segments = html.match(/max-width:64px/g) ?? [];
    expect(segments.length).toBe(4);
  });

  it("fills completed blocks lime and the active block amber", () => {
    // current=7 → blocks 0 (q0-4) done, block 1 (q5-9) partially done (q5,q6 answered → 2/5).
    const html = renderToStaticMarkup(<RoundProgress total={20} current={7} />);
    expect(html).toContain("var(--lime)"); // at least one completed block
    expect(html).toContain("var(--amber)"); // the in-progress block
  });

  it("still shows 4 segments for a non-20 total (graceful fallback)", () => {
    const html = renderToStaticMarkup(<RoundProgress total={12} current={0} />);
    expect((html.match(/max-width:64px/g) ?? []).length).toBe(4);
  });
});

describe("RoundBanner — block names at the boundaries", () => {
  it("renders the correct block name for each block key", () => {
    expect(renderToStaticMarkup(<RoundBanner blockKey="openingRound" />)).toContain("OPENING ROUND");
    expect(renderToStaticMarkup(<RoundBanner blockKey="pressureRound" />)).toContain(
      "PRESSURE ROUND",
    );
    expect(renderToStaticMarkup(<RoundBanner blockKey="crownClimb" />)).toContain("CROWN CLIMB");
    expect(renderToStaticMarkup(<RoundBanner blockKey="finalCrownRound" />)).toContain(
      "FINAL CROWN ROUND",
    );
  });
});

describe("RevealView — confetti gating + anti-cheat", () => {
  const round = {
    idx: 0,
    type: "trivia",
    client_spec: {
      prompt: "Capital of France?",
      options: ["Paris", "Rome", "Berlin", "Madrid"],
    },
  } as unknown as Parameters<typeof RevealView>[0]["round"];

  function reveal(over: Partial<RevealData> = {}): RevealData {
    return {
      idx: 0,
      correct: true,
      valid: true,
      points: 120,
      answer: { correctIndex: 0 },
      total_score: 120,
      finished: false,
      ...over,
    };
  }

  const render = (rev: RevealData, choice: number | null, celebrate: boolean) =>
    renderToStaticMarkup(
      <RevealView round={round} reveal={rev} choice={choice} celebrate={celebrate} />,
    );

  it("does NOT fire confetti on a plain correct answer (celebrate=false)", () => {
    const html = render(reveal({ correct: true }), 0, false);
    expect(html).toContain("Correct!"); // the per-correct pop + points count-up stay
    expect(html).toContain("120"); // points count-up
    expect(html).not.toContain("<canvas"); // confetti gated off
  });

  it("fires confetti when celebrate=true (milestone streak / final question)", () => {
    const html = render(reveal({ correct: true }), 0, true);
    expect(html).toContain("<canvas");
  });

  it("never fires confetti on a wrong answer", () => {
    // The host would never pass celebrate=true for a wrong answer, but the view also gates by celebrate.
    const html = render(reveal({ correct: false }), 1, false);
    expect(html).not.toContain("<canvas");
  });
});

describe("ScoreBanked", () => {
  function contest(over: Partial<CurrentContest> = {}): CurrentContest {
    return { open_window: null, schedule: [], ...over };
  }

  it("shows Score Locked framing (not the old Score Banked)", async () => {
    mockCurrentContest.mockResolvedValue(contest());
    const { getByText, queryByText } = render(
      <ScoreBanked windowId="w1" onExit={() => {}} onPractice={() => {}} />,
    );
    expect(getByText("SCORE LOCKED")).toBeTruthy();
    expect(queryByText("SCORE BANKED")).toBeNull();
  });

  it("shows a viewer-local results time from settle_at (no ET label)", async () => {
    mockCurrentContest.mockResolvedValue(
      contest({
        schedule: [
          {
            id: "w1",
            slot: "royale",
            state: "OPEN",
            open_at: "2026-06-10T12:00:00Z",
            close_at: "2026-06-11T00:00:00Z",
            settle_at: "2026-06-11T00:15:00Z",
            entry_count: 3,
          },
        ],
      }),
    );
    const { container } = render(
      <ScoreBanked windowId="w1" onExit={() => {}} onPractice={() => {}} />,
    );
    await waitFor(() => {
      expect(container.textContent).toMatch(/Results at \d{2}:\d{2} (AM|PM)\./);
    });
    expect(container.textContent).not.toContain("ET");
  });

  it("falls back to a generic results line when no window time is available", async () => {
    mockCurrentContest.mockResolvedValue(contest()); // no matching window
    const { container } = render(
      <ScoreBanked windowId="w1" onExit={() => {}} onPractice={() => {}} />,
    );
    // Effect resolves with no window → the generic "results settle when the field closes" line.
    await waitFor(() => {
      expect(container.textContent).toContain("field closes");
    });
  });
});
