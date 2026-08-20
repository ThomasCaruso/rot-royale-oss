/**
 * Lightweight internal funnel analytics (docs/analytics-funnel.md).
 *
 * Contract: `trackFunnel` can NEVER throw or reject into gameplay/UI code — a lost beacon is
 * fine; a blocked tap is not. Events are allowlisted here AND server-side so the funnel stays
 * queryable. In dev builds each event also logs to console.debug for eyeballing the flow.
 * `trackFunnelOnce` dedupes per page-load — for mount-time events (StrictMode double-mounts,
 * re-renders) like intro_viewed / profile_reveal_viewed / ranked_save_gate_viewed.
 */

import { api } from "@/api/client";

export type FunnelEvent =
  | "intro_viewed"
  | "start_check_clicked"
  | "guest_created"
  | "starter_check_completed"
  | "profile_reveal_viewed"
  | "save_profile_clicked"
  | "upgrade_completed"
  | "keep_playing_clicked"
  | "ranked_save_gate_viewed"
  | "ranked_save_completed"
  // Acquisition funnel for the public /download page (the canonical external link). These fire
  // for anonymous visitors — the beacon's auth is optional — and carry no account, no device id
  // and no user agent; the only context is the coarse in-app-browser bucket in `source`.
  | "download_page_view"
  | "download_cta_tap"
  | "download_meta_escape_attempt"
  | "download_meta_escape_signal"
  | "download_fallback_shown"
  | "download_retry_tap"
  | "download_link_copied"
  | "download_play_now_tap";

export type FunnelSource =
  | "reveal"
  | "home_banner"
  | "ranked_gate"
  | "intro"
  // /download only: which Meta in-app browser was positively detected (a fixed four-value bucket,
  // never the raw user agent).
  | "instagram"
  | "threads"
  | "facebook"
  | "messenger";

const sentThisLoad = new Set<string>();

export function trackFunnel(event: FunnelEvent, source?: FunnelSource): void {
  try {
    if (import.meta.env.DEV) {
      console.debug(`[funnel] ${event}${source ? ` (${source})` : ""}`);
    }
    void api.sendFunnelBeacon({ event, source: source ?? null }).catch(() => {
      // Swallowed by design: analytics is best-effort, gameplay never waits on it.
    });
  } catch {
    // Even a synchronous throw must never reach the caller.
  }
}

export function trackFunnelOnce(event: FunnelEvent, source?: FunnelSource): void {
  const key = `${event}:${source ?? ""}`;
  if (sentThisLoad.has(key)) return;
  sentThisLoad.add(key);
  trackFunnel(event, source);
}
