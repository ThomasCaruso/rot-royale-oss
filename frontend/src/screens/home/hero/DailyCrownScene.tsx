import { lobbyArt } from "@/assets/lobby";

/**
 * The right-side TROPHY scene of the Daily Royale card — a self-contained square STAGE composed of
 * explicit layers (back → front):
 *   0. a soft ambient radial glow that melts the stage into the card lighting;
 *   1. `crownArena` — the circular trivia backdrop (quiz card + numbered 1–8 tiles), rendered at its
 *      REAL 442:391 aspect ratio at ~94% of the stage so it is never stretched and never clipped;
 *   2. a breathing underglow grounding the crown (tightens on card hover, rr-daily-glow);
 *   3. `crownHero` — the gold crown, the focal object, front-centre over the arena (idle float).
 * The stage owns its safe bounds: every layer is sized/positioned relative to the wrapper and stays
 * inside it, so the parent can place the stage anywhere without anything getting cut off. The arena
 * is deliberately smaller + slightly translucent so it supports the crown instead of competing with
 * it. The scene renders identically in EVERY hero state (before/live/locked/settled) — standings
 * live in the results reveal and the leaderboard, never as a giant number on this card.
 * Decorative → aria-hidden.
 */
export function DailyCrownScene({ size, reduced }: { size: string; reduced: boolean }) {
  return (
    <div aria-hidden style={{ position: "relative", width: size, aspectRatio: "1 / 1", pointerEvents: "none" }}>
      {/* 0 — Ambient stage light behind the arena, so the backdrop's circular halo fades into the
          card instead of ending in a visible edge. */}
      <span
        style={{
          position: "absolute",
          inset: "-4%",
          zIndex: 0,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 50% 56%, color-mix(in srgb, var(--brand) 46%, transparent) 0%, color-mix(in srgb, var(--brand-2) 22%, transparent) 48%, transparent 74%)",
          filter: "blur(10px)",
        }}
      />

      {/* 1 — Arena backdrop at its intrinsic aspect ratio, bottom-anchored in the stage — fully
          visible, never stretched square, never bleeding. It can span the whole stage because the
          asset's own un-matted halo already fades to nothing well before its bitmap edge. */}
      <img
        src={lobbyArt.crownArena}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          aspectRatio: "442 / 391",
          objectFit: "contain",
          display: "block",
          zIndex: 1,
          opacity: 0.92,
        }}
      />

      {/* 2 — Breathing underglow grounding the crown over the arena's quiz card. */}
      <span
        className={reduced ? "rr-daily-glow" : "rr-daily-glow rr-aura"}
        style={{
          position: "absolute",
          left: "29%",
          right: "29%",
          top: "62%",
          height: "15%",
          zIndex: 2,
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse at 50% 50%, color-mix(in srgb, var(--amber) 44%, transparent), color-mix(in srgb, var(--brand-2) 26%, transparent) 52%, transparent 76%)",
          filter: "blur(8px)",
        }}
      />

      {/* 3 — The crown, the focal object at ~54% of the stage, CENTRED on the arena's quiz card and
          seated low (top 22%) so the card's "?" header peeks above the prongs and the crown's base
          lands on the dome's glowing floor — per the hero reference art. The numbered tiles stay
          visible on both sides (idle float, specular-lifted). */}
      <div className={reduced ? undefined : "rr-float"} style={{ position: "absolute", left: "23%", right: "23%", top: "22%", zIndex: 3 }}>
        <img
          src={lobbyArt.crownHero}
          alt=""
          draggable={false}
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            objectFit: "contain",
            display: "block",
            filter: "drop-shadow(0 12px 16px rgba(0,0,0,.55)) brightness(1.07) contrast(1.06) saturate(1.05)",
          }}
        />
      </div>
    </div>
  );
}
