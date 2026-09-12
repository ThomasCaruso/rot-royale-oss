/**
 * BattleAvatar tests — the Duel arena medallion has three faces (SSR renderToStaticMarkup, matching
 * the DuelLobby test convention):
 *  - `identity` (+ sleek) → the player's OWN pfp: their equipped avatar preset portrait (every theme
 *    except Rot Royale);
 *  - `mystery` (+ sleek, no identity) → an honest unknown rival disc — never a fabricated pfp;
 *  - `src` → the special illustrated art (the Rot Royale founder look), not a preset portrait.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BattleAvatar } from "./BattleAvatar";

const common = { glow: "var(--brand-2)", size: "80px", reduced: true };

describe("BattleAvatar", () => {
  it("renders the player's own pfp (their equipped preset portrait) when given an identity", () => {
    const html = renderToStaticMarkup(
      <BattleAvatar {...common} label="YOU" sleek identity={{ preset: "bishop", frame: null }} />,
    );
    expect(html).toContain("/avatars/portraits/bishop.webp?v=3");
  });

  it("renders an honest mystery disc for the rival — no portrait, just the ? mark", () => {
    const html = renderToStaticMarkup(<BattleAvatar {...common} label="RIVAL" sleek mystery />);
    expect(html).not.toContain("/avatars/"); // never a fabricated identity
    expect(html).toContain("?");
  });

  it("keeps the special illustrated art (the founder look) when given a src, not a pfp", () => {
    const html = renderToStaticMarkup(<BattleAvatar {...common} label="YOU" src="/founder/hooded.png" />);
    expect(html).toContain("/founder/hooded.png");
    expect(html).not.toContain("/avatars/");
  });
});
