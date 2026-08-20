import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StarterVault } from "./StarterVault";
import type { VaultItem } from "@/api/client";

// The previews and the avatar pull bitmaps/canvas work that adds nothing here; the identity of the
// theme each preview was handed IS asserted, via a marker.
vi.mock("@/screens/vault/ThemeShot", () => ({
  ThemeShot: ({ theme }: { theme: { id: string } }) => <i data-preview={theme.id} />,
}));
vi.mock("@/screens/home/Avatar", () => ({ Avatar: () => null }));

/** The real catalog shape the server returns: themes are COIN-priced, several are EARNED (cost 0 +
 *  a requirement) rather than sold, and one is equipped. */
const ITEMS: VaultItem[] = [
  { id: "starter", kind: "theme", cost: 0, currency: "coins", owned: true, equipped: true, locked: false, coming_soon: false, requirement: null },
  { id: "bubblegum", kind: "theme", cost: 400, currency: "coins", owned: false, equipped: false, locked: false, coming_soon: false, requirement: null },
  { id: "forest", kind: "theme", cost: 600, currency: "coins", owned: false, equipped: false, locked: false, coming_soon: false, requirement: null },
  // Earned, not sold: cost 0 behind a requirement.
  { id: "daylight", kind: "theme", cost: 0, currency: "coins", owned: false, equipped: false, locked: true, coming_soon: false, requirement: "royales:7" },
  // Unreleased: the server locks these and refuses to sell them, whatever the price or progress.
  { id: "midnight", kind: "theme", cost: 900, currency: "coins", owned: false, equipped: false, locked: true, coming_soon: true, requirement: null },
  { id: "apex", kind: "theme", cost: 0, currency: "coins", owned: false, equipped: false, locked: true, coming_soon: true, requirement: "division:Apex" },
];

function render(items: VaultItem[] = ITEMS, tab: "themes" | "frames" = "themes") {
  return renderToStaticMarkup(
    <StarterVault
      tab={tab}
      onTab={() => {}}
      onBack={() => {}}
      items={items}
      balance={511}
      gemsBalance={307}
      equippedFrameId={null}
      avatarPreset="knight"
      busy={false}
      onBuy={() => {}}
      onEquip={() => {}}
    />,
  );
}

describe("StarterVault — the equipped piece is the centrepiece", () => {
  it("features the equipped theme by name, with its Equipped status and its own preview", () => {
    const html = render();
    expect(html).toContain("Equipped theme");
    expect(html).toContain("Starter");
    expect(html).toContain("Equipped");
    expect(html).toContain('data-preview="starter"');
  });

  it("does not repeat the equipped theme down in the product grid", () => {
    const html = render();
    // One preview for the featured card, and none of the tiles is the equipped one.
    expect((html.match(/data-preview="starter"/g) ?? []).length).toBe(1);
  });
});

describe("StarterVault — prices come from the catalog, never invented", () => {
  it("shows each buyable theme's real coin price", () => {
    const html = render();
    for (const price of ["400", "600", "900"]) expect(html).toContain(price);
  });

  it("shows an EARNED theme's goal instead of a price", () => {
    const html = render();
    // daylight is cost 0 + `royales:7` — a goal, not something with a price tag.
    expect(html).toContain("Play 7 Daily Royales");
  });

  it("groups unreleased themes under the Coming soon divider, below the available ones", () => {
    const html = render();
    expect(html).toContain("Coming soon");
    // The unreleased pair is present but shows neither a price nor a goal — just the quiet label.
    const soonLabels = (html.match(/Coming soon/g) ?? []).length;
    expect(soonLabels).toBeGreaterThanOrEqual(3); // divider + one per unreleased tile
    // …and the divider sits after the available section, not before it.
    expect(html.indexOf("All themes")).toBeLessThan(html.indexOf("Coming soon"));
  });

  it("lets a holder EQUIP an unreleased theme — ownership outranks release state", () => {
    // The grant path (beta access, an admin grant) writes a real ownership row. The server's
    // equip check is ownership-only, so the UI must offer it rather than hiding behind the label.
    const held = ITEMS.map((i) =>
      i.id === "midnight" ? { ...i, owned: true } : i,
    );
    const html = render(held);
    const tile = html.slice(html.indexOf('data-preview="midnight"'));
    expect(tile.slice(0, 1400)).toContain("Equip");
  });

  it("shows only the quiet label to someone who does NOT hold an unreleased theme", () => {
    const html = render();
    const tile = html.slice(html.indexOf('data-preview="midnight"'));
    const window600 = tile.slice(0, 1400);
    expect(window600).toContain("Coming soon");
    expect(window600).not.toContain("Equip");
  });

  it("never offers a price for an unreleased theme, even though it has one", () => {
    const html = render();
    // midnight costs 900 but is unreleased — the number must not appear as a buy affordance.
    const midnightTile = html.slice(html.indexOf('data-preview="midnight"'));
    expect(midnightTile.slice(0, 1400)).not.toContain("900");
  });

  it("renders exactly the items it was given — no filler tiles", () => {
    const html = render();
    const previews = (html.match(/data-preview="/g) ?? []).length;
    expect(previews).toBe(ITEMS.length); // featured + every tile, released and not
  });
});

describe("StarterVault — layout", () => {
  it("lays the catalog out two per row, scrolling with the page (not a sideways shelf)", () => {
    const html = render();
    expect(html).toContain("grid-template-columns:repeat(2, minmax(0, 1fr))");
    expect(html).not.toContain("overflow-x:auto");
  });

  it("labels the catalog section", () => {
    expect(render()).toContain("All themes");
    expect(render(ITEMS, "frames")).toContain("All frames");
  });
});

describe("StarterVault — honesty copy", () => {
  it("contains no cash/gambling language", () => {
    const html = render().toLowerCase();
    for (const word of ["cash", "prize", "wager", "gambl", "jackpot", "casino", "lottery", "payout"]) {
      expect(html, `banned word "${word}"`).not.toContain(word);
    }
  });
});
