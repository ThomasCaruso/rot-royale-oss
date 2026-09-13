// Lightweight Royale Results sound — synthesized with the Web Audio API (no audio files, no
// dependency). EVERYTHING degrades silently: a blocked/absent AudioContext, disabled localStorage,
// and unsupported vibration are all no-ops, never throws. Cues are warm and competitive — never
// casino / jackpot energy.

import { feedback, setHapticsEnabled } from "@/lib/haptics";

const MUTE_KEY = "rot_royale_sfx_enabled";

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;
let ctxFailed = false;

function getCtx(): AudioContext | null {
  if (ctxFailed) return null;
  if (ctx) return ctx;
  try {
    const g = globalThis as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) {
      ctxFailed = true;
      return null;
    }
    ctx = new Ctor();
    return ctx;
  } catch {
    ctxFailed = true;
    return null;
  }
}

function lsGet(key: string): string | null {
  try {
    return (globalThis.localStorage as Storage | undefined)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    (globalThis.localStorage as Storage | undefined)?.setItem(key, value);
  } catch {
    // storage blocked — preference just won't persist
  }
}

export function isSfxEnabled(): boolean {
  return lsGet(MUTE_KEY) !== "0"; // sound is on by default; only an explicit "0" mutes
}

// Apply the STORED preference at module load. Without this a muted player would still feel haptics
// until they happened to toggle the setting again this session.
setHapticsEnabled(isSfxEnabled());
export function setSfxEnabled(on: boolean): void {
  lsSet(MUTE_KEY, on ? "1" : "0");
  setHapticsEnabled(on); // one switch governs sound AND touch feedback
}

/** Resume a suspended context after a user gesture (browsers block audio before interaction). */
export function resumeAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

interface Note {
  freq: number;
  to?: number; // optional pitch glide target
  start: number; // seconds from "now"
  dur: number; // seconds
  type?: OscillatorType;
  gain?: number;
}

function play(notes: Note[]): void {
  if (!isSfxEnabled()) return;
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume().catch(() => {});
    const now = c.currentTime;
    for (const n of notes) {
      const osc = c.createOscillator();
      const g = c.createGain();
      const t0 = now + n.start;
      const t1 = t0 + n.dur;
      const peak = n.gain ?? 0.08;
      osc.type = n.type ?? "sine";
      osc.frequency.setValueAtTime(n.freq, t0);
      if (n.to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, n.to), t1);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, n.dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    }
  } catch {
    // an audio hiccup must never break the reveal
  }
}

// --- the cues (warm sine/triangle, low gain, tasteful) ---
export const revealTick = () =>
  play([{ freq: 1180, start: 0, dur: 0.05, gain: 0.05, type: "triangle" }]);
export const uiTap = () => play([{ freq: 760, start: 0, dur: 0.035, gain: 0.05, type: "triangle" }]);
export const scoreImpact = () =>
  play([{ freq: 440, to: 240, start: 0, dur: 0.18, gain: 0.09, type: "triangle" }]);
export const placementImpact = () =>
  play([
    { freq: 300, to: 150, start: 0, dur: 0.26, gain: 0.12, type: "sine" },
    { freq: 600, start: 0, dur: 0.08, gain: 0.05, type: "triangle" },
  ]);
export const coinChime = () =>
  play([
    { freq: 680, start: 0, dur: 0.08, gain: 0.07, type: "sine" },
    { freq: 1020, start: 0.07, dur: 0.1, gain: 0.07, type: "sine" },
  ]);
export const ratingRise = () =>
  play([{ freq: 320, to: 640, start: 0, dur: 0.24, gain: 0.07, type: "sine" }]);
export const podiumFanfare = () =>
  play([
    { freq: 523, start: 0, dur: 0.12, gain: 0.09, type: "triangle" }, // C5
    { freq: 659, start: 0.1, dur: 0.12, gain: 0.09, type: "triangle" }, // E5
    { freq: 784, start: 0.2, dur: 0.22, gain: 0.1, type: "triangle" }, // G5
  ]);

