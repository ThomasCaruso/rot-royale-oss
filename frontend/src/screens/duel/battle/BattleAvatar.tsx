import { getFrame, getPreset, presetProfileImage } from "@/theme/identity";
import { useArtStyle, useThemeArt } from "@/theme/useArtStyle";
import { FitText } from "@/ui/FitText";

/**
 * One side of the Battle Mode versus scene — a circular player medallion on a soft, colour-matched
 * glow that dissolves the edge into the card. A slow ring breath (rr-aura, opacity only) keeps it
 * alive; the ring tightens on card hover (`rr-battle-ring`).
 *
 * Two faces feed the medallion:
 *  - `src` — an illustrated portrait asset (the special **Rot Royale** hooded art, and the mystery
 *    bot silhouette). This is the rich, arcade look reserved for the founder theme.
 *  - `identity` (with `sleek`) — the player's OWN pfp: their equipped `avatar_preset` portrait +
 *    `equipped_frame` ring, rendered on every OTHER theme. `sleek` drops the heavy neon bloom for a
 *    crisp framed disc so the scene matches the app's cleaner modern look (and the mono/"Blank"
 *    skin renders a flat hairline disc, exactly like the profile Avatar). The rival keeps an honest
 *    mystery "?" disc — never a fabricated identity.
 *
 * The circle is the ONLY thing in layout flow (size × size); the role label is positioned absolutely
 * beneath it so the centre VS aligns to the faces (not to circle-plus-label). Decorative →
 * aria-hidden.
 */
