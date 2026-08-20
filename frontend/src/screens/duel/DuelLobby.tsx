import { useState } from "react";
import type { DuelConfigResponse, DuelStatsResponse, DuelTier } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { useSessionStore } from "@/store/session";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { ClassicArena } from "./ClassicArena";
import { MinimalArena } from "./MinimalArena";

/**
 * The Duel arena. Two skins share one set of stakes logic:
 *  - **ClassicArena** — the original rich, arcade face-off card. Shown ONLY on the Rot Royale
 *    (founder) theme, where the loud gradient/glow/gold belongs to the special skin.
 *  - **MinimalArena** — the quiet-luxury minimal arena. Shown on every OTHER theme, matching the
 *    app's newer calm direction (the player's own pfp vs a mystery rival, flat --cta CTA).
 *
 * All tier/stakes state + handlers are computed ONCE here and handed to whichever skin renders, so
 * routing/API/entry logic is identical regardless of theme. `initialStake` seeds the SSR tests.
 */
export function DuelLobby({
  config,
  stats = null,
  onSelectTier,
  onBack,
  initialStake,
}: {
  config: DuelConfigResponse;
  /** Lifetime duel stats for the stakes framing — optional (the card degrades gracefully). */
  stats?: DuelStatsResponse | null;
  onSelectTier: (type: string) => void;
  onBack: () => void;
  initialStake?: string;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const username = useSessionStore((s) => s.me?.username);
  const avatarPreset = useSessionStore((s) => s.me?.avatar_preset);
  const equippedFrame = useSessionStore((s) => s.me?.equipped_frame);
  const equippedTheme = useSessionStore((s) => s.me?.equipped_theme);
  // Rot Royale (the founder theme) keeps the full original arcade arena; every other theme gets the
  // new minimal skin.
  const isRotChampion = equippedTheme === "royale";
  const [showRules, setShowRules] = useState(false);

  const tiers = [...config.tiers].sort((a, b) => a.entry_gems - b.entry_gems);
  const [selType, setSelType] = useState<string>(
    () => initialStake ?? (tiers.find((x) => x.entry_gems === 0) ?? tiers[0])?.type,
  );
  const sel = tiers.find((x) => x.type === selType);
  const openEntry = (sel?.entry_gems ?? 0) === 0;
  const unaffordable = sel != null && !openEntry && config.gems_balance < sel.entry_gems;
  const startable = sel != null && sel.unlocked && !unaffordable;

  // Escalation heat (0..1) from the selected entry's position — the classic skin warms with it.
  const heat = sel && tiers.length > 1 ? Math.max(0, tiers.indexOf(sel)) / (tiers.length - 1) : 0;

  // Lifetime record (ranked + open duels together) + the streak that's at risk today.
  const recordW = (stats?.wins ?? 0) + (stats?.training_wins ?? 0);
  const recordL = (stats?.losses ?? 0) + (stats?.training_losses ?? 0);
  const record = stats && recordW + recordL > 0 ? fmt(t.duel.recordLine, { w: recordW, l: recordL }) : undefined;
  const streak = stats?.current_streak ?? 0;

  const ctaLabel =
    sel == null || openEntry
      ? t.duel.start
      : sel.entry_gems === 1
        ? t.duel.duelForGemsOne
        : fmt(t.duel.duelForGems, { n: sel.entry_gems });

  const view: ArenaViewProps = {
    config,
    t,
    reduced,
    tiers,
    selType,
    setSelType,
    sel,
    openEntry,
    unaffordable,
    startable,
    heat,
    record,
    streak,
    username,
    avatarPreset,
    equippedFrame,
    ctaLabel,
    onSelectTier,
    onBack,
    showRules,
    setShowRules,
  };

  return isRotChampion ? <ClassicArena {...view} /> : <MinimalArena {...view} />;
}

/** Everything a duel-arena skin needs — computed once in DuelLobby, identical for both skins. */
export interface ArenaViewProps {
  config: DuelConfigResponse;
  t: ReturnType<typeof useT>;
  reduced: boolean;
  tiers: DuelTier[];
  selType: string;
  setSelType: React.Dispatch<React.SetStateAction<string>>;
  sel: DuelTier | undefined;
  openEntry: boolean;
  unaffordable: boolean;
  startable: boolean;
  heat: number;
  record: string | undefined;
  streak: number;
  username: string | undefined;
  avatarPreset: string | undefined;
  equippedFrame: string | null | undefined;
  ctaLabel: string;
  onSelectTier: (type: string) => void;
  onBack: () => void;
  showRules: boolean;
  setShowRules: React.Dispatch<React.SetStateAction<boolean>>;
}
