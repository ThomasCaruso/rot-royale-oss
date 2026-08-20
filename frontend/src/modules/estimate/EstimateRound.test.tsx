// @vitest-environment jsdom
/**
 * EstimateRound. Pins the round chrome it previously lacked entirely (verb header, guess pips, the
 * live range caption, the gold CTA) and the behaviour that must survive any restyle: the committed
 * guess is the ROUNDED value, the server's direction/band comes back as a ledger row, the range
 * narrows to the server's bounds, and `done` finalizes the round exactly once.
 *
 * The client never computes bounds or correctness (Invariant 1) — every number rendered here came
 * from the server response.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EstimateRound } from "@/modules/estimate/EstimateRound";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

primeArcadeTheme();

const cogEstimateGuess = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    cogEstimateGuess: (id: string, value: number) => cogEstimateGuess(id, value),
  },
}));

const spec = {
  prompt: "How many Earths fit inside the Sun?",
  unit: "Earths",
  difficulty: "two_step",
  max_guesses: 3,
  slider_min: 10,
  slider_max: 1000,
  cognition_instance_id: "inst-1",
};

// geomMid(10, 1000) = 100 — the opening value is deterministic, so the CTA label is assertable.
const OPENING = 100;

beforeEach(() => cogEstimateGuess.mockReset());
afterEach(cleanup);

describe("EstimateRound — chrome", () => {
  it("renders the verb header, prompt, unit and the live range", () => {
    const html = renderToStaticMarkup(<EstimateRound spec={spec} onComplete={() => {}} />);
    expect(html).toContain("Estimate");
    // The prompt's trailing keyword is lifted into brand violet, so the stem and the keyword are
    // separate nodes — that split IS the shared prompt treatment.
    expect(html).toContain("How many Earths fit inside the");
    expect(html).toContain('<span style="color:var(--brand-2)">Sun</span>');
    expect(html).toContain("Earths");
    expect(html).toContain("Range");
    expect(html).toContain("10 – 1,000");
  });

  it("uses the shared themed surfaces instead of the old hardcoded debug card", () => {
    const html = renderToStaticMarkup(<EstimateRound spec={spec} onComplete={() => {}} />);
    expect(html).toContain("rr-glass"); // GlassCard, like every other round
    expect(html).toContain("var(--brand)"); // token-driven, not #111/#fff
    expect(html).not.toContain("2px solid #111");
    expect(html).not.toContain("-apple-system");
  });

  it("shows one pip per available guess", () => {
    const { container } = render(<EstimateRound spec={spec} onComplete={() => {}} />);
    expect(container.querySelector('[aria-label="3 of 3 guesses left"]')).not.toBeNull();
  });

  it("labels the CTA with the value that will actually be committed", () => {
    const { getByRole } = render(<EstimateRound spec={spec} onComplete={() => {}} />);
    expect(getByRole("button").textContent).toContain(`${OPENING} Earths`);
  });
});

describe("EstimateRound — guessing", () => {
  it("commits the rounded value and renders the server's verdict as a ledger row", async () => {
    cogEstimateGuess.mockResolvedValue({
      correct: false,
      direction: "higher",
      band: "far",
      done: false,
      guesses_left: 2,
      points: 0,
      slider_min: 200,
      slider_max: 900,
    });
    const { getByRole, findByText, container } = render(
      <EstimateRound spec={spec} onComplete={() => {}} />,
    );

    fireEvent.click(getByRole("button"));

    await waitFor(() => expect(cogEstimateGuess).toHaveBeenCalledTimes(1));
    expect(cogEstimateGuess).toHaveBeenCalledWith("inst-1", OPENING);

    // The verdict the server sent — direction and band — is shown, and nothing else.
    expect(await findByText(/Higher/)).toBeTruthy();
    expect(container.textContent).toContain("way off");
    // The range closed in to the SERVER's narrowed bounds.
    expect(container.textContent).toContain("200 – 900");
    // A guess was spent.
    expect(container.querySelector('[aria-label="2 of 3 guesses left"]')).not.toBeNull();
  });

  it("finalizes the round once when the server reports done", async () => {
    cogEstimateGuess.mockResolvedValue({
      correct: true,
      direction: null,
      band: null,
      done: true,
      guesses_left: 2,
      points: 140,
      slider_min: 10,
      slider_max: 1000,
    });
    const onComplete = vi.fn();
    const { getByRole } = render(<EstimateRound spec={spec} onComplete={onComplete} />);

    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    // A second press after the round is finished must not fire another guess or another complete.
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(cogEstimateGuess).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
