import { useEffect, useState } from "react";
import { api, type ChallengeCreateResponse } from "@/api/client";
import type { RotReportData } from "@/lib/rotReport";
import { useWindowMeta } from "@/lib/useWindowMeta";
import { RotReport } from "@/screens/results/RotReport";

/**
 * Re-open of the INSTANT {@link RotReport} from Home, after the Contest screen (which holds the only
 * per-round log) is gone. The report itself is replayed from the client-side stash; this wrapper only
 * re-hydrates the live bits: the window's results-time/attempt count and a freshly re-minted share
 * link (`createChallenge` is idempotent per entry, so the SAME `…/c/<id>` link comes back — and it
 * picks up a corrected share host once the backend env is set). Best-effort: on a challenge-create
 * hiccup RotReport falls back to the neutral app link, so re-sharing is never blocked.
 */
export function RotReportReplay({
  report,
  entryId,
  windowId,
  onClose,
  onPractice,
}: {
  report: RotReportData;
  entryId: string;
  windowId: string;
  onClose: () => void;
  onPractice: () => void;
}) {
  const { resultsAt, attempts } = useWindowMeta(windowId);
  const [challenge, setChallenge] = useState<ChallengeCreateResponse | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .createChallenge(entryId)
      .then((c) => alive && setChallenge(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [entryId]);

  return (
    <RotReport
      report={report}
      resultsAt={resultsAt}
      attempts={attempts}
      windowId={windowId}
      challengeUrl={challenge?.url}
      challengeScore={challenge?.score}
      challengeNo={challenge?.contest_no}
      onExit={onClose}
      onPractice={onPractice}
    />
  );
}
