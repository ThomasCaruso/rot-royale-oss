/**
 * Fire-and-forget gameplay interaction tracking (silent personalization).
 *
 * Contract: `trackInteraction` can NEVER throw or reject into gameplay code — a failed or slow
 * event write must not block, break, or delay play. It returns void on purpose; nothing should
 * await it. This is ordinary gameplay analytics used only to tune the caller's own question mix
 * (server-side taste profile) — no third parties, nothing user-visible.
 */

import { api, type QuestionInteractionPayload } from "@/api/client";

export function trackInteraction(payload: QuestionInteractionPayload): void {
  try {
    void api.recordQuestionInteraction(payload).catch(() => {
      // Swallowed by design: personalization signals are best-effort.
    });
  } catch {
    // Even a synchronous throw (e.g. serialization) must never reach gameplay.
  }
}
