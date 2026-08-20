// @vitest-environment jsdom
/**
 * AnswerPill is the hero answer tap target. These pin the anti-cheat property (in-play states never
 * encode correctness) and the reveal states (correct=green, wrong=red) — plus the big tap target and
 * graceful long-label wrapping.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnswerPill } from "@/ui/AnswerPill";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

afterEach(cleanup);

describe("AnswerPill — anti-cheat in-play states", () => {
  it("default and selected look the same calm violet (no green/red correctness signal)", () => {
    const def = renderToStaticMarkup(<AnswerPill index={0} label="Paris" state="default" />);
    const sel = renderToStaticMarkup(<AnswerPill index={0} label="Paris" state="selected" />);
    // Neither in-play state may use the correct (lime) or wrong (pink) colors.
    for (const html of [def, sel]) {
      expect(html).not.toContain("var(--lime)");
      expect(html).not.toContain("var(--pink)");
    }
    // selected is distinguished only by the brand violet lock, not correctness.
    expect(sel).toContain("var(--brand-2)");
  });

  it("keeps a big tap target (>=56px)", () => {
    const html = renderToStaticMarkup(<AnswerPill index={0} label="Paris" />);
    expect(html).toContain("min-height:60px");
  });

  it("wraps long labels gracefully (no clipping)", () => {
    const long = "A very long answer option that should wrap onto multiple lines without clipping";
    const html = renderToStaticMarkup(<AnswerPill index={3} label={long} />);
    expect(html).toContain("word-break:break-word");
    expect(html).toContain(long);
  });
});

describe("AnswerPill — reveal states (correctness shown only here)", () => {
  it("correct uses lime, wrong uses pink", () => {
    expect(renderToStaticMarkup(<AnswerPill index={0} label="Paris" state="correct" />)).toContain(
      "var(--lime)",
    );
    expect(renderToStaticMarkup(<AnswerPill index={1} label="Rome" state="wrong" />)).toContain(
      "var(--pink)",
    );
  });
});

describe("AnswerPill — press feedback", () => {
  it("scales down on pointer-down for an interactive pill, and back on pointer-up", () => {
    const { getByRole } = render(<AnswerPill index={0} label="Paris" state="default" />);
    const btn = getByRole("button");
    fireEvent.pointerDown(btn);
    expect(btn.getAttribute("style")).toContain("scale(0.97)");
    fireEvent.pointerUp(btn);
    expect(btn.getAttribute("style")).not.toContain("scale(0.97)");
  });

  it("does not add a press squish to a disabled reveal pill", () => {
    const { getByRole } = render(<AnswerPill index={0} label="Paris" state="correct" disabled />);
    const btn = getByRole("button");
    fireEvent.pointerDown(btn);
    expect(btn.getAttribute("style")).not.toContain("scale(0.97)");
  });
});
