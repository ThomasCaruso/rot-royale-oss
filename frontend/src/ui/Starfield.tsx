import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * Subtle drifting starfield over the violet vignette (DESIGN §5). GPU-cheap: two layered
 * radial-gradient tiles translated on the compositor. Fixed behind everything; pointer-transparent.
 * Reduced-motion: render the static field, no drift.
 */
export function Starfield() {
  const reduced = useReducedMotion();
  // A dense far layer (small, dim, many) + a sparser near layer (bigger, brighter, brand-tinted) drift
  // at different speeds for real parallax depth — a deep space arena, not a few specks.
  const far =
    "radial-gradient(1px 1px at 8% 12%, rgba(255,255,255,.5), transparent)," +
    "radial-gradient(1px 1px at 22% 32%, rgba(255,255,255,.4), transparent)," +
    "radial-gradient(1px 1px at 37% 18%, rgba(199,180,255,.45), transparent)," +
    "radial-gradient(1px 1px at 48% 52%, rgba(255,255,255,.4), transparent)," +
    "radial-gradient(1px 1px at 61% 28%, rgba(255,255,255,.45), transparent)," +
    "radial-gradient(1px 1px at 73% 66%, rgba(199,180,255,.4), transparent)," +
    "radial-gradient(1px 1px at 84% 38%, rgba(255,255,255,.45), transparent)," +
    "radial-gradient(1px 1px at 92% 74%, rgba(255,255,255,.35), transparent)," +
    "radial-gradient(1px 1px at 15% 78%, rgba(255,255,255,.4), transparent)," +
    "radial-gradient(1px 1px at 30% 88%, rgba(199,180,255,.4), transparent)," +
    "radial-gradient(1px 1px at 56% 84%, rgba(255,255,255,.35), transparent)," +
    "radial-gradient(1px 1px at 68% 92%, rgba(255,255,255,.4), transparent)";
  const near =
    "radial-gradient(1.8px 1.8px at 18% 24%, rgba(255,255,255,.85), transparent)," +
    "radial-gradient(2px 2px at 64% 16%, rgba(255,201,30,.6), transparent)," +
    "radial-gradient(1.7px 1.7px at 80% 58%, rgba(255,255,255,.7), transparent)," +
    "radial-gradient(1.9px 1.9px at 40% 70%, rgba(168,85,247,.6), transparent)," +
    "radial-gradient(1.7px 1.7px at 12% 60%, rgba(255,255,255,.6), transparent)," +
    "radial-gradient(2px 2px at 90% 28%, rgba(255,255,255,.55), transparent)";
  return (
    // rr-stars: the mono ("Blank") skin hides the whole field via CSS — blank space, no cosmos.
    <div aria-hidden className="rr-stars" style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: "-50% 0",
          backgroundImage: far,
          backgroundSize: "440px 440px",
          opacity: 0.8,
          animation: reduced ? "none" : "rr-drift 90s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "-50% 0",
          backgroundImage: near,
          backgroundSize: "680px 680px",
          opacity: 0.9,
          animation: reduced ? "none" : "rr-drift 55s linear infinite",
        }}
      />
    </div>
  );
}
