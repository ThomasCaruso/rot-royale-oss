import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/i18n";
import { useT } from "@/i18n/useT";
import { feedback } from "@/lib/haptics";
import { MemoryHeadline } from "@/modules/memoryFlash/MemoryHeadline";
import { MemoryTile, type TileState } from "@/modules/memoryFlash/MemoryTile";
import { MemoryTimer } from "@/modules/memoryFlash/MemoryTimer";
import { SequenceProgress } from "@/modules/memoryFlash/SequenceProgress";
import { GlassCard } from "@/ui/GlassCard";
import { RoundHeader } from "@/ui/RoundHeader";
import { useReducedMotion } from "@/ui/useReducedMotion";

export interface MemoryFlashSpec {
  /** Wave 1, under its historic name. Kept so a shipped binary still plays the round it knows. */
  sequence: number[];
  /** The ladder. Absent on a legacy spec, in which case the round is just `sequence`. */
  waves?: number[][];
  /** Ms between flashes, per wave. Absent → one fallback tempo for every wave. */
  wave_gap_ms?: number[];
  tiles: number;
  category: string;
  icon: string;
  time_limit_ms: number;
}

/** One wave's play record. The server judges each wave independently. */
export interface MemoryWaveResult {
  taps: number[];
  tap_times: number[]; // ms offsets from the start of THIS wave's input phase
  elapsed_ms: number;
}

export interface MemoryFlashResult {
  waves: MemoryWaveResult[];
  elapsed_ms: number; // total across the whole round
}

/**
 * Simon-style memory round — a short LADDER of waves. This file owns the game; the components
 * around it own the pixels.
 *
 * THREE WAVES, NOT ONE. A single four-step sequence is over in about two seconds and there is
 * nothing to come back for; played repeatedly it went flat by the fourth run. The round is now
 * 3 items, then 4, then 5, each played faster than the last, and failing a wave ends the round and
 * banks the waves already cleared — so from wave 2 onward there is something to lose.
 *
 * WHY IT SHOWS CORRECTNESS WHILE YOU PLAY, and why that is not a leak. The sequences are in
 * client_spec BY DESIGN — they are the stimulus the player watches, so the client has always held
 * them (CLAUDE.md §5). The anti-cheat property is that the submitted TAPS are validated
 * server-side, with per-tap timestamps for plausibility; it was never that the pattern is secret.
 *
 * The submitted payload carries NO verdict — only what was tapped and when, per wave. The server
 * decides everything, and still accepts the old single-sequence payload from binaries that predate
 * the ladder (§7c).
 */

type Phase = "watch" | "go" | "input" | "cleared" | "won" | "lost";

/** Lead-in before a wave's first flash, and the beat between its last flash and the grid going live. */
const LEAD_IN_MS = 400;
const GO_BEAT_MS = 520;
/** Fraction of the gap a tile stays lit — the remainder is the dark space that separates flashes. */
const FLASH_ON_FRACTION = 0.62;
/** Held between waves, and after the final outcome, before handing back. */
const WAVE_CLEARED_HOLD_MS = 780;
const OUTCOME_HOLD_MS = 700;
/** Only used when a legacy spec arrives with no per-wave tempo. */
const FALLBACK_GAP_MS = 700;

