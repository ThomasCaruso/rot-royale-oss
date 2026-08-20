import { getFrame, getPreset, presetProfileImage } from "@/theme/identity";
import { useArtStyle, useThemeArt } from "@/theme/useArtStyle";

/**
 * Stylized player avatar — an emoji glyph on a glowing gradient disc, or (when `art` is passed)
 * an illustrated portrait filling the disc. `preset` picks one of the 8 identity presets
 * (default: ninja — with no new props this renders exactly the pre-identity Avatar). `art` is a
 * surface-level upgrade used by marquee chrome (the Home header) so the player's chip matches
 * the illustrated Battle portraits instead of a platform emoji; the preset still tints the disc
 * behind the portrait and remains the identity everywhere else. `frame` layers an equipped
 * cosmetic frame: the ring gradient replaces the plain `ring` border, an optional glow joins the
 * box-shadow, and an optional ornament emoji perches on the top edge (like the Vault
 * equipped-crown badge). The prestige frame adds a slow gold glow pulse — decorative only,
 * collapsed by the global prefers-reduced-motion rule, and gated by `animated` (row lists pass
 * false so a scrolling leaderboard never runs an infinite animation per row; the static glow
 * keeps the prestige read). Optional green "online" dot at the lower-right.
 */
/** Thin chess-knight outline — the mono skin's single refined player mark. One continuous
 * profile stroke (chest → jaw → muzzle → forehead → ear → crest → back of the neck), a baseline
 * and an eye dot. Stroke-only, hairline weight, drawn for legibility from 32px rows up. */
function KnightGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      style={{ width: size, height: size, display: "block" }}
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* base */}
      <path d="M7.6 19.5h9.2" />
      {/* head + neck profile */}
      <path d="M9 19.5c.5-2.6 1-4.6 2-6.4-1.3-.1-2.6-.7-3.4-1.6-.4-.4-.4-1-.05-1.45.8-.75 1.7-1.3 2.7-1.75.2-.8.5-1.5.9-2.1l.8-1.55.85 1.55c1.5.8 2.6 2.1 3.1 3.8.4 1.3.5 2.7.4 4.1-.1 1.9-.2 3.6-.1 5.4" />
      {/* eye */}
      <circle cx="10.7" cy="10" r="0.55" fill={color} stroke="none" />
    </svg>
  );
}

