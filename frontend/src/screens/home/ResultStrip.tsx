import { fmt, useT } from "@/i18n/useT";
import { ordinalPlace, royaleTitleKey } from "@/lib/home";

export interface ResultStripProps {
  slot: string; // "midday"
  place: number; // 1-based placement
  coins: number; // coins awarded (>= 0)
  ratingDelta: number; // can be negative
  podium: boolean; // top-3 → celebratory gold treatment
  onClick?: () => void; // open the full Royale Results reveal
}

/**
 * The previous game's outcome as a compact, TAPPABLE victory ticket — the gateway into the full
 * Royale Results reveal. A real podium finish gets the celebratory gold-trophy treatment (1st place
 * goes fully gold); anything else is shown honestly (real place + the true rating delta, negatives
 * included) — no fake dopamine over a loss (DESIGN §7).
 */
export function ResultStrip({ slot, place, coins, ratingDelta, podium, onClick }: ResultStripProps) {
  const t = useT();
  const ratingPositive = ratingDelta >= 0;
  const winner = place === 1;
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(e) => (e.currentTarget.style.transform = "scale(.985)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{
        width: "100%",
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        font: "inherit",
        color: "inherit",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px 14px 18px",
        borderRadius: 24,
        transition: "transform 140ms ease",
        background: podium
          ? "linear-gradient(135deg, color-mix(in srgb, var(--amber) 28%, var(--panel)), var(--panel))"
          : "linear-gradient(135deg, var(--panel2), var(--panel))",
        border: `1px solid ${winner ? "rgba(255,201,30,.7)" : podium ? "rgba(255,201,30,.5)" : "var(--line)"}`,
        boxShadow: winner
          ? "0 14px 34px rgba(0,0,0,.35), 0 0 30px rgba(255,193,52,.4)"
          : podium
            ? "0 14px 34px rgba(0,0,0,.35), 0 0 24px rgba(255,193,52,.28)"
            : "0 14px 34px rgba(0,0,0,.35)",
      }}
    >
      <span
        aria-hidden
        className="emoji"
        style={{
          fontSize: 40,
          lineHeight: 1,
          filter: podium ? "drop-shadow(0 4px 12px rgba(255,201,30,.55))" : "none",
        }}
      >
        {winner ? "👑" : podium ? "🏆" : "🎯"}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontWeight: 800,
            color: "var(--amber)",
          }}
        >
          {fmt(t.home.slotResultView, { slot: t.home[royaleTitleKey(slot)] })}
        </div>
        <div className="display" style={{ fontSize: 24, color: "var(--text)", lineHeight: 1.05 }}>
          {fmt(t.home.placeLabel, { place: ordinalPlace(place) })}
        </div>
      </div>

      <Stat value={`+${coins}`} label={t.home.coins} color="var(--amber)" />
      <Divider />
      <Stat
        value={`${ratingPositive ? "+" : "−"}${Math.abs(ratingDelta)}`}
        label={t.home.rating}
        color={ratingPositive ? "var(--brand-2)" : "var(--pink)"}
      />
      <span
        aria-hidden
        style={{ color: "var(--amber)", fontSize: 26, fontWeight: 800, flex: "none", marginLeft: 2 }}
      >
        ›
      </span>
    </button>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ textAlign: "center", flex: "none" }}>
      <div className="display" style={{ fontSize: 20, color, lineHeight: 1 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 800,
          color: "var(--faint)",
          marginTop: 3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Divider() {
  return <div aria-hidden style={{ width: 1, height: 30, background: "var(--line)", flex: "none" }} />;
}
