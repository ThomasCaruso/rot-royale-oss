// @vitest-environment jsdom
/**
 * The video round's client behaviour.
 *
 * The properties worth pinning are the ones that strand a player when they break: a question that
 * never resolves, a clip that fails to load and wedges the round, or an answer sent for the wrong
 * question index. All three are silent failures mid-run, which is the worst kind in a timed mode.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cogVideoAnswer = vi.fn();
vi.mock("@/api/client", () => ({
  api: { cogVideoAnswer: (...a: unknown[]) => cogVideoAnswer(...a) },
}));
vi.mock("@/lib/haptics", () => ({ feedback: vi.fn() }));

import { VideoRound } from "./VideoRound";

const LIMIT = 5000;

const spec = {
  cognition_instance_id: "inst-1",
  base_url: "/v/base.mp4",
  altered_url: "/v/altered.mp4",
  width: 720,
  height: 1280,
  duration_ms: 5040,
  question_time_limit_ms: LIMIT,
  questions: [
    { prompt: "first question", options: ["a1", "b1", "c1", "d1"] },
    { prompt: "second question", options: ["a2", "b2", "c2", "d2"] },
  ],
  change_question: { prompt: "what changed", options: ["a3", "b3", "c3", "d3"] },
};

/** jsdom never plays media, so the clip phases are advanced by firing `ended` directly. */
function endClip(container: HTMLElement) {
  const v = container.querySelector("video");
  if (v) act(() => void fireEvent.ended(v));
}

/** The component ignores taps for 250ms after a question appears (the double-tap guard), so a test
 *  that clicks on the same tick is not simulating a human. Let the clock move first. */
function pick(label: string) {
  act(() => void vi.advanceTimersByTime(400));
  fireEvent.click(screen.getByText(label));
}

describe("VideoRound", () => {
  beforeEach(() => {
    // Fake timers throughout: the round is built on two clocks (the per-question countdown and the
    // input cooldown), and driving them explicitly is the only way to test either honestly.
    vi.useFakeTimers();
    vi.clearAllMocks();
    cogVideoAnswer.mockResolvedValue({ correct: true, question_index: 0, answered: 1, done: false });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("plays the clip before asking anything", () => {
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/v/base.mp4");
    expect(screen.queryByText("first question")).toBeNull();
  });

  it("autoplay is muted and inline, or iOS silently refuses to start it", () => {
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    const v = container.querySelector("video") as HTMLVideoElement;
    expect(v.muted).toBe(true);
    expect(v.getAttribute("playsinline")).not.toBeNull();
    expect(v.autoplay).toBe(true);
  });

  it("runs clip, two questions, altered clip, then the change question", () => {
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    endClip(container);
    expect(screen.getByText("first question")).toBeTruthy();

    pick("a1");
    expect(screen.getByText("second question")).toBeTruthy();

    pick("a2");
    // Back to a clip — the ALTERED one this time.
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/v/altered.mp4");

    endClip(container);
    expect(screen.getByText("what changed")).toBeTruthy();
  });

  it("sends each answer against its own question index", () => {
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    endClip(container);
    pick("b1");
    pick("c2");
    expect(cogVideoAnswer.mock.calls[0].slice(0, 3)).toEqual(["inst-1", 0, 1]);
    expect(cogVideoAnswer.mock.calls[1].slice(0, 3)).toEqual(["inst-1", 1, 2]);
  });

  it("completes after the third answer", () => {
    const onComplete = vi.fn();
    const { container } = render(<VideoRound spec={spec} onComplete={onComplete} />);
    endClip(container);
    pick("a1");
    pick("a2");
    endClip(container);
    pick("a3");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(cogVideoAnswer).toHaveBeenCalledTimes(3);
  });

  it("a timed-out question answers NULL and moves on", () => {
    // The change round's lesson: a timeout that does not resolve leaves the instance open and the
    // Royale bridge 409ing behind it, stranding the player on a round they cannot finish.
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    endClip(container);
    act(() => void vi.advanceTimersByTime(LIMIT + 200));
    expect(cogVideoAnswer).toHaveBeenCalledTimes(1);
    expect(cogVideoAnswer.mock.calls[0][2]).toBeNull();
  });

  it("one question cannot be answered twice", () => {
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    endClip(container);
    act(() => void vi.advanceTimersByTime(400));
    const pill = screen.getByText("a1");
    fireEvent.click(pill);
    fireEvent.click(pill); // same tick AND inside the next question's cooldown
    expect(cogVideoAnswer).toHaveBeenCalledTimes(1);
  });

  it("a clip that fails to load does not wedge the round", () => {
    // Better a hard question than a dead screen: the questions still run, the round still finishes.
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    const v = container.querySelector("video") as HTMLVideoElement;
    act(() => void fireEvent.error(v));
    expect(screen.getByText("first question")).toBeTruthy();
  });

  it("a failed answer request still advances the round", async () => {
    // The server is authoritative and the round finalizes through /entries/{id}/answer regardless,
    // so a dropped request must not leave the player stuck on a question they already answered.
    cogVideoAnswer.mockRejectedValue(new Error("offline"));
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    endClip(container);
    act(() => void vi.advanceTimersByTime(400));
    await act(async () => void fireEvent.click(screen.getByText("a1")));
    expect(screen.getByText("second question")).toBeTruthy();
  });

  it("sizes the clip from the source aspect ratio, never a fixed box", () => {
    // The height is a `min(60vh, 580px)` clamp, which jsdom's CSSOM drops — so this asserts the
    // aspect ratio, which is the half that must track the CONTENT. A 9:16 clip rendering at any
    // other ratio would be stretched or cropped, and cropping this round can hide the change.
    // The height clamp itself is verified against a real browser (225x400 on SE, 285x506 on 14).
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    const frame = container.querySelector("video")?.parentElement as HTMLElement;
    expect(frame.style.aspectRatio).toBe("720 / 1280");
  });

  it("answering does not wait on the network", () => {
    // A timed round cannot stall on a slow request. The next question must appear immediately;
    // the answer travels in the background because the server judges it either way.
    let settle: (v: unknown) => void = () => {};
    cogVideoAnswer.mockReturnValue(new Promise((r) => (settle = r)));
    const { container } = render(<VideoRound spec={spec} onComplete={() => {}} />);
    endClip(container);
    pick("a1");
    expect(screen.getByText("second question")).toBeTruthy(); // still pending, already advanced
    settle({});
  });
});
