import { useT } from "@/i18n/useT";
import { fmt } from "@/i18n";
import { toneFor } from "@/modules/memoryFlash/glyphShapes";
import { TileGlyph } from "@/modules/memoryFlash/TileGlyph";

/**
 * "Here is the pattern, and here is where you lost it."
 *
 * This round had NO reveal, so it fell through to the generic one line of grey text ("counted" /
 * "no points") — the exact defect §7a1 describes. A memory round that never shows you the sequence
 * again throws away its whole payoff: the interesting thing is not that you were wrong, it is
 * WHICH step went. People remember three of four and want to know which one slipped.
 *
 * `answer` is the server_answer, released only after the round is finalized (Invariant 1), so the
 * true sequence is safe to render here. `result` is what the module itself reported — the player's
 * own taps, passed back up rather than round-tripped through the wire.
 */
export function MemoryFlashReveal({
  answer,
  result,
}: {
  answer: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  const t = useT();
  // The ladder ends on the wave that beat you, and THAT is the one worth showing — the waves you
  // cleared need no explanation. A legacy single-sequence result falls back to the old shape.
  const allWaves = Array.isArray(answer.waves) ? (answer.waves as number[][]) : null;
  const playedWaves = Array.isArray(result.waves)
    ? (result.waves as { taps?: number[] }[])
    : null;

  let seq: number[] = [];
  let taps: number[] = [];
  let clearedWaves = 0;
  if (allWaves && playedWaves) {
    // The last wave played is the one that ended the round (or the final one, on a clean sweep).
    const lastIdx = Math.max(0, Math.min(playedWaves.length, allWaves.length) - 1);
    seq = allWaves[lastIdx] ?? [];
    taps = Array.isArray(playedWaves[lastIdx]?.taps) ? playedWaves[lastIdx].taps! : [];
    clearedWaves = playedWaves.filter(
      (w, i) => Array.isArray(w?.taps) && w.taps.length === (allWaves[i]?.length ?? -1),
    ).length;
  } else {
    seq = Array.isArray(answer.sequence) ? (answer.sequence as number[]) : [];
    taps = Array.isArray(result.taps) ? (result.taps as number[]) : [];
  }
  const totalWaves = allWaves?.length ?? 0;
  if (!seq.length) return null;

  // The first step that diverged. -1 means every step the player entered was right (they may still
  // have run out of time before finishing, which is a different sentence below).
  const wrongAt = seq.findIndex((tile, i) => i < taps.length && taps[i] !== tile);
  const matched = wrongAt === -1 ? Math.min(taps.length, seq.length) : wrongAt;
  const perfect = matched === seq.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            fontWeight: 800,
            color: "var(--muted)",
          }}
        >
          {t.rounds.thePattern}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginTop: 2 }}>
          {/* With a ladder, WAVES cleared is the round's real score; the step count only explains
              the wave that ended it. */}
          {totalWaves > 1
            ? clearedWaves === totalWaves
              ? t.rounds.perfectRecall
              : fmt(t.rounds.clearedNofM, { n: clearedWaves, m: totalWaves })
            : perfect
              ? t.rounds.perfectRecall
              : fmt(t.rounds.youHadNofM, { n: matched, m: seq.length })}
        </div>
      </div>

      {/* The sequence laid out in order — the shape of the pattern, which is the thing worth
          seeing again. Each step carries its own tile face, so the row reads as the same objects
          the grid showed rather than as abstract markers. */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {seq.map((tile, i) => {
          const entered = i < taps.length;
          const right = entered && taps[i] === tile;
          const wrong = i === wrongAt;
          return (
            <div
              key={i}
              style={{
                ["--mem-tile" as string]: wrong ? "var(--pink)" : toneFor(tile),
                width: 46,
                height: 46,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                border: `2px solid ${
                  wrong ? "var(--pink)" : right ? "var(--lime)" : "var(--line)"
                }`,
                // Steps the player never reached are dimmed rather than hidden: the pattern's full
                // length is part of the information, and a run that timed out should look unfinished
                // rather than look short.
                opacity: entered ? 1 : 0.4,
                background: "linear-gradient(180deg, var(--panel2), var(--panel))",
              }}
            >
              <TileGlyph index={tile} lit={false} />
            </div>
          );
        })}
      </div>

      {!perfect && wrongAt >= 0 && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
          {fmt(t.rounds.lostItOnTap, { n: wrongAt + 1 })}
        </div>
      )}
      {!perfect && wrongAt === -1 && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
          {t.rounds.ranOutOfTime}
        </div>
      )}
    </div>
  );
}
