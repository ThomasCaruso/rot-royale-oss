// @vitest-environment jsdom
/**
 * MemoryFlashRound — a ladder of waves.
 *
 * WHAT THIS FILE USED TO PIN, AND WHY IT NO LONGER DOES. It asserted "the client is never told
 * whether a tap was right". That was never actually true: the sequences are in client_spec BY
 * DESIGN, because they are the stimulus the player watches (CLAUDE.md §5), so the component has
 * always held the answer. The real anti-cheat property is that the submitted TAPS are validated
 * server-side, and that is untouched — the payload still carries only what was tapped and when,
 * per wave, and the server decides the round.
 *
 * The ladder is the other half: one four-step sequence was over in two seconds with nothing to come
 * back for, so the round is now 3 → 4 → 5 with a fail-out. The tests worth having are the ones
 * about BANKING — what gets submitted when you fail wave two is what decides whether a player is
 * paid for the wave they did clear.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/haptics", () => ({ feedback: vi.fn() }));

import { MemoryFlashRound, type MemoryFlashSpec } from "@/modules/memoryFlash/MemoryFlashRound";

/** Two short waves — enough to exercise the ladder without a long fake-timer crawl. */
const spec: MemoryFlashSpec = {
  sequence: [0, 2],
  waves: [
    [0, 2],
    [1, 3, 5],
  ],
  wave_gap_ms: [700, 600],
  tiles: 6,
  category: "Memory",
  icon: "🧠",
  time_limit_ms: 10000,
};

/** Past a wave's flashes, up to the GO beat. */
const PAST_FLASHES_MS = 4000;
/** Past the hold between waves, and past the final outcome hold. */
const PAST_HOLD_MS = 1200;

/** Taps fire on POINTER DOWN, not click — the tick has to land with the finger (§7b1). */
const tap = (el: Element) => fireEvent.pointerDown(el);

afterEach(cleanup);

/**
 * Run a wave's watch phase through to a tappable grid, in TWO clock steps.
 *
 * The steps are separate on purpose. GO → input is its own effect, scheduled only once React has
 * committed the GO phase change, so a single advanceTimersByTime would fire the flashes and then
 * race past the input transition before it was ever scheduled. Two steps is also simply what a
 * browser does: render, then time passes.
 */
function runToInput() {
  act(() => void vi.advanceTimersByTime(PAST_FLASHES_MS));
  act(() => void vi.advanceTimersByTime(900));
}

const mount = (onComplete = vi.fn()) => ({
  onComplete,
  ...render(<MemoryFlashRound spec={spec} onComplete={onComplete} />),
});

describe("MemoryFlashRound — phases", () => {
  it("opens in the Watch phase with every tile disabled", () => {
    vi.useFakeTimers();
    const { getAllByRole, getByText } = mount();
    expect(getByText("Watch carefully")).toBeTruthy();
    expect(getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    vi.useRealTimers();
  });

  it("renders one tile per spec.tiles, so a server-side count change needs no client release", () => {
    vi.useFakeTimers();
    const { getAllByRole } = mount();
    expect(getAllByRole("button")).toHaveLength(6);
    vi.useRealTimers();
  });

  it("hands the grid over after the show timeline", () => {
    vi.useFakeTimers();
    const { getByText } = mount();
    runToInput();
    expect(getByText("Now repeat it")).toBeTruthy();
    vi.useRealTimers();
  });
});

describe("MemoryFlashRound — the ladder", () => {
  it("clearing a wave starts the NEXT one instead of ending the round", () => {
    vi.useFakeTimers();
    const { onComplete, getByLabelText, getByText } = mount();
    runToInput();

    tap(getByLabelText("tile 0"));
    tap(getByLabelText("tile 2")); // wave 1 done
    expect(getByText("Wave cleared")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(PAST_HOLD_MS));
    expect(getByText("Watch carefully")).toBeTruthy(); // wave 2 is playing
    vi.useRealTimers();
  });

  it("clearing every wave pays off with Perfect! and submits them all", () => {
    vi.useFakeTimers();
    const { onComplete, getByLabelText, getByText } = mount();

    runToInput();
    tap(getByLabelText("tile 0"));
    tap(getByLabelText("tile 2"));
    // TWO separate flushes, deliberately. The between-waves hold fires a timer that sets state;
    // the effect which schedules wave 2's flashes only runs after React commits that. Advancing
    // through both in one call schedules wave 2's timers at a clock that has already passed them,
    // and the wave silently never starts.
    act(() => void vi.advanceTimersByTime(PAST_HOLD_MS));
    runToInput();

    tap(getByLabelText("tile 1"));
    tap(getByLabelText("tile 3"));
    tap(getByLabelText("tile 5"));
    expect(getByText("Perfect!")).toBeTruthy();

    act(() => void vi.advanceTimersByTime(PAST_HOLD_MS));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0];
    expect(payload.waves).toHaveLength(2);
    expect(payload.waves[0].taps).toEqual([0, 2]);
    expect(payload.waves[1].taps).toEqual([1, 3, 5]);
    vi.useRealTimers();
  });

  it("failing wave 2 still BANKS wave 1 — the cleared wave has to be paid for", () => {
    // The whole point of a ladder: what you already did survives the run ending. If only the failed
    // wave were submitted, the player would lose the wave they actually won.
    vi.useFakeTimers();
    const { onComplete, getByLabelText, getByText } = mount();

    runToInput();
    tap(getByLabelText("tile 0"));
    tap(getByLabelText("tile 2")); // wave 1 cleared
    // TWO separate flushes, deliberately. The between-waves hold fires a timer that sets state;
    // the effect which schedules wave 2's flashes only runs after React commits that. Advancing
    // through both in one call schedules wave 2's timers at a clock that has already passed them,
    // and the wave silently never starts.
    act(() => void vi.advanceTimersByTime(PAST_HOLD_MS));
    runToInput();

    tap(getByLabelText("tile 4")); // wave 2 wants 1 — wrong
    expect(getByText("Almost!")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(PAST_HOLD_MS));

    const payload = onComplete.mock.calls[0][0];
    expect(payload.waves).toHaveLength(2);
    expect(payload.waves[0].taps).toEqual([0, 2]); // banked, and correct
    expect(payload.waves[1].taps).toEqual([4]); // the wave that ended it
    vi.useRealTimers();
  });

  it("a wrong tap stops the round rather than accepting more taps", () => {
    vi.useFakeTimers();
    const { onComplete, getByLabelText } = mount();
    runToInput();

    tap(getByLabelText("tile 4")); // wave 1 wants 0
    tap(getByLabelText("tile 2")); // must be ignored
    act(() => void vi.advanceTimersByTime(PAST_HOLD_MS));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].waves[0].taps).toEqual([4]);
    vi.useRealTimers();
  });

  it("running out of time banks the part-played wave and ends the round", () => {
    vi.useFakeTimers();
    const { onComplete, getByLabelText } = mount();
    runToInput();
    tap(getByLabelText("tile 0"));
    act(() => void vi.advanceTimersByTime(spec.time_limit_ms + PAST_HOLD_MS));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].waves[0].taps).toEqual([0]);
    vi.useRealTimers();
  });
});

