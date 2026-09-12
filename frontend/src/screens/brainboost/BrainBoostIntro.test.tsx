// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrainBoostIntro } from "./BrainBoostIntro";

afterEach(cleanup);

describe("BrainBoostIntro — the front door has no signup wall", () => {
  it("shows six things and nothing else — the whole screen is one tap deep", () => {
    const { getByText, getByLabelText, queryByText, container } = render(
      <BrainBoostIntro onStart={async () => {}} onEmailLogin={() => {}} />
    );
    // What a brand-new visitor is asked to read, in order.
    expect(getByText("Rot Royale")).toBeTruthy();
    expect(getByText("Daily Royale")).toBeTruthy();
    expect(getByText("One challenge a day. Sharper every day.")).toBeTruthy();
    expect(getByText("PLAY DAILY ROYALE")).toBeTruthy();
    expect(getByText("No sign up. Just play.")).toBeTruthy();
    expect(getByText("Already playing?")).toBeTruthy();
    expect(getByLabelText("Email")).toBeTruthy();

    // And what was deliberately taken away. This screen used to make a stranger process six
    // separate claims — three reason pills and a three-column payoff card — before reaching the
    // button they came for. Asserted as ABSENT rather than simply deleted, because "one more
    // useful thing on the first screen" is the easiest change in the world to make and the whole
    // point of this screen is that it resists exactly that.
    for (const gone of [
      "2 min",
      "No signup",
      "Ranked",
      "Play today. See what you earn.",
      "Your score",
      "Today's rank",
      "Compare",
    ]) {
      expect(queryByText(gone)).toBeNull();
    }

    // The CTA plus the returning-user tiles, and nothing else. Under test no social provider is
    // configured, so the row is Email alone — two buttons. Any growth here is a new demand made of
    // someone who has not played yet.
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });

  it("stages the crown in its light field — no podium, no painted plate", () => {
    const { container } = render(
      <BrainBoostIntro onStart={async () => {}} onEmailLogin={() => {}} />
    );
    const srcs = Array.from(container.querySelectorAll("img")).map((i) =>
      i.getAttribute("src")
    );
    // Version-agnostic on `?v=N`: it is a cache-buster that changes whenever the art is re-exported
    // (docs/architecture.md §13), so pinning the number breaks this test on unrelated asset work.
    const hasArt = (path: string) =>
      srcs.some((s) => s != null && s.replace(/\?v=\d+$/, "") === path);
    expect(hasArt("/assets/themes/starter/crown.webp")).toBe(true);

    // The crown is now the ONLY bitmap in the hero. The marble podium and the painted lavender
    // backdrop plate were retired when this screen adopted the sign-in screen's treatment: the
    // crown stands in a vector halo and a CSS light field instead, so the front door and its login
    // step share one continuous ivory background. Asserted rather than assumed, because dropping
    // either asset back in would silently reintroduce two different worlds either side of one tap.
    expect(hasArt("/assets/themes/starter/starter-podium.webp")).toBe(false);
    expect(hasArt("/assets/themes/starter/background_art_starter.webp")).toBe(false);
    expect(srcs.filter((s) => s != null)).toHaveLength(1);

    expect(container.querySelector('[aria-hidden="true"] img')).toBeTruthy();
  });

  it("PLAY DAILY ROYALE invokes onStart (guest creation + straight into today's daily)", async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <BrainBoostIntro onStart={onStart} onEmailLogin={() => {}} />
    );
    fireEvent.click(getByText("PLAY DAILY ROYALE"));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
  });

  it("the Email tile routes to the dedicated sign-in screen; Apple/Google sign in in place", () => {
    const onEmailLogin = vi.fn();
    const { getByLabelText } = render(
      <BrainBoostIntro onStart={async () => {}} onEmailLogin={onEmailLogin} />
    );
    // Email is the only route that LEAVES this screen — a password needs a form, and that form
    // already exists one screen away. Apple and Google run their flow in place, so neither calls
    // this; the row is not a link dressed up as three buttons.
    fireEvent.click(getByLabelText("Email"));
    expect(onEmailLogin).toHaveBeenCalledTimes(1);
  });

  // The CTA's glint shipped with no resting state at all: for the whole 1.9s animation delay the
  // span fell back to its own styles — no transform, full opacity — parking a bright white band
  // across the left of the button on every cold load. It read as a half-painted, broken control on
  // the one screen a stranger sees first. jsdom runs no animation, so what this test renders IS the
  // resting state, which makes it exactly the right check: whatever the keyframes do, the span must
  // be invisible AND off the pill when nothing is animating it.
  it("the CTA's shine is invisible and off the button at rest", () => {
    const { container } = render(
      <BrainBoostIntro onStart={async () => {}} onEmailLogin={() => {}} />
    );
    const shine = container.querySelector<HTMLElement>(".rr-cta-shine");
    expect(shine).toBeTruthy();

    // Guarantee one: nothing to paint.
    expect(shine!.style.opacity).toBe("0");

    // Guarantee two: and nothing on the pill to paint it onto, so the two are independent rather
    // than the same guarantee written twice. Parsed rather than string-matched — the point is that
    // it is far enough left to clear the surface, not that it is spelled a particular way. The
    // translate is in the span's OWN width units, so it must be past -100% for the band's trailing
    // edge to clear the pill's left edge.
    const shift = Number(/translateX\((-?[\d.]+)%\)/.exec(shine!.style.transform)?.[1] ?? NaN);
    expect(Number.isNaN(shift)).toBe(false);
    expect(shift).toBeLessThanOrEqual(-100);

    // And the band itself stays restrained. A CTA that glints occasionally reads as premium; the
    // old .30/.42 alpha read as a wet gloss sitting on the purple.
    // jsdom normalizes `.13` to `0.13`, so match the alpha with or without its leading zero.
    const peaks = [
      ...shine!.style.background.matchAll(/rgba\(\s*255,\s*255,\s*255,\s*(0?\.\d+)\s*\)/g),
    ].map((m) => Number(m[1]));
    expect(peaks.length).toBeGreaterThan(0);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(0.2);
  });

  it("a failed start surfaces an error and re-enables the CTA (never a dead end)", async () => {
    const onStart = vi.fn().mockRejectedValue(new Error("offline"));
    const { getByText, findByText } = render(
      <BrainBoostIntro onStart={onStart} onEmailLogin={() => {}} />
    );
    fireEvent.click(getByText("PLAY DAILY ROYALE"));
    await findByText("Something went wrong");
    expect(getByText("PLAY DAILY ROYALE")).toBeTruthy();
  });
});
