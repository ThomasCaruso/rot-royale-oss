import { api, ApiError } from "@/api/client";
import { listOutbox, removeFromOutbox, bumpAttempts } from "./db";
import { refreshOutboxCount } from "./outbox";
import type { OutboxRecord, OfflineItem } from "./types";

export interface SyncDeps {
  campaign: (b: { world: string; level: number; client_id: string; items: OfflineItem[] }) => Promise<unknown>;
  practice: (b: { mode: string | null; category: string | null; client_id: string; items: OfflineItem[] }) => Promise<unknown>;
  onReconciled: (rec: OutboxRecord, result: unknown) => void;
}

const defaultDeps: Pick<SyncDeps, "campaign" | "practice"> = {
  campaign: (b) => api.campaignOfflineComplete(b),
  practice: (b) => api.practiceOfflineSubmit(b),
};

let draining = false;

/** Drain the outbox strictly FIFO. Network / 5xx error → keep + bump attempts (stop). 4xx → drop (never succeeds). */
export async function drainOutbox(deps: Partial<SyncDeps> = {}): Promise<void> {
  if (draining) return;
  draining = true;
  const { campaign, practice, onReconciled } = { ...defaultDeps, onReconciled: () => {}, ...deps } as SyncDeps;
  try {
    for (const rec of await listOutbox()) {
      try {
        const result =
          rec.kind === "campaign"
            ? await campaign({ world: rec.payload.world, level: rec.payload.level, client_id: rec.client_id, items: rec.payload.items })
            : await practice({ mode: rec.payload.mode, category: rec.payload.category, client_id: rec.client_id, items: rec.payload.items });
        await removeFromOutbox(rec.client_id);
        onReconciled(rec, result);
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          await removeFromOutbox(rec.client_id); // permanent validation rejection
        } else {
          await bumpAttempts(rec.client_id); // transient (offline / 5xx) — retry later
          break; // stop draining; preserve FIFO for dependent campaign levels
        }
      }
    }
  } finally {
    await refreshOutboxCount();
    draining = false;
  }
}
