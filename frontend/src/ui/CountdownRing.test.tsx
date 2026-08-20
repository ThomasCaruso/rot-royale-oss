/**
 * CountdownRing is the primary timer. These pin the seconds display, the gold→red low-time switch,
 * and the final-seconds urgency (tighter pulse + breathing red glow halo). Pure SVG, rendered to
 * static markup.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountdownRing } from "@/ui/CountdownRing";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

describe("CountdownRing", () => {
  it("shows ceil(seconds) for the remaining time", () => {
    expect(renderToStaticMarkup(<CountdownRing remainingMs={6200} totalMs={10000} />)).toContain(
      ">7<",
    );
  });

  it("is gold with plenty of time left", () => {
    const html = renderToStaticMarkup(<CountdownRing remainingMs={8000} totalMs={10000} />);
    expect(html).toContain("var(--amber)");
    expect(html).not.toContain("rr-ring-urgent");
  });

  it("turns red under 30% remaining", () => {
    const html = renderToStaticMarkup(<CountdownRing remainingMs={2500} totalMs={10000} />);
    expect(html).toContain("var(--pink)");
  });

  it("runs the urgent pulse + red glow halo in the final 3 seconds", () => {
    const html = renderToStaticMarkup(<CountdownRing remainingMs={2500} totalMs={10000} />);
    expect(html).toContain("rr-ring-urgent");
    expect(html).toContain("rr-ring-glow");
  });

  it("does not run the urgent animations when time is up (0ms)", () => {
    const html = renderToStaticMarkup(<CountdownRing remainingMs={0} totalMs={10000} />);
    expect(html).not.toContain("rr-ring-urgent");
  });
});
