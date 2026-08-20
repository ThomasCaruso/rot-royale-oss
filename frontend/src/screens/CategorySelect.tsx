import { useEffect, useState } from "react";
import { type CategoryItem } from "@/api/client";
import { api } from "@/api/client";
import { useT, fmt } from "@/i18n/useT";
import { useArtStyle } from "@/theme/useArtStyle";
import { Display } from "@/ui/Display";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";
import { errorMessage } from "@/i18n/errors";

const wrap: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  margin: "0 auto",
  padding: "calc(clamp(18px, 5vw, 28px) + env(safe-area-inset-top)) clamp(14px, 4vw, 20px) calc(110px + env(safe-area-inset-bottom))",
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 2,
  textTransform: "uppercase",
  fontWeight: 800,
  color: "var(--brand-2)",
};

// Descriptive icon per canonical category — the SAME glyph shown on the in-play category splash, so
// the picker and the round screen stay consistent. Unknown categories fall back to a neutral mark.
const CATEGORY_ICON: Record<string, string> = {
  "Science & Nature": "🔬",
  History: "🏛️",
  Geography: "🌍",
  "Arts & Literature": "🎨",
  Sports: "⚽",
  "Pop Culture & Entertainment": "🎬",
  "Money & Business": "💰",
  "Street Smarts": "🧠",
};
const iconFor = (name: string): string => CATEGORY_ICON[name] ?? "❔";

function press(scale: number) {
  return (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = `scale(${scale})`;
  };
}

/** Round glowing icon disc — violet for categories, gold for the Mixed option. */
function IconDisc({ emoji, gold, size = 56 }: { emoji: string; gold?: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className="emoji"
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        background: gold
          ? "radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--amber) 45%, black), color-mix(in srgb, var(--amber) 14%, black) 72%)"
          : "radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--brand) 65%, var(--panel2)), var(--panel) 72%)",
        border: gold
          ? "1.5px solid color-mix(in srgb, var(--amber) 55%, transparent)"
          : "1.5px solid color-mix(in srgb, var(--brand-2) 50%, transparent)",
        boxShadow: gold
          ? "inset 0 2px 8px rgba(0,0,0,.45), 0 0 16px color-mix(in srgb, var(--amber) 30%, transparent)"
          : "inset 0 2px 8px rgba(0,0,0,.45), 0 0 16px color-mix(in srgb, var(--brand-2) 28%, transparent)",
      }}
    >
      {emoji}
    </span>
  );
}

/**
 * Presentational category picker (pure — easy to test). The "Mixed" card starts the unchanged
 * 5-round all-category practice (onPick(null)); each category CARD starts a scoped 10-question trivia
 * session (onPick(name)). Category choice exists ONLY here / in practice — never in ranked windows,
 * which stay mixed for fair comparability.
 */
