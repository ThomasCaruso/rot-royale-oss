// @vitest-environment jsdom
/**
 * The viral-loop share: when a real challenge link is present, tapping Share must fire
 * navigator.share with that `…/c/<id>` URL and a spoiler-free "beat my {score}" recruit text.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RotReport } from "./RotReport";
import type { RotReportData } from "@/lib/rotReport";

afterEach(() => cleanup());

const report: RotReportData = {
  score: 6,
  total: 8,
  incorrect: 2,
  avgMs: null,
  fastestMs: null,
  rounds: [true, true, false, true, true, false, true, true],
};

function renderReport(props: Partial<React.ComponentProps<typeof RotReport>> = {}) {
  return render(
    <RotReport
      report={report}
      resultsAt={null}
      onExit={() => {}}
      onPractice={() => {}}
      {...props}
    />,
  );
}

describe("RotReport share — viral loop", () => {
  it("shares the real challenge link + score-only beat text when a challenge exists", () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: shareSpy });

    renderReport({ challengeUrl: "https://x.test/c/aZ3k", challengeScore: 742, challengeNo: 142 });
    fireEvent.click(screen.getByText(/share/i));

    expect(shareSpy).toHaveBeenCalledTimes(1);
    const arg = shareSpy.mock.calls[0][0];
    expect(arg.url).toBe("https://x.test/c/aZ3k");
    expect(arg.text).toContain("https://x.test/c/aZ3k");
    expect(arg.text).toContain("742"); // the point score to beat
    expect(arg.text).not.toMatch(/\b(correctindex|answer|option)\b/i); // spoiler-free
    vi.unstubAllGlobals();
  });

  it("falls back to the neutral app link when no challenge is present (tests/offline)", () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: shareSpy });

    renderReport();
    fireEvent.click(screen.getByText(/share/i));

    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy.mock.calls[0][0].text).not.toContain("/c/"); // no per-result challenge link
    vi.unstubAllGlobals();
  });
});

describe("RotReport share — the Wordle-style grid", () => {
  it("puts the tick/cross row in the shared text, in play order", () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: shareSpy });

    renderReport();
    fireEvent.click(screen.getByText(/share/i));

    const text = shareSpy.mock.calls[0][0].text as string;
    // Same run as the fixture: 6/8 with misses at rounds 3 and 6.
    expect(text).toContain("✅✅❌✅✅❌✅✅");
    // It says WHERE the run broke, never what the answer was — safe to paste before a friend plays.
    expect(text).not.toMatch(/\b(correctindex|answer|option)\b/i);
    vi.unstubAllGlobals();
  });

  it("omits the row entirely rather than emitting a blank line when there is no per-round data", () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: shareSpy });

    renderReport({ report: { ...report, rounds: [] } });
    fireEvent.click(screen.getByText(/share/i));

    const text = shareSpy.mock.calls[0][0].text as string;
    expect(text).not.toMatch(/[✅❌]/u);
    expect(text).not.toContain("\n\n"); // no empty stat line left behind
    vi.unstubAllGlobals();
  });
});
