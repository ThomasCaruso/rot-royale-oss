import { BottomNav } from "@/screens/home/BottomNav";
import { useOpenContest } from "@/screens/home/useOpenContest";

/**
 * The single reusable bottom nav for App-controlled screens (Vault, Leaderboard, the practice
 * category picker). It owns the Play affordance internally via useOpenContest() so each caller
 * just wires the destination handlers and declares which tab is `active`. Home and Campaign keep
 * their own BottomNav (they already fetch the open-window state) — this is for the flat screens that
 * don't.
 *
 * Centre Play is state-aware: the open Daily Royale while the attempt is available, else Quick Play
 * (the no-stakes 8-question mixed trivia run) via `onQuickPlay`.
 *
 * `active="none"` (the category picker) highlights nothing — every slot is a navigation button so the
 * player can leave the picker to any destination. The active screen omits its own handler so that
 * slot renders as the non-interactive highlighted item.
 */
export function AppNav({
  active,
  onHome,
  onCampaign,
  onLeaderboard,
  onVault,
  onPlayWindow,
  onQuickPlay,
}: {
  // App-controlled flat screens use "leaderboard" | "vault" | "none"; "home"/"campaign" are accepted
  // for completeness but those screens (Home, Campaign) render their own BottomNav directly.
  active: "home" | "campaign" | "leaderboard" | "vault" | "none";
  onHome?: () => void;
  onCampaign?: () => void;
  onLeaderboard?: () => void;
  onVault?: () => void;
  onPlayWindow?: (windowId: string) => void;
  onQuickPlay?: () => void;
}) {
  const { windowId, canPlay } = useOpenContest();
  const playRoyale = canPlay && windowId != null && onPlayWindow != null;
  return (
    <BottomNav
      active={active}
      onHome={onHome}
      onCampaign={onCampaign}
      onLeaderboard={onLeaderboard}
      onVault={onVault}
      onPlay={playRoyale ? () => onPlayWindow(windowId) : onQuickPlay}
      playTarget={playRoyale ? "royale" : "quick"}
    />
  );
}
