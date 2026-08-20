import { useEffect, useState } from "react";
import { api, type DuelResult as DuelResultData, type DuelStatsResponse } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { resultReasonCopy } from "@/screens/duel/resultReasonCopy";
import { Confetti } from "@/ui/Confetti";
import { CountUp } from "@/ui/CountUp";
import { Display } from "@/ui/Display";
import { FitText } from "@/ui/FitText";
import { GemIcon } from "@/ui/GemIcon";
import { GoldButton } from "@/ui/GoldButton";
import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * Duel result — the emotional payoff that drives the "Run It Back" loop. A flat screen (DuelFlow
 * renders it WITH the bottom nav, hence the bottom padding) built from the celebration language of
 * the Daily Royale results reveal but its own thing: a head-to-head scoreline, the Gem delta with a
 * count-up, a one-line "why", duel streak/XP/tier, and Run It Back as the ALWAYS-primary CTA.
 *
 * Win/loss/perfect treatments:
 *   - PERFECT (perfect win) → gold headline, a bigger/gold confetti burst, the Flawless badge.
 *   - VICTORY (win)         → gold/lime headline, a confetti burst, lime scoreline accent.
 *   - DEFEAT (loss)         → restrained muted-red headline, NO confetti (dignified), pink accent,
 *                             plus the close-loss "run it back" nudge on a one-round loss.
 *
 * Anti-cheat parity: nothing here is trusted from the client — the result object is the server's
 * verdict (winner, gem_delta, xp, perfect/comeback, tier). `duelStats()` is fetched on mount only to
 * enrich the screen (streak + W–L record); it fails gracefully (the screen never depends on it, and
 * SSR/tests never run the effect).
 */
export function DuelResult({
  result,
  onRunItBack,
  onHome,
}: {
  result: DuelResultData;
  duelType: string;
  onRunItBack: () => void;
  onHome: () => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const [stats, setStats] = useState<DuelStatsResponse | null>(null);

  const won = result.winner === "user";
  const isPerfect = result.perfect && won;
  // A comeback (won after trailing) gets its OWN celebration beat — a green headline + a bigger
  // burst — so it pops like a perfect instead of hiding behind a plain "Victory". Perfect wins can't
  // also be comebacks (a perfect never trailed), so the two headline treatments never collide.
  const isComeback = result.comeback && won && !isPerfect;

  // Enrich with the current streak + record (best-effort; the screen stands without it).
  useEffect(() => {
    let cancelled = false;
    api
      .duelStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const headline = isPerfect
    ? t.duel.perfect
    : isComeback
      ? t.duel.comeback
      : won
        ? t.duel.victory
        : t.duel.defeat;
  // Win/perfect → gold; loss → a restrained, muted red (dignified, not punishing).
  const headlineColor = won ? "var(--amber)" : "color-mix(in srgb, var(--pink) 70%, var(--muted))";
  const scoreAccent = won ? "var(--lime)" : "var(--pink)";

  const why = resultReasonCopy(t, result);
  const closeLoss = !won && result.rival_round_wins - result.user_round_wins === 1;

  return (
    <main
      style={{
        minHeight: "100dvh",
        width: "100%",
        maxWidth: 480,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding:
          "calc(env(safe-area-inset-top) + clamp(28px, 8vh, 56px)) clamp(16px, 5vw, 22px) calc(110px + env(safe-area-inset-bottom))",
        boxSizing: "border-box",
        textAlign: "center",
      }}
    >
      {/* Celebration: a burst only on a win; bigger + gold-weighted on a perfect. Reduced-motion-aware
          inside Confetti itself. Nothing flashy on a loss — keep it dignified, momentum-forward. */}
      {won && (
        <Confetti
          burstKey={isPerfect ? 2 : isComeback ? 3 : 1}
          count={isPerfect ? 200 : isComeback ? 175 : 130}
        />
      )}

      {/* Eyebrow + outcome crest */}
      <div style={{ ...eyebrow, color: won ? "var(--amber)" : "var(--muted)" }}>{t.duel.resultEyebrow}</div>
      <div
        aria-hidden
        className={`emoji${won && !reduced ? " rr-pop" : ""}`}
        style={{
          fontSize: 60,
          lineHeight: 1,
          filter: won
            ? `drop-shadow(0 6px 22px color-mix(in srgb, ${isComeback ? "var(--lime)" : "var(--amber)"} 55%, transparent))`
            : "grayscale(.3) brightness(.85)",
        }}
      >
        {won ? (isComeback ? "🔥" : "👑") : "⚔️"}
      </div>

      <Display
        pop={isPerfect || isComeback}
        gold={won && !isComeback}
        className={won && !reduced ? "rr-pop" : undefined}
        style={{
          fontSize: "clamp(38px, 12vw, 56px)",
          lineHeight: 1.02,
          color: isComeback ? "var(--lime)" : won ? undefined : headlineColor,
        }}
      >
        {headline}
      </Display>

      {/* Perfect honor badge (the comeback is celebrated by its own headline above). */}
      {isPerfect && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Badge label={t.duel.perfectBadge} emoji="✨" accent="var(--amber)" />
        </div>
      )}

      {/* Head-to-head ledger — the duel scoreline, the centerpiece. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginTop: 2,
        }}
      >
        <ScoreSide label={t.duel.you} wins={result.user_round_wins} accent={won ? scoreAccent : "var(--text)"} big={won} />
        <span className="display" style={{ fontSize: 16, color: "var(--muted)", letterSpacing: 1 }}>
          —
        </span>
        <ScoreSide
          label={t.duel.rivalShort}
          wins={result.rival_round_wins}
          accent={won ? "var(--muted)" : "var(--pink)"}
          big={!won}
        />
      </div>

      {/* Why — the one-line explanation of the result (acceptance #19). */}
      <div style={{ color: "var(--muted)", fontSize: 14.5, fontWeight: 700, maxWidth: 340 }}>{why}</div>

      {/* Gems — the stake outcome. Positive (gold/cyan + count-up) on a win, restrained on a loss,
          and the no-stakes line for a Training duel (gem_delta === 0). */}
      <GemPanel delta={result.gem_delta} t={t} />

      {/* XP + tier + streak — the progression strip. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", width: "100%", maxWidth: 360 }}>
        <Chip label={fmt(t.duel.xpGain, { n: result.xp_awarded })} accent="var(--brand-2)" />
        <Chip label={(t.duel.duelTier as Record<string, string>)[result.duel_tier] ?? result.duel_tier} accent="var(--cyan)" />
        {stats && stats.current_streak > 0 && (
          <Chip label={fmt(t.duel.duelStreak, { n: stats.current_streak })} accent="var(--amber)" emoji="🔥" />
        )}
        {stats && (
          <Chip label={fmt(t.duel.recordLine, { w: stats.wins, l: stats.losses })} accent="var(--muted)" />
        )}
      </div>

      {/* Close-loss nudge — a one-round loss, framed as momentum, not failure. */}
      {closeLoss && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "10px 16px",
            borderRadius: 14,
            border: "1px solid color-mix(in srgb, var(--pink) 38%, transparent)",
            background: "color-mix(in srgb, var(--pink) 12%, var(--panel))",
            color: "var(--text)",
            fontWeight: 700,
            fontSize: 13.5,
            maxWidth: 360,
          }}
        >
          <span aria-hidden className="emoji" style={{ fontSize: 16 }}>
            🎯
          </span>
          {t.duel.closeLoss}
        </div>
      )}

      {/* CTAs — Run It Back is ALWAYS the primary, win or lose (the core loop). */}
      <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
        <GoldButton onClick={onRunItBack}>{t.duel.runItBack}</GoldButton>
        <button
          type="button"
          onClick={onHome}
          style={{
            padding: "13px 26px",
            borderRadius: 14,
            border: "1px solid var(--line)",
            background: "color-mix(in srgb, var(--panel2) 50%, transparent)",
            color: "var(--text)",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          <FitText as="span" size={14} min={0.6} style={{ display: "block", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}>
            {t.duel.home}
          </FitText>
        </button>
      </div>
    </main>
  );
}

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  fontWeight: 800,
};

/** One side of the final scoreline — label over a big round-win count. The winner's side is larger. */
function ScoreSide({ label, wins, accent, big }: { label: string; wins: number; accent: string; big: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 56 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "var(--muted)" }}>{label}</span>
      <span
        className="display"
        style={{
          fontSize: big ? 52 : 42,
          lineHeight: 1,
          color: accent,
          textShadow: `0 0 18px color-mix(in srgb, ${accent} 50%, transparent)`,
        }}
      >
        {wins}
      </span>
    </div>
  );
}

