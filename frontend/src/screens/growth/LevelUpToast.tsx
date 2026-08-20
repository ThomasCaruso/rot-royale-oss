import type React from "react";
import { useEffect } from "react";
import type { MasteryItem } from "@/api/client";
import { fmt } from "@/i18n/useT";

export function LevelUpToast({
  items,
  line,
  onDone,
}: {
  items: MasteryItem[];
  line: string; // template e.g. "{category} → Level {level}"
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 4200);
    return () => clearTimeout(t);
  }, [onDone]);
  if (items.length === 0) return null;
  return (
    <button type="button" onClick={onDone} style={wrap} aria-live="polite">
      <div style={card}>
        {items.map((m) => (
          <div key={m.category} style={lineStyle}>
            <span style={arrow}>↑</span>
            {fmt(line, { category: m.category, level: m.level })}
          </div>
        ))}
      </div>
    </button>
  );
}

const wrap: React.CSSProperties = { position: "fixed", left: 0, right: 0, bottom: 90, display: "flex", justifyContent: "center", zIndex: 90, border: "none", background: "transparent", cursor: "pointer", padding: 0 };
const card: React.CSSProperties = { maxWidth: 360, width: "calc(100% - 40px)", padding: "12px 16px", borderRadius: 14, background: "var(--panel)", border: "1px solid color-mix(in srgb, var(--amber) 45%, var(--line))", boxShadow: "0 14px 34px rgba(0,0,0,.18)", textAlign: "left" };
const lineStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: "var(--text)" };
const arrow: React.CSSProperties = { color: "var(--amber)", fontWeight: 800 };
