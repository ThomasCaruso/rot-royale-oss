/**
 * Ranked save gate — shown when a GUEST finishes a Daily Royale run. The score is real but only
 * becomes permanent (standings, rating, streak) if the profile is saved before settlement; this
 * frames that as locking in earned progress, never as a signup wall. "Later" always continues to
 * the normal post-run report — play is never blocked.
 */

import { useEffect } from "react";
import { useT } from "@/i18n/useT";
import { trackFunnel, trackFunnelOnce } from "@/lib/analytics";
import { SaveProfileScreen } from "./SaveProfileScreen";

export function RankedSaveGate({
  onDone,
  onLater,
}: {
  onDone: () => void; // profile saved — rank locks in at settlement
  onLater: () => void; // skipped — continue to the run report (score fades at settlement)
}) {
  const t = useT();
  useEffect(() => {
    trackFunnelOnce("ranked_save_gate_viewed");
  }, []);

  return (
    <SaveProfileScreen
      title={t.brainBoost.rankedGateTitle}
      subtitle={t.brainBoost.rankedGateSub}
      skipLabel={t.brainBoost.later}
      source="ranked_gate"
      onDone={() => {
        trackFunnel("ranked_save_completed");
        onDone();
      }}
      onSkip={onLater}
    />
  );
}
