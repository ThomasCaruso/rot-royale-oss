import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { haptic } from "@/lib/sfx";
import { Display } from "@/ui/Display";
import { GlassCard } from "@/ui/GlassCard";
import { PromptText } from "@/ui/PromptText";
import { RoundHeader } from "@/ui/RoundHeader";
import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * Daily Royale CHANGE DETECTION round (interactive class). Plays the PRE-BOUND cognition instance
 * from the round spec — never calls change/start. The pair flickers base/blank/altered/blank on a
 * loop; the player taps where the change is. The tap is submitted in NORMALIZED 0-1 image
 * coordinates to the cognition submit endpoint (bbox + tolerance are server-only), then onComplete
 * finalizes the Royale round via the /answer bridge.
 *
 * Presentation follows the shared round language (RoundHeader + GlassCard). The round's
 * `time_limit_ms` auto-submits a miss when it expires; that countdown used to run INVISIBLY, so a
 * player could be timed out with no warning. It is now the same gold ring every other timed round
 * uses — a fairness fix, not just a coat of paint.
 *
 * (Image URLs are stubs until real asset pairs land — the flicker + tap flow works regardless.)
 */
// Cap on waiting for the two frames to decode. Past this the round starts anyway: a dead asset
// must cost one round, not hang the run.
const LOAD_TIMEOUT_MS = 4000;
// Below this the announcement can't be read, so the gap stays a plain wipe instead of flashing a
// word. Guards legacy round plans, which carry only the 80ms blank.
const MIN_READABLE_LABEL_MS = 400;

interface ChangeSpec {
  cognition_instance_id: string;
  base_url: string;
  altered_url: string;
  width: number;
  height: number;
  flicker_base_ms: number;
  // The altered frame is held LONGER than the base — it is the one being searched. Optional so an
  // older pinned round plan (which has no such field) still plays, falling back to the base timing.
  flicker_altered_ms?: number;
  flicker_blank_ms: number;
  // Duration of the titled beat that announces each frame. Optional: a round plan pinned before the
  // beat existed has no such field, and falls back to the bare blank wipe.
  flicker_label_ms?: number;
  time_limit_ms: number;
}

