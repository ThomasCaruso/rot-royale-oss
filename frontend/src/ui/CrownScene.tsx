import { lobbyArt } from "@/assets/lobby";

/**
 * The Daily Royale marquee art — the real `crown-hero.png` (gold crown on a violet velvet pedestal,
 * with its own modelled shadow) framed large as the dominant hero object: a breathing gold aura
 * behind it and an idle float. The PNG carries the depth, so we don't redraw a platform — we just
 * light it. Decorative → aria-hidden. Motion is CSS (collapsed by reduced-motion).
 */
export function CrownScene({ width = 158 }: { width?: number | string }) {
  return (
    <div aria-hidden style={{ position: "relative", width, height: width, aspectRatio: "1 / 1", display: "grid", placeItems: "center" }}>
      {/* Breathing aura behind the crown — gold core into a violet halo. */}
      <div
        className="rr-aura"
        style={{
          position: "absolute",
          width: "112%",
          height: "112%",
          top: "3%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--amber) 58%, transparent) 0%, color-mix(in srgb, var(--brand-2) 32%, transparent) 38%, transparent 68%)",
          filter: "blur(4px)",
          pointerEvents: "none",
        }}
      />

      <div className="rr-float" style={{ position: "relative", width: "100%", height: "100%" }}>
        <img
          src={lobbyArt.crownHero}
          alt=""
          aria-hidden
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            filter: "drop-shadow(0 14px 20px rgba(0,0,0,.55))",
          }}
        />
      </div>
    </div>
  );
}
