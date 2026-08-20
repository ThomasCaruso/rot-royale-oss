import { useEffect, useState } from "react";
import { api } from "@/api/client";

/**
 * This window's post-run meta from the current contest: when daily placement finalizes (settle_at →
 * close_at fallback → null) and the honest real attempt count today (entry_count → null). One fetch,
 * shared by the instant Rot Report (live + re-opened) and the legacy ScoreBanked screen.
 */
export function useWindowMeta(windowId: string): { resultsAt: string | null; attempts: number | null } {
  const [meta, setMeta] = useState<{ resultsAt: string | null; attempts: number | null }>({
    resultsAt: null,
    attempts: null,
  });
  useEffect(() => {
    let cancelled = false;
    api
      .currentContest()
      .then((c) => {
        if (cancelled) return;
        const w =
          c.schedule.find((win) => win.id === windowId) ??
          (c.open_window?.id === windowId ? c.open_window : null);
        setMeta({
          resultsAt: w?.settle_at ?? w?.close_at ?? null,
          attempts: w?.entry_count ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [windowId]);
  return meta;
}
