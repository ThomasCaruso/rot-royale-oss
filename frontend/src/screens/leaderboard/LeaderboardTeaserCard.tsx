import { fmt, useT } from "@/i18n/useT";
import { CrownIcon } from "@/ui/CrownIcon";
import { FitText } from "@/ui/FitText";
import { useSessionStore } from "@/store/session";

export function LeaderboardTeaserCard({ onLeaderboard }: { onLeaderboard: () => void }) {
  const t = useT();
  const me = useSessionStore((s) => s.me);

  const rank = me?.rank;
  const division = me?.division;
  const showStanding = rank != null && division;

  const statusLine = showStanding
    ? fmt(t.leaderboard.teaserStanding, { rank, division })
    : t.leaderboard.teaserDefault;

  return (
    <button
      type="button"
      onClick={onLeaderboard}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 18px",
        borderRadius: 20,
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--brand) 35%, var(--panel2)) 0%, var(--panel) 100%)",
        border: "1.5px solid color-mix(in srgb, var(--brand) 35%, transparent)",
        boxShadow: "0 8px 24px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.05)",
        cursor: "pointer",
        textAlign: "left",
        transition: "border-color 180ms, box-shadow 180ms",
      }}
      onPointerDown={(e) => {
        e.currentTarget.style.borderColor = "color-mix(in srgb, var(--brand) 60%, transparent)";
        e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.05)";
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.borderColor = "color-mix(in srgb, var(--brand) 35%, transparent)";
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.05)";
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.borderColor = "color-mix(in srgb, var(--brand) 35%, transparent)";
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.05)";
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background:
            "radial-gradient(circle at 40% 35%, color-mix(in srgb, var(--amber) 18%, transparent), var(--panel))",
          border: "1.5px solid color-mix(in srgb, var(--amber) 30%, transparent)",
          flex: "none",
        }}
      >
        <CrownIcon size={22} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <FitText
          as="div"
          size={12}
          min={0.66}
          style={{
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--brand-2)",
            marginBottom: 2,
            width: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {t.nav.leaderboard}
        </FitText>
        <FitText
          as="div"
          size={13}
          min={0.7}
          style={{
            fontWeight: 600,
            color: showStanding ? "var(--amber)" : "var(--muted)",
            width: "100%",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {statusLine}
        </FitText>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          flex: "none",
        }}
      >
        <div style={{ fontSize: 18, color: "var(--brand-2)", opacity: 0.7, lineHeight: 1 }}>›</div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--brand-2)",
            opacity: 0.7,
            whiteSpace: "nowrap",
          }}
        >
          {t.leaderboard.viewLeaderboard}
        </span>
      </div>
    </button>
  );
}
