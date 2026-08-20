import { useEffect, useState } from "react";
import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * "Here's what you missed."
 *
 * A change round used to end with the word "Not quite" and nothing else — the player never learned
 * where the change was, so a miss taught them nothing and a hit felt unconfirmed. This shows the
 * altered frame with the real region ringed and their own tap marked, which is the only feedback
 * that makes the next round easier.
 *
 * The ring is drawn AFTER a beat rather than immediately: landing it on the same frame as the image
 * gives the eye nothing to search, and the half-second of looking before the answer appears is what
 * makes "oh, THERE" land. Reduced motion skips straight to the answer.
 */
type Bbox = { x: number; y: number; w: number; h: number };

const RING_DELAY_MS = 450;

export function ChangeReveal({
  spec,
  answer,
  result,
  correct,
}: {
  spec: { altered_url: string; width: number; height: number };
  answer: Record<string, unknown>;
  result: Record<string, unknown>;
  correct: boolean;
}) {
  const reduced = useReducedMotion();
  const [showRing, setShowRing] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    const id = window.setTimeout(() => setShowRing(true), RING_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [reduced]);

  // The box comes from server_answer; the submit response carries it too, so accept either rather
  // than depending on which path finalized the round.
  const raw = (answer.bbox ?? result.bbox) as Bbox | undefined;
  const tap = result.tap as { x: number; y: number } | undefined;
  if (!raw || typeof raw.x !== "number") return null;

  const pct = (n: number) => `${n * 100}%`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: `${spec.width} / ${spec.height}`,
          borderRadius: "var(--radius-ctl, 14px)",
          overflow: "hidden",
          border: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <img
          src={spec.altered_url}
          alt=""
          draggable={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        {/* Dim everything except the answer, so the eye is led rather than asked to hunt. Four
            panels around the box beat an SVG mask here: no extra element type, no viewBox maths,
            and it scales with the container for free. */}
        {showRing && (
          <>
            {[
              { left: 0, top: 0, width: "100%", height: pct(raw.y) },
              { left: 0, top: pct(raw.y + raw.h), width: "100%", bottom: 0 },
              { left: 0, top: pct(raw.y), width: pct(raw.x), height: pct(raw.h) },
              { left: pct(raw.x + raw.w), top: pct(raw.y), right: 0, height: pct(raw.h) },
            ].map((box, i) => (
              <div
                key={i}
                aria-hidden
                style={{
                  position: "absolute",
                  background: "rgba(10, 8, 6, 0.55)",
                  transition: reduced ? "none" : "opacity 260ms ease",
                  ...box,
                }}
              />
            ))}
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: pct(raw.x),
                top: pct(raw.y),
                width: pct(raw.w),
                height: pct(raw.h),
                border: "2.5px solid var(--lime)",
                borderRadius: 8,
                boxShadow: "0 0 0 3px rgba(0,0,0,.35), 0 0 20px var(--glow)",
                transition: reduced ? "none" : "transform 320ms cubic-bezier(.2,.9,.3,1.2)",
              }}
            />
          </>
        )}
        {/* The player's own tap, so a near miss reads as "I was close" rather than "I was wrong".
            Only shown on a miss — on a hit it sits under the ring and just adds clutter. */}
        {tap && !correct && typeof tap.x === "number" && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: pct(tap.x),
              top: pct(tap.y),
              width: 26,
              height: 26,
              marginLeft: -13,
              marginTop: -13,
              borderRadius: "50%",
              border: "2px solid var(--pink)",
              background: "rgba(0,0,0,.25)",
              boxShadow: "0 0 0 2px rgba(0,0,0,.35)",
            }}
          />
        )}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
        {correct ? "You found it." : tap ? "The change was here." : "Time — the change was here."}
      </div>
    </div>
  );
}