/** The Gem stake outcome panel: earned (gold/cyan + count-up), lost (restrained), or no-stakes. */
function GemPanel({ delta, t }: { delta: number; t: ReturnType<typeof useT> }) {
  if (delta === 0) {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 18px",
          borderRadius: 16,
          border: "1px solid var(--line)",
          background: "color-mix(in srgb, var(--panel) 55%, transparent)",
          color: "var(--muted)",
          fontWeight: 700,
          fontSize: 14,
          maxWidth: 360,
        }}
      >
        <GemIcon size={16} style={{ opacity: 0.7 }} />
        {t.duel.noGemChange}
      </div>
    );
  }
  const earned = delta > 0;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "13px 22px",
        borderRadius: 18,
        border: `1.5px solid ${earned ? "color-mix(in srgb, var(--cyan) 50%, transparent)" : "color-mix(in srgb, var(--pink) 40%, transparent)"}`,
        background: earned
          ? "linear-gradient(160deg, color-mix(in srgb, var(--brand-2) 24%, var(--panel2)), var(--panel))"
          : "color-mix(in srgb, var(--panel2) 50%, transparent)",
        boxShadow: earned ? "0 0 26px color-mix(in srgb, var(--cyan) 22%, transparent)" : "none",
      }}
    >
      <GemIcon size={22} />
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
        <span
          className="display"
          style={{ fontSize: 26, color: earned ? "var(--cyan)" : "var(--pink)" }}
        >
          {earned ? "+" : "−"}
          <CountUp value={Math.abs(delta)} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
          {earned
            ? fmt(t.duel.gemsEarned, { n: delta })
            : fmt(t.duel.gemsLost, { n: Math.abs(delta) })}
        </span>
      </span>
    </div>
  );
}

/** A small earned-honor badge (Flawless / Comeback). */
function Badge({ label, emoji, accent }: { label: string; emoji: string; accent: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 0.4,
        color: accent,
        background: `color-mix(in srgb, ${accent} 14%, var(--panel))`,
        border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)`,
      }}
    >
      <span aria-hidden className="emoji" style={{ fontSize: 13 }}>
        {emoji}
      </span>
      {label}
    </span>
  );
}

/** A compact progression chip (XP / tier / streak / record). */
function Chip({ label, accent, emoji }: { label: string; accent: string; emoji?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "7px 13px",
        borderRadius: 12,
        fontSize: 12.5,
        fontWeight: 800,
        color: accent,
        background: "color-mix(in srgb, var(--panel2) 45%, transparent)",
        border: "1px solid var(--line)",
      }}
    >
      {emoji && (
        <span aria-hidden className="emoji" style={{ fontSize: 12 }}>
          {emoji}
        </span>
      )}
      {label}
    </span>
  );
}
