import { TileGlyph } from "@/modules/memoryFlash/TileGlyph";
import { toneFor } from "@/modules/memoryFlash/glyphShapes";

/**
 * One tile of the memory grid, as a pure function of its state.
 *
 * Every state is named rather than derived from a pile of booleans at the call site, because the
 * states are what the round IS: the difference between "the game is showing me this" and "I hit
 * this" has to be legible at a glance and must never render the same way.
 */
export type TileState = "idle" | "flash" | "correct" | "wrong" | "disabled";

const ANIM: Record<TileState, string> = {
  idle: "",
  flash: "rr-tile-flash", // the game showing you the sequence
  correct: "rr-tile-bloom", // your tap landing — a bigger overshoot, so it feels like YOU did it
  wrong: "rr-shake",
  disabled: "",
};

export function MemoryTile({
  index,
  state,
  onPress,
}: {
  index: number;
  state: TileState;
  onPress?: (index: number) => void;
}) {
  const tone = toneFor(index);
  const lit = state === "flash" || state === "correct";
  const wrong = state === "wrong";
  // Interactivity follows the HANDLER, not the look. Deriving it from the state name left a tile
  // showing "wrong" or "correct" still enabled after the round had already settled, because those
  // states outlive the recall phase — the visual state and the ability to press are two different
  // questions and only the caller knows the second one.
  const interactive = onPress !== undefined;

  return (
    <button
      type="button"
      // `rr-mem-tile` carries the resting face (its own hue washed faintly through it). The lit and
      // wrong states override `background` inline, which beats the class.
      className={["rr-mem-tile", ANIM[state]].filter(Boolean).join(" ")}
      disabled={!interactive}
      // POINTER DOWN, not click: the feedback has to land with the finger. Waiting for click puts it
      // after the decision, which is most of the difference between responsive and laggy (§7b1).
      onPointerDown={onPress ? () => onPress(index) : undefined}
      aria-label={`tile ${index}`}
      style={{
        ["--mem-tile" as string]: tone,
        aspectRatio: "1 / 1",
        display: "grid",
        placeItems: "center",
        // Grows with the viewport but never past a comfortable thumb target on a big phone.
        borderRadius: "clamp(16px, 4.5vw, 22px)",
        border: `2px solid ${wrong ? "var(--pink)" : tone}`,
        ...(wrong ? { background: "var(--pink)" } : lit ? { background: tone } : null),
        boxShadow: lit
          ? `0 0 30px ${tone}, 0 6px 18px rgba(0,0,0,.18), inset 0 0 18px rgba(255,255,255,.35)`
          : "0 4px 12px rgba(0,0,0,.16), inset 0 1px 0 rgba(255,255,255,.06)",
        // Idle tiles during the watch phase are dimmed, not greyed: the grid should read as waiting
        // its turn rather than as switched off.
        opacity: state === "disabled" ? 0.72 : 1,
        cursor: interactive ? "pointer" : "default",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        transition: "background 90ms, box-shadow 90ms, border-color 90ms, opacity 200ms",
      }}
    >
      <TileGlyph index={index} lit={lit || wrong} />
    </button>
  );
}
