import { useCallback, useEffect, useRef, useState } from "react";
import { GlassCard } from "@/ui/GlassCard";
import { RoundHeader } from "@/ui/RoundHeader";

export interface MemoryFlashSpec {
  sequence: number[];
  tiles: number;
  category: string;
  icon: string;
  time_limit_ms: number;
}

export interface MemoryFlashResult {
  taps: number[];
  tap_times: number[]; // ms offsets from the start of the input phase (per-tap timestamps)
  elapsed_ms: number;
}

const TILE_COLORS = ["#15a85f", "#ff5a4d", "#8b5cf6", "#f5a524", "#27c08a", "#ff9ad1"];

type Phase = "show" | "input";

/**
 * Simon-style memory round (ported from RotRoyale.jsx MemoryRound). Flashes the sequence, then
 * records the player's tapped sequence + per-tap timestamps and submits — the server validates the
 * taps against the stored sequence (it never reveals correctness here).
 */
export const MemoryFlashRound: React.FC<{
  spec: MemoryFlashSpec;
  onComplete: (result: MemoryFlashResult) => void;
  // Host-supplied chrome rendered inside the card, above the prompt (e.g. the "Round 1 of 4" eyebrow).
  eyebrow?: React.ReactNode;
  // Unused here (memory has no post-answer hold note), but accepted for a uniform module signature.
  footer?: React.ReactNode;
}> = ({ spec, onComplete, eyebrow, footer }) => {
  const [phase, setPhase] = useState<Phase>("show");
  const [lit, setLit] = useState(-1);
  const [left, setLeft] = useState(spec.time_limit_ms);
  const taps = useRef<number[]>([]);
  const tapTimes = useRef<number[]>([]);
  const inputStart = useRef<number>(0);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    const elapsed = inputStart.current ? Math.round(performance.now() - inputStart.current) : 0;
    setTimeout(
      () => onComplete({ taps: taps.current, tap_times: tapTimes.current, elapsed_ms: elapsed }),
      400,
    );
  }, [onComplete]);

  // Show phase: flash each tile, then switch to input.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 400;
    for (const tile of spec.sequence) {
      timers.push(setTimeout(() => setLit(tile), t));
      timers.push(setTimeout(() => setLit(-1), t + 450));
      t += 620;
    }
    timers.push(
      setTimeout(() => {
        inputStart.current = performance.now();
        setPhase("input");
      }, t + 150),
    );
    return () => timers.forEach(clearTimeout);
  }, [spec.sequence]);

  // Input phase: countdown; submit whatever is tapped when time runs out.
  useEffect(() => {
    if (phase !== "input") return;
    const start = performance.now();
    const id = setInterval(() => {
      const remaining = spec.time_limit_ms - (performance.now() - start);
      if (remaining <= 0) {
        clearInterval(id);
        setLeft(0);
        finish();
      } else {
        setLeft(remaining);
      }
    }, 50);
    return () => clearInterval(id);
  }, [phase, spec.time_limit_ms, finish]);

  const tap = (i: number) => {
    if (phase !== "input" || done.current) return;
    taps.current = [...taps.current, i];
    tapTimes.current = [...tapTimes.current, Math.round(performance.now() - inputStart.current)];
    setLit(i);
    setTimeout(() => setLit(-1), 150);
    if (taps.current.length >= spec.sequence.length) finish();
  };

  const watching = phase === "show";
  return (
    <div>
      {/* Header BAR above the card so the ring + its glow halo can never be clipped. */}
      <RoundHeader
        category={spec.category}
        icon={spec.icon}
        remainingMs={left}
        totalMs={spec.time_limit_ms}
        ring={phase === "input"}
      />
      <GlassCard>
      {eyebrow}
      <div style={{ margin: "4px 0 18px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            borderRadius: 999,
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            fontWeight: 800,
            color: watching ? "var(--amber)" : "var(--lime)",
            background: watching ? "rgba(255,201,30,.14)" : "rgba(47,212,94,.14)",
            border: `1px solid ${watching ? "rgba(255,201,30,.4)" : "rgba(47,212,94,.4)"}`,
          }}
        >
          <span aria-hidden className="emoji" style={{ fontSize: 13 }}>
            {watching ? "👀" : "✋"}
          </span>
          {watching ? "Watch" : "Your turn"}
        </span>
        <span style={{ fontSize: 17, fontWeight: 800, color: "var(--text)" }}>
          {watching ? (
            "Memorize the pattern"
          ) : (
            <>
              Now <span style={{ color: "var(--brand-2)" }}>repeat</span> it
            </>
          )}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {Array.from({ length: spec.tiles }, (_, i) => {
          const color = TILE_COLORS[i % TILE_COLORS.length];
          const isLit = lit === i;
          return (
            <button
              key={i}
              disabled={phase !== "input"}
              onClick={() => tap(i)}
              aria-label={`tile ${i}`}
              className={isLit ? "rr-tile-flash" : undefined}
              style={{
                aspectRatio: "1 / 1",
                borderRadius: 16,
                border: `2px solid ${color}`,
                background: isLit
                  ? color
                  : "linear-gradient(180deg, var(--panel2), var(--panel))",
                boxShadow: isLit
                  ? `0 0 28px ${color}, inset 0 0 18px rgba(255,255,255,.35)`
                  : "0 4px 12px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.05)",
                cursor: phase === "input" ? "pointer" : "default",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
                transition: "background 90ms, box-shadow 90ms",
              }}
            />
          );
        })}
      </div>
      {/*
       * Tap-count progress pips — green pip = a tap has been entered for that slot.
       * Green does NOT mean "correct"; correctness is never known client-side during play.
       * The server validates taps against the stored sequence after onComplete fires.
       * Pip count simply reflects how many taps have been logged (0..sequence.length).
       */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 14, minHeight: 10 }}>
        {phase === "input" &&
          Array.from({ length: spec.sequence.length }, (_, k) => (
            <span
              key={k}
              aria-hidden
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: k < taps.current.length ? "var(--lime)" : "var(--line)",
                boxShadow: k < taps.current.length ? "0 0 8px var(--lime)" : "none",
                transition: "background 120ms",
              }}
            />
          ))}
      </div>
      {footer}
      </GlassCard>
    </div>
  );
};
