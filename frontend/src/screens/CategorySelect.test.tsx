import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CategoryList } from "@/screens/CategorySelect";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

describe("CategoryList", () => {
  const categories = [
    { name: "Science", count: 12 },
    { name: "History", count: 8 },
  ];

  it("offers a Mixed option plus a card per servable category with its icon and count", () => {
    const withCanonical = [{ name: "Science & Nature", count: 12 }, ...categories];
    const html = renderToStaticMarkup(
      <CategoryList categories={withCanonical} onPick={() => {}} />,
    );
    expect(html).toContain("Mixed"); // the all-categories practice option
    expect(html).toContain("5 rounds"); // mixed = the unchanged 5-round session
    expect(html).toContain("Science &amp; Nature"); // category name (& is HTML-escaped in markup)
    expect(html).toContain("History");
    expect(html).toContain("🔬"); // a descriptive icon, keyed to the canonical category
    expect(html).toContain("12 questions"); // each card shows how much content backs the category
  });

  it("renders nothing extra when there are no categories yet (just Mixed)", () => {
    const onPick = vi.fn();
    const html = renderToStaticMarkup(<CategoryList categories={[]} onPick={onPick} />);
    expect(html).toContain("Mixed");
    expect(html).not.toContain("Science");
  });
});
