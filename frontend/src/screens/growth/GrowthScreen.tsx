import { useEffect, useState } from "react";
import { api, type GrowthResponse, type BrainBoostToday } from "@/api/client";
import { useT } from "@/i18n/useT";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { GrowthView } from "./GrowthView";

/**
 * "Your Growth" — a thin data shell around {@link GrowthView} (the pure composition). It fetches the
 * real Brain Score trend + the latest Brain Profile read and hands them down; the view owns the whole
 * single-screen composition. Insight + subject profile are best-effort — the hero still renders from
 * the trend if the read fails to load. Honest empty states throughout.
 */
export function GrowthScreen({ onBack, onTrainCategory }: { onBack: () => void; onTrainCategory?: (category: string) => void }) {
  const t = useT();
  const g = t.growth;
  const reduced = useReducedMotion();
  const [data, setData] = useState<GrowthResponse | null>(null);
  const [error, setError] = useState(false);
  const [rotToday, setRotToday] = useState<BrainBoostToday | null>(null);

  useEffect(() => {
    let alive = true;
    api.getGrowth(90).then((d) => alive && setData(d)).catch(() => alive && setError(true));
    api.brainBoostToday().then((r) => alive && setRotToday(r)).catch(() => {
      /* insight + profile are best-effort; the hero still renders from the trend */
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <GrowthView
      data={data}
      summary={rotToday?.latest ?? null}
      error={error}
      reduced={reduced}
      onBack={onBack}
      onTrainCategory={onTrainCategory}
      labels={{
        title: g.title,
        subtitle: g.subtitle,
        brainScore: g.brainScore,
        thisWeek: g.thisWeek,
        today: g.today,
        daysAgo: g.daysAgo,
        keepPlaying: g.keepPlaying,
        aiInsight: g.aiInsight,
        becomingStrength: g.becomingStrength,
        strongestNow: g.strongestNow,
        biggestGap: g.biggestGap,
        wellRounded: g.wellRounded,
        focusGap: g.focusGap,
        insightEmpty: g.insightEmpty,
        knowledgeProfile: g.knowledgeProfile,
        emptyProfile: g.emptyProfile,
        dayStreak: g.dayStreak,
        keepStreak: g.keepStreak,
        error: g.error,
        back: t.common.back,
      }}
    />
  );
}
