// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EstimateReveal } from "./EstimateReveal";

// NB: queries are scoped to each render's own container, never `screen`. This project registers no
// vitest setupFiles, so testing-library's auto-cleanup never runs and document.body accumulates
// every render in the file — a `screen` query would match earlier tests' leftovers.
const spec = { unit: "charges", slider_min: 10, slider_max: 100_000 };

describe("EstimateReveal", () => {
  it("says the answer — the entire reason the question was worth asking", () => {
    const { container } = render(
      <EstimateReveal spec={spec} answer={{ answer: 1000 }} result={{ final_guess: 550 }} />,
    );
    expect(container.textContent).toContain("1,000");
    expect(container.textContent).toContain("Your guess 550");
  });

  it("expresses the miss as a RATIO, not a difference", () => {
    // These questions span orders of magnitude: "450 off" is meaningless, because 450 off a
    // thousand is a good guess and 450 off ten is not.
    const { container } = render(
      <EstimateReveal spec={spec} answer={{ answer: 1000 }} result={{ final_guess: 550 }} />,
    );
    expect(container.textContent).toContain("1.8x low");
  });

  it("names the direction correctly when the guess was too high", () => {
    const { container } = render(
      <EstimateReveal spec={spec} answer={{ answer: 1000 }} result={{ final_guess: 2000 }} />,
    );
    expect(container.textContent).toContain("2x high");
  });

  it("still shows the answer when the guess is missing", () => {
    // A timed-out or abandoned round has no final guess. The answer is the valuable half and must
    // survive on its own.
    const { container } = render(
      <EstimateReveal spec={spec} answer={{ answer: 1000 }} result={{}} />,
    );
    expect(container.textContent).toContain("1,000");
    expect(container.textContent).not.toContain("Your guess");
  });

  it("renders nothing rather than a broken card when the server sent no answer", () => {
    const { container } = render(
      <EstimateReveal spec={spec} answer={{}} result={{ final_guess: 550 }} />,
    );
    expect(container.textContent).toBe("");
  });
});
