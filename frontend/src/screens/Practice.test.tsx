import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PracticeAnswerResponse } from "@/api/client";
import { PracticeReveal } from "@/screens/Practice";

const round = {
  idx: 0,
  type: "trivia",
  client_spec: { prompt: "Capital of France?", options: ["Paris", "Rome", "Berlin", "Madrid"] },
};

function reveal(over: Partial<PracticeAnswerResponse>): PracticeAnswerResponse {
  return {
    idx: 0,
    module_type: "trivia",
    correct: false,
    valid: true,
    answer: { correctIndex: 0 },
    explanation: "Paris has been France's capital since the 12th century.",
    finished: false,
    correct_count: null,
    total: null,
    accuracy: null,
    sharpness: null,
    sharpness_gained: null,
    ...over,
  };
}

const render = (
  rev: PracticeAnswerResponse,
  choice: number | null,
  celebrate = false,
) =>
  renderToStaticMarkup(
    <PracticeReveal
      round={round}
      reveal={rev}
      choice={choice}
      total={10}
      current={0}
      celebrate={celebrate}
      onContinue={() => {}}
    />,
  );

describe("PracticeReveal (lesson-mode feedback)", () => {
  it("on a wrong answer: highlights the correct option green, the chosen one red, and shows why", () => {
    const html = render(reveal({ correct: false, answer: { correctIndex: 0 } }), 2);
    expect(html).toContain("Not quite");
    expect(html).toContain("var(--lime)"); // the correct option pill (green)
    expect(html).toContain("var(--pink)"); // the player's wrong choice (red)
    expect(html).toContain("Paris has been France"); // the explanation — the learn-this payload
    expect(html).toContain("Here"); // the "Here's why" panel header
    expect(html).toContain("Continue"); // self-paced advance, not auto
  });

  it("on a correct answer: shows Correct! and the explanation", () => {
    const html = render(reveal({ correct: true, answer: { correctIndex: 0 } }), 0);
    expect(html).toContain("Correct!");
    expect(html).toContain("var(--lime)");
    expect(html).toContain("Paris has been France");
  });

  it("on a timeout (no choice): still reveals the correct answer + explanation, no crash", () => {
    const html = render(reveal({ correct: false }), null);
    expect(html).toContain("Not quite");
    expect(html).toContain("var(--lime)"); // correct still highlighted
    expect(html).toContain("Paris has been France");
  });

  it("with no explanation: renders the pills but no 'why' panel", () => {
    const html = render(reveal({ explanation: null }), 1);
    expect(html).not.toContain("Here&#x27;s why");
    expect(html).toContain("Paris"); // pills still render
  });

  it("on the final round: the button says See results", () => {
    const html = render(reveal({ finished: true }), 0);
    expect(html).toContain("See results");
  });

  it("does NOT fire confetti on a plain correct answer when celebrate is false/omitted", () => {
    // The default (no celebrate prop) is the un-celebrated correct answer — pop + explanation, no
    // confetti. Confetti renders a <canvas>; assert it's absent.
    const html = render(reveal({ correct: true, answer: { correctIndex: 0 } }), 0);
    expect(html).toContain("Correct!"); // the per-correct reward stays
    expect(html).not.toContain("<canvas"); // but no confetti burst
  });

  it("fires confetti when celebrate is true (streak milestone / final question)", () => {
    const html = render(reveal({ correct: true, answer: { correctIndex: 0 } }), 0, true);
    expect(html).toContain("<canvas"); // the gated confetti burst
  });
});
