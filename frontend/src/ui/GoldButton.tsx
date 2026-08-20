import { feedback } from "@/lib/haptics";
import { FitText } from "@/ui/FitText";

/** Primary gold CTA (DESIGN §4) — gradient, dark text, glow + slow idle pulse, presses 2px. Pass
 * `shine` to add a slow periodic light sweep across the cap (used for the marquee Home CTAs); it's
 * opt-in so the dozen other callers are untouched. The sweep collapses under reduced motion. */
export function GoldButton({
  children,
  onClick,
  disabled,
  idlePulse = true,
  shine = false,
  type = "button",
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  idlePulse?: boolean;
  shine?: boolean;
  type?: "button" | "submit";
  style?: React.CSSProperties;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="display"
      onPointerDown={(e) => {
        e.currentTarget.style.transform = "translateY(2px)";
        // Fires with the finger, not with the click — see AnswerPill for why that ordering is the
        // whole difference. Light, because a primary tap is a touch, not an outcome.
        if (!disabled) feedback("light");
      }}
      onPointerUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        padding: "15px 22px",
        borderRadius: "var(--radius-ctl, 16px)",
        border: "none",
        // Beveled gold: a bright top sheen rolling into a deeper base, with an inset top highlight
        // and inset bottom shadow so the cap reads as a pressed, three-dimensional button. The gold
        // is derived from the theme's --amber so the primary CTA stays cohesive on every skin (a
        // greener gold on Evergreen, a hotter amber on Midnight) instead of a stuck royale gold.
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--amber) 82%, white) 0%, var(--amber) 44%, color-mix(in srgb, var(--amber) 76%, black) 100%)",
        color: "var(--btnText)",
        fontSize: 20,
        letterSpacing: 0.5,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        // Physical cap: a bright top highlight, a solid amber "edge" beneath (the 0 6px 0 layer), a
        // wide warm glow, and an inset bottom shadow — so it reads as a chunky 3D game button.
        boxShadow:
          "inset 0 2px 0 rgba(255,255,255,.85), inset 0 -5px 10px rgba(140,84,0,.4), 0 6px 0 color-mix(in srgb, var(--amber) 55%, #5a3700), 0 16px 30px color-mix(in srgb, var(--amber) 50%, transparent), 0 18px 40px rgba(0,0,0,.4)",
        animation: idlePulse && !disabled ? "rr-glow-pulse 2.6s ease-in-out infinite" : "none",
        transition: "transform 80ms",
        ...style,
      }}
    >
      {shine && !disabled && (
        <span
          aria-hidden
          className="rr-card-shine"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "-30%",
            width: "55%",
            background: "linear-gradient(115deg, transparent 38%, rgba(255,255,255,.45) 50%, transparent 62%)",
            pointerEvents: "none",
          }}
        />
      )}
      {/* Label holds one line: a longer localized CTA shrinks to fit the cap rather than wrapping and
          growing the button. `size="1em"` scales from whatever font-size the button (or a caller's
          `style` override) sets, so English is byte-identical. */}
      <FitText
        as="span"
        size="1em"
        min={0.55}
        style={{
          position: "relative",
          zIndex: 1,
          display: "block",
          width: "100%",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textAlign: "center",
        }}
      >
        {children}
      </FitText>
    </button>
  );
}
