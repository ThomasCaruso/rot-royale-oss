// @vitest-environment jsdom
/**
 * CategorySplash is the ~1s anticipation beat between questions, and Confetti is the reveal reward.
 * These pin that the splash always shows its category + icon (state visible), and that under
 * prefers-reduced-motion the decorative confetti drops entirely while state stays intact.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CategorySplash } from "@/ui/CategorySplash";
import { Confetti } from "@/ui/Confetti";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

/** Install a matchMedia stub that reports the given reduced-motion preference. */
function stubMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(cleanup);

describe("CategorySplash", () => {
  beforeEach(() => stubMatchMedia(false));

  it("always renders the category name and icon (state is never hidden behind motion)", () => {
    const html = renderToStaticMarkup(<CategorySplash category="Science & Nature" icon="🔬" />);
    expect(html).toContain("Science &amp; Nature");
    expect(html).toContain("🔬");
    expect(html).toContain("Category");
  });
});

describe("Confetti — reduced motion", () => {
  it("renders the canvas when motion is allowed", () => {
    stubMatchMedia(false);
    const { container } = render(<Confetti burstKey={1} />);
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("renders nothing under prefers-reduced-motion (decorative motion drops)", () => {
    stubMatchMedia(true);
    const { container } = render(<Confetti burstKey={1} />);
    expect(container.querySelector("canvas")).toBeNull();
  });
});
