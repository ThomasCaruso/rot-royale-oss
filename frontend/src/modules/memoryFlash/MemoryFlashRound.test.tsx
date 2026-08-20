// @vitest-environment jsdom
/**
 * MemoryFlashRound (Simon). Pins the two clear phases — "Watch" (no live timer) → "Your turn" (timer
 * + tappable tiles) — and that the player's taps are recorded and submitted without the client ever
 * being told whether they were right (server-validated; anti-cheat).
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryFlashRound, type MemoryFlashSpec } from "@/modules/memoryFlash/MemoryFlashRound";

const spec: MemoryFlashSpec = {
  sequence: [0, 2],
  tiles: 6,
  category: "Memory",
  icon: "🧠",
  time_limit_ms: 10000,
};

afterEach(cleanup);

describe("MemoryFlashRound — phases", () => {
  it("opens in the Watch phase with tiles disabled and no live timer", () => {
    vi.useFakeTimers();
    const { getByText, getAllByRole } = render(
      <MemoryFlashRound spec={spec} onComplete={() => {}} />,
    );
    expect(getByText("Watch")).toBeTruthy();
    // Tiles are not yet interactive while watching.
    expect(getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    vi.useRealTimers();
  });

  it("after the show timeline it becomes Your turn; taps record + submit, no correctness shown", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const { getByText, getByLabelText } = render(
      <MemoryFlashRound spec={spec} onComplete={onComplete} />,
    );

    // Run out the show timeline (2 tiles: ~400 + 2*620 + 150 ≈ 1810ms). Advance generously.
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(getByText("Your turn")).toBeTruthy();

    // Tap the full sequence; the round submits the taps (it never reveals right/wrong here).
    fireEvent.click(getByLabelText("tile 0"));
    fireEvent.click(getByLabelText("tile 2"));
    act(() => {
      vi.advanceTimersByTime(500); // the ~400ms submit beat
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ taps: [0, 2] });
    vi.useRealTimers();
  });
});

describe("MemoryFlashRound — pip semantics (tap count, not correctness)", () => {
  it("onComplete payload has no correctness field — correctness is server-side only", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const { getByLabelText } = render(
      <MemoryFlashRound spec={spec} onComplete={onComplete} />,
    );

    // Advance past the show phase.
    act(() => {
      vi.advanceTimersByTime(2200);
    });

    // Tap full sequence and wait for the submit delay.
    fireEvent.click(getByLabelText("tile 0"));
    fireEvent.click(getByLabelText("tile 2"));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0] as Record<string, unknown>;

    // The payload must carry taps (and optionally tap_times / elapsed_ms) but NEVER a correctness
    // field — the client has no answer during play; the server validates after submit.
    expect(payload).toHaveProperty("taps");
    expect(payload).not.toHaveProperty("correct");
    expect(payload).not.toHaveProperty("correctness");
    expect(payload).not.toHaveProperty("isCorrect");

    vi.useRealTimers();
  });

  it("pips reflect tap count: N taps filled out of sequence.length total", () => {
    vi.useFakeTimers();
    // Use a longer sequence so we can observe partial fill.
    const longSpec: MemoryFlashSpec = { ...spec, sequence: [0, 2, 1], tiles: 6 };
    const { container, getByLabelText } = render(
      <MemoryFlashRound spec={longSpec} onComplete={() => {}} />,
    );

    // Advance past show phase (3 tiles: ~400 + 3*620 + 150 ≈ 2410ms).
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Helper: count filled (lime) and unfilled (line) pips.
    const getPips = () =>
      Array.from(container.querySelectorAll("span[aria-hidden]")).filter((el) => {
        const bg = (el as HTMLElement).style.background;
        return bg.includes("var(--lime)") || bg.includes("var(--line)");
      });

    // 0 taps → 0 pips filled.
    const pips0 = getPips();
    expect(pips0.length).toBe(3);
    expect(pips0.filter((el) => (el as HTMLElement).style.background.includes("var(--lime)")).length).toBe(0);

    // 1 tap → 1 pip filled.
    fireEvent.click(getByLabelText("tile 0"));
    const pips1 = getPips();
    expect(pips1.filter((el) => (el as HTMLElement).style.background.includes("var(--lime)")).length).toBe(1);

    // 2 taps → 2 pips filled.
    fireEvent.click(getByLabelText("tile 2"));
    const pips2 = getPips();
    expect(pips2.filter((el) => (el as HTMLElement).style.background.includes("var(--lime)")).length).toBe(2);

    vi.useRealTimers();
  });
});
