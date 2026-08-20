import type { Friend } from "@/api/client";
import { Avatar } from "@/screens/home/Avatar";
import { fmt, useT } from "@/i18n/useT";
import { FitText } from "@/ui/FitText";

// Editorial serif for the rival's name — the one featured card on the page (matches the titles).
const SERIF = '"Playfair Display", "Cormorant Garamond", Georgia, serif';

const card: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "13px 14px 13px 16px",
  borderRadius: 18,
  background: "color-mix(in srgb, var(--panel) 60%, transparent)",
  border: "1px solid color-mix(in srgb, var(--line) 80%, transparent)",
  boxShadow: "0 8px 24px rgba(37, 31, 23, 0.05)",
  overflow: "hidden",
};

/** The single lavender edge accent — the card's only loud stroke. */
const accent: React.CSSProperties = {
  position: "absolute",
  left: 0,
  top: "22%",
  bottom: "22%",
  width: 2.5,
  borderRadius: 999,
  background: "var(--brand)",
};

const settleBtn: React.CSSProperties = {
  marginLeft: "auto",
  flex: "none",
  padding: "8px 15px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--brand) 42%, transparent)",
  background: "transparent",
  color: "var(--text)",
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export function RivalCard({ rival, onSettle }: { rival: Friend; onSettle: () => void }) {
  const t = useT();
  const rv = t.rivalry;
  const record =
    rival.wins > rival.losses
      ? fmt(rv.youLead, { w: rival.wins, l: rival.losses })
      : rival.wins < rival.losses
        ? fmt(rv.youTrail, { w: rival.wins, l: rival.losses })
        : fmt(rv.even, { w: rival.wins, l: rival.losses });
  const streakText =
    rival.streak > 0
      ? fmt(rv.wonStreak, { n: rival.streak })
      : rival.streak < 0
        ? fmt(rv.lostStreak, { n: -rival.streak })
        : "";
  return (
    <section style={card}>
      <span aria-hidden style={accent} />
      <Avatar size={42} preset={rival.avatar_preset} frame={rival.equipped_frame} animated={false} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <FitText
          as="div"
          size={9.5}
          min={0.66}
          style={{ fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--brand)", width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}
        >
          {rv.label}
        </FitText>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 19,
            fontWeight: 600,
            color: "var(--text)",
            lineHeight: 1.15,
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {rival.username}
        </div>
        <FitText
          as="div"
          size={12}
          min={0.7}
          style={{ color: "var(--muted)", marginTop: 2, width: "100%", overflow: "hidden", whiteSpace: "nowrap" }}
        >
          {record}
          {streakText && (
            <> · <span style={{ color: rival.streak > 0 ? "var(--lime)" : "var(--pink)", fontWeight: 700 }}>{streakText}</span></>
          )}
        </FitText>
      </div>
      <button type="button" className="rr-tap" onClick={onSettle} style={settleBtn}>
        {rv.settle}
      </button>
    </section>
  );
}
