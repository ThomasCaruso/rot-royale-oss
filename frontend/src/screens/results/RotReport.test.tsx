// @vitest-environment jsdom
/**
 * Rot Report — the INSTANT personal result card shown the moment the Daily Royale run finishes.
 * Static-markup assertions cover the screenshot-facing content (score / funny title / chips / pending
 * strip) + the copy-honesty guard; jsdom + testing-library cover the Wordle-style share clipboard CTAs.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RotReportData } from "@/lib/rotReport";
import { RotReport } from "@/screens/results/RotReport";

// jsdom lacks matchMedia; useReducedMotion reads it. Stub a non-reduced matcher.
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

// Money/gambling language that must never appear in player-facing copy (DESIGN §7). "players" is
// NOT banned any more — the field is real entries only, so naming them is the honest wording.
const BANNED = /\b(cash|prize|jackpot|bet|wager|gambling)\b/i;

function report(over: Partial<RotReportData> = {}): RotReportData {
  return {
    score: 6,
    total: 8,
    incorrect: 2,
    avgMs: 5800,
    fastestMs: 2100,
    rounds: [true, true, false, true, true, false, true, true],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RotReport — instant personal result content", () => {
  it("shows ROT REPORT, the score out of total, and the score-based funny title", () => {
    const html = renderToStaticMarkup(
      <RotReport report={report()} resultsAt={null} onExit={() => {}} onPractice={() => {}} />,
    );
    expect(html).toContain("ROT REPORT");
    expect(html).toContain("6");
    expect(html).toContain("/ 8");
    expect(html).toContain("Not Cooked Yet"); // 6/8 title
    expect(html).toContain("Prove your brain"); // tagline eyebrow (apostrophe is HTML-escaped)
  });

  it("maps each score to its own title (8 → Final Boss, 0 → Cooked Beyond Repair)", () => {
    const boss = renderToStaticMarkup(
      <RotReport report={report({ score: 8, incorrect: 0, rounds: Array(8).fill(true) })} resultsAt={null} onExit={() => {}} onPractice={() => {}} />,
    );
    expect(boss).toContain("Final Boss");
    const cooked = renderToStaticMarkup(
      <RotReport report={report({ score: 0, incorrect: 8 })} resultsAt={null} onExit={() => {}} onPractice={() => {}} />,
    );
    expect(cooked).toContain("Cooked Beyond Repair");
  });

  it("renders timing chips when present, omits them when absent", () => {
    const withStats = renderToStaticMarkup(
      <RotReport report={report()} resultsAt={null} onExit={() => {}} onPractice={() => {}} />,
    );
    expect(withStats).toContain("5.8s"); // avg
    expect(withStats).toContain("2.1s"); // fastest

    const noStats = renderToStaticMarkup(
      <RotReport
        report={report({ avgMs: null, fastestMs: null })}
        resultsAt={null}
        onExit={() => {}}
        onPractice={() => {}}
      />,
    );
    expect(noStats).not.toContain("Average time"); // chip omitted when no clean timing
  });

  it("renders one tick/cross box per round, in play order", () => {
    // 6/8 with misses at rounds 3 and 6 — the fixture's shape.
    const html = renderToStaticMarkup(
      <RotReport report={report()} resultsAt={null} onExit={() => {}} onPractice={() => {}} />,
    );
    expect(html).toContain("Round by round");
    expect((html.match(/✓/g) ?? []).length).toBe(6);
    expect((html.match(/✕/g) ?? []).length).toBe(2);
    // The row carries an accessible name, so it isn't 8 unlabelled boxes to a screen reader.
    expect(html).toContain("Round by round: 6 of 8 correct");
  });

  it("hides the grid rather than rendering an empty row when there is no per-round data", () => {
    // An older stashed report (written before the grid shipped) coerces `rounds` to [].
    const html = renderToStaticMarkup(
      <RotReport report={report({ rounds: [] })} resultsAt={null} onExit={() => {}} onPractice={() => {}} />,
    );
    expect(html).not.toContain("Round by round");
  });

  it("separates the instant result from the pending daily placement", () => {
    const generic = renderToStaticMarkup(
      <RotReport report={report()} resultsAt={null} onExit={() => {}} onPractice={() => {}} />,
    );
    expect(generic).toContain("Daily placement pending");
    expect(generic).toContain("when the field closes");

    const timed = renderToStaticMarkup(
      <RotReport
        report={report()}
        resultsAt="2026-06-21T00:15:00Z"
        onExit={() => {}}
        onPractice={() => {}}
      />,
    );
    expect(timed).toMatch(/Daily placement finalizes at \d{1,2}:\d{2}/);
  });

  it("shows the honest attempt count when provided, hides it when absent/zero", () => {
    const withAttempts = renderToStaticMarkup(
      <RotReport report={report()} resultsAt={null} attempts={1284} onExit={() => {}} onPractice={() => {}} />,
    );
    expect(withAttempts).toContain("1,284 played today");

    const noAttempts = renderToStaticMarkup(
      <RotReport report={report()} resultsAt={null} attempts={0} onExit={() => {}} onPractice={() => {}} />,
    );
    expect(noAttempts).not.toContain("played today");
  });

  it("uses Wordle-style social copy — never 1v1 challenge language", () => {
    const html = renderToStaticMarkup(
      <RotReport report={report()} resultsAt={null} attempts={5} onExit={() => {}} onPractice={() => {}} />,
    );
    // The single share CTA is present…
    expect(html).toContain("Share Rot Report");
    // …and absolutely no Duel-style direct-challenge language on the Daily card.
    expect(html.toLowerCase()).not.toContain("challenge");
    expect(html.toLowerCase()).not.toContain("beat my score");
    expect(html.toLowerCase()).not.toContain(" vs ");
  });

  it("introduces no banned money/gambling/fake-human copy", () => {
    const html = renderToStaticMarkup(
      <RotReport report={report()} resultsAt="2026-06-21T00:15:00Z" attempts={42} onExit={() => {}} onPractice={() => {}} />,
    );
    const text = html.replace(/<[^>]+>/g, " ");
    expect(BANNED.test(text)).toBe(false);
  });
});

describe("RotReport — navigation", () => {
  it("wires Back to hub / Practice to their callbacks", () => {
    const onExit = vi.fn();
    const onPractice = vi.fn();
    const { getByText } = render(
      <RotReport report={report()} resultsAt={null} onExit={onExit} onPractice={onPractice} />,
    );
    fireEvent.click(getByText("Back to hub"));
    fireEvent.click(getByText("Practice"));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onPractice).toHaveBeenCalledTimes(1);
  });
});
