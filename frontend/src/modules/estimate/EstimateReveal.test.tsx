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
    expect(container.textContent).toContain("1.8× low");
  });

  it("names the direction correctly when the guess was too high", () => {
    const { container } = render(
      <EstimateReveal spec={spec} answer={{ answer: 1000 }} result={{ final_guess: 2000 }} />,
    );
    expect(container.textContent).toContain("2× high");
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

describe("EstimateReveal — inside a Daily Royale", () => {
  // THE REGRESSION, and why the tests above did not catch it. Every one of them hands the answer in
  // through `answer`, which is how a round with a real stored server_answer works. A Royale
  // INTERACTIVE round has no such thing: `server_answer` is a binding marker
  // ({interactive, cognition_instance_id, module_type, difficulty}) with no `answer` key at all, so
  // this component hit its null guard and rendered NOTHING — the player saw "Correct!" or
  // "Not quite" and was never told the number. That is the one thing a Fermi round exists to say.
  const resolve = {
    answer: 1_300_000,
    unit: "Earths",
    reveal_explanation: "The Sun's volume is about 1.3 million times Earth's.",
    intuition_note: "Volume grows with the cube of size, so it explodes.",
    components: [
      { label: "Sun's volume", value: 1.41e18, unit: "km^3" },
      { label: "Earth's volume", value: 1.08e12, unit: "km^3" },
    ],
  };

  it("takes the answer from the resolve payload when server_answer carries none", () => {
    const { container } = render(
      <EstimateReveal
        spec={spec}
        answer={{ interactive: true, module_type: "estimate" }}
        result={{ final_guess: 550, reveal: resolve }}
      />,
    );
    expect(container.textContent).toContain("1,300,000");
  });

  it("says TWO things and no more — the number, and how far off", () => {
    // The resolve payload also carries the explanation, the components and the intuition note, and
    // an earlier pass rendered all of it. That turned a 90-second game's between-round beat into a
    // datasheet: sixty words of reading competing with the one number the round exists to deliver.
    // This asserts the restraint, because the payload will keep tempting future changes.
    const { container } = render(
      <EstimateReveal spec={spec} answer={{}} result={{ final_guess: 550, reveal: resolve }} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("1,300,000");
    expect(text).toContain("2,400× low");
    expect(text).not.toContain("about 1.3 million times Earth's");
    expect(text).not.toContain("Sun's volume");
    expect(text).not.toContain("Volume grows with the cube");
  });

  it("rounds the ratio to what a person actually reads", () => {
    // 1,300,000 / 550 is 2363.63..., and the tenth on a number that size is noise dressed as
    // precision — it reads as a machine talking rather than a game.
    const { container } = render(
      <EstimateReveal spec={spec} answer={{}} result={{ final_guess: 550, reveal: resolve }} />,
    );
    expect(container.textContent).not.toContain("2,363.6");
  });

  it("calls a dead-on guess exact rather than '1x low'", () => {
    const { container } = render(
      <EstimateReveal spec={spec} answer={{ answer: 1000 }} result={{ final_guess: 1000 }} />,
    );
    expect(container.textContent).toContain("Exact");
    expect(container.textContent).not.toContain("1× low");
  });
});
