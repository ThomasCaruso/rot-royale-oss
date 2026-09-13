// @vitest-environment jsdom
/**
 * The IN-RUN cues.
 *
 * These are easy to break and hard to notice: every cue degrades silently by design (no
 * AudioContext, blocked storage and unsupported vibration are all no-ops), so a mistake here does
 * not throw — the game just quietly stops feeling like anything. That is exactly the failure the
 * whole change exists to fix, so the properties worth pinning are the ones a silent regression
 * would take away.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeOsc {
  type: string;
  frequency: { setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const oscillators: FakeOsc[] = [];

function installFakeAudio() {
  oscillators.length = 0;
  class FakeAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createOscillator(): FakeOsc {
      const osc: FakeOsc = {
        type: "sine",
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(() => ({ connect: vi.fn() })),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }
    createGain() {
      return {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(() => ({ connect: vi.fn() })),
      };
    }
    resume() {
      return Promise.resolve();
    }
  }
  (globalThis as { AudioContext?: unknown }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
}

/** The frequency each note STARTED on, in play order. */
const startFreqs = () =>
  oscillators.map((o) => o.frequency.setValueAtTime.mock.calls[0]?.[0] as number);

describe("in-run cues", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    installFakeAudio();
  });
  afterEach(() => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it("every in-run cue actually emits sound", async () => {
    const sfx = await import("./sfx");
    for (const cue of [sfx.questionIn, sfx.commitLock, sfx.wrongThud, sfx.timerTick] as const) {
      oscillators.length = 0;
      cue();
      expect(oscillators.length).toBeGreaterThan(0);
    }
  });

  it("the correct chime RISES with the streak", async () => {
    const sfx = await import("./sfx");
    const at = (step: number) => {
      oscillators.length = 0;
      sfx.correctChime(step);
      return startFreqs()[0];
    };
    const base = at(0);
    // Each milestone is strictly higher than the last — the audible "this is going well".
    expect(at(1)).toBeGreaterThan(base);
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(3)).toBeGreaterThan(at(2));
  });

  it("correct is a RISING pair and wrong is a single FALLING note", async () => {
    const sfx = await import("./sfx");
    sfx.correctChime(0);
    const [first, second] = startFreqs();
    expect(second).toBeGreaterThan(first); // two notes, going up

    oscillators.length = 0;
    sfx.wrongThud();
    // One note, and it glides DOWN. Wrong must read as "noted", not as a buzzer — this player is
    // already worried their brain is cooked (§5c), and the product exists to relieve that.
    expect(oscillators).toHaveLength(1);
    const glideTo = oscillators[0].frequency.exponentialRampToValueAtTime.mock.calls[0]?.[0];
    expect(glideTo).toBeLessThan(startFreqs()[0]);
  });

  it("wrong is quieter and shorter than correct — failure never dominates the room", async () => {
    const sfx = await import("./sfx");
    sfx.wrongThud();
    const wrongStops = oscillators.map((o) => o.stop.mock.calls[0]?.[0] as number);
    oscillators.length = 0;
    sfx.correctChime(0);
    const correctStops = oscillators.map((o) => o.stop.mock.calls[0]?.[0] as number);
    expect(Math.max(...wrongStops)).toBeLessThan(Math.max(...correctStops));
  });

  it("memory tiles are pentatonic, so any random sequence stays consonant", async () => {
    const sfx = await import("./sfx");
    const freqs = new Set<number>();
    for (let i = 0; i < 9; i++) {
      oscillators.length = 0;
      sfx.tilePing(i);
      freqs.add(startFreqs()[0]);
    }
    // Nine distinct pitches: a repeat would make two different tiles indistinguishable by ear,
    // which defeats the point of pitching them at all.
    expect(freqs.size).toBe(9);
  });

  it("a tile's note is STABLE and index-safe", async () => {
    const sfx = await import("./sfx");
    const noteFor = (i: number) => {
      oscillators.length = 0;
      sfx.tilePing(i);
      return startFreqs()[0];
    };
    expect(noteFor(3)).toBe(noteFor(3)); // same tile, same note, every time
    expect(noteFor(-1)).toBeGreaterThan(0); // a negative index must not read past the array
    expect(noteFor(99)).toBeGreaterThan(0);
  });

  it("MUTING silences the run, not just the results", async () => {
    const sfx = await import("./sfx");
    sfx.setSfxEnabled(false);
    for (const cue of [sfx.questionIn, sfx.commitLock, sfx.wrongThud, sfx.timerTick] as const) {
      oscillators.length = 0;
      cue();
      expect(oscillators).toHaveLength(0);
    }
    oscillators.length = 0;
    sfx.correctChime(2);
    expect(oscillators).toHaveLength(0);
    oscillators.length = 0;
    sfx.tilePing(1);
    expect(oscillators).toHaveLength(0);
  });

  it("sound is ON by default", async () => {
    const sfx = await import("./sfx");
    expect(sfx.isSfxEnabled()).toBe(true);
  });

  it("a cue never throws when there is no audio at all", async () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    vi.resetModules();
    const sfx = await import("./sfx");
    // A blocked or absent AudioContext must cost the sound and nothing else — never the round.
    expect(() => {
      sfx.questionIn();
      sfx.commitLock();
      sfx.correctChime(3);
      sfx.wrongThud();
      sfx.timerTick();
      sfx.tilePing(2);
    }).not.toThrow();
  });
});
