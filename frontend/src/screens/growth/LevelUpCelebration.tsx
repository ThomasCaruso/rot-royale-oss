import { useEffect, useState } from "react";
import { api, type MasteryResponse } from "@/api/client";
import { useT } from "@/i18n/useT";
import { markMasterySeen, pendingLevelUps } from "@/lib/masterySeen";
import { LevelUpToast } from "./LevelUpToast";

/**
 * Single owner of the category level-up celebration. Rendered once in the authenticated App shell so
 * the reward lands right after a player finishes a session (not only when they open "Your Growth").
 *
 * `trigger` is bumped by the shell whenever Home becomes the active view (post-play landing); every
 * bump — plus the initial mount — re-checks `GET /me/mastery` against the stored baseline. Detection
 * (pendingLevelUps, read-only) and consumption (markMasterySeen, write) stay split so a re-render /
 * StrictMode double-invoke can't eat a level-up before it's shown. Best-effort: a failed fetch
 * renders nothing and never throws.
 */
export function LevelUpCelebration({ userId, trigger }: { userId: string; trigger: number }) {
  const t = useT();
  const [mastery, setMastery] = useState<MasteryResponse | null>(null);
  const [leveledUp, setLeveledUp] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    api
      .getMastery()
      .then((r) => {
        if (!alive) return;
        setMastery(r);
        const leveled = pendingLevelUps(userId, r.categories);
        setLeveledUp(leveled);
        // Nothing to celebrate → advance the baseline now; otherwise wait until the toast is
        // dismissed so re-renders / StrictMode can't consume the level-up before it's shown.
        if (leveled.size === 0) markMasterySeen(userId, r.categories);
      })
      .catch(() => {
        /* offline / error — no celebration this pass, harmless */
      });
    return () => {
      alive = false;
    };
  }, [userId, trigger]);

  if (!mastery || leveledUp.size === 0) return null;

  return (
    <LevelUpToast
      items={mastery.categories.filter((m) => leveledUp.has(m.category))}
      line={t.growth.levelUpToast}
      onDone={() => {
        markMasterySeen(userId, mastery.categories);
        setLeveledUp(new Set());
      }}
    />
  );
}
