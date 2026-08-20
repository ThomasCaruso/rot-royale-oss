// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChangeReveal } from "./ChangeReveal";

// Scoped to each render's container, not `screen` — see EstimateReveal.test.tsx for why.
const spec = { altered_url: "/assets/change/x_altered.jpg", width: 1024, height: 683 };
const bbox = { x: 0.4, y: 0.25, w: 0.07, h: 0.13 };

describe("ChangeReveal", () => {
  it("shows the altered frame so the answer is visible at all", () => {
    const { container } = render(
      <ChangeReveal
        spec={spec}
        answer={{ bbox }}
        result={{ tap: { x: 0.6, y: 0.5 } }}
        correct={false}
      />,
    );
    expect(container.querySelector(`img[src="${spec.altered_url}"]`)).toBeTruthy();
    expect(container.textContent).toContain("The change was here.");
  });

  it("confirms a hit rather than just saying nothing", () => {
    const { container } = render(
      <ChangeReveal spec={spec} answer={{ bbox }} result={{ tap: { x: 0.42, y: 0.3 } }} correct />,
    );
    expect(container.textContent).toContain("You found it.");
  });

  it("names a timeout differently from a wrong tap", () => {
    // No tap at all means the clock ran out; blaming the player for a miss they never made reads
    // as the game being wrong about what happened.
    const { container } = render(
      <ChangeReveal spec={spec} answer={{ bbox }} result={{}} correct={false} />,
    );
    expect(container.textContent).toContain("Time — the change was here.");
  });

  it("accepts the bbox from the submit response when the server answer lacks it", () => {
    // The round can finalize down two paths; the reveal must not depend on which one ran.
    const { container } = render(
      <ChangeReveal spec={spec} answer={{}} result={{ bbox }} correct={false} />,
    );
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("renders nothing rather than a broken frame when no box is available", () => {
    const { container } = render(
      <ChangeReveal spec={spec} answer={{}} result={{}} correct={false} />,
    );
    expect(container.textContent).toBe("");
  });
});
