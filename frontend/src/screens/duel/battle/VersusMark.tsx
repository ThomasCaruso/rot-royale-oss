/**
 * The centre "VS" of the Battle Mode scene — a gold 3D lettermark (in the app's display face, so it
 * matches the wordmark, not a flat vector) over a subtle diagonal gold divider/slash. A soft radial
 * glow behind it brightens on card hover (`rr-battle-glow`), and the mark gives a calm idle throb
 * (`rr-duel-vs`). Decorative → aria-hidden.
 */
export function VersusMark({ size, reduced }: { size: string; reduced: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        flex: "none",
        alignSelf: "center",
        display: "grid",
        placeItems: "center",
        margin: "0 clamp(-15px, -4cqw, -9px)",
        zIndex: 3,
      }}
    >
      {/* Soft glow pocket behind the mark — swells on hover. */}
      <span
        className="rr-battle-glow"
        style={{
          position: "absolute",
          width: "clamp(46px, 14cqw, 68px)",
          height: "clamp(46px, 14cqw, 68px)",
          borderRadius: "50%",
          background: "radial-gradient(circle, color-mix(in srgb, var(--amber) 46%, transparent), transparent 68%)",
          filter: "blur(7px)",
          opacity: 0.7,
          pointerEvents: "none",
        }}
      />
      {/* Diagonal gold slash — the "energy divider" between the two rivals; flashes bright on the
          face-off clash beat (shared rr-faceoff timeline). */}
      <span
        className={reduced ? undefined : "rr-faceoff-flash"}
        style={{
          position: "absolute",
          width: "clamp(3px, 1.1cqw, 6px)",
          height: "clamp(64px, 20cqw, 100px)",
          transform: "rotate(18deg)",
          borderRadius: 999,
          background:
            "linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--amber) 80%, transparent) 28%, color-mix(in srgb, var(--amber) 96%, white) 50%, color-mix(in srgb, var(--amber) 80%, transparent) 72%, transparent 100%)",
          filter: "blur(1px)",
          opacity: 0.55,
          pointerEvents: "none",
        }}
      />
      <span
        className={reduced ? "display" : "display rr-duel-vs"}
        style={{
          position: "relative",
          fontSize: size,
          lineHeight: 1,
          color: "#ffd24a",
          WebkitTextFillColor: "#ffd24a",
          WebkitTextStroke: "1.2px #7a4a00",
          textShadow: "0 2px 0 #9A5B00, 0 4px 0 #6d3f00, 0 0 16px rgba(255,201,30,.7)",
          letterSpacing: "-.02em",
        }}
      >
        VS
      </span>
    </div>
  );
}
