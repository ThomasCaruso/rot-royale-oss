import type React from "react";
import type { MasteryItem } from "@/api/client";
import { growthCardStyle, SERIF } from "./styles";

const LEVELS = 5;

export function MasteryCard({
  items,
  leveledUp,
  labels,
}: {
  items: MasteryItem[];
  leveledUp: Set<string>;
  labels: { title: string; mastered: string; growing: string; newTag: string; up: string; lv: string };
}) {
  return (
    <section style={growthCardStyle}>
      <div style={sect}>{labels.title}</div>
      <div>
        {items.map((m, i) => {
          const just = leveledUp.has(m.category);
          const pct = Math.round((Math.max(0, m.level) / LEVELS) * 100);
          const tag = m.mastered
            ? labels.mastered
            : just
              ? labels.up
              : m.level === 0
                ? labels.newTag
                : m.level <= 1
                  ? labels.growing
                  : "";
          return (
            <div key={m.category} style={{ ...row, borderTop: i === 0 ? "none" : row.borderTop }}>
              <span style={name}>
                {m.category}
                {just && <span style={upMark}> ↑</span>}
              </span>
              <span style={track}>
                <span style={{ ...fill, width: `${pct}%`, background: m.mastered ? "var(--amber)" : "var(--brand)" }} />
              </span>
              <span style={lvl}>
                <span style={lvNum}>{m.level === 0 ? labels.newTag : `${labels.lv} ${m.level}`}</span>
                {tag && <span style={{ ...lvTag, color: m.mastered || just ? "var(--amber)" : "var(--muted)" }}>{tag}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const sect: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderTop: "1px solid var(--line)" };
const name: React.CSSProperties = { flex: "none", width: 104, fontWeight: 600, fontSize: 14, color: "var(--text)" };
const upMark: React.CSSProperties = { color: "var(--amber)", fontWeight: 800 };
const track: React.CSSProperties = { flex: 1, height: 6, borderRadius: 999, background: "var(--faint)", overflow: "hidden" };
const fill: React.CSSProperties = { display: "block", height: "100%", borderRadius: 999 };
const lvl: React.CSSProperties = { flex: "none", width: 74, textAlign: "right" };
const lvNum: React.CSSProperties = { display: "block", fontFamily: SERIF, fontWeight: 700, fontSize: 14 };
const lvTag: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 700, marginTop: 1 };