describe("MemoryFlashRound — the submitted payload stays server-judged", () => {
  it("carries taps per wave and NEVER a correctness field", () => {
    vi.useFakeTimers();
    const { onComplete, getByLabelText } = mount();
    runToInput();
    tap(getByLabelText("tile 4")); // end it quickly
    act(() => void vi.advanceTimersByTime(PAST_HOLD_MS));

    const payload = onComplete.mock.calls[0][0] as Record<string, unknown>;
    // Showing the player what the client already knows is one thing; TELLING THE SERVER what to
    // think is another. The submission stays a plain record of what was tapped.
    expect(payload).toHaveProperty("waves");
    expect(payload).not.toHaveProperty("correct");
    expect(payload).not.toHaveProperty("cleared");
    expect(payload).not.toHaveProperty("isCorrect");
    vi.useRealTimers();
  });

  it("a legacy spec with no waves still plays as a single-sequence round", () => {
    // §7c in the other direction: the component must not REQUIRE the new field to exist.
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const legacy: MemoryFlashSpec = {
      sequence: [0, 2],
      tiles: 6,
      category: "Memory",
      icon: "🧠",
      time_limit_ms: 10000,
    };
    const { getByLabelText, getByText } = render(
      <MemoryFlashRound spec={legacy} onComplete={onComplete} />,
    );
    runToInput();
    tap(getByLabelText("tile 0"));
    tap(getByLabelText("tile 2"));
    expect(getByText("Perfect!")).toBeTruthy(); // one wave IS the whole round
    act(() => void vi.advanceTimersByTime(PAST_HOLD_MS));
    expect(onComplete.mock.calls[0][0].waves).toHaveLength(1);
    vi.useRealTimers();
  });
});


describe("MemoryFlashRound — the grid actually becomes tappable", () => {
  it("reaches the input phase even when the GO transition triggers a re-render", () => {
    // THE REGRESSION THIS FILE MISSED, and the reason it missed it.
    //
    // GO → input used to be scheduled by the same effect as the flashes. Firing GO called setPhase,
    // which re-rendered, which changed that effect's dependencies, which ran its CLEANUP — killing
    // the pending timer that opens the input phase. The round parked on GO with every tile disabled
    // and the player could not tap at all.
    //
    // The old tests advanced through GO and input inside ONE act(), so both timers fired before
    // React ever re-rendered and the teardown never happened. Stepping the clock in two — with a
    // render in between, exactly as it works in a browser — is what exposes it.
    vi.useFakeTimers();
    const { getAllByRole, getByText } = mount();

    // Far enough to fire the flashes and the GO transition, but NOT the input one.
    act(() => void vi.advanceTimersByTime(2900));
    expect(getByText("GO")).toBeTruthy();
    expect(getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);

    // A second, separate step: React has now re-rendered on the GO phase change.
    act(() => void vi.advanceTimersByTime(900));
    expect(getByText("Now repeat it")).toBeTruthy();
    expect(getAllByRole("button").every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    vi.useRealTimers();
  });

  it("survives a parent that rebuilds the spec object on every render", () => {
    // A module must not restart its round because its caller re-rendered. The preview harness
    // builds the spec inline, and that alone was enough to keep re-running the watch effect.
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const { rerender, getAllByRole, getByLabelText } = render(
      <MemoryFlashRound spec={{ ...spec }} onComplete={onComplete} />,
    );
    act(() => void vi.advanceTimersByTime(2900));
    rerender(<MemoryFlashRound spec={{ ...spec }} onComplete={onComplete} />); // fresh object
    act(() => void vi.advanceTimersByTime(900));

    expect(getAllByRole("button").every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    tap(getByLabelText("tile 0"));
    tap(getByLabelText("tile 2"));
    act(() => void vi.advanceTimersByTime(PAST_HOLD_MS));
    expect(getAllByRole("button").length).toBe(6); // still alive, now on wave 2
    vi.useRealTimers();
  });
});