export function CategoryList({
  categories,
  onPick,
}: {
  categories: CategoryItem[];
  onPick: (category: string | null) => void;
}) {
  const t = useT();
  const mono = useArtStyle() === "mono";

  // Mono ("Blank"): the picker is one quiet text list — Mixed first, then the six categories with
  // their counts at a lower voice. Hairline separators, a faint chevron; no emoji discs, no cards.
  if (mono) {
    const rows: Array<{ key: string; label: string; sub: string | null; onClick: () => void }> = [
      { key: "__mixed", label: t.practice.mixed, sub: t.practice.mixedSub, onClick: () => onPick(null) },
      ...categories.map((c) => ({
        key: c.name,
        label: c.name,
        sub: fmt(t.practice.questionCount, { count: c.count }),
        onClick: () => onPick(c.name),
      })),
    ];
    return (
      <GlassCard style={{ display: "flex", flexDirection: "column", padding: "6px 22px" }}>
        {rows.map((row, i) => (
          <button
            key={row.key}
            type="button"
            onClick={row.onClick}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              width: "100%",
              padding: "15px 0",
              background: "transparent",
              border: "none",
              borderTop: i === 0 ? "none" : "1px solid var(--line)",
              cursor: "pointer",
              textAlign: "left",
              color: "var(--text)",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span className="display" style={{ display: "block", fontSize: 18, lineHeight: 1.15 }}>
                {row.label}
              </span>
              {row.sub && (
                <span style={{ display: "block", marginTop: 3, fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>
                  {row.sub}
                </span>
              )}
            </span>
            <span aria-hidden style={{ color: "var(--faint)", fontSize: 17, fontWeight: 500, lineHeight: 1 }}>
              ›
            </span>
          </button>
        ))}
      </GlassCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Mixed — the prominent "play everything" card, set apart in gold above the category grid. */}
      <button
        type="button"
        onClick={() => onPick(null)}
        onPointerDown={press(0.98)}
        onPointerUp={press(1)}
        onPointerLeave={press(1)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          width: "100%",
          textAlign: "left",
          padding: "15px 18px",
          borderRadius: 20,
          border: "1px solid color-mix(in srgb, var(--amber) 34%, transparent)",
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--brand) 45%, var(--panel2)), var(--panel))",
          boxShadow: "0 14px 30px rgba(0,0,0,.4), 0 0 22px color-mix(in srgb, var(--amber) 12%, transparent)",
          cursor: "pointer",
          color: "var(--text)",
          transition: "transform 140ms ease",
        }}
      >
        <IconDisc emoji="🎲" gold size={52} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <Display gold style={{ fontSize: 20 }}>
            {t.practice.mixed}
          </Display>
          <span style={{ display: "block", color: "var(--muted)", fontSize: 12.5, fontWeight: 600 }}>
            {t.practice.mixedSub}
          </span>
        </span>
        <span aria-hidden style={{ color: "var(--amber)", fontSize: 22, fontWeight: 800 }}>
          ›
        </span>
      </button>

      {/* The six categories — two cards wide, icon over name. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {categories.map((c, i) => (
          <button
            key={c.name}
            type="button"
            onClick={() => onPick(c.name)}
            className="rr-splash-in"
            onPointerDown={press(0.97)}
            onPointerUp={press(1)}
            onPointerLeave={press(1)}
            style={{
              animationDelay: `${(i + 1) * 55}ms`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 11,
              minHeight: 160,
              padding: "20px 12px 15px",
              borderRadius: 20,
              border: "1px solid var(--line)",
              background: "linear-gradient(180deg, var(--panel2), var(--panel))",
              boxShadow: "0 10px 26px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.05)",
              cursor: "pointer",
              color: "var(--text)",
              transition: "transform 140ms ease",
            }}
          >
            <IconDisc emoji={iconFor(c.name)} />
            {/* Name — the label, given room to breathe and center-balanced across 1–2 lines. */}
            <span
              style={{
                flex: 1,
                display: "grid",
                placeItems: "center",
                fontSize: 14.5,
                fontWeight: 800,
                lineHeight: 1.15,
                textAlign: "center",
              }}
            >
              {c.name}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: "var(--faint)",
              }}
            >
              {fmt(t.practice.questionCount, { count: c.count })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Fetches the servable categories and lets the player pick a scope, then hands the choice up. */
export function CategorySelect({
  onPick,
  onBack,
}: {
  onPick: (category: string | null) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [categories, setCategories] = useState<CategoryItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .categories()
      .then((r) => !cancelled && setCategories(r.categories))
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, t, t.practice.errCategories));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div style={wrap}>
      <div style={{ textAlign: "center" }}>
        <div style={eyebrow}>{t.practice.eyebrow}</div>
        <Display gold style={{ fontSize: 34 }}>
          {t.practice.pickCategory}
        </Display>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          {t.practice.pickSubtitle}
        </div>
      </div>

      {error ? (
        <GlassCard style={{ textAlign: "center", color: "var(--pink)", fontWeight: 700 }}>
          {error}
        </GlassCard>
      ) : categories === null ? (
        <GlassCard style={{ textAlign: "center", color: "var(--muted)" }}>{t.practice.loading}</GlassCard>
      ) : (
        <CategoryList categories={categories} onPick={onPick} />
      )}

      <GoldButton idlePulse={false} onClick={onBack} style={{ maxWidth: 240, margin: "0 auto" }}>
        {t.practice.backToHub}
      </GoldButton>
    </div>
  );
}