export function Avatar({
  size = 44,
  online = false,
  ring = "var(--line)",
  preset,
  frame = null,
  art,
  animated = true,
}: {
  size?: number;
  online?: boolean;
  /** Plain ring color when no frame is equipped (e.g. isMe-gold in leaderboard rows). */
  ring?: string;
  preset?: string;
  frame?: string | null;
  /** Illustrated portrait src — replaces the emoji face (the ring/frame/ornament/dot all stay). */
  art?: string;
  /** Gates the prestige frame's infinite glow pulse. Status moments (podium, header, editor,
   * reveal) keep it true; dense row lists pass false — zero animation, glow stays static. */
  animated?: boolean;
}) {
  const mono = useArtStyle() === "mono";
  const themeArt = useThemeArt();
  const p = getPreset(preset);
  const f = getFrame(frame);
  const hasRing = Boolean(f?.ring);
  // Line-art is for the ART-LESS Blank pair ONLY, which is what `mono` used to mean.
  //
  // It stopped meaning that when Starter adopted style `mono` for its calm surface language: the
  // whole Starter system (Starter + every skin) then fell into the line-art branch, which draws a
  // plain hairline ring and DROPS the equipped frame. The portrait still came through, so it looked
  // deliberate rather than broken — an equipped frame simply never appeared anywhere except the two
  // screens that had discovered the problem and passed an opt-in flag.
  //
  // That flag is gone. A cosmetic the player earned and chose to wear must not depend on each call
  // site remembering a prop: nine of them did not, including the Home header. Keying off `themeArt`
  // alone restores the original intent — the Blank pair has no art set and keeps its line-art mark,
  // everything else shows the identity as owned.
  const monoLineArt = mono && themeArt == null;
  // The chosen avatar image (or an explicit marquee portrait): the illustrated human portrait on
  // every theme except the Blank pair, which keeps its line-art mark.
  const imgSrc = art ?? presetProfileImage(p, monoLineArt && themeArt == null);

  // Mono ("Blank") profile icons are pure line-art: a hairline ring with a thin chess-knight
  // outline — one refined mark for every player (no emoji face, no portrait bitmap, no conic
  // frame metals; the whole skin is one drawing style). Identity/frames stay fully visible on
  // every other theme.
  if (monoLineArt) {
    const dotSize = Math.max(8, Math.round(size * 0.22));
    const strokeCol = "color-mix(in srgb, var(--text) 75%, transparent)";
    return (
      <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
            background: "var(--panel)",
            border: `1.5px solid color-mix(in srgb, var(--text) 45%, transparent)`,
          }}
        >
          {imgSrc ? (
            <img
              src={imgSrc}
              alt=""
              aria-hidden
              draggable={false}
              loading="lazy"
              decoding="async"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <KnightGlyph size={size * 0.56} color={strokeCol} />
          )}
        </div>
        {online && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: dotSize,
              height: dotSize,
              borderRadius: "50%",
              background: "var(--lime)",
              border: "2px solid var(--panel)",
            }}
          />
        )}
      </div>
    );
  }
  // Frame rings thicken with size so the machined-metal conic detail still reads on big
  // podium/preview avatars (a hair bolder than the old 0.055 — the rings are the merchandise).
  const ringW = hasRing ? Math.max(2, Math.round(size * 0.07)) : 2;
  // Depth that follows the theme instead of forcing black. The old `rgba(0,0,0,.45)` inset + `.35`
  // drop were tuned for the dark arcade skin; over the now theme-mixed disc (see `disc()` in
  // theme/identity.ts) they re-darkened the medallion on the light themes and put a hard grey
  // shadow on the ivory page. Mixing from `--text` keeps the same sculpted read on dark skins while
  // going appropriately soft on light ones.
  const inset = "color-mix(in srgb, var(--text) 22%, transparent)";
  const drop = "color-mix(in srgb, var(--text) 16%, transparent)";
  const baseShadow = `inset 0 2px 6px ${inset}, 0 4px 12px ${drop}`;
  const dot = Math.max(9, Math.round(size * 0.26));
  const ornamentSize = Math.max(11, Math.round(size * 0.36));
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <div
        className={f?.prestige && animated ? "emoji rr-glow-pulse" : "emoji"}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          fontSize: size * 0.52,
          lineHeight: 1,
          // Double-background trick: the disc gradient fills the padding box while the frame's
          // ring gradient paints the (transparent) border box — one element, any gradient ring.
          background: hasRing && f?.ring ? `${p.bg} padding-box, ${f.ring} border-box` : p.bg,
          border: hasRing ? `${ringW}px solid transparent` : `2px solid ${ring}`,
          boxShadow: f?.glow ? `${baseShadow}, ${f.glow}` : baseShadow,
          color: "#d7ccff",
          overflow: "hidden",
        }}
      >
        {imgSrc ? (
          <img
            src={imgSrc}
            alt=""
            aria-hidden
            draggable={false}
            loading="lazy"
            decoding="async"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "50%" }}
          />
        ) : (
          p.emoji
        )}
      </div>
      {f?.ornament && (
        <span
          aria-hidden
          className="emoji"
          style={{
            position: "absolute",
            top: Math.round(-size * 0.24),
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: ornamentSize,
            lineHeight: 1,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,.6))",
            pointerEvents: "none",
          }}
        >
          {f.ornament}
        </span>
      )}
      {online && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: dot,
            height: dot,
            borderRadius: "50%",
            background: "#43e35f",
            border: "2px solid #160730",
            boxShadow: "0 0 8px rgba(67,227,95,.8)",
          }}
        />
      )}
    </div>
  );
}
