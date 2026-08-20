// DEV-ONLY visual harness — the real HeroCard (Daily Royale) states + DuelCard (Battle Mode), at the
// real Home shell width (max 480). Not part of the production build.
import { createRoot } from "react-dom/client";
import { DuelCard } from "@/screens/duel/DuelCard";
import { PromptSheet } from "@/screens/prompts/PromptSheet";
import { ChangeReveal } from "@/modules/changeDetection/ChangeReveal";
import { ChangeRound } from "@/modules/changeDetection/ChangeRound";
import { EstimateReveal } from "@/modules/estimate/EstimateReveal";
import { HeroCard } from "@/screens/home/HeroCard";
import { MonoBattleHero } from "@/screens/home/MonoBattleHero";
import { DEFAULT_THEME_ID, getTheme } from "@/theme/tokens";
import "@/theme/global.css";

const theme = getTheme(DEFAULT_THEME_ID);
for (const [k, v] of Object.entries(theme.vars)) document.documentElement.style.setProperty(k, v);

const PROMPT = new URLSearchParams(window.location.search).get("prompt");

const el = document.getElementById("root");
if (!el) throw new Error("no root");
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
