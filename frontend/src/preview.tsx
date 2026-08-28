// DEV-ONLY visual harness — the real HeroCard (Daily Royale) states + DuelCard (Battle Mode), at the
// real Home shell width (max 480). Not part of the production build.
import { createRoot } from "react-dom/client";
import { DuelCard } from "@/screens/duel/DuelCard";
import { MemoryFlashReveal } from "@/modules/memoryFlash/MemoryFlashReveal";
import { MemoryFlashRound } from "@/modules/memoryFlash/MemoryFlashRound";
import { VideoRound } from "@/modules/video/VideoRound";
import { PromptSheet } from "@/screens/prompts/PromptSheet";
import { ChangeReveal } from "@/modules/changeDetection/ChangeReveal";
import { ChangeRound } from "@/modules/changeDetection/ChangeRound";
import { EstimateReveal } from "@/modules/estimate/EstimateReveal";
import { HeroCard } from "@/screens/home/HeroCard";
import { MonoBattleHero } from "@/screens/home/MonoBattleHero";
import { DEFAULT_THEME_ID, getTheme } from "@/theme/tokens";
import "@/theme/global.css";

// `?theme=<id>` so a change can be checked on a LIGHT and a DARK theme without rebuilding. Roughly
// half the catalog is each (§7), and anything derived from accent tokens has to hold on both.
const theme = getTheme(new URLSearchParams(window.location.search).get("theme") ?? DEFAULT_THEME_ID);
for (const [k, v] of Object.entries(theme.vars)) document.documentElement.style.setProperty(k, v);

const PROMPT = new URLSearchParams(window.location.search).get("prompt");

// Preview-only: `&slow=N` stretches every timer by N so a remote screenshot can land ON a specific
// animation frame. Round phases are 300-600ms and a screenshot round-trip is seconds, so without
// this the only states reachable are whichever one the clock happens to be in.
//
// It patches setTimeout/setInterval BEFORE the app mounts, so components need no preview-specific
// prop and the code under test is exactly the code that ships. RELATIVE pacing is preserved, which
// is the part a game-feel review is actually judging.
const SLOW = Number(new URLSearchParams(window.location.search).get("slow") ?? 1);
if (SLOW > 1) {
  const st = window.setTimeout.bind(window);
  const si = window.setInterval.bind(window);
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) =>
    st(fn, (ms ?? 0) * SLOW, ...a)) as typeof window.setTimeout;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...a: unknown[]) =>
    si(fn, (ms ?? 0) * SLOW, ...a)) as typeof window.setInterval;
  // performance.now() MUST be scaled too, and forgetting it made the first version of this shim
  // produce misleading captures. The round's countdowns are driven by elapsed-time DELTAS rather
  // than by timer durations — which is the right way to build them, since it keeps them accurate
  // when a tab is throttled — so stretching only setTimeout left the clocks draining at real speed:
  // the readout showed 0.0s during a slowed watch phase and the recall window expired seconds into
  // a capture. Scaling the clock keeps the whole round internally consistent.
  const origin = performance.now();
  const now = performance.now.bind(performance);
  performance.now = () => origin + (now() - origin) / SLOW;
}

// Preview-only: `&hold` keeps any clip paused on its first frame. The clips are 5s and a remote
// screenshot round-trip is slower than that, so without this the round has always advanced past
// the video by the time anything can look at it.
if (new URLSearchParams(window.location.search).has("hold")) {
  const freeze = () => {
    document.querySelectorAll("video").forEach((v) => v.pause());
    requestAnimationFrame(freeze);
  };
  requestAnimationFrame(freeze);
}