export const ChangeRound: React.FC<{
  spec: ChangeSpec;
  onComplete: (result: Record<string, unknown>) => void;
  eyebrow?: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ spec, onComplete, eyebrow, footer }) => {
  // Flicker cycle: base → blank → altered → blank. `frame` indexes that 4-phase loop.
  const [frame, setFrame] = useState(0);
  const [left, setLeft] = useState(spec.time_limit_ms);
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  // How long the frame CURRENTLY on screen has left. The gold ring counts the whole round; this is
  // the one the player is actually working to — "how long can I still study this image".
  const [phaseLeft, setPhaseLeft] = useState(0);
  const phaseEndsAt = useRef(0);
  // Set the instant a tap lands: freezes the flicker so the scene holds still under the finger.
  const [locked, setLocked] = useState(false);
  const started = useRef(Date.now());
  const done = useRef(false);
  // The player's tap, claimed the moment it lands. The submit is deferred ~260ms so the mark is
  // visible, and without this the auto-miss could fire inside that gap and score a real tap in the
  // last quarter-second of the round as a MISS.
  const committed = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // Don't start the round until both frames are decoded. The flicker and the 15s limit used to run
  // from mount, so on a cold cache the player spent the opening seconds watching an empty box and
  // then had to find the change in whatever time was left — and the very first altered frame could
  // be missing entirely, because a single <img> swapping src fetches on the swap. Images are never
  // precached (the service worker globs js/css/html/fonts only), so this is the NORMAL path on
  // mobile data, not an edge case. Capped so a slow or dead asset can't hang the round forever.
  useEffect(() => {
    let alive = true;
    const load = (src: string) =>
      new Promise<void>((resolve) => {
        const im = new Image();
        im.onload = () => resolve();
        im.onerror = () => resolve(); // a broken asset must not hang the round; it plays and misses
        im.src = src;
      });
    const cap = window.setTimeout(() => alive && setReady(true), LOAD_TIMEOUT_MS);
    void Promise.all([load(spec.base_url), load(spec.altered_url)]).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
      window.clearTimeout(cap);
    };
  }, [spec.base_url, spec.altered_url]);

  useEffect(() => {
    if (!ready || locked) return; // a committed tap freezes the scene (see onTap)
    started.current = Date.now(); // the clock starts when the round is actually playable
    const { flicker_base_ms: base, flicker_blank_ms: blank } = spec;
    const altered = spec.flicker_altered_ms ?? base;
    // The wipe is now a TITLED beat that announces the frame it precedes, so the player knows which
    // image they're about to study instead of inferring it from a picture changing under them.
    // Falls back to the bare blank when the server doesn't send a label duration.
    const label = spec.flicker_label_ms ?? blank;
    // frame 0 = "First image", 1 = base, 2 = "Second image", 3 = altered. The label LEADS its image
    // — announcing a frame after showing it would be pointless.
    const durations = [label, base, label, altered];
    let f = 0;
    let timer: number;
    const arm = (i: number) => {
      phaseEndsAt.current = Date.now() + durations[i];
      setPhaseLeft(durations[i]);
    };
    const tick = () => {
      f = (f + 1) % 4;
      setFrame(f);
      arm(f);
      timer = window.setTimeout(tick, durations[f]);
    };
    arm(0);
    timer = window.setTimeout(tick, durations[0]);
    const countdown = window.setInterval(
      () => setPhaseLeft(Math.max(0, phaseEndsAt.current - Date.now())),
      100,
    );
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(countdown);
    };
  }, [spec, ready, locked]);

  // x/y null = timed out with no tap. NOT (-1, -1): the API constrains taps to 0..1, so the old
  // sentinel came back 422, the cognition instance was never resolved, and the Royale bridge then
  // 409'd — the player was stranded on "finish this round before moving on" with no way to finish.
  const submit = useCallback(
    async (x: number | null, y: number | null) => {
      if (done.current) return;
      done.current = true;
      const elapsed = Date.now() - started.current;
      let outcome: Record<string, unknown> = {};
      try {
        // The response carries hit/points and the now-revealed bbox. The Royale bridge ignores this
        // payload (it re-reads the instance server-side), so passing it up is free there and is
        // what lets the playtest harness show whether the tap landed.
        outcome = (await api.cogChangeSubmit(
          spec.cognition_instance_id, x, y, elapsed,
        )) as unknown as Record<string, unknown>;
      } finally {
        // Carry the tap up with the outcome. The server response reports hit/points and the box,
        // but not WHERE the player pointed — and the reveal needs that to show a near miss as
        // "you were close" instead of a bare wrong. Only the module knows it.
        onComplete(x === null || y === null ? outcome : { ...outcome, tap: { x, y } });
      }
    },
    [spec.cognition_instance_id, onComplete],
  );

  // Auto-resolve when the limit expires — as the player's tap if one is already committed but still
  // inside its reveal delay, otherwise as a miss.
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => {
      const tap = committed.current;
      void submit(tap?.x ?? null, tap?.y ?? null);
    }, spec.time_limit_ms);
    return () => window.clearTimeout(t);
  }, [spec.time_limit_ms, submit, ready]);

  // Drive the visible ring off the same clock the auto-miss uses.
  useEffect(() => {
    if (!ready) return;
    const start = performance.now();
    const id = window.setInterval(() => {
      const remaining = spec.time_limit_ms - (performance.now() - start);
      setLeft(remaining > 0 ? remaining : 0);
      if (remaining <= 0) window.clearInterval(id);
    }, 50);
    return () => window.clearInterval(id);
  }, [spec.time_limit_ms, ready]);

  const onTap = (e: React.PointerEvent) => {
    const el = imgRef.current;
    if (!el || done.current || !ready || committed.current) return;
    const r = el.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width);
    const y = clamp01((e.clientY - r.top) / r.height);
    // Claim the tap NOW, then let the mark show before resolving, so the player sees where they
    // committed rather than the round vanishing under their finger.
    committed.current = { x, y };
    setMark({ x, y });
    // Hold the scene still and confirm the hit physically. Strobing on under a committed tap is
    // what made this feel glitchy — the answer is locked, so the picture should stop arguing.
    setLocked(true);
    haptic(12);
    window.setTimeout(() => void submit(x, y), reduced ? 0 : 320);
  };

  // frame 0 = "First image" beat, 1 = base, 2 = "Second image" beat, 3 = altered.
  const labelMs = spec.flicker_label_ms ?? spec.flicker_blank_ms;
  const showAltered = !locked && frame === 3;
  // Frames 0 and 2 are the gap between pictures: always a wipe (both frames hidden), which is what
  // stops a direct visual comparison. The TITLED beat is drawn over that gap only when the server
  // gave it long enough to be read — a legacy round plan sends only the 80ms blank, and a word
  // flashed for 80ms is noise, not an announcement.
  const between = !locked && (frame === 0 || frame === 2);
  const announcing = between && labelMs >= MIN_READABLE_LABEL_MS;
  const phaseTotal =
    frame === 3
      ? (spec.flicker_altered_ms ?? spec.flicker_base_ms)
      : frame === 1
        ? spec.flicker_base_ms
        : labelMs;

  return (
    <div>
      <RoundHeader label="Spot the change" remainingMs={left} totalMs={spec.time_limit_ms} />
      <GlassCard>
        {eyebrow}
        <PromptText text="Tap where it changes" style={{ margin: "4px 0 10px" }} />
        {/* Which frame is on screen and how long it stays. The two are held for DIFFERENT lengths
            (5s then 8s), so without this the player cannot tell whether to keep studying or wait
            for the swap — they just watch the picture change under them. */}
        {/* Hidden during the titled beat: that beat IS the announcement, and a second countdown
            over it just races the words the player is reading. This row belongs to the image. */}
        {!locked && ready && !between && (
          <div style={{ margin: "0 0 10px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                fontSize: 11.5,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                fontWeight: 800,
                color: between ? "var(--faint)" : "var(--muted)",
              }}
            >
              <span>{showAltered ? "Second image" : "First image"}</span>
              <span
                className="display"
                style={{
                  fontSize: 15,
                  letterSpacing: 0,
                  color: between ? "var(--faint)" : "var(--text)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.ceil(phaseLeft / 1000)}s
              </span>
            </div>
            {/* Depletes across the frame's own duration, so 5s and 8s both read as one full bar. */}
            <div
              style={{
                height: 4,
                marginTop: 5,
                borderRadius: 999,
                background: "var(--panel2)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(0, Math.min(1, phaseLeft / phaseTotal)) * 100}%`,
                  background: showAltered
                    ? "linear-gradient(90deg, var(--brand), var(--brand-2))"
                    : "var(--faint)",
                  transition: reduced ? "none" : "width 120ms linear",
                }}
              />
            </div>
          </div>
        )}
        <div
          ref={imgRef}
          onPointerDown={onTap}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: `${spec.width} / ${spec.height}`,
            // The blank phase is a calm theme surface rather than a white flash — on the ivory
            // Starter skin a hard #fff strobe was the brightest thing on the screen.
            background: between ? "var(--panel2)" : "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-ctl, 14px)",
            overflow: "hidden",
            cursor: locked ? "default" : "crosshair",
            touchAction: "none",
            boxShadow: "inset 0 2px 10px rgba(0,0,0,.12)",
          }}
        >
          {/* BOTH frames stay mounted and are toggled by visibility. A single <img> whose src
              swapped four times a second re-decoded (and on a cold cache re-fetched) every swap,
              which is the one thing this round cannot afford: the flicker IS the mechanic, so a
              dropped frame reads as "there was no change". */}
          {[spec.base_url, spec.altered_url].map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                pointerEvents: "none",
                visibility: !between && showAltered === (i === 1) ? "visible" : "hidden",
              }}
            />
          ))}
          {/* The titled beat, staged in the trivia category splash's language (diamond-hairline
              eyebrow over a Display name) but sized to the frame rather than the screen — it
              announces the image the player is ABOUT to study, so they never have to work out
              which one they're looking at from the picture changing under them. */}
          {announcing && (
            <div
              className={reduced ? undefined : "rr-splash-in"}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                textAlign: "center",
                padding: "0 16px",
              }}
            >
              <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 22, height: 1, background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--amber) 70%, transparent))" }} />
                <span style={{ width: 4, height: 4, transform: "rotate(45deg)", background: "linear-gradient(135deg, #FFE58A, var(--amber))" }} />
                <span style={{ width: 22, height: 1, background: "linear-gradient(90deg, color-mix(in srgb, var(--amber) 70%, transparent), transparent)" }} />
              </div>
              <Display style={{ fontSize: "clamp(24px, 7vw, 34px)", lineHeight: 1.05 }}>
                {frame === 0 ? "First image" : "Second image"}
              </Display>
              <span
                style={{
                  fontSize: 10.5,
                  letterSpacing: "0.28em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  color: "var(--faint)",
                }}
              >
                {frame === 0 ? "The original" : "Something changed"}
              </span>
            </div>
          )}
          {mark && !reduced && (
            <span
              aria-hidden
              className="rr-tap-halo"
              style={{
                position: "absolute",
                left: `${mark.x * 100}%`,
                top: `${mark.y * 100}%`,
                width: 44,
                height: 44,
                marginLeft: -22,
                marginTop: -22,
                borderRadius: "50%",
                border: "2px solid var(--amber)",
                pointerEvents: "none",
              }}
            />
          )}
          {mark && (
            <span
              aria-hidden
              className="rr-tap-land"
              style={{
                position: "absolute",
                left: `${mark.x * 100}%`,
                top: `${mark.y * 100}%`,
                width: 44,
                height: 44,
                marginLeft: -22,
                marginTop: -22,
                borderRadius: "50%",
                border: "3px solid var(--amber)",
                boxShadow: "0 0 0 6px var(--glow)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
        {footer}
      </GlassCard>
    </div>
  );
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