export const MemoryFlashRound: React.FC<{
  spec: MemoryFlashSpec;
  onComplete: (result: MemoryFlashResult) => void;
  // Host-supplied chrome rendered inside the card, above the prompt (e.g. the "Round 1 of 4" eyebrow).
  eyebrow?: React.ReactNode;
  // Unused here (memory has no post-answer hold note), but accepted for a uniform module signature.
  footer?: React.ReactNode;
}> = ({ spec, onComplete, eyebrow, footer }) => {
  const t = useT();
  const reduced = useReducedMotion();

  // The ladder, normalised once. A spec with no `waves` is the old single-sequence round.
  const waves = useMemo(
    () => (spec.waves?.length ? spec.waves : [spec.sequence]),
    [spec.waves, spec.sequence],
  );
  const gaps = useMemo(
    () => waves.map((_, i) => spec.wave_gap_ms?.[i] ?? FALLBACK_GAP_MS),
    [waves, spec.wave_gap_ms],
  );

  const [waveIdx, setWaveIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("watch");
  const [lit, setLit] = useState(-1);
  // The player's own tile events, kept apart from `lit` so "the game is showing me" and "I hit it"
  // can never render as the same thing.
  const [hit, setHit] = useState(-1);
  const [miss, setMiss] = useState(-1);
  const [entered, setEntered] = useState(0);
  const [banked, setBanked] = useState(0);
  const [watchLeft, setWatchLeft] = useState(0);
  const [left, setLeft] = useState(spec.time_limit_ms);

  const sequence = useMemo(() => waves[waveIdx] ?? [], [waves, waveIdx]);
  // Value identity for the current wave, so effects re-run when the CONTENT changes and not merely
  // because the parent handed us a freshly-built object.
  const waveKey = sequence.join(",");
  const showMs = LEAD_IN_MS + sequence.length * gaps[waveIdx];

  // Accumulated across waves. Refs, not state: they are read inside the tap handler, which must see
  // the current value synchronously — a stale read would submit the wrong taps.
  const played = useRef<MemoryWaveResult[]>([]);
  const taps = useRef<number[]>([]);
  const tapTimes = useRef<number[]>([]);
  const inputStart = useRef(0);
  const roundStart = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    roundStart.current = performance.now();
  }, []);

  /** Bank the wave just played, however it ended. */
  const bankWave = useCallback(() => {
    played.current = [
      ...played.current,
      {
        taps: taps.current,
        tap_times: tapTimes.current,
        elapsed_ms: inputStart.current
          ? Math.round(performance.now() - inputStart.current)
          : spec.time_limit_ms,
      },
    ];
    setBanked(played.current.length);
  }, [spec.time_limit_ms]);

  const finish = useCallback(
    (outcome: "won" | "lost") => {
      if (done.current) return;
      done.current = true;
      setPhase(outcome);
      const total = roundStart.current ? Math.round(performance.now() - roundStart.current) : 0;
      // The outcome is held BEFORE handing back, so it is a beat the player sees rather than a
      // frame that flickers past on the way to the next round.
      setTimeout(() => onComplete({ waves: played.current, elapsed_ms: total }), OUTCOME_HOLD_MS);
    },
    [onComplete],
  );

  // Watch phase for the CURRENT wave: flash its tiles, then a GO beat, then the grid goes live.
  useEffect(() => {
    if (phase !== "watch") return;
    taps.current = [];
    tapTimes.current = [];
    setEntered(0);
    setMiss(-1);
    setHit(-1);
    setLeft(spec.time_limit_ms);

    const gap = gaps[waveIdx];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = LEAD_IN_MS;
    sequence.forEach((tile) => {
      timers.push(
        setTimeout(() => {
          setLit(tile);
          // A tick per flash, so the pattern has a rhythm you FEEL and not only see. iOS has no
          // navigator.vibrate, so this must route through feedback() to exist at all (§7b1).
          feedback("selection");
        }, at),
      );
      timers.push(setTimeout(() => setLit(-1), at + gap * FLASH_ON_FRACTION));
      at += gap;
    });
    timers.push(setTimeout(() => setPhase("go"), at));
    return () => timers.forEach(clearTimeout);
    // `sequence` and `gaps` are deliberately NOT dependencies, and `waveKey` stands in for them.
    //
    // They are derived from the `spec` prop, so a caller that rebuilds that object on each render
    // gives them a new identity every time. Listing them would tear this effect down and restart
    // the wave — flashes, timers and all — on any unrelated re-render, which is the same class of
    // failure that parked the round on GO. `waveKey` is the wave's CONTENT, which is what actually
    // determines what this effect should schedule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, waveIdx, waveKey, spec.time_limit_ms]);

  // GO → input owns its OWN effect, and that separation is the whole bug fix.
  //
  // Both transitions used to be scheduled together by the watch effect. Firing the first one called
  // setPhase("go"), which re-rendered, which changed that effect's dependencies, which ran its
  // CLEANUP — clearing the still-pending timer that was supposed to open the input phase. The
  // effect then re-ran, saw it was no longer in "watch", and returned without rescheduling
  // anything. The round parked on GO with every tile disabled and the player could not tap at all.
  //
  // An effect must not own a transition that outlives its own phase. One phase, one effect.
  useEffect(() => {
    if (phase !== "go") return;
    const id = setTimeout(() => {
      inputStart.current = performance.now();
      setPhase("input");
    }, GO_BEAT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  // Watch countdown — the same timeline the flashes run on, sampled for the readout.
  useEffect(() => {
    if (phase !== "watch") return;
    const start = performance.now();
    setWatchLeft(showMs);
    const id = setInterval(() => {
      setWatchLeft(Math.max(0, showMs - (performance.now() - start)));
    }, 50);
    return () => clearInterval(id);
  }, [phase, showMs]);

  // Recall: the real answer window, PER WAVE. Running out ends the round on this wave.
  useEffect(() => {
    if (phase !== "input") return;
    const start = performance.now();
    const id = setInterval(() => {
      const remaining = spec.time_limit_ms - (performance.now() - start);
      if (remaining <= 0) {
        clearInterval(id);
        setLeft(0);
        bankWave();
        finish("lost");
      } else {
        setLeft(remaining);
      }
    }, 50);
    return () => clearInterval(id);
  }, [phase, spec.time_limit_ms, finish, bankWave]);

  // A cleared wave holds briefly, then the next one starts.
  useEffect(() => {
    if (phase !== "cleared") return;
    const id = setTimeout(() => {
      setWaveIdx((i) => i + 1);
      setPhase("watch");
    }, WAVE_CLEARED_HOLD_MS);
    return () => clearTimeout(id);
  }, [phase]);

  const tap = (i: number) => {
    if (phase !== "input" || done.current) return;
    const n = taps.current.length;
    taps.current = [...taps.current, i];
    tapTimes.current = [...tapTimes.current, Math.round(performance.now() - inputStart.current)];
    setEntered(taps.current.length);

    if (sequence[n] === i) {
      setHit(i);
      setTimeout(() => setHit(-1), 300);
      if (taps.current.length >= sequence.length) {
        bankWave();
        feedback("success");
        if (waveIdx >= waves.length - 1) finish("won");
        else setPhase("cleared");
      } else {
        feedback("selection");
      }
      return;
    }
    // Wrong: say so immediately and stop. The server still judges every wave — this is the client
    // telling the player what it already knows, not deciding the round.
    setMiss(i);
    feedback("error");
    bankWave();
    finish("lost");
  };

  const watching = phase === "watch" || phase === "go";
  const settled = phase === "won" || phase === "lost";
  // A banked wave counts as CLEARED only if it was played to full length — a wave that ran out of
  // time or ended on a wrong tap is banked too, and must not be credited.
  const clearedCount = played.current.filter(
    (w, i) => w.taps.length === (waves[i]?.length ?? -1),
  ).length;

  const tileState = (i: number): TileState => {
    if (miss === i) return "wrong";
    if (hit === i) return "correct";
    if (lit === i) return "flash";
    return phase === "input" ? "idle" : "disabled";
  };

  const headline = {
    watch: {
      key: `watch${waveIdx}`,
      title: t.rounds.watchCarefully,
      sub: t.rounds.memorizeThePattern,
    },
    go: { key: `go${waveIdx}`, title: t.rounds.go, sub: t.rounds.tapInSameOrder },
    input: { key: `input${waveIdx}`, title: t.rounds.nowRepeatIt, sub: t.rounds.tapInSameOrder },
    cleared: { key: `cleared${waveIdx}`, title: t.rounds.waveCleared, sub: undefined },
    won: { key: "won", title: t.rounds.perfect, sub: undefined },
    lost: { key: "lost", title: t.rounds.almost, sub: undefined },
  }[phase];

  const timerHidden = settled || phase === "go" || phase === "cleared";

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
      <GlassCard
        className={(phase === "won" || phase === "cleared") && !reduced ? "rr-mem-win" : undefined}
      >
        {/* Status row: the host's REAL "Round n of m" progress, then which WAVE the ladder is on —
            this mode's own progress, and the thing that makes the round feel like it is going
            somewhere. Both numbers are real; neither is an invented counter. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: "clamp(6px, 1.6vw, 10px)",
          }}
        >
          <div className="rr-mem-status-eyebrow" style={{ minWidth: 0 }}>
            {eyebrow}
          </div>
          <span
            className="rr-mem-status-chip"
            style={{
              opacity: settled ? 0 : 1,
              transition: reduced ? "none" : "opacity 160ms",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 11px",
              borderRadius: 999,
              fontSize: 10.5,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              fontWeight: 800,
              color: watching ? "var(--amber)" : "var(--lime)",
              background: watching ? "rgba(255,201,30,.14)" : "rgba(47,212,94,.14)",
              border: `1px solid ${watching ? "rgba(255,201,30,.4)" : "rgba(47,212,94,.4)"}`,
            }}
          >
            {waves.length > 1
              ? fmt(t.rounds.waveOf, { n: waveIdx + 1, m: waves.length })
              : watching
                ? t.rounds.watch
                : t.rounds.yourTurn}
          </span>
        </div>

        <MemoryHeadline
          phaseKey={headline.key}
          title={headline.title}
          subtitle={headline.sub}
          tone={
            phase === "won" || phase === "cleared" ? "good" : phase === "lost" ? "bad" : "default"
          }
        />

        {/* ONE timer doing two jobs: time until your turn, then time to answer. Collapsed during the
            GO beat — the watch countdown reaches zero the instant the last flash ends, and an empty
            bar reading 0.0s reads as a stalled timer at exactly the moment that should be a beat —
            and between waves and once settled. Animating the height closed avoids both a jolt and a
            hole where it used to be. */}
        <div
          style={{
            maxHeight: timerHidden ? 0 : 60,
            opacity: timerHidden ? 0 : 1,
            overflow: "hidden",
            transition: reduced ? "none" : "max-height 260ms ease, opacity 160ms",
            pointerEvents: "none",
          }}
        >
          <MemoryTimer
            leftMs={watching ? watchLeft : left}
            totalMs={watching ? showMs : spec.time_limit_ms}
            tone={watching ? "watch" : "recall"}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "clamp(9px, 2.6vw, 14px)",
          }}
        >
          {Array.from({ length: spec.tiles }, (_, i) => (
            <MemoryTile
              key={i}
              index={i}
              state={tileState(i)}
              onPress={phase === "input" ? tap : undefined}
            />
          ))}
        </div>

        <div
          style={{
            marginTop: "clamp(10px, 2.6vw, 16px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 7,
          }}
        >
          {/* Steps of the CURRENT wave — the row lengthens as the ladder climbs, which is the
              escalation made visible without a word of copy. */}
          <SequenceProgress total={sequence.length} done={entered} />
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--faint)", minHeight: 15 }}>
            {phase === "input"
              ? t.rounds.tapInOrder
              : settled && waves.length > 1 && banked > 0
                ? fmt(t.rounds.clearedNofM, { n: clearedCount, m: waves.length })
                : ""}
          </div>
        </div>
        {footer}
      </GlassCard>
    </div>
  );
};
