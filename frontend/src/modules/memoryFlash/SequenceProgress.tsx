/**
 * Recall progress: one marker per step of the sequence, filled as you get them right.
 *
 * These are NOT carousel dots. Each one is a step of the actual answer, and a filled marker means
 * that step matched — a wrong tap ends the round, so every mark on screen is earned. That makes the
 * row the player's running score for the round rather than decoration.
 */
export function SequenceProgress({ total, done }: { total: number; done: number }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 7,
        justifyContent: "center",
        alignItems: "center",
        // Wraps rather than overflowing if a longer sequence is ever served.
        flexWrap: "wrap",
        minHeight: 12,
      }}
    >
      {Array.from({ length: total }, (_, i) => {
        const filled = i < done;
        return (
          <span
            key={i}
            aria-hidden
            className={filled ? "rr-pop" : undefined}
            style={{
              width: filled ? 11 : 9,
              height: filled ? 11 : 9,
              borderRadius: "50%",
              // Brand violet for progress rather than the green used for "correct" elsewhere: this
              // is how far through you are, not a verdict, and the round's verdict is the server's.
              background: filled ? "var(--brand-2)" : "transparent",
              border: filled ? "none" : "2px solid var(--line)",
              boxShadow: filled ? "0 0 10px color-mix(in srgb, var(--brand-2) 55%, transparent)" : "none",
              transition: "width 140ms, height 140ms, background 140ms",
            }}
          />
        );
      })}
    </div>
  );
}
