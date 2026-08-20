import type { DuelTier } from "@/api/client";
import { lobbyArt } from "@/assets/lobby";
import { fmt } from "@/i18n/useT";
import { BattleAvatar } from "@/screens/duel/battle/BattleAvatar";
import { BestOfSevenPips } from "@/screens/duel/battle/BestOfSevenPips";
import { PhoneSilhouette } from "@/screens/duel/battle/PhoneSilhouette";
import { VersusMark } from "@/screens/duel/battle/VersusMark";
import { FitText } from "@/ui/FitText";
import { GemIcon } from "@/ui/GemIcon";
import { GoldButton } from "@/ui/GoldButton";
import { FlameIcon } from "@/ui/icons";
import type { ArenaViewProps } from "./DuelLobby";

/**
 * The ORIGINAL rich, arcade Duel arena — the loud purple-glass face-off card with the glowing gold
 * VS, chunky GoldButton, and the entry heat wash. Shown ONLY on the Rot Royale (founder) theme,
 * where that arcade energy belongs. Every other theme renders MinimalArena instead. Stakes state +
 * handlers arrive via props; the founder skin always shows the illustrated hooded medallions.
 */
export function ClassicArena({
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
  heat,
  record,
  streak,
  username,
  ctaLabel,
  onSelectTier,
  onBack,
  showRules,
  setShowRules,
}: ArenaViewProps) {
  return (
    <main style={shell}>
      {/* Header: back + title/subtitle + Gem balance. */}
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" aria-label={t.duel.home} onClick={onBack} style={backBtn}>
          ‹
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FitText
            as="div"
            className="display"
            size={26}
            min={0.6}
            style={{ color: "var(--text)", lineHeight: 1, width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}
          >
            {t.duel.lobbyTitle}
          </FitText>
          <FitText
            as="div"
            size={12}
            min={0.7}
            style={{ color: "var(--muted)", fontWeight: 600, marginTop: 3, width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}
          >
            {t.duel.bestOf7} • {t.duel.cardSubtitle}
          </FitText>
        </div>
        <div style={gemChip}>
          <GemIcon size={20} />
          <span className="display" style={{ fontSize: 20, color: "var(--cyan)" }}>
            {config.gems_balance}
          </span>
        </div>
      </header>

      {/* The card block centres in the leftover height — no dead bottom half. */}
      <div style={{ margin: "auto 0", display: "flex", flexDirection: "column", gap: 12, containerType: "inline-size" }}>
        <section
          style={{
            ...arenaCard,
            // Escalation: the rim warms from violet toward gold with the entry (transitions below).
            border: `1px solid color-mix(in srgb, var(--amber) ${Math.round(28 + heat * 44)}%, color-mix(in srgb, var(--brand-2) 40%, transparent))`,
          }}
        >
          {/* Heat wash — an amber pool that rises with the selected entry. */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              pointerEvents: "none",
              background: "radial-gradient(120% 82% at 50% 0%, color-mix(in srgb, var(--amber) 24%, transparent) 0%, transparent 62%)",
              opacity: heat,
              transition: "opacity 320ms ease",
            }}
          />

          <FitText
            as="div"
            className="display"
            size="clamp(20px, 6.4cqw, 26px)"
            min={0.6}
            style={{ color: "var(--text)", textAlign: "center", position: "relative", width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}
          >
            {t.duel.openDuel}
          </FitText>
          <div style={{ color: "color-mix(in srgb, var(--text) 72%, var(--muted))", fontSize: "clamp(11.5px, 3.2cqw, 13px)", fontWeight: 600, textAlign: "center", position: "relative" }}>
            {t.duel.duelTagline}
          </div>

          {/* The face-off — YOUR name + record vs a silhouetted unknown, over the faint question
              screen, with the periodic lean-in beat. Extra bottom padding reserves the label room. */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(8px, 2.6cqw, 16px)", paddingTop: "clamp(8px, 2.4cqw, 12px)", paddingBottom: "clamp(28px, 8cqw, 36px)" }}>
            <BattleAvatar
              src={lobbyArt.avatarHooded}
              label={username ?? t.duel.cardYou}
              sub={record}
              glow="color-mix(in srgb, var(--brand-2) 82%, transparent)"
              size="clamp(72px, 22cqw, 100px)"
              reduced={reduced}
              z={2}
              className={reduced ? undefined : "rr-faceoff-a"}
            />
            <div style={{ position: "relative", flex: "none", display: "grid", placeItems: "center" }}>
              <PhoneSilhouette />
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 2 }}>
                <VersusMark size="clamp(24px, 7.4cqw, 36px)" reduced={reduced} />
              </div>
              {/* The POOL, physically between the two of you once Gems are on the line. */}
              {sel && !openEntry && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    bottom: "5%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 3,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: "linear-gradient(180deg, rgba(22,11,42,.9), rgba(10,5,24,.9))",
                    border: "1px solid color-mix(in srgb, var(--amber) 68%, transparent)",
                    boxShadow: `0 0 ${Math.round(8 + heat * 10)}px color-mix(in srgb, var(--amber) 45%, transparent)`,
                  }}
                >
                  <GemIcon size={12} />
                  <span className="display" style={{ fontSize: 13, color: "var(--amber)", lineHeight: 1 }}>
                    {sel.pool_gems}
                  </span>
                </span>
              )}
            </div>
            <BattleAvatar
              src={lobbyArt.avatarBot}
              label={t.duel.cardRival}
              glow="color-mix(in srgb, var(--amber) 76%, transparent)"
              size="clamp(72px, 22cqw, 100px)"
              reduced={reduced}
              z={1}
              mystery
              className={reduced ? undefined : "rr-faceoff-b"}
            />
          </div>
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <BestOfSevenPips label={t.duel.cardBestOf} reduced={reduced} />
            <div style={{ color: "var(--muted)", fontSize: "clamp(10px, 2.8cqw, 11px)", fontWeight: 600, textAlign: "center" }}>
              {t.duel.attritionLine}
            </div>
            {streak >= 2 && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--amber)", fontSize: "clamp(11px, 3cqw, 12.5px)", fontWeight: 800 }}>
                <FlameIcon size={13} style={{ flex: "none" }} />
                {fmt(t.duel.streakOnLine, { n: streak })}
              </div>
            )}
          </div>

          {/* Entry selector — every REAL server tier as one compact chip; 0 is just the default. */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8, paddingTop: "clamp(6px, 1.8cqw, 10px)" }}>
            <div style={{ color: "var(--muted)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", textAlign: "center" }}>
              {t.duel.entry}
            </div>
            <div style={{ display: "flex", gap: 7 }}>
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
            <div style={{ minHeight: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center" }}>
              {sel && openEntry && (
                <span style={{ color: "var(--muted)", fontSize: 11.5, fontWeight: 600 }}>{t.duel.noGemsLine}</span>
              )}
              {sel && !openEntry && (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>
                    {t.duel.entry}: <GemVal n={sel.entry_gems} color="var(--cyan)" /> • {t.duel.pool}: <GemVal n={sel.pool_gems} color="var(--amber)" />
                  </span>
                  {unaffordable && (
                    <span style={{ color: "color-mix(in srgb, var(--brand-2) 60%, white)", fontSize: 11.5, fontWeight: 700 }}>
                      {t.duel.earnGemsHint}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <GoldButton
            disabled={!startable}
            onClick={() => sel && onSelectTier(sel.type)}
            style={{ fontSize: "clamp(15px, 4.4cqw, 17px)", padding: "clamp(13px, 3.8cqw, 15px) 20px" }}
          >
            {ctaLabel}
          </GoldButton>
        </section>

        {/* Collapsed rules + Gems disclosure — a quiet row, not a resident block. */}
        <button type="button" aria-expanded={showRules} onClick={() => setShowRules((v) => !v)} style={rulesRow}>
          <FitText as="span" size={12} min={0.7} style={{ flex: 1, minWidth: 0, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden" }}>{t.duel.rulesTitle}</FitText>
          <span aria-hidden style={{ fontSize: 13, transform: showRules ? "rotate(180deg)" : "none", display: "inline-block", transition: "transform 160ms" }}>
            ˅
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

/** An inline "[gem] n" value for the entry/pool helper line. */
function GemVal({ n, color }: { n: number; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color, fontWeight: 800 }}>
      <GemIcon size={12} />
      {n}
    </span>
  );
}

/** One compact entry chip (a real server tier — 0 = the open/training tier). Locked = dimmed. */
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
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        minHeight: 44,
        padding: "7px 4px",
        borderRadius: 13,
        cursor: locked ? "default" : "pointer",
        opacity: locked ? 0.5 : 1,
        color: "var(--text)",
        background: selected
          ? "linear-gradient(180deg, color-mix(in srgb, var(--brand-2) 38%, var(--panel2)), var(--panel))"
          : "color-mix(in srgb, var(--panel) 82%, transparent)",
        border: selected
          ? "1.5px solid color-mix(in srgb, var(--amber) 62%, transparent)"
          : "1px solid color-mix(in srgb, var(--brand-2) 28%, var(--line))",
        boxShadow: selected ? "inset 0 1px 0 rgba(255,255,255,.14), 0 4px 12px rgba(0,0,0,.3)" : "none",
        transition: "border-color 140ms ease, background 140ms ease",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <GemIcon size={12} />
        <span className="display" style={{ fontSize: 16, color: selected ? "var(--cyan)" : "var(--text)" }}>
          {tier.entry_gems}
        </span>
      </span>
      {locked && (
        <FitText
          as="span"
          size={8}
          min={0.66}
          style={{ fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}
        >
          {lockedLabel}
        </FitText>
      )}
    </button>
  );
}

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  margin: "0 auto",
  minHeight: "100dvh",
  padding:
    "calc(clamp(14px, 5vw, 22px) + env(safe-area-inset-top)) clamp(14px, 4vw, 20px) calc(110px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const backBtn: React.CSSProperties = {
  flex: "none",
  width: 40,
  height: 40,
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--panel) 70%, transparent)",
  color: "var(--text)",
  fontSize: 24,
  lineHeight: 1,
  cursor: "pointer",
};

const gemChip: React.CSSProperties = {
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "7px 13px",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--panel) 72%, transparent)",
  border: "1px solid color-mix(in srgb, var(--brand-2) 45%, transparent)",
};

/** The one arena card — deep purple glass with a confident rim; depth from border/shadow, one quiet
 * violet pool of light behind the scene. The border is set inline (it warms with the entry heat). */
const arenaCard: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  gap: "clamp(6px, 1.8cqw, 9px)",
  padding: "clamp(16px, 4.6cqw, 22px) clamp(14px, 4cqw, 18px)",
  borderRadius: 24,
  background:
    "radial-gradient(110% 70% at 50% 0%, color-mix(in srgb, var(--brand) 34%, transparent) 0%, transparent 60%)," +
    " linear-gradient(170deg, color-mix(in srgb, var(--panel2) 90%, var(--brand)) 0%, color-mix(in srgb, var(--panel) 94%, black) 100%)",
  boxShadow: "0 18px 40px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12), inset 0 -22px 40px rgba(0,0,0,.3)",
  transition: "border-color 320ms ease",
};

const rulesRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 14px",
  borderRadius: 14,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--panel) 72%, transparent)",
  color: "var(--muted)",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.08em",
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
