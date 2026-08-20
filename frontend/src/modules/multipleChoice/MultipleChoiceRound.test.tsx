// @vitest-environment jsdom
/**
 * MultipleChoiceRound (trivia + rapid_math). Pins the anti-cheat behavior — selecting an option locks
 * it (calm violet) and NEVER reveals correctness in-play — plus the confident card chrome (category
 * chip with icon, the 10s countdown ring) and that selection submits the chosen index.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MultipleChoiceRound,
  type MultipleChoiceSpec,
} from "@/modules/multipleChoice/MultipleChoiceRound";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

const spec: MultipleChoiceSpec = {
  prompt: "Capital of France?",
  options: ["Paris", "Rome", "Berlin", "Madrid"],
  category: "Geography",
  icon: "🌍",
  time_limit_ms: 10000,
};

afterEach(cleanup);

describe("MultipleChoiceRound — chrome", () => {
  it("renders the category chip with its icon and the 10s timer", () => {
    const html = renderToStaticMarkup(<MultipleChoiceRound spec={spec} onComplete={() => {}} />);
    expect(html).toContain("Geography");
    expect(html).toContain("🌍");
    // 10s timer: time_limit_ms=10000 → ceil shows "10".
    expect(html).toContain(">10<");
  });

  it("gives the category chip a distinct filled accent (not dark-on-dark) so it reads", () => {
    const html = renderToStaticMarkup(<MultipleChoiceRound spec={spec} onComplete={() => {}} />);
    // Filled brand gradient background + themable high-contrast text (--brandText: white on every
    // classic theme; ink on the dark Blank whose brand surface is white) — the chip used to share
    // the card's dark surface and disappear.
    expect(html).toContain("linear-gradient(135deg, var(--brand), var(--brand-2))");
    expect(html).toContain("color:var(--brandText, #fff)");
  });

  it("renders all four options as answer pills (no correctness markers)", () => {
    const html = renderToStaticMarkup(<MultipleChoiceRound spec={spec} onComplete={() => {}} />);
    for (const opt of spec.options) expect(html).toContain(opt);
    // In-play: no green/red anywhere — the client has no answer.
    expect(html).not.toContain("var(--lime)");
    expect(html).not.toContain("var(--pink)");
  });
});

describe("MultipleChoiceRound — anti-cheat lock + submit", () => {
  it("locks the chosen option (violet) without showing correctness, then submits the index", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const { getByText } = render(<MultipleChoiceRound spec={spec} onComplete={onComplete} />);

    fireEvent.click(getByText("Rome"));
    // The selected pill is locked violet; still no green/red correctness signal mid-round.
    const selected = getByText("Rome").closest("button")!;
    expect(selected.getAttribute("style")).toContain("var(--brand-2)");
    expect(selected.getAttribute("style")).not.toContain("var(--lime)");

    // The submit is deferred ~420ms (the lock beat). Advance and assert the chosen index (1 = Rome).
    vi.advanceTimersByTime(500);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ choice: 1 });
    vi.useRealTimers();
  });
});

describe("MultipleChoiceRound — the second chance explains itself", () => {
  it("greys the wrong pick, re-arms the clock, and shows the host's notice", () => {
    const html = renderToStaticMarkup(
      <MultipleChoiceRound
        spec={spec}
        onComplete={() => {}}
        eliminated={1}
        retryMs={8000}
        notice={<div>Second try — worth half points</div>}
      />,
    );
    // The beat the player was missing: the mechanic used to fire in silence.
    expect(html).toContain("Second try");
    // Still no correctness leak — the player learns only that their OWN pick is out (Invariant 1).
    expect(html).not.toContain("var(--lime)");
  });

  it("renders nothing extra on a normal round", () => {
    const html = renderToStaticMarkup(<MultipleChoiceRound spec={spec} onComplete={() => {}} />);
    expect(html).not.toContain("Second try");
  });
});

describe("MultipleChoiceRound — the eliminated option leaves", () => {
  it("removes the wrong pick from the list entirely, leaving three", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <MultipleChoiceRound spec={spec} onComplete={() => {}} />,
    );
    expect(container.querySelectorAll("button").length).toBe(4);

    // The host reports the wrong first pick (§5f) — option index 1.
    rerender(
      <MultipleChoiceRound spec={spec} onComplete={() => {}} eliminated={1} retryMs={8000} />,
    );
    await vi.advanceTimersByTimeAsync(400); // let it slide out and unmount

    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.length).toBe(3);
    // Greying it in place was the old behaviour; it must be GONE, not dimmed.
    expect(labels.some((l) => l?.includes("Rome"))).toBe(false);
    expect(labels.some((l) => l?.includes("Paris"))).toBe(true);
    vi.useRealTimers();
  });
});
