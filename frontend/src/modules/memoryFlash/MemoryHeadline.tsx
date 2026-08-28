import { useEffect, useState } from "react";
import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * The headline + subline, and the small slide/fade that plays when the phase changes.
 *
 * The phase change is the most important moment in the round — it is the instant the game stops
 * talking and starts listening — and it used to be a silent text swap. Animating it is what makes
 * "watch" and "your turn" feel like two different modes rather than two different strings.
 *
 * Keyed re-entry rather than a transition library: the component simply remounts its text on a new
 * `phaseKey`, which restarts the CSS animation. No dependency, and it collapses to nothing under
 * the global reduced-motion rule.
 */
export function MemoryHeadline({
  phaseKey,
  title,
  subtitle,
  tone,
}: {
  /** Changes when the copy should re-animate. */
  phaseKey: string;
  title: string;
  subtitle?: string;
  tone?: "default" | "good" | "bad";
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(phaseKey);
  useEffect(() => setShown(phaseKey), [phaseKey]);

  const color =
    tone === "good" ? "var(--lime)" : tone === "bad" ? "var(--pink)" : "var(--text)";

  return (
    <div style={{ minHeight: "clamp(56px, 14vw, 74px)", marginBottom: "clamp(8px, 2vw, 12px)" }}>
      <div
        key={shown}
        className={reduced ? undefined : tone === "good" ? "rr-win-pop" : "rr-headline-in"}
        style={{ display: "flex", flexDirection: "column", gap: 3 }}
      >
        <div
          style={{
            // Substantially bigger than the old 17px line — this is the focal point of the screen,
            // and on a phone the player reads it in peripheral vision while watching the grid.
            fontSize: "clamp(24px, 6.6vw, 32px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            color,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: "clamp(12.5px, 3.3vw, 14px)",
              fontWeight: 600,
              lineHeight: 1.35,
              color: "var(--muted)",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
