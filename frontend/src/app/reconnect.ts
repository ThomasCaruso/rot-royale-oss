import { drainOutbox } from "@/offline/sync";
import { refreshOfflineContent } from "@/offline/content";
import { refreshMe } from "@/api/session";

/**
 * What to do when the app comes back online (or is foregrounded while online): drain the outbox of
 * queued offline results, and refresh the profile after each one reconciles. Extracted from App's
 * bootstrap effect so it's a single, unit-testable seam (see reconnect.test.ts / offlineSync.test.ts).
 *
 * `deps` is injected only in tests; production uses the real modules.
 */
export interface ReconnectDeps {
  drainOutbox: typeof drainOutbox;
  refreshOfflineContent: typeof refreshOfflineContent;
  refreshMe: typeof refreshMe;
}

const defaultDeps: ReconnectDeps = { drainOutbox, refreshOfflineContent, refreshMe };

/** Full reconnect: drain queued results (refreshing /me as each reconciles) + re-pull offline content. */
export function onReconnect(deps: ReconnectDeps = defaultDeps): void {
  void deps.drainOutbox({
    onReconciled: () => {
      void deps.refreshMe();
    },
  });
  void deps.refreshOfflineContent();
}

/** Foreground drain: no content re-pull, just flush anything the outbox is still holding. */
export function onForegroundDrain(deps: Pick<ReconnectDeps, "drainOutbox" | "refreshMe"> = defaultDeps): void {
  void deps.drainOutbox({
    onReconciled: () => {
      void deps.refreshMe();
    },
  });
}
