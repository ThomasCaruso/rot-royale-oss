import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { findBannedTerms } from "@/i18n/copyGuard";
import { NextStepCard } from "@/screens/home/NextStepCard";

function render() {
  return renderToStaticMarkup(
    <NextStepCard world="Science" levelNumber={7} title="Pressure" onContinue={() => {}} />,
  );
}

describe("NextStepCard", () => {
  it("shows the campaign eyebrow, the world/level, and the level title", () => {
    const out = render();
    expect(out).toContain("Campaign");
    expect(out).toContain("Science · Level 7");
    expect(out).toContain("Pressure");
  });
  it("is copy-guard clean", () => {
    expect(findBannedTerms(render())).toEqual([]);
  });
});