export function BattleAvatar({
  src,
  identity,
  label,
  sub,
  glow,
  size,
  reduced,
  z = 1,
  className,
  mystery = false,
  sleek = false,
}: {
  /** Illustrated portrait asset — the Rot Royale founder art (you) / bot silhouette (rival). */
  src?: string;
  /** The player's own identity — renders their preset portrait + equipped frame (non-royale). */
  identity?: { preset: string; frame: string | null };
  label: string;
  /** Optional second, smaller line under the label (e.g. the player's W–L record). */
  sub?: string;
  /** Halo colour — pass the token that matches the face (var(--brand-2) / var(--amber)). */
  glow: string;
  /** CSS length (e.g. a clamp()) so the whole scene scales with the card. */
  size: string;
  reduced: boolean;
  /** Stacking order so the overlapping circles read as layered depth, not a collision. */
  z?: number;
  /** Idle-motion class on the medallion wrapper (e.g. the rr-faceoff lean-in). */
  className?: string;
  /** Unknown-opponent treatment: a silhouette / mystery disc under a "?" — the rival is revealed
   * later (pre-match), so the unknown carries tension here. */
  mystery?: boolean;
  /** Clean, modern medallion (framed pfp / flat mystery disc) — every theme except Rot Royale. */
  sleek?: boolean;
}) {
  const mono = useArtStyle() === "mono";

  let face: React.ReactNode;
  if (sleek && identity) {
    face = <IdentityDisc identity={identity} mono={mono} />;
  } else if (sleek) {
    face = <MysteryDisc mono={mono} />;
  } else {
    // Legacy illustrated art (Rot Royale founder portrait / bot silhouette).
    face = (
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        className="rr-battle-ring"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
          filter: mystery
            ? "brightness(0.3) saturate(0.45) drop-shadow(0 8px 16px rgba(0,0,0,.6))"
            : "drop-shadow(0 8px 16px rgba(0,0,0,.6))",
        }}
      />
    );
  }

  // The rich violet bloom + under-avatar spotlight belong to the founder art; the sleek pfp scene
  // uses a tighter, softer halo (and mono goes fully flat — the disc's own shadow grounds it).
  const showSpotlight = !sleek;
  const showHalo = !mono;

  return (
    <div className={className} style={{ position: "relative", width: size, height: size, flex: "none", zIndex: z, display: "grid", placeItems: "center" }}>
      {showSpotlight && (
        /* Spotlight platform — a soft colour-matched ellipse pooling beneath the ring. */
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "-6%",
            right: "-6%",
            bottom: "-14%",
            height: "22%",
            borderRadius: "50%",
            background: `radial-gradient(ellipse at 50% 50%, ${glow} 0%, color-mix(in srgb, ${glow}, transparent 60%) 45%, transparent 74%)`,
            filter: "blur(6px)",
            opacity: 0.55,
            pointerEvents: "none",
          }}
        />
      )}
      {showHalo && (
        /* Ring glow — larger than the medallion + blurred so the edge melts into the card; slow
           breath. Tighter + fainter in the sleek scene. */
        <span
          aria-hidden
          className={reduced ? "rr-battle-glow" : "rr-battle-glow rr-aura"}
          style={{
            position: "absolute",
            inset: sleek ? "-8%" : "-16%",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${glow} 0%, color-mix(in srgb, ${glow}, transparent 55%) 40%, transparent 68%)`,
            filter: sleek ? "blur(7px)" : "blur(10px)",
            opacity: sleek ? 0.4 : 0.85,
            pointerEvents: "none",
          }}
        />
      )}
      {face}
      {/* Mystery mark — a soft "?" over the silhouette / mystery disc (who's behind it is the hook). */}
      {mystery && (
        <span
          aria-hidden
          className="display"
          style={{
            position: "absolute",
            fontSize: "clamp(22px, 6.8cqw, 32px)",
            color: mono ? "var(--muted)" : "#cdb8ff",
            textShadow: mono ? "none" : "0 2px 6px rgba(0,0,0,.7), 0 0 14px color-mix(in srgb, var(--brand-2) 70%, transparent)",
            pointerEvents: "none",
          }}
        >
          ?
        </span>
      )}
      {/* Role label (+ optional sub line) — absolute, centred beneath the circle (out of flow so
          the VS stays face-aligned). */}
      <span
        style={{
          position: "absolute",
          top: "calc(100% + clamp(4px, 1.4cqw, 7px))",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
      >
        <FitText
          as="span"
          size="clamp(9px, 2.6cqw, 11px)"
          min={0.66}
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            maxWidth: size,
            fontWeight: 900,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: "color-mix(in srgb, var(--text) 82%, var(--muted))",
          }}
        >
          {label}
        </FitText>
        {sub && (
          <span style={{ whiteSpace: "nowrap", fontSize: "clamp(8.5px, 2.4cqw, 10px)", fontWeight: 800, letterSpacing: ".06em", color: "var(--muted)" }}>
            {sub}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The player's own pfp inside the medallion — their preset portrait behind their equipped frame
 * ring (mirrors the profile Avatar's rendering, at medallion scale with cqw-relative ring width so
 * it stays responsive). Mono/"Blank" is a flat hairline disc — the whole skin is one line style.
 */
function IdentityDisc({ identity, mono }: { identity: { preset: string; frame: string | null }; mono: boolean }) {
  const themeArt = useThemeArt();
  const p = getPreset(identity.preset);
  const f = getFrame(identity.frame);
  const hasRing = Boolean(f?.ring);
  // Blank keeps the line-art mark; every other theme wears the human character portrait.
  const imgSrc = presetProfileImage(p, mono && themeArt == null);
  const portrait = imgSrc ? (
    <img
      src={imgSrc}
      alt=""
      aria-hidden
      draggable={false}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "50%" }}
    />
  ) : (
    <span className="emoji" aria-hidden style={{ fontSize: "clamp(26px, 9cqw, 44px)", color: "#d7ccff", lineHeight: 1 }}>
      {p.emoji}
    </span>
  );

  if (mono) {
    return (
      <div
        className="rr-battle-ring"
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          overflow: "hidden",
          display: "grid",
          placeItems: "center",
          background: "var(--panel)",
          border: "1.5px solid color-mix(in srgb, var(--text) 40%, transparent)",
          boxShadow: "0 6px 16px rgba(0,0,0,.35)",
        }}
      >
        {portrait}
      </div>
    );
  }

  const baseShadow = "inset 0 2px 6px rgba(0,0,0,.4), 0 6px 16px rgba(0,0,0,.4)";
  return (
    <div
      className="rr-battle-ring"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
        // Double-background trick (as in Avatar): disc gradient fills the padding box, the frame's
        // ring gradient paints the transparent border box — one element, any gradient ring.
        background: hasRing && f?.ring ? `${p.bg} padding-box, ${f.ring} border-box` : p.bg,
        border: hasRing ? "clamp(3px, 1.2cqw, 5px) solid transparent" : "2px solid color-mix(in srgb, var(--brand-2) 50%, var(--line))",
        boxShadow: f?.glow ? `${baseShadow}, ${f.glow}` : baseShadow,
      }}
    >
      {portrait}
    </div>
  );
}

/** The rival's honest unknown — a clean disc (the "?" mark is drawn by the parent). Never a pfp. */
function MysteryDisc({ mono }: { mono: boolean }) {
  return (
    <div
      className="rr-battle-ring"
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        background: mono
          ? "var(--panel)"
          : "linear-gradient(180deg, color-mix(in srgb, var(--brand) 22%, var(--panel2)), var(--panel))",
        border: mono
          ? "1.5px solid color-mix(in srgb, var(--text) 30%, transparent)"
          : "2px solid color-mix(in srgb, var(--brand-2) 40%, transparent)",
        boxShadow: "0 6px 16px rgba(0,0,0,.35)",
      }}
    />
  );
}
