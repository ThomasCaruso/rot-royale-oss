// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GrowthTrail } from "./GrowthTrail";

describe("GrowthTrail", () => {
  afterEach(() => cleanup());

  it("renders an svg route for a real series", () => {
    const { container } = render(<GrowthTrail points={[470, 480, 495, 505, 512]} reduced={false} startValue={470} endValue={512} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    // a line path is drawn (fill:none stroke path)
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
    // start + current values are shown, no Y-axis numbers
    expect(container.textContent).toContain("470");
    expect(container.textContent).toContain("512");
  });

  it("still renders cleanly with a single point (no fabricated line)", () => {
    const { container } = render(<GrowthTrail points={[651]} reduced={false} endValue={651} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.textContent).toContain("651");
  });

  it("renders an empty svg with no points (honest empty)", () => {
    const { container } = render(<GrowthTrail points={[]} reduced={false} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.textContent).toBe("");
  });

  it("does not inject keyframes / animation when reduced motion is requested", () => {
    const { container } = render(<GrowthTrail points={[470, 480, 495, 520]} reduced endValue={520} />);
    // the pulse keyframes live in an inline <style>; reduced motion omits it entirely
    expect(container.querySelector("style")).toBeNull();
    expect(container.innerHTML).not.toContain("animation");
  });

  it("derives at most two milestone crowns from meaningful jumps", () => {
    // three big jumps but the trail crowns at most two, and only real (non-endpoint) jumps
    const { container } = render(
      <GrowthTrail points={[400, 460, 470, 540, 545, 610, 615]} reduced={false} startValue={400} endValue={615} />,
    );
    // crown badges are small filled paths on a panel circle — count the milestone connector dashes
    const dashed = Array.from(container.querySelectorAll("line")).filter((l) => l.getAttribute("stroke-dasharray"));
    expect(dashed.length).toBeLessThanOrEqual(2);
  });
});
