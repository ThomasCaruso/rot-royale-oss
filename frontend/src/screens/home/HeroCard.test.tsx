// @vitest-environment jsdom
/**
 * HeroCard rendering tests — focused on the progress-bar honesty (Phase 3 fix #1) and the state-D
 * settle-time line (fix #2). The A–F phase DECISION lives in home.test.ts and the data→copy wiring in
 * Home.flow.test.tsx; here we render the card directly for the visual slots those don't cover.
 *
 * The progress bar measures elapsed-fraction of an OPEN window. In the pre-open countdown states
 * (A `before`, F `viewed` → counting down to a FUTURE open) there is no running window, so the bar is
 * meaningless and must NOT render (it previously stuck at 0 / showed an inverted value). The big
 * countdown number stays — it's the one honest element.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HeroCard, type HeroState } from "./HeroCard";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

afterEach(cleanup);

// The progress-bar FILL is the only element with this gold gradient inline; counting it tells us
// whether a bar was rendered. The track itself is purple, so we key off the fill specifically.
function fillCount(container: HTMLElement): number {
  return Array.from(container.querySelectorAll<HTMLElement>("div[style]")).filter((el) =>
    el.style.background.includes("linear-gradient(90deg"),
  ).length;
}

describe("HeroCard — progress bar honesty in pre-open states (fix #1)", () => {
  it("before (A): renders the countdown number but NO progress bar", () => {
    const state: HeroState = { kind: "before", opensText: "Today's Royale unlocks at 12:00 AM", countdown: "4h 12m" };
    const { container, getByText } = render(<HeroCard state={state} />);
    expect(getByText("4h 12m")).toBeTruthy(); // honest countdown stays
    expect(fillCount(container)).toBe(0); // no stuck/inverted bar
  });

  it("viewed (F): renders the next-open countdown but NO progress bar", () => {
    const state: HeroState = {
      kind: "viewed",
      rank: 2,
      opensText: "Tomorrow's Royale unlocks at 12:00 AM",
      countdown: "11h 30m",
    };
    const { container, getByText } = render(<HeroCard state={state} />);
    expect(getByText("11h 30m")).toBeTruthy();
    expect(fillCount(container)).toBe(0);
  });

  it("live (B): DOES render the progress bar (open window has meaningful elapsed-fraction)", () => {
    const state: HeroState = {
      kind: "live",
      oneShotText: "One attempt. One field. Results at 12:15 AM.",
      fieldText: "Field of 8",
      countdown: "3h 00m",
      progress: 0.5,
      onPlay: () => {},
    };
    const { container } = render(<HeroCard state={state} />);
    expect(fillCount(container)).toBe(1);
  });
});

describe("HeroCard — state D renders the settle time (fix #2)", () => {
  it("settling: shows both 'Results settling' and the settle-time line", () => {
    const state: HeroState = {
      kind: "settling",
      settleText: "Settles at 12:15 AM",
      countdown: "9m",
      progress: 0.3,
    };
    const { getByText } = render(<HeroCard state={state} />);
    expect(getByText("Results settling")).toBeTruthy();
    expect(getByText("Settles at 12:15 AM")).toBeTruthy();
  });
});
