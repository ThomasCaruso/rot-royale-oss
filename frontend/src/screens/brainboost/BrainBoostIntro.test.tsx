// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrainBoostIntro } from "./BrainBoostIntro";

afterEach(cleanup);

describe("BrainBoostIntro — the front door has no signup wall", () => {
  it("shows the kicker, Daily Royale hook, reason pills, the payoff card, one CTA, and a log-in link", () => {
    const { getByText, queryByText } = render(
      <BrainBoostIntro onStart={async () => {}} onLogin={() => {}} />
    );
    expect(getByText("Daily Royale")).toBeTruthy();
    // No subtitle: the headline and the hero carry the screen on their own.
    expect(queryByText(/8 questions\. One shot/)).toBeNull();
    expect(getByText("No signup")).toBeTruthy(); // low-barrier reason pill
    expect(getByText("Ranked")).toBeTruthy();
    // The three-column payoff card (what one run pays back).
    expect(getByText("Play today. See what you earn.")).toBeTruthy();
    expect(getByText("Your score")).toBeTruthy();
    expect(getByText("Today's rank")).toBeTruthy();
    expect(getByText("Compare")).toBeTruthy();
    expect(getByText("PLAY DAILY ROYALE")).toBeTruthy();
    expect(getByText("Already playing? Log in")).toBeTruthy();
  });

  it("stages the crown on its podium (decorative hero, hidden from assistive tech)", () => {
    const { container } = render(
      <BrainBoostIntro onStart={async () => {}} onLogin={() => {}} />
    );
    const srcs = Array.from(container.querySelectorAll("img")).map((i) =>
      i.getAttribute("src")
    );
    // Version-agnostic on `?v=N`: it is a cache-buster that changes whenever the art is re-exported
    // (CLAUDE.md §7), so pinning the number breaks this test on unrelated asset work.
    const hasArt = (path: string) =>
      srcs.some((s) => s != null && s.replace(/\?v=\d+$/, "") === path);
    expect(hasArt("/assets/themes/starter/starter-podium.png")).toBe(true);
    expect(hasArt("/assets/themes/starter/crown.png")).toBe(true);
    expect(container.querySelector('[aria-hidden="true"] img')).toBeTruthy();
  });

  it("PLAY DAILY ROYALE invokes onStart (guest creation + straight into today's daily)", async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <BrainBoostIntro onStart={onStart} onLogin={() => {}} />
    );
    fireEvent.click(getByText("PLAY DAILY ROYALE"));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
  });

  it("the log-in link routes returning players to auth", () => {
    const onLogin = vi.fn();
    const { getByText } = render(
      <BrainBoostIntro onStart={async () => {}} onLogin={onLogin} />
    );
    fireEvent.click(getByText("Already playing? Log in"));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("a failed start surfaces an error and re-enables the CTA (never a dead end)", async () => {
    const onStart = vi.fn().mockRejectedValue(new Error("offline"));
    const { getByText, findByText } = render(
      <BrainBoostIntro onStart={onStart} onLogin={() => {}} />
    );
    fireEvent.click(getByText("PLAY DAILY ROYALE"));
    await findByText("Something went wrong");
    expect(getByText("PLAY DAILY ROYALE")).toBeTruthy();
  });
});