const el = document.getElementById("root");
if (!el) throw new Error("no root");
if (PROMPT === "memory") {
  // `?prompt=memory&tiles=N` — the Simon-style flashing grid, at any tile count, for comparing
  // layouts. The server's TILES constant is the real one; this only previews the rendering.
  const q = new URLSearchParams(window.location.search);
  const tiles = Number(q.get("tiles") ?? 6);
  // `&seq=0,3,1` overrides the pattern. A longer one stretches the watch phase, which is the only
  // way to catch the charge bar and a lit tile in a screenshot — the real timeline is shorter than
  // a remote round-trip.
  const seq = (q.get("seq") ?? "0,3,1,4").split(",").map(Number).filter(Number.isFinite);
  createRoot(el).render(
    <div className={`rr-root s-${theme.style}`} style={{ minHeight: "100dvh", padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <MemoryFlashRound
        spec={{
          sequence: seq,
          // The real ladder, so the harness previews the round that actually ships.
          waves: [seq.slice(0, 3), [1, 3, 5, 0], [2, 4, 0, 5, 1]],
          wave_gap_ms: [820, 690, 570],
          tiles,
          category: "Memory Flash",
          icon: "🧩",
          time_limit_ms: 10000,
        }}
        onComplete={(r) => console.log("done", r)}
        eyebrow={
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 800, color: "var(--muted)" }}>
            Round 3 of 4 · Q 2 of 2
          </div>
        }
      />
    </div>
  );
} else if (PROMPT === "video") {
  // `?p=video&clip=<key>` previews any ingested clip. The clip key is the ONLY content this file
  // names: the real prompts live in the private content package and are served per-instance, so
  // copying them here would create a second, unowned copy that silently drifts from what ships.
  // These placeholders are deliberately generic — this preview is for LAYOUT, not content review.
  const clip = new URLSearchParams(window.location.search).get("clip") ?? "waiting_room";
  const opts = ["First option", "Second option", "Third option", "Fourth option"];
  createRoot(el).render(
    <div className={`rr-root s-${theme.style}`} style={{ minHeight: "100dvh", padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <VideoRound
        spec={{
          cognition_instance_id: "preview",
          base_url: `http://localhost:8001/content/video/${clip}_base.mp4`,
          altered_url: `http://localhost:8001/content/video/${clip}_altered.mp4`,
          width: 720,
          height: 1280,
          duration_ms: 5040,
          question_time_limit_ms: 5000,
          questions: [
            { prompt: "Placeholder question one", options: opts },
            { prompt: "Placeholder question two", options: opts },
          ],
          change_question: { prompt: "Something changed. What was it?", options: opts },
        }}
        onComplete={(r) => console.log("done", r)}
      />
    </div>
  );
} else
createRoot(el).render(
  <div className={`rr-root s-${theme.style}`} style={{ minHeight: "100dvh", padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 480, margin: "0 auto" }}>
    <HeroCard state={{ kind: "live", oneShotText: "One attempt. 8 questions. One crown.", fieldText: "8 in the field", countdown: "12m", progress: 0.4, onPlay: () => {} }} />
    <DuelCard onDuel={() => {}} gems={0} />
    <MonoBattleHero onDuel={() => {}} />
    <HeroCard state={{ kind: "before", opensText: "Today's Royale unlocks at 12:00 AM", countdown: "4h 12m" }} />
    <HeroCard state={{ kind: "viewed", rank: 3, opensText: "Tomorrow unlocks at 12:00 AM", countdown: "9h 48m" }} />
    {/* One-time prompt sheets. ?prompt=notify|rate|sorry — they're fixed-position overlays, so only
        one can be inspected at a time. */}
    {PROMPT === "change" && (
      <ChangeRound
        spec={{
          cognition_instance_id: "preview",
          base_url: "/content/change/sample_01_before.png",
          altered_url: "/content/change/sample_01_after.png",
          width: 512,
          height: 512,
          flicker_base_ms: 5000,
          flicker_altered_ms: 7000,
          flicker_blank_ms: 80,
          flicker_label_ms: 1300,
          time_limit_ms: 30000,
        }}
        onComplete={() => {}}
      />
    )}
    {PROMPT === "reveal" && (
      <div className="rr-glass" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <ChangeReveal
          spec={{ altered_url: "/content/change/sample_01_after.png", width: 512, height: 512 }}
          answer={{ bbox: { x: 0.3978, y: 0.2646, w: 0.0742, h: 0.1338 } }}
          result={{ tap: { x: 0.62, y: 0.55 } }}
          correct={false}
        />
        <EstimateReveal
          spec={{ unit: "charges", slider_min: 10, slider_max: 100000 }}
          answer={{ answer: 1000 }}
          result={{ final_guess: 550 }}
        />
        <MemoryFlashReveal answer={{ sequence: [0, 4, 7, 2] }} result={{ taps: [0, 4, 1] }} />
      </div>
    )}
    {PROMPT === "notify" && (
      <PromptSheet
        icon="🔔"
        title="Don't miss tomorrow's"
        body="One reminder a day when the Daily Royale opens — so your streak survives the days you forget."
        confirm="Turn on reminders"
        decline="Not now"
        onConfirm={() => {}}
        onDecline={() => {}}
      />
    )}
    {PROMPT === "rate" && (
      <PromptSheet
        icon="⭐"
        title="Enjoying Rot Royale?"
        body="A quick rating helps other players find the game. It takes about ten seconds."
        confirm="Rate the app"
        decline="Not now"
        onConfirm={() => {}}
        onDecline={() => {}}
      />
    )}
    {PROMPT === "sorry" && (
      <PromptSheet
        icon="🎁"
        title="Sorry about that"
        body="A bug cut some Daily Royale runs short. We've added 5 gems and 50 coins to your account by way of apology."
        confirm="Thanks"
        decline="Got it"
        onConfirm={() => {}}
        onDecline={() => {}}
      />
    )}
  </div>,
);
