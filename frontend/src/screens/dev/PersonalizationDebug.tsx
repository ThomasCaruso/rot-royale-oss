/**
 * Dev-only taste-profile inspector. Renders NOTHING unless VITE_PERSONALIZATION_DEBUG=true is
 * baked into the build (set it in a gitignored frontend/.env.local — never in production builds).
 * The backend applies its own gate too: /personalization/me/profile 404s in production unless
 * PERSONALIZATION_DEBUG is set server-side, so this can't leak by accident.
 */

import { useEffect, useState } from "react";
import { api, type TasteProfile } from "@/api/client";
import { isPersonalizationDebugEnabled } from "@/lib/personalizationFlags";

function topEntries(map: Record<string, number>, n = 5): [string, number][] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export function PersonalizationDebug() {
  const enabled = isPersonalizationDebugEnabled();
  const [profile, setProfile] = useState<TasteProfile | null>(null);

  useEffect(() => {
    if (!enabled) return;
    api
      .getTasteProfile()
      .then(setProfile)
      .catch(() => {
        // debug-only surface; a 404 (prod gate) or network error just renders nothing
      });
  }, [enabled]);

  if (!enabled || !profile) return null;

  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8 };
  const label: React.CSSProperties = { color: "var(--muted)" };

  return (
    <div
      data-testid="personalization-debug"
      style={{
        marginTop: 8,
        padding: "12px 14px",
        borderRadius: 14,
        border: "1px dashed var(--line)",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        textAlign: "left",
      }}
    >
      <div style={{ fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase" }}>
        🧪 Taste profile (dev)
      </div>
      <div style={row}>
        <span style={label}>interactions / confidence</span>
        <span>
          {profile.interaction_count} · {(profile.confidence_score * 100).toFixed(0)}%
        </span>
      </div>
      <div style={row}>
        <span style={label}>difficulty pref</span>
        <span>{profile.difficulty_preference.toFixed(2)}</span>
      </div>
      <div style={row}>
        <span style={label}>top categories</span>
        <span>
          {topEntries(profile.category_affinity)
            .map(([k, v]) => `${k} ${v.toFixed(2)}`)
            .join(", ") || "—"}
        </span>
      </div>
      <div style={row}>
        <span style={label}>top topics</span>
        <span>
          {topEntries(profile.topic_affinity)
            .map(([k, v]) => `${k} ${v.toFixed(2)}`)
            .join(", ") || "—"}
        </span>
      </div>
      <div style={row}>
        <span style={label}>weak-but-interesting</span>
        <span>{profile.weak_but_interesting_topics.join(", ") || "—"}</span>
      </div>
      <div style={row}>
        <span style={label}>disliked</span>
        <span>{profile.disliked_topics.join(", ") || "—"}</span>
      </div>
    </div>
  );
}