/**
 * Short haptic pulse(s) on major beats.
 *
 * KEPT for the existing call sites, but it no longer talks to navigator.vibrate — iOS doesn't
 * implement that, so this was silent on every iPhone. It now maps the old millisecond vocabulary
 * onto the platform's real feedback styles (lib/haptics.ts).
 *
 * Prefer `feedback("medium")` directly in new code: iOS exposes STYLES, not durations, so a number
 * can only ever be an approximation of what the caller meant.
 */
export function haptic(pattern: number | number[]): void {
  const peak = Array.isArray(pattern) ? Math.max(...pattern) : pattern;
  // A pattern (rather than a single pulse) always meant "an outcome happened", which is what the
  // notification styles are for; a lone pulse was a touch.
  if (Array.isArray(pattern)) {
    feedback(peak >= 30 ? "error" : "success");
    return;
  }
  feedback(peak <= 10 ? "selection" : peak <= 15 ? "light" : peak <= 25 ? "medium" : "heavy");
}

// --- IN-RUN cues -------------------------------------------------------------------------------
//
// Everything above this line fires on the RESULTS screen. The run itself — the ninety seconds that
// are actually the game — had no sound at all and two haptics in total. These are the beats of the
// loop: anticipate, commit, confirm, advance.
//
// The whole set is deliberately quiet (gain <= 0.09) and short (<= 0.26s). A timed round is played
// in public, often one-handed, sometimes with someone else in the room; a cue that announces itself
// gets the sound switched off, and then NONE of it works. Restraint is what keeps it on.

/** A question arrives. A small lift, not a fanfare — this is anticipation, not reward. */
export const questionIn = () =>
  play([{ freq: 300, to: 520, start: 0, dur: 0.12, gain: 0.045, type: "sine" }]);

/** An answer is committed. Short, dry, downward: the sound of a thing being SET, not celebrated. */
export const commitLock = () =>
  play([{ freq: 420, to: 300, start: 0, dur: 0.07, gain: 0.06, type: "triangle" }]);

/**
 * Correct. Two notes rising, transposed UP by `step` semitones so a streak audibly climbs.
 *
 * The escalation is free — the run already tracks consecutive-correct to gate confetti — and it is
 * the one moment worth spending delight on: §5c says the job is evidence your brain still works,
 * and a rising line is that evidence in a form you feel before you have read anything.
 */
export const correctChime = (step = 0) => {
  const k = Math.pow(2, Math.max(0, step) / 12);
  play([
    { freq: 660 * k, start: 0, dur: 0.075, gain: 0.07, type: "sine" },
    { freq: 880 * k, start: 0.065, dur: 0.13, gain: 0.07, type: "sine" },
  ]);
};

/**
 * Wrong. ONE warm low note, and deliberately not a buzzer.
 *
 * This player is already worried their attention span is cooked (§5c) — that is the whole premise
 * of the product. A harsh or comedic failure sound confirms the fear it exists to relieve, and it
 * is the single easiest way to make someone close the app. It should read as "noted", not "wrong".
 */
export const wrongThud = () =>
  play([{ freq: 240, to: 180, start: 0, dur: 0.16, gain: 0.055, type: "sine" }]);

/** The last seconds. Barely there on purpose — pressure, not panic. */
export const timerTick = () =>
  play([{ freq: 1500, start: 0, dur: 0.022, gain: 0.03, type: "triangle" }]);

/**
 * One memory-flash tile, pitched by its index.
 *
 * A pentatonic set, chosen so ANY order of tiles is consonant — a Simon sequence is random, so a
 * scale with semitones would produce genuinely sour pairs about a third of the time, and a round
 * that sounds wrong when you are playing it right is worse than silence.
 */
const TILE_NOTES = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568]; // C D E G A C D E G
export const tilePing = (index: number) =>
  play([
    {
      freq: TILE_NOTES[((index % TILE_NOTES.length) + TILE_NOTES.length) % TILE_NOTES.length],
      start: 0,
      dur: 0.11,
      gain: 0.05,
      type: "sine",
    },
  ]);
