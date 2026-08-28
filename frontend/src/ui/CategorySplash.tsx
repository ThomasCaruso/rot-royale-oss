import { useArtStyle } from "@/theme/useArtStyle";
import { Display } from "@/ui/Display";

/**
 * Category splash before each round (DESIGN §5) — a punchy ~1s anticipation beat staged like a
 * reveal, not a floating emoji:
 *  - a wide ambient violet pool grounds the moment in the world;
 *  - the icon sits on a gold-rimmed MEDALLION (gradient ring over dark glass) under a breathing
 *    halo, with one gold spark orbiting it;
 *  - a diamond-hairline eyebrow frames CATEGORY, and the big display name rises in a beat after
 *    the medallion (a staged two-step entrance — no glare/flash sweeps).
 * All entrance/idle motion rides existing keyframes (rr-splash-in / rr-rise-in / rr-aura /
 * rr-orbit / rr-twinkle), which the global reduced-motion media query collapses to an instant,
 * fully-legible state. Decorative layers are aria-hidden.
 */
export function CategorySplash({
  category,
  icon,
  eyebrow,
}: {
  category: string;
  icon: string;
  /**
   * The small caps line above the name, localized BY THE CALLER — this component holds no i18n.
   *
   * REQUIRED, deliberately. It was a hardcoded English "Category" for this component's whole life,
   * which meant campaign and practice showed the word "Category" to Spanish, French and Turkish
   * players on every single round. Giving it a default would have left both of those callers
   * silently wrong; requiring it made the compiler find them. It is also no longer always the
   * word "Category" — the interactive cognition rounds carry no trivia category, and calling
   * "Spot the change" a Category would be a lie.
   */
  eyebrow: string;
}) {
  const mono = useArtStyle() === "mono";

  // Mono ("Blank"): the anticipation beat is pure typography — a whisper-caps eyebrow over the
  // category name, centred in space. No medallion, no emoji, no pool, no sparks.
  if (mono) {
    return (
      <div
        className="rr-splash-in"
        style={{
          flex: 1,
          minHeight: 300,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            fontWeight: 600,
            color: "var(--faint)",
          }}
        >
          {eyebrow}
        </span>
        <Display style={{ fontSize: "clamp(30px, 9vw, 40px)", textAlign: "center", lineHeight: 1.08, padding: "0 14px" }}>
          {category}
        </Display>
        <span aria-hidden style={{ width: 34, height: 1, background: "var(--line)" }} />
      </div>
    );
  }

  return (
    <div
      className="rr-splash-in"
      style={{
        position: "relative",
        flex: 1,
        minHeight: 300,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 15,
      }}
    >
      {/* Ambient stage pool behind the whole moment. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "44%",
          width: "min(340px, 92%)",
          aspectRatio: "1 / 0.9",
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--brand) 34%, transparent) 0%, color-mix(in srgb, var(--brand-2) 14%, transparent) 44%, transparent 70%)",
          filter: "blur(14px)",
          pointerEvents: "none",
        }}
      />
      {/* A few twinkling specks so the stage feels alive (not confetti). */}
      {SPECKS.map((s, i) => (
        <span
          key={i}
          aria-hidden
          className="rr-twinkle"
          style={{
            position: "absolute",
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            background: s.color,
            opacity: 0.6,
            animationDelay: s.delay,
            pointerEvents: "none",
          }}
        />
      ))}

      {/* The medallion: breathing halo → gold-rimmed gradient ring → dark glass face → icon,
          with one orbiting gold spark. */}
      <div style={{ position: "relative", width: 150, height: 150, display: "grid", placeItems: "center" }}>
        <span
          aria-hidden
          className="rr-aura"
          style={{
            position: "absolute",
            inset: "-12%",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--amber) 30%, transparent) 0%, color-mix(in srgb, var(--brand-2) 34%, transparent) 42%, transparent 70%)",
            filter: "blur(10px)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            // Double-background: dark glass face in the padding box, gold→violet ring in the border box.
            background:
              "radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--brand) 44%, var(--panel2)), color-mix(in srgb, var(--panel) 85%, black) 72%) padding-box," +
              " linear-gradient(135deg, #FFE9A8 0%, var(--amber) 32%, var(--brand-2) 72%, var(--brand) 100%) border-box",
            border: "2.5px solid transparent",
            boxShadow:
              "inset 0 2px 10px rgba(0,0,0,.5), inset 0 -10px 20px color-mix(in srgb, var(--brand) 30%, transparent), 0 16px 38px rgba(0,0,0,.5), 0 0 30px color-mix(in srgb, var(--brand-2) 26%, transparent)",
          }}
        >
          <div
            className="emoji"
            style={{ fontSize: 62, filter: "drop-shadow(0 8px 18px rgba(0,0,0,.55))", lineHeight: 1 }}
          >
            {icon}
          </div>
        </div>
        {/* One gold spark orbiting the ring. */}
        <span aria-hidden className="rr-orbit" style={{ position: "absolute", inset: 6, pointerEvents: "none" }}>
          <span
            style={{
              position: "absolute",
              top: -2,
              left: "50%",
              marginLeft: -2.5,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #FFE9A8, var(--amber))",
              boxShadow: "0 0 8px color-mix(in srgb, var(--amber) 85%, transparent)",
            }}
          />
        </span>
      </div>

      {/* Diamond-hairline eyebrow framing the label. */}
      <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 26, height: 1, background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--amber) 70%, transparent))" }} />
        <span style={{ width: 4.5, height: 4.5, transform: "rotate(45deg)", background: "linear-gradient(135deg, #FFE58A, var(--amber))", boxShadow: "0 0 6px color-mix(in srgb, var(--amber) 70%, transparent)" }} />
        <span
          style={{
            fontSize: 10.5,
            letterSpacing: 5,
            textTransform: "uppercase",
            fontWeight: 800,
            color: "var(--brand-2)",
          }}
        >
          {eyebrow}
        </span>
        <span style={{ width: 4.5, height: 4.5, transform: "rotate(45deg)", background: "linear-gradient(135deg, #FFE58A, var(--amber))", boxShadow: "0 0 6px color-mix(in srgb, var(--amber) 70%, transparent)" }} />
        <span style={{ width: 26, height: 1, background: "linear-gradient(90deg, color-mix(in srgb, var(--amber) 70%, transparent), transparent)" }} />
      </div>

      {/* The name rises in a beat AFTER the medallion pops (staged entrance, no glare sweeps) —
          rr-rise-in is springy + `both`-filled, so the delay holds it hidden then settles it. */}
      <Display
        className="rr-rise-in"
        style={{
          fontSize: "clamp(32px, 9.6vw, 42px)",
          textAlign: "center",
          lineHeight: 1.05,
          padding: "2px 14px",
          textShadow: "0 3px 0 rgba(16,8,38,.7), 0 6px 0 rgba(9,4,26,.5), 0 12px 24px rgba(0,0,0,.55)",
          animationDelay: "0.16s",
        }}
      >
        {category}
      </Display>
    </div>
  );
}

/** Twinkle speck placements (static so renders stay stable). */
const SPECKS = [
  { left: "16%", top: "22%", size: 3, color: "#e6dbff", delay: "0s" },
  { left: "80%", top: "30%", size: 2.5, color: "#ffd88a", delay: "0.5s" },
  { left: "24%", top: "72%", size: 2, color: "#cdb8ff", delay: "0.9s" },
  { left: "74%", top: "66%", size: 2.5, color: "#efe6ff", delay: "1.3s" },
] as const;
