// @vitest-environment jsdom
/**
 * The memory round's reveal.
 *
 * This round had none, so it ended on the generic "counted / no points" line and never showed the
 * player WHICH step they lost — the one interesting thing about getting a memory task wrong. The
 * assertions here are about that: the divergence has to be identified exactly, and a run that timed
 * out has to read differently from a run that was wrong.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryFlashReveal } from "@/modules/memoryFlash/MemoryFlashReveal";

afterEach(cleanup);

const reveal = (sequence: number[], taps: number[]) =>
  render(<MemoryFlashReveal answer={{ sequence }} result={{ taps }} />);

describe("MemoryFlashReveal", () => {
  it("calls a fully correct run perfect", () => {
    const { getByText } = reveal([0, 2, 1], [0, 2, 1]);
    expect(getByText("Perfect recall")).toBeTruthy();
  });

  it("names the exact tap the run diverged on, 1-indexed for a human", () => {
    const { getByText } = reveal([0, 2, 1], [0, 4, 1]);
    expect(getByText("You had 1 of 3")).toBeTruthy();
    expect(getByText("You lost it on tap 2")).toBeTruthy();
  });

  it("counts only the steps BEFORE the divergence, not every incidental match after it", () => {
    // Taps 3 and 4 happen to equal the sequence, but the run was already lost at tap 2 — crediting
    // them would tell the player they were closer than they were.
    const { getByText } = reveal([0, 1, 2, 3], [0, 5, 2, 3]);
    expect(getByText("You had 1 of 4")).toBeTruthy();
  });

  it("a short run that never went wrong reads as out of time, not as a wrong tap", () => {
    const { getByText, queryByText } = reveal([0, 1, 2, 3], [0, 1]);
    expect(getByText("Time ran out before you finished")).toBeTruthy();
    expect(queryByText(/lost it on tap/)).toBeNull();
  });

  it("renders one marker per step of the true sequence, including steps never reached", () => {
    // The pattern's full length is part of the information: an unfinished run should look
    // unfinished rather than look short.
    const { container } = reveal([0, 1, 2, 3, 4], [0, 1]);
    expect(container.querySelectorAll("svg")).toHaveLength(5);
  });

  it("renders nothing rather than throwing when the answer is missing", () => {
    // A decoration must never be able to unmount the app over a payload it did not expect.
    const { container } = render(<MemoryFlashReveal answer={{}} result={{}} />);
    expect(container.firstChild).toBeNull();
  });
});
