/**
 * GrowthStreakRow — tertiary consistency signal, in its own neat rr-glass card so it belongs to the
 * same surface family as the hero + knowledge cards (never a bare row floating on the page). A small
 * amber flame tile, the current streak as the main line, one muted support line. No seven-day
 * calendar, no chevron (there is no streak detail route). The growth API has no "best streak", so this
 * never fabricates one; a mastered streak count reads in amber as a quiet achievement accent.
 */

import { FlameIcon } from "@/ui/icons";
import { fmt } from "@/i18n/useT";

export function GrowthStreakRow({
  streak,
  labels,
}: {
  streak: number;
  labels: { dayStreak: string; keepStreak: string };
}) {
  const has = streak >= 1;
  return (
    <section className="rr-glass" style={{ borderRadius: 18, padding: "13px 16px", display: "flex", alignItems: "center", gap: 13 }}>
      <span
        aria-hidden
        style={{
          flex: "none",
          width: 34,
          height: 34,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          color: "var(--amber)",
          background: "color-mix(in srgb, var(--amber) 14%, transparent)",
          border: "1px solid color-mix(in srgb, var(--amber) 24%, transparent)",
        }}
      >
        <FlameIcon size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", lineHeight: 1.15 }}>
          {has ? fmt(labels.dayStreak, { n: streak }) : labels.keepStreak}
        </div>
        {has && <div style={{ color: "var(--muted)", fontSize: 12.5, fontWeight: 500, marginTop: 1 }}>{labels.keepStreak}</div>}
      </div>
    </section>
  );
}
