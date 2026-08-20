import { useEffect, useState } from "react";
import { api, type SeasonStatus } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { FitText } from "@/ui/FitText";

/**
 * Season banner — a slim, self-fetching card showing the current monthly season, when it ends, and
 * your division. Monthly at rollover the ranked + duel ladders soften toward baseline and season-end
 * gems are paid (services/seasons.py); this just surfaces the live season so the ladder feels alive.
 * Calm cream/lavender, one hairline card. Renders nothing until the fetch resolves (best-effort).
 */
export function SeasonBanner() {
  const t = useT();
  const [s, setS] = useState<SeasonStatus | null>(null);

  useEffect(() => {
    let alive = true;
    // Best-effort: any throw/rejection (offline, older server) just hides the banner — it must
    // never break the leaderboard. Wrapping in Promise.resolve turns a sync throw into a rejection.
    Promise.resolve()
      .then(() => api.season())
      .then((x) => alive && setS(x))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!s) return null;

  const days = Math.max(0, Math.ceil((Date.parse(s.ends_at) - Date.now()) / 86_400_000));
  const ends =
    days <= 0 ? t.season.endsToday : days === 1 ? t.season.endsTomorrow : fmt(t.season.endsIn, { n: days });

  return (
    <section
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 18,
        border: "1px solid color-mix(in srgb, var(--brand) 22%, var(--line))",
        background: "color-mix(in srgb, var(--brand) 6%, transparent)",
      }}
    >
      <span
        aria-hidden
        style={{
          flex: "none",
          width: 40,
          height: 40,
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          color: "var(--brand)",
          background: "color-mix(in srgb, var(--brand) 13%, transparent)",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 4h12v3a6 6 0 0 1-12 0zM9 15h6M12 13v2M8 20h8"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <FitText
          as="div"
          size={11}
          min={0.66}
          style={{
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--brand)",
            width: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {t.season.label}
        </FitText>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginTop: 1 }}>
          {s.label}
        </div>
      </div>
      <div style={{ flex: "none", textAlign: "right" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{s.division}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>{ends}</div>
      </div>
    </section>
  );
}
