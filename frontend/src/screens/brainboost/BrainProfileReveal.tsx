/**
 * Post-Starter-Check profile reveal — the "the app just learned you" moment. Strengths, weak
 * spots, a Rot Type, and the starter Brain Score, framed honestly as an early read. Primary CTA
 * saves the profile (guest → account); secondary keeps playing.
 */

import { useEffect, useState } from "react";
import { api, type BrainBoostSummary } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { trackFunnel, trackFunnelOnce } from "@/lib/analytics";
import { Confetti } from "@/ui/Confetti";
import { CountUp } from "@/ui/CountUp";
import { Display } from "@/ui/Display";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 2,
  textTransform: "uppercase",
  fontWeight: 800,
  color: "var(--brand-2)",
};

function CategoryChips({ perfs, tone }: { perfs: { category: string; score: number }[]; tone: "up" | "down" }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
      {perfs.map((p) => (
        <span
          key={p.category}
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border: `1px solid ${tone === "up" ? "color-mix(in srgb, var(--lime) 45%, var(--line))" : "color-mix(in srgb, var(--pink) 40%, var(--line))"}`,
            background: "var(--panel)",
            fontSize: 13.5,
            fontWeight: 800,
          }}
        >
          {p.category} <span style={{ color: tone === "up" ? "var(--lime)" : "var(--pink)" }}>{p.score}</span>
        </span>
      ))}
    </div>
  );
}

export function BrainProfileReveal({
  entryId,
  onSave,
  onKeepPlaying,
}: {
  entryId: string;
  onSave: () => void;
  onKeepPlaying: () => void;
}) {
  const t = useT();
  const [summary, setSummary] = useState<BrainBoostSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    trackFunnelOnce("profile_reveal_viewed");
    api
      .brainBoostSummary(entryId)
      .then(setSummary)
      .catch(() => setFailed(true));
  }, [entryId]);

  if (failed) {
    // The check itself already finished — never trap the player on a summary hiccup.
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
        <GoldButton onClick={onKeepPlaying} style={{ maxWidth: 260 }}>
          {t.brainBoost.keepPlaying}
        </GoldButton>
      </main>
    );
  }
  if (!summary) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          color: "var(--muted)",
          fontWeight: 700,
        }}
      >
        {t.brainBoost.readingBrain}
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 14,
        padding:
          "calc(22px + env(safe-area-inset-top)) clamp(18px, 5vw, 26px) calc(28px + env(safe-area-inset-bottom))",
        maxWidth: 430,
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      <Confetti burstKey={1} count={70} />

      <div style={eyebrow}>{t.brainBoost.profileCreated}</div>

      <div>
        <div style={{ ...eyebrow, color: "var(--muted)", marginBottom: 2 }}>
          {t.brainBoost.starterScore}
        </div>
        <Display gold className="rr-pop" style={{ fontSize: 72 }}>
          <CountUp value={summary.brain_score} />
        </Display>
      </div>

      <GlassCard style={{ display: "flex", flexDirection: "column", gap: 6, padding: 16 }}>
        <div style={{ ...eyebrow, color: "var(--muted)" }}>{t.brainBoost.rotType}</div>
        <Display style={{ fontSize: 28 }}>{summary.rot_type}</Display>
      </GlassCard>

      {summary.strengths.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={eyebrow}>{t.brainBoost.sharpest}</div>
          <CategoryChips perfs={summary.strengths} tone="up" />
        </div>
      )}

      {summary.weaknesses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ ...eyebrow, color: "var(--muted)" }}>{t.brainBoost.needsWork}</div>
          <CategoryChips perfs={summary.weaknesses} tone="down" />
        </div>
      )}

      {summary.weak_spot_topic && (
        <div style={{ fontSize: 13.5, color: "var(--muted)", fontWeight: 700 }}>
          {fmt(t.brainBoost.weakSpotFound, { topic: summary.weak_spot_topic })}
        </div>
      )}

      <div style={{ fontSize: 12.5, color: "var(--faint)" }}>{t.brainBoost.earlyRead}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
        <GoldButton
          onClick={() => {
            trackFunnel("save_profile_clicked", "reveal");
            onSave();
          }}
        >
          {t.brainBoost.saveMyProfile}
        </GoldButton>
        <button
          type="button"
          onClick={() => {
            trackFunnel("keep_playing_clicked");
            onKeepPlaying();
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--brand-2)",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            padding: 8,
          }}
        >
          {t.brainBoost.keepPlaying}
        </button>
      </div>
    </main>
  );
}
