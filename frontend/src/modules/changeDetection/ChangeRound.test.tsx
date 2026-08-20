// @vitest-environment jsdom
/**
 * ChangeRound. The round's `time_limit_ms` auto-submits a MISS when it expires; that countdown used
 * to run with no on-screen representation at all, so a player could be timed out mid-look with no
 * warning. These pin both halves: the countdown is now visible, and it still fires the auto-miss.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeRound } from "@/modules/changeDetection/ChangeRound";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

primeArcadeTheme();

const cogChangeSubmit = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    cogChangeSubmit: (id: string, x: number, y: number, ms: number) =>
      cogChangeSubmit(id, x, y, ms),
  },
}));

const spec = {
  cognition_instance_id: "inst-c1",
  base_url: "/a.png",
  altered_url: "/b.png",
  width: 4,
  height: 3,
  flicker_base_ms: 400,
  flicker_blank_ms: 120,
  time_limit_ms: 8000,
};

beforeEach(() => cogChangeSubmit.mockReset());
afterEach(() => {
  cleanup();
  // Unconditional: a test that throws before its own useRealTimers() would otherwise leak fake
  // timers into the next test, where waitFor then hangs. That is what made this file flaky.
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChangeRound — chrome", () => {
  it("shows the verb header and the countdown that governs the auto-miss", () => {
    const html = renderToStaticMarkup(<ChangeRound spec={spec} onComplete={() => {}} />);
    expect(html).toContain("Spot the change");
    // 8000ms → the ring reads "8"; previously this timer had NO on-screen representation.
    expect(html).toContain(">8<");
  });

  it("uses the shared themed surfaces, not the old hardcoded debug card", () => {
    const html = renderToStaticMarkup(<ChangeRound spec={spec} onComplete={() => {}} />);
    expect(html).toContain("rr-glass");
    expect(html).toContain("var(--panel");
    expect(html).not.toContain("2px solid #111");
    expect(html).not.toContain("-apple-system");
  });
});

// The round does not start until both frames are decoded. jsdom never loads resources at all, so
// image loading is stubbed explicitly rather than leaning on the component's timeout — otherwise
// these tests exercise the dead-asset path by accident and depend on wall-clock ordering.
function stubImages({ loads }: { loads: boolean }) {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      if (loads) queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

describe("ChangeRound — the clock does not start until the images do", () => {
  it("runs no timer while the frames are still loading", async () => {
    vi.useFakeTimers();
    stubImages({ loads: false });
    cogChangeSubmit.mockResolvedValue({});
    render(<ChangeRound spec={spec} onComplete={vi.fn()} />);

    // Most of the time limit has passed in wall-clock terms, but the round has not started, so
    // nothing resolves. Previously the limit ran from mount, so a cold cache silently ate the
    // opening seconds of the round.
    await vi.advanceTimersByTimeAsync(3000);
    expect(cogChangeSubmit).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("submits a miss when the time limit expires, exactly once", async () => {
    // Real timers with a deliberately tiny limit. `ready` flips in a promise continuation, so
    // React commits the round's timers a scheduler tick later — fake timers do not reliably drive
    // that boundary, and forcing them here tests the harness rather than the round.
    stubImages({ loads: true });
    const onComplete = vi.fn();
    cogChangeSubmit.mockResolvedValue({});
    render(<ChangeRound spec={{ ...spec, time_limit_ms: 120 }} onComplete={onComplete} />);

    await waitFor(() => expect(cogChangeSubmit).toHaveBeenCalledTimes(1));
    // NULL x/y is the timeout signal. The old (-1,-1) sentinel was rejected by the API with a
    // 422, which left the round unresolvable and stranded the player mid-run.
    expect(cogChangeSubmit).toHaveBeenCalledWith("inst-c1", null, null, expect.any(Number));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("ChangeRound — a tap in the dying seconds still counts", () => {
  it("scores a tap landed inside the reveal delay as the TAP, not as a miss", async () => {
    vi.useFakeTimers();
    stubImages({ loads: true });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    cogChangeSubmit.mockResolvedValue({});
    const { container } = render(<ChangeRound spec={spec} onComplete={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(100); // let the frames "load" and the round's timers commit
    const surface = container.querySelector('[style*="crosshair"]')!;

    // Tap 100ms before expiry. The submit is deferred ~260ms for the mark, so the auto-miss fires
    // FIRST — and before this fix it resolved the round as (-1, -1) and threw the tap away.
    await vi.advanceTimersByTimeAsync(spec.time_limit_ms - 100);
    fireEvent.pointerDown(surface, { clientX: 150, clientY: 100 });
    await vi.advanceTimersByTimeAsync(500);

    expect(cogChangeSubmit).toHaveBeenCalledTimes(1);
    expect(cogChangeSubmit).toHaveBeenCalledWith("inst-c1", 0.5, 0.5, expect.any(Number));
    vi.useRealTimers();
  });
});
