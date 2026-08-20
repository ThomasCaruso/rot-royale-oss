import { fmt } from "@/i18n/useT";
import type { DuelTier } from "@/api/client";
import { BattleAvatar } from "@/screens/duel/battle/BattleAvatar";
import { FitText } from "@/ui/FitText";
import { GemIcon } from "@/ui/GemIcon";
import type { ArenaViewProps } from "./DuelLobby";

/**
 * The quiet-luxury minimal Duel arena — shown on every theme EXCEPT Rot Royale. Token-driven: a
 * hairline panel on the theme surface (no loud gradient/glow), the player's own pfp vs an honest
 * mystery rival, a minimal VS device, clean entry chips, and a flat --cta primary pill. Compacted
 * to fill one screen without scroll; all stakes state arrives via props (see ArenaViewProps).
 */
export function MinimalArena({
  config,
  t,
  reduced,
  tiers,
  selType,
  setSelType,
  sel,
  openEntry,
  unaffordable,
  startable,
  record,
  streak,
  username,
  avatarPreset,
  equippedFrame,
  ctaLabel,
  onSelectTier,
  onBack,
  showRules,
  setShowRules,
}: ArenaViewProps) {
  return (
    <main style={shell}>
      {/* Header: back + title/subtitle + Gem balance — calm and editorial. */}
      <header style={{ display: "flex", alignItems: "center", gap: "clamp(12px, 3.5vw, 16px)" }}>
        <button type="button" aria-label={t.duel.home} onClick={onBack} style={backBtn}>
          ‹
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FitText
            as="div"
            className="display"
            size="clamp(23px, 7.5vw, 30px)"
            min={0.6}
            style={{ color: "var(--text)", lineHeight: 1, letterSpacing: ".01em", textTransform: "uppercase", width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}
          >
            {t.duel.lobbyTitle}
          </FitText>
          <FitText
            as="div"
            size="clamp(11.5px, 3.3vw, 13px)"
            min={0.7}
            style={{ color: "var(--muted)", fontWeight: 600, marginTop: 4, width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}
          >
            {t.duel.bestOf7} • {t.duel.cardSubtitle}
          </FitText>
        </div>
        <div style={gemPill}>
          <GemIcon size={16} />
          <span className="display" style={{ fontSize: 17, color: "var(--text)" }}>
            {config.gems_balance}
          </span>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, containerType: "inline-size" }}>
        <section style={duelPanel}>
          {/* A whisper of the brand accent pooled at the top edge — the only tint on the panel. */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              pointerEvents: "none",
              background: "radial-gradient(120% 62% at 50% 0%, color-mix(in srgb, var(--brand) 10%, transparent) 0%, transparent 60%)",
            }}
          />

          {/* Title + tagline. */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <FitText
              as="div"
              className="display"
              size="clamp(23px, 7.5cqw, 29px)"
              min={0.6}
              style={{ color: "var(--text)", textAlign: "center", lineHeight: 1.05, width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}
            >
              {t.duel.openDuel}
            </FitText>
            <div style={{ color: "color-mix(in srgb, var(--text) 62%, var(--muted))", fontSize: "clamp(12.5px, 3.6cqw, 14.5px)", fontWeight: 500, textAlign: "center", lineHeight: 1.4 }}>
              {t.duel.duelTagline}
            </div>
          </div>

          {/* The matchup — the player's pfp vs an honest mystery rival, a minimal VS device between. */}
          <div style={matchupRow}>
            <BattleAvatar
              identity={{ preset: avatarPreset ?? "knight", frame: equippedFrame ?? null }}
              sleek
              label={username ?? t.duel.cardYou}
              sub={record}
              glow="color-mix(in srgb, var(--brand-2) 60%, transparent)"
              size="clamp(72px, 22cqw, 90px)"
              reduced={reduced}
              z={2}
            />
            <ArenaDevice poolGems={sel && !openEntry ? sel.pool_gems : null} />
            <BattleAvatar
              sleek
              label={t.duel.cardRival}
              glow="color-mix(in srgb, var(--brand-2) 45%, transparent)"
              size="clamp(72px, 22cqw, 90px)"
              reduced={reduced}
              z={1}
              mystery
            />
          </div>

          {/* Best of 7 — a calm section: label, seven quiet pips, one explanatory line. */}
          <div style={{ position: "relative", marginTop: "clamp(16px, 4.5vw, 24px)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <RoundPips label={t.duel.cardBestOf} sub={t.duel.attritionLine} />
            {streak >= 2 && (
              <div style={{ fontSize: "clamp(11.5px, 3.2vw, 12.5px)", fontWeight: 700, color: "var(--brand-2)" }}>
                {fmt(t.duel.streakOnLine, { n: streak })}
              </div>
            )}
          </div>

          {/* Entry selector — ENTRY between hairlines, one clean chip per real server tier. */}
          <div style={{ position: "relative", marginTop: "clamp(14px, 4vw, 20px)", display: "flex", flexDirection: "column", gap: 11 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span aria-hidden style={{ flex: 1, height: 1, background: "var(--line)" }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)" }}>
                {t.duel.entry}
              </span>
              <span aria-hidden style={{ flex: 1, height: 1, background: "var(--line)" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${tiers.length}, 1fr)`, gap: 10 }}>
              {tiers.map((tier) => (
                <EntryChip
                  key={tier.type}
                  tier={tier}
                  selected={tier.type === selType}
                  lockedLabel={t.duel.locked}
                  onSelect={() => tier.unlocked && setSelType(tier.type)}
                />
              ))}
            </div>

            {/* One helper slot (fixed min-height so the card never jumps between selections). */}
            <div style={{ minHeight: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center", marginTop: 2 }}>
              {sel && openEntry && (
                <span style={{ color: "var(--muted)", fontSize: 12.5, fontWeight: 500 }}>{t.duel.noGemsLine}</span>
              )}
              {sel && !openEntry && (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--muted)", fontSize: 12.5, fontWeight: 500 }}>
                    {t.duel.entry}: <GemVal n={sel.entry_gems} /> • {t.duel.pool}: <GemVal n={sel.pool_gems} />
                  </span>
                  {unaffordable && (
                    <span style={{ color: "var(--brand-2)", fontSize: 11.5, fontWeight: 600 }}>{t.duel.earnGemsHint}</span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* The one dominant action — a flat premium pill on the theme's CTA surface (no glow). */}
          <button
            type="button"
            className="display"
            disabled={!startable}
            onClick={() => sel && onSelectTier(sel.type)}
            onPointerDown={(e) => startable && (e.currentTarget.style.transform = "translateY(1px)")}
            onPointerUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
            onPointerLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
            style={duelPrimaryAction(startable)}
          >
            <FitText
              as="span"
              size="clamp(15px, 4.4vw, 17px)"
              min={0.6}
              style={{ display: "inline-block", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden" }}
            >
              {ctaLabel}
            </FitText>
          </button>
        </section>

        {/* A quiet settings-style row — expands the rules/disclosure in place. */}
        <button type="button" aria-expanded={showRules} onClick={() => setShowRules((v) => !v)} style={howItWorksRow}>
          <FitText as="span" size={12} min={0.7} style={{ flex: 1, minWidth: 0, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden" }}>{t.duel.rulesTitle}</FitText>
          <span aria-hidden style={{ fontSize: 18, lineHeight: 1, color: "var(--muted)", transform: showRules ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform 160ms" }}>
            ›
          </span>
        </button>
        {showRules && (
          <div style={rulesBody}>
            <p style={{ margin: 0 }}>{t.duel.rules}</p>
            <p style={{ margin: "10px 0 0" }}>
              <strong style={{ color: "color-mix(in srgb, var(--text) 75%, var(--muted))" }}>{t.duel.disclaimerLink}:</strong>{" "}
              {t.duel.disclaimer}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

/** The minimal centre "VS device" — a nearly-empty phone (the trivia they duel over) with a clean VS
 * lettermark centred over it. No lightning, no glow. Pool chip drops in only for a Gem entry. */
function ArenaDevice({ poolGems }: { poolGems: number | null }) {
  return (
    <div style={{ position: "relative", flex: "none", display: "grid", placeItems: "center" }}>
      <div
        aria-hidden
        style={{
          width: "clamp(64px, 20cqw, 80px)",
          aspectRatio: "10 / 16",
          borderRadius: "clamp(12px, 3.6cqw, 16px)",
          background:
            "linear-gradient(158deg, color-mix(in srgb, var(--brand) 9%, var(--panel)) 0%, var(--panel) 52%, color-mix(in srgb, var(--panel2) 60%, var(--panel)) 100%)",
          border: "1px solid var(--line)",
          boxShadow: "inset 0 1px 0 var(--sheen), 0 8px 20px rgba(0,0,0,.07)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "9% 0",
        }}
      >
        {/* Notch + home indicator — the only marks, so it reads "phone" without visual noise. */}
        <span style={{ width: "26%", height: 3, borderRadius: 999, background: "color-mix(in srgb, var(--text) 16%, transparent)" }} />
        <span style={{ width: "22%", height: 3, borderRadius: 999, background: "color-mix(in srgb, var(--text) 14%, transparent)" }} />
      </div>
      <span
        className="display"
        aria-hidden
        style={{ position: "absolute", fontSize: "clamp(21px, 6.6cqw, 27px)", lineHeight: 1, color: "var(--text)", letterSpacing: "-.01em" }}
      >
        VS
      </span>
      {poolGems != null && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            bottom: "-7%",
            left: "50%",
            transform: "translateX(-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 9px",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--panel2) 88%, transparent)",
            border: "1px solid var(--line)",
          }}
        >
          <GemIcon size={12} />
          <span className="display" style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1 }}>
            {poolGems}
          </span>
        </span>
      )}
    </div>
  );
}

/** The BEST-OF-7 motif — a small tracked label, seven quiet dots (the first filled), one line. */
function RoundPips({ label, sub, total = 7 }: { label: string; sub: string; total?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)" }}>
        {label}
      </span>
      <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: i === 0 ? "var(--text)" : "color-mix(in srgb, var(--text) 15%, transparent)",
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: "clamp(12px, 3.4vw, 13.5px)", color: "var(--muted)", textAlign: "center", lineHeight: 1.4 }}>
        {sub}
      </span>
    </div>
  );
}

/** An inline "[gem] n" value for the entry/pool helper line. */
function GemVal({ n }: { n: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text)", fontWeight: 700 }}>
      <GemIcon size={12} />
      {n}
    </span>
  );
}

/** One clean entry chip (a real server tier — 0 = the open/training tier). Selected = a thin accent
 * outline (no heavy shadow); locked = dimmed with a tiny label. */
function EntryChip({
  tier,
  selected,
  lockedLabel,
  onSelect,
}: {
  tier: DuelTier;
  selected: boolean;
  lockedLabel: string;
  onSelect: () => void;
}) {
  const locked = !tier.unlocked;
  return (
    <button
      type="button"
      disabled={locked}
      aria-pressed={selected}
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        height: "clamp(50px, 13.5vw, 56px)",
        borderRadius: 14,
        cursor: locked ? "default" : "pointer",
        opacity: locked ? 0.45 : 1,
        color: "var(--text)",
        background: selected ? "color-mix(in srgb, var(--brand) 7%, var(--panel))" : "var(--panel)",
        border: selected
          ? "1.5px solid color-mix(in srgb, var(--brand-2) 70%, var(--line))"
          : "1px solid var(--line)",
        transition: "border-color 140ms ease, background 140ms ease",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <GemIcon size={12} />
        <span className="display" style={{ fontSize: 15, color: "var(--text)" }}>
          {tier.entry_gems}
        </span>
      </span>
      {locked && (
        <FitText
          as="span"
          size={8.5}
          min={0.66}
          style={{ fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}
        >
          {lockedLabel}
        </FitText>
      )}
    </button>
  );
}

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 460,
  margin: "0 auto",
  minHeight: "100dvh",
  padding:
    "calc(clamp(12px, 3.5vw, 18px) + env(safe-area-inset-top)) clamp(16px, 6vw, 24px) calc(92px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: "clamp(10px, 3vw, 14px)",
};

const backBtn: React.CSSProperties = {
  flex: "none",
  width: 46,
  height: 46,
  borderRadius: 14,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--panel) 80%, transparent)",
  color: "var(--text)",
  fontSize: 24,
  lineHeight: 1,
  cursor: "pointer",
};

const gemPill: React.CSSProperties = {
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  minWidth: 82,
  height: 42,
  padding: "0 14px",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--panel) 80%, transparent)",
  border: "1px solid var(--line)",
};

/** The one arena panel — a hairline surface on the theme background: no loud gradient, no glow, one
 * soft ambient shadow so it reads as a refined container floating on the page. */
const duelPanel: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  padding: "clamp(18px, 5vw, 24px) clamp(16px, 5vw, 22px)",
  borderRadius: 26,
  background: "var(--panel)",
  border: "1px solid var(--line)",
  boxShadow: "0 8px 24px rgba(0,0,0,.05)",
};

const matchupRow: React.CSSProperties = {
  position: "relative",
  marginTop: "clamp(16px, 4.5vw, 24px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "clamp(10px, 3.5cqw, 20px)",
  paddingBottom: "clamp(22px, 6cqw, 28px)",
};

function duelPrimaryAction(startable: boolean): React.CSSProperties {
  return {
    position: "relative",
    marginTop: "clamp(14px, 4vw, 18px)",
    width: "100%",
    height: "clamp(50px, 13.5vw, 54px)",
    borderRadius: 15,
    border: "none",
    background: "var(--cta)",
    color: "var(--ctaText)",
    fontSize: "clamp(15px, 4.4vw, 17px)",
    letterSpacing: ".08em",
    textTransform: "uppercase",
    cursor: startable ? "pointer" : "default",
    opacity: startable ? 1 : 0.45,
    boxShadow: "0 6px 18px rgba(0,0,0,.12)",
    transition: "transform 80ms, opacity 140ms",
  };
}

const howItWorksRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 18px",
  height: 52,
  borderRadius: 15,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--panel) 80%, transparent)",
  color: "var(--text)",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const rulesBody: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 12.5,
  fontWeight: 500,
  lineHeight: 1.55,
  padding: "0 6px",
};
