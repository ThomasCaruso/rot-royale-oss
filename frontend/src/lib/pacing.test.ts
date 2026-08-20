import { describe, expect, it } from "vitest";
import { initialPacing, pacingReducer, type PacingState, type RevealData } from "@/lib/pacing";

const REVEAL: RevealData = {
  idx: 0,
  correct: true,
  valid: true,
  points: 142,
  answer: { correctIndex: 2 },
  total_score: 142,
  finished: false,
};

function drive(state: PacingState, ...events: Parameters<typeof pacingReducer>[1][]): PacingState {
  return events.reduce(pacingReducer, state);
}

describe("pacingReducer", () => {
  it("starts on splash and advances to playing", () => {
    const s = initialPacing(3);
    expect(s.phase).toBe("splash");
    expect(drive(s, { type: "SPLASH_DONE" }).phase).toBe("playing");
  });

  it("reveals as soon as the answer arrives — lock → reveal, no delay", () => {
    let s = drive(initialPacing(3), { type: "SPLASH_DONE" }); // playing
    s = pacingReducer(s, { type: "LOCKED" });
    expect(s.phase).toBe("holding"); // locked, briefly waiting on the server answer
    s = pacingReducer(s, { type: "REVEAL_READY", reveal: REVEAL });
    expect(s.phase).toBe("reveal"); // shown immediately once the answer is in (no hold beat)
    expect(s.reveal).toEqual(REVEAL);
    s = pacingReducer(s, { type: "REVEAL_DONE" });
    expect(s.phase).toBe("splash"); // straight to the next round — no per-round leaderboard
    expect(s.idx).toBe(1);
  });

  it("holds only until the server answer arrives — nothing else gates the reveal", () => {
    const s = drive(initialPacing(3), { type: "SPLASH_DONE" }, { type: "LOCKED" });
    expect(s.phase).toBe("holding"); // no answer yet → still holding
    expect(pacingReducer(s, { type: "REVEAL_READY", reveal: REVEAL }).phase).toBe("reveal");
  });

  it("guards reveal-before-lock: a reveal while still playing is ignored", () => {
    const s = drive(initialPacing(3), { type: "SPLASH_DONE" }); // playing, never locked
    const after = pacingReducer(s, { type: "REVEAL_READY", reveal: REVEAL });
    expect(after.phase).toBe("playing");
    expect(after.reveal).toBeNull();
  });

  it("guards double-advance: a repeated REVEAL_DONE only advances once", () => {
    let s = drive(
      initialPacing(3),
      { type: "SPLASH_DONE" },
      { type: "LOCKED" },
      { type: "REVEAL_READY", reveal: REVEAL },
    );
    expect(s.phase).toBe("reveal");
    expect(s.idx).toBe(0);
    s = pacingReducer(s, { type: "REVEAL_DONE" });
    expect(s.idx).toBe(1); // advanced to round 1
    expect(s.phase).toBe("splash");
    const again = pacingReducer(s, { type: "REVEAL_DONE" }); // stray repeat
    expect(again.idx).toBe(1); // did NOT double-advance
    expect(again.phase).toBe("splash");
  });

  it("§5f: a retry offer re-arms the same round (holding → playing) instead of revealing", () => {
    let s = drive(initialPacing(3), { type: "SPLASH_DONE" }, { type: "LOCKED" }); // holding
    s = pacingReducer(s, { type: "RETRY", eliminated: 2, retryMs: 4000 });
    expect(s.phase).toBe("playing"); // back to play, not reveal
    expect(s.reveal).toBeNull(); // the answer is NOT revealed on the offer
    expect(s.retry).toEqual({ eliminated: 2, retryMs: 4000 });
    expect(s.idx).toBe(0); // same round

    // The second pick then resolves normally.
    s = pacingReducer(s, { type: "LOCKED" });
    expect(s.phase).toBe("holding");
    s = pacingReducer(s, { type: "REVEAL_READY", reveal: REVEAL });
    expect(s.phase).toBe("reveal");
  });

  it("§5f: a RETRY is ignored unless the round is locked (holding)", () => {
    const playing = drive(initialPacing(3), { type: "SPLASH_DONE" }); // playing, not locked
    expect(pacingReducer(playing, { type: "RETRY", eliminated: 1, retryMs: 4000 }).phase).toBe(
      "playing",
    );
    expect(pacingReducer(playing, { type: "RETRY", eliminated: 1, retryMs: 4000 }).retry).toBeNull();
  });

  it("§5f: the retry state clears when the round advances", () => {
    let s = drive(initialPacing(2), { type: "SPLASH_DONE" }, { type: "LOCKED" });
    s = pacingReducer(s, { type: "RETRY", eliminated: 0, retryMs: 4000 });
    expect(s.retry).not.toBeNull();
    s = drive(s, { type: "LOCKED" }, { type: "REVEAL_READY", reveal: REVEAL }, { type: "REVEAL_DONE" });
    expect(s.idx).toBe(1);
    expect(s.retry).toBeNull(); // fresh round, no lingering elimination
  });

  it("resets per-round state on advance and finishes after the last round", () => {
    function oneRound(s: PacingState): PacingState {
      return drive(
        s,
        { type: "SPLASH_DONE" },
        { type: "LOCKED" },
        { type: "REVEAL_READY", reveal: REVEAL },
        { type: "REVEAL_DONE" },
      );
    }
    let s = initialPacing(2);
    s = oneRound(s); // round 0 done → round 1 splash
    expect(s.idx).toBe(1);
    expect(s.phase).toBe("splash");
    expect(s.reveal).toBeNull(); // reveal cleared for the new round
    s = oneRound(s); // round 1 (last) done
    expect(s.phase).toBe("finished");
  });
});
