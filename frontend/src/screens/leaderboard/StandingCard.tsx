import { lobbyArt } from "@/assets/lobby";
import { FitText } from "@/ui/FitText";
import { activeTag } from "@/i18n/format";

interface StandingCardProps {
  rank: number | null;
  division: string;
  rating: number;
  top3Finishes: number;
  /** Rating delta from the player's most recent settled game; null when there is no settled history. */
  fromLastGame: number | null;
  labels: {
    yourStanding: string;
    unranked: string;
    rating: string;
    topFinishes: string;
    fromLastGame: string;
  };
}

/**
 * "Your Standing" — a compact 3-column grid (shield · rank block · stat strip), 96–104px tall. Calm
 * by design: a soft drop-shadow only (no big glow) so it sits BELOW the podium in the hierarchy. The
 * division never truncates. Dynamic rank/division/rating from the profile.
 */
export function StandingCard({
  rank,
  division,
  rating,
  top3Finishes,
  fromLastGame,
  labels,
}: StandingCardProps) {
  const rankDisplay = rank != null ? `#${rank}` : labels.unranked;
  const showDivision = division && division.trim().length > 0;

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 20,
        padding: "7px 12px",
        minHeight: 86,
        maxHeight: 94,
        // Calm panel — minimal brand tint, no glow — so it ranks BELOW the podium in the hierarchy.
        background: "linear-gradient(135deg, color-mix(in srgb, var(--brand) 14%, var(--panel2)) 0%, var(--panel) 80%)",
        border: "1px solid var(--line)",
        boxShadow: "0 6px 16px rgba(0,0,0,.36), inset 0 1px 0 rgba(255,255,255,.04)",
        display: "grid",
        gridTemplateColumns: "76px 92px 1fr",
        alignItems: "center",
        columnGap: 8,
      }}
    >
      {/* Shield */}
      <div style={{ position: "relative", width: 76, height: 76, display: "grid", placeItems: "center" }}>
        <img
          src={lobbyArt.shieldGoldIii}
          alt=""
          aria-hidden
          draggable={false}
          style={{ width: 72, height: 72, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,.5))" }}
        />
      </div>

      {/* Rank block */}
      <div style={{ minWidth: 0 }}>
        <FitText
          as="div"
          size={8.5}
          min={0.66}
          style={{
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--brand-2)",
            marginBottom: 1,
            width: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {labels.yourStanding}
        </FitText>
        <div className="display" style={{ fontSize: "clamp(42px, 11vw, 46px)", color: "var(--text)", lineHeight: 0.88, letterSpacing: 0 }}>
          {rankDisplay}
        </div>
        {showDivision && (
          <div style={{ marginTop: 2, fontSize: 16, fontWeight: 900, color: "var(--amber)", letterSpacing: "0.02em", textTransform: "uppercase", lineHeight: 1, whiteSpace: "nowrap" }}>
            {division}
          </div>
        )}
      </div>

      {/* Stat strip — 3 equal columns + dividers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          borderRadius: 11,
          background: "color-mix(in srgb, var(--panel) 45%, transparent)",
          border: "1px solid color-mix(in srgb, var(--line) 60%, transparent)",
        }}
      >
        <StatCol icon={<StarIcon />} label={labels.rating} value={rating.toLocaleString(activeTag())} tone="amber" />
        <StatCol icon={<FlameGlyph />} label={labels.topFinishes} value={String(top3Finishes)} tone="amber" divided />
        <StatCol icon={<BarsIcon />} label={labels.fromLastGame} value={fromLastGame == null ? "—" : signed(fromLastGame)} delta={fromLastGame} divided />
      </div>
    </div>
  );
}

/** Signed rating delta with a real minus sign: 24 → "+24", -8 → "−8", 0 → "±0". */
function signed(n: number): string {
  if (n === 0) return "±0";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString(activeTag())}`;
}

function StatCol({
  icon,
  label,
  value,
  tone,
  divided = false,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "amber";
  divided?: boolean;
  delta?: number | null;
}) {
  const color =
    delta != null
      ? delta > 0
        ? "var(--brand-2)"
        : delta < 0
          ? "var(--pink)"
          : "var(--muted)"
      : tone === "amber"
        ? "var(--amber)"
        : "var(--text)";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        padding: "6px 3px",
        minWidth: 0,
        borderLeft: divided ? "1px solid var(--line)" : undefined,
      }}
    >
      <span aria-hidden style={{ display: "flex", color, opacity: 0.9 }}>
        {icon}
      </span>
      <span className="display" style={{ fontSize: 16, color, lineHeight: 1, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
      <FitText
        as="span"
        size={8}
        min={0.66}
        style={{ fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--faint)", textAlign: "center", lineHeight: 1.05, width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {label}
      </FitText>
    </div>
  );
}

/* --- CSS-only stat glyphs --- */
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12 }} fill="currentColor" aria-hidden>
      <path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9l6.6-.9z" />
    </svg>
  );
}
function FlameGlyph() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12 }} fill="currentColor" aria-hidden>
      <path d="M13 2c1 3-1 4.5-2.5 6.5C9 10.5 8 12 8 14a4 4 0 008 0c0-2-1-3.2-2-5 2.4 1 4 3.2 4 6a6 6 0 11-12 0c0-4.4 3.4-7.2 5-9 1-1.1 1.8-2.6 2-4z" />
    </svg>
  );
}
function BarsIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12 }} fill="currentColor" aria-hidden>
      <rect x="3" y="13" width="4" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="13" rx="1" />
      <rect x="17" y="4" width="4" height="17" rx="1" />
    </svg>
  );
}
