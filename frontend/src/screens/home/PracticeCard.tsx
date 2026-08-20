import { useT } from "@/i18n/useT";
import { Display } from "@/ui/Display";

/** High-impact practice CTA — the primary action while a window settles (M8: 5 rounds, just for fun). */
export function PracticeCard({ onPractice }: { onPractice: () => void }) {
  const t = useT();
  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 18px",
        borderRadius: 26,
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--brand) 40%, var(--panel2)) 0%, var(--panel2) 55%, var(--panel) 100%)",
        border: "1px solid color-mix(in srgb, var(--brand) 42%, transparent)",
        boxShadow: "0 16px 38px rgba(0,0,0,.4), 0 0 26px color-mix(in srgb, var(--brand) 25%, transparent)",
      }}
    >
      <div
        aria-hidden
        className="emoji"
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          flex: "none",
          display: "grid",
          placeItems: "center",
          fontSize: 34,
          background:
            "radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--brand) 60%, var(--panel2)), var(--panel))",
          border: "2px solid color-mix(in srgb, var(--brand-2) 50%, transparent)",
          boxShadow: "inset 0 2px 8px rgba(0,0,0,.4), 0 0 18px color-mix(in srgb, var(--brand-2) 35%, transparent)",
        }}
      >
        🎯
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <Display style={{ fontSize: 22, color: "var(--text)", lineHeight: 1.04 }}>{t.home.practiceMode}</Display>
        <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600, marginTop: 3 }}>
          {t.home.practiceSubtitle}
        </div>
      </div>

      <button
        type="button"
        className="display"
        onClick={onPractice}
        onPointerDown={(e) => (e.currentTarget.style.transform = "scale(.96)")}
        onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        style={{
          flex: "none",
          minHeight: 58,
          padding: "0 22px",
          borderRadius: 18,
          border: "none",
          cursor: "pointer",
          fontSize: 17,
          letterSpacing: 0.5,
          color: "var(--btnText)",
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--amber) 72%, white) 0%, var(--amber) 45%, color-mix(in srgb, var(--amber) 72%, black) 100%)",
          boxShadow: "0 10px 26px color-mix(in srgb, var(--amber) 45%, transparent)",
          transition: "transform 140ms ease, box-shadow 140ms ease",
        }}
      >
        {t.home.practice}
      </button>
    </section>
  );
}
