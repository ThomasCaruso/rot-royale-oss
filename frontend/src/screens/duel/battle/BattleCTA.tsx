/**
 * The Battle Mode CTA — a deep royal-PURPLE cap (not gold): full-width, glassy violet gradient with a
 * brand rim, white display-face label and a subtle light sweep. Deliberately one step below the Daily
 * Royale hero's gold CTA in the light hierarchy — it contrasts and invites without competing for the
 * screen's single gold action. Same physical press (2px) and reduced-motion behaviour as GoldButton.
 */
import { FitText } from "@/ui/FitText";

export function BattleCTA({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="display"
      onClick={onClick}
      onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(2px)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        padding: "clamp(13px, 3.8cqw, 16px) clamp(16px, 5cqw, 26px)",
        borderRadius: "clamp(14px, 4cqw, 18px)",
        border: "1.5px solid color-mix(in srgb, var(--brand-2) 62%, transparent)",
        // Beveled royal purple: a lit violet top rolling into a near-black base, so the cap reads as
        // a pressed 3D button in the same physical language as the gold CTA — just a quieter metal.
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--brand-2) 46%, var(--brand)) 0%, color-mix(in srgb, var(--brand) 78%, #0d0620) 48%, color-mix(in srgb, var(--brand) 44%, #0a0518) 100%)",
        color: "var(--text)",
        letterSpacing: 0.6,
        cursor: "pointer",
        boxShadow:
          "inset 0 2px 0 rgba(255,255,255,.22), inset 0 -5px 10px rgba(0,0,0,.45), 0 5px 0 color-mix(in srgb, var(--brand) 42%, #120826), 0 14px 26px rgba(0,0,0,.45), 0 0 20px color-mix(in srgb, var(--brand-2) 22%, transparent)",
        textShadow: "0 2px 0 rgba(10,5,24,.6), 0 4px 10px rgba(0,0,0,.5)",
        transition: "transform 80ms",
      }}
    >
      {/* Slow light sweep — the same premium glint as the gold caps, at violet-glass intensity. */}
      <span
        aria-hidden
        className="rr-card-shine"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "-30%",
          width: "55%",
          background: "linear-gradient(115deg, transparent 38%, rgba(255,255,255,.22) 50%, transparent 62%)",
          pointerEvents: "none",
        }}
      />
      <FitText
        as="span"
        size="clamp(15px, 4.4cqw, 18px)"
        min={0.6}
        style={{ position: "relative", zIndex: 1, display: "block", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}
      >
        {label}
      </FitText>
    </button>
  );
}
