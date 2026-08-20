import { useEffect, useState } from "react";
import { api } from "@/api/client";

/**
 * Shared "Battle affordance" for the bottom nav: is there an open ranked window, and can I play it?
 * Fetches the current contest; if a window is open, fetches my entry to see whether I've already
 * entered (one entry per window). DRYs the logic Home and Campaign both grew independently so every
 * screen that renders the nav lights up Battle identically.
 *
 *   windowId  the open window's id (null when nothing is open)
 *   canPlay   an open window exists AND I haven't entered it yet (so Battle is tappable)
 *
 * Uses the cancelled-flag unmount guard (mirrors Campaign.tsx / Home.tsx) so a late resolve after
 * navigation never sets state on an unmounted component.
 */
export function useOpenContest(): { windowId: string | null; canPlay: boolean } {
  const [windowId, setWindowId] = useState<string | null>(null);
  const [canPlay, setCanPlay] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .currentContest()
      .then(async (c) => {
        const open = c.open_window;
        if (!open) return;
        const mine = await api.myEntry(open.id).catch(() => null);
        if (cancelled) return;
        setWindowId(open.id);
        setCanPlay(!mine?.entry_id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return { windowId, canPlay };
}
