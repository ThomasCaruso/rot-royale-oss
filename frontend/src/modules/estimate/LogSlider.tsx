import { useEffect, useRef, useState } from "react";
import { clamp, fmtNum } from "@/modules/estimate/logScale";
import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * Logarithmic dial — the estimate gesture IS the mechanic, so this is the round's hero control.
 * Each decade occupies equal track width (value = min·(max/min)^t). Drag anywhere; the value rides
 * above the handle on the theme's display face. When the server narrows the bounds after a wrong
 * guess, min/max change, the whole track eases to the new scale and the rail pulses once — you
 * WATCH yourself converge. Bounds come from the server; this never computes them.
 *
 * Fully theme-token driven (--brand/--amber/--panel2/--faint), so every skin gets it for free and
 * the ivory Starter default no longer renders a black-bordered debug control mid-Royale.
 *
 * Shared by the Royale estimate round (modules/estimate/EstimateRound) and the dev playtest harness.
 */
export function LogSlider({
  min,
  max,
  value,
  unit,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  /** Rendered as a small-caps suffix under the hero number. Omitted by the dev harness. */
  unit?: string | null;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tightening, setTightening] = useState(false);
  const reduced = useReducedMotion();
  const lmin = Math.log(min);
  const span = Math.log(max) - lmin || 1;
  const toT = (v: number) => (Math.log(clamp(v, min, max)) - lmin) / span;
  const toV = (t: number) => Math.exp(lmin + clamp(t, 0, 1) * span);
  const t = toT(value);
  const ease = reduced ? "none" : "left 0.3s cubic-bezier(.22,1,.36,1)";

  // The range just closed in: pulse the rail once so the narrowing is FELT, not merely reflected in
  // relabelled ticks. Transform/opacity only, and skipped entirely under reduced motion.
  useEffect(() => {
    if (reduced) return;
    setTightening(true);
    const id = window.setTimeout(() => setTightening(false), 460);
    return () => window.clearTimeout(id);
  }, [min, max, reduced]);

  const setFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onChange(toV((clientX - r.left) / r.width));
  };

  // Decade ticks = powers of 10 that actually fall inside the current [min, max]. The tiny epsilon
  // keeps exact-power bounds (the initial decade/10 .. decade*10) on the axis despite float error.
  const ticks: number[] = [];
  const lo = Math.ceil(Math.log10(min) - 1e-9);
  const hi = Math.floor(Math.log10(max) + 1e-9);
  for (let p = lo; p <= hi; p++) ticks.push(10 ** p);

  const handleSize = dragging ? 42 : 36;

  return (
    <div style={{ padding: "14px 12px 20px", userSelect: "none", touchAction: "none" }}>
      {/* Hero readout: the theme display face (serif on Starter, chunky on arcade), riding the
          handle. This is the number the player is committing to, so it gets the largest type in
          the round.
          The readout is absolutely positioned (it tracks the handle), so this box RESERVES its
          space explicitly. It used to be `height: 0` with the space faked by the container's top
          padding — which meant enlarging the readout changed nothing about the layout, and shaving
          the padding silently dropped the number onto the line above. The dial is the round's whole
          body (a question card gets its height from four answer pills), so this reservation is also
          what gives the card presence in a centred stage. */}
      <div style={{ position: "relative", height: 120 }}>
        <div
          style={{
            position: "absolute",
            // Clamped so the readout never hangs off the card. After a wrong guess the value is
            // clamped onto the NEW bound, which puts t at exactly 0 or 1 — the common case, not an
            // edge case.
            left: `clamp(48px, ${t * 100}%, calc(100% - 48px))`,
            bottom: 14,
            transform: "translateX(-50%)",
            transition: dragging ? "none" : ease,
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          <div
            className="display"
            style={{
              fontSize: "clamp(44px, 12vw, 60px)",
              lineHeight: 1,
              color: "var(--text)",
              textShadow: "0 2px 10px var(--glow)",
            }}
          >
            {fmtNum(value)}
          </div>
          {unit && (
            <div
              style={{
                marginTop: 3,
                fontSize: 11,
                letterSpacing: 1.6,
                textTransform: "uppercase",
                fontWeight: 700,
                color: "var(--muted)",
              }}
            >
              {unit}
            </div>
          )}
        </div>
      </div>

      <div
        ref={trackRef}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* capture is best-effort; drag still works without it */
          }
          setDragging(true);
          setFromX(e.clientX);
        }}
        onPointerMove={(e) => dragging && setFromX(e.clientX)}
        onPointerUp={(e) => {
          setDragging(false);
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* no-op */
          }
        }}
        onPointerCancel={() => setDragging(false)}
        style={{
          position: "relative",
          height: 18,
          borderRadius: 999,
          // A recessed rail: the panel2 surface with an inset shadow so the fill reads as sitting
          // INSIDE the track rather than painted on top of it.
          background: "var(--panel2)",
          border: "1px solid var(--line)",
          boxShadow: tightening
            ? "inset 0 2px 5px rgba(0,0,0,.14), 0 0 0 3px var(--glow)"
            : "inset 0 2px 5px rgba(0,0,0,.14)",
          transform: tightening ? "scaleX(1.015)" : "scaleX(1)",
          transition: reduced ? "none" : "box-shadow .3s ease, transform .3s cubic-bezier(.22,1,.36,1)",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            position: "absolute",
            insetBlock: 0,
            left: 0,
            width: `${t * 100}%`,
            background: "linear-gradient(90deg, var(--brand), var(--brand-2))",
            borderRadius: 999,
            transition: dragging || reduced ? "none" : "width 0.3s cubic-bezier(.22,1,.36,1)",
          }}
        />
        {/* Handle: an ivory cap with a gold rim. Gold is the app's "this is the thing you act on"
            colour (CTA, timer, coins), so the grab point reads as precious rather than as a
            generic form control. */}
        <div
          style={{
            position: "absolute",
            // Same clamp as the readout: a handle sitting on t=0 / t=1 would otherwise be sliced in
            // half by the track's rounded end. The drag maths is unaffected — setFromX reads the
            // track rect, so only the PAINTED position is clamped.
            left: `clamp(${handleSize / 2}px, ${t * 100}%, calc(100% - ${handleSize / 2}px))`,
            top: "50%",
            width: handleSize,
            height: handleSize,
            marginLeft: -handleSize / 2,
            marginTop: -handleSize / 2,
            borderRadius: "50%",
            background: "linear-gradient(180deg, var(--panel) 0%, var(--panel2) 100%)",
            border: "3px solid var(--amber)",
            boxShadow: dragging
              ? "0 6px 18px rgba(0,0,0,.28), 0 0 0 10px var(--glow), inset 0 1px 0 rgba(255,255,255,.9)"
              : "0 3px 10px rgba(0,0,0,.20), 0 0 0 5px var(--glow), inset 0 1px 0 rgba(255,255,255,.9)",
            transition: dragging
              ? "width .12s, height .12s, margin .12s, box-shadow .12s"
              : `${ease}, width .12s, height .12s, margin .12s, box-shadow .12s`,
          }}
        />
      </div>

      <div style={{ position: "relative", height: 20, marginTop: 14 }}>
        {ticks.map((tk) => (
          <span
            key={tk}
            style={{
              position: "absolute",
              left: `${toT(tk) * 100}%`,
              transform: "translateX(-50%)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.3,
              color: "var(--faint)",
              transition: dragging ? "none" : ease,
            }}
          >
            {tk >= 1 ? tk.toLocaleString() : tk}
          </span>
        ))}
      </div>
    </div>
  );
}
