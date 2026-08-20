import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stat } from "@/ui/Stat";

describe("Stat", () => {
  it("renders the global rank prominently as #N with a 'rank' label and 'of M' context", () => {
    const html = renderToStaticMarkup(
      <Stat label="rank" value="#3" sub="of 12" accent="var(--brand-2)" />,
    );
    expect(html).toContain("#3"); // rank, prominent
    expect(html).toContain("rank"); // label
    expect(html).toContain("of 12"); // smaller context
  });

  it("renders without a context line when sub is omitted", () => {
    const html = renderToStaticMarkup(<Stat label="division" value="Bronze" />);
    expect(html).toContain("Bronze");
    expect(html).not.toContain(" · ");
  });
});
