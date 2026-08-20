import { fmt, useT } from "@/i18n/useT";
import { FitText } from "@/ui/FitText";

export interface NextStepCardProps {
  world: string;
  levelNumber: number;
  title: string; // level title (manifest copy)
  onContinue: () => void;
}

/** The campaign next step — a single tappable card that drops the player back onto their current
 *  mission. Whole card is the affordance (big tap target); the chevron signals "go". */
export function NextStepCard({ world, levelNumber, title, onContinue }: NextStepCardProps) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onContinue}
      onPointerDown={(e) => (e.currentTarget.style.transform = "scale(.985)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 15px",
        borderRadius: 20,
        cursor: "pointer",
        color: "var(--text)",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--brand) 34%, var(--panel2)) 0%, var(--panel2) 60%, var(--panel) 100%)",
        border: "1px solid color-mix(in srgb, var(--brand) 40%, transparent)",
        boxShadow: "0 14px 30px rgba(0,0,0,.34)",
        transition: "transform 120ms ease",
      }}
    >
      <span
        aria-hidden
        className="emoji"
        style={{
          width: 46,
          height: 46,
          flex: "none",
          display: "grid",
          placeItems: "center",
          fontSize: 24,
          borderRadius: 14,
          background:
            "radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--brand) 55%, var(--panel2)), var(--panel))",
          border: "1px solid color-mix(in srgb, var(--brand-2) 45%, transparent)",
        }}
      >
        🗺️
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <FitText
          as="div"
          size={10}
          min={0.66}
          style={{
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontWeight: 800,
            color: "var(--brand-2)",
            width: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {t.today.nextStepEyebrow}
        </FitText>
        <div className="display" style={{ fontSize: 15, lineHeight: 1.1, marginTop: 1 }}>
          {fmt(t.today.nextStepLevel, { world, n: levelNumber })}
        </div>
        <FitText
          as="div"
          size={12}
          min={0.7}
          style={{
            color: "var(--muted)",
            fontWeight: 600,
            marginTop: 1,
            width: "100%",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </FitText>
      </div>
      <span aria-hidden style={{ flex: "none", color: "var(--brand-2)", fontSize: 22, fontWeight: 900 }}>
        ›
      </span>
    </button>
  );
}
