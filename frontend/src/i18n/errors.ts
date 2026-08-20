/**
 * Server error codes → player-facing text in the player's language.
 *
 * The server sends a stable snake_case CODE as `detail` (see `backend/app/core/errors.py`), never
 * prose. This maps it through the active dictionary.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: **never render a raw server string to a player.** Before
 * this, screens did `err instanceof ApiError ? err.message : t.something`, which put the server's
 * English straight on screen whenever the API supplied a detail — so a Spanish player hit
 * "Already entered this window" mid-game. The `: t.something` fallback only ran when the API said
 * nothing at all, which is the rarer case.
 *
 * Degrading safely matters as much as the mapping. An unrecognised code — an endpoint not yet
 * migrated, an older client against a newer server — resolves to the caller's generic fallback,
 * which is itself translated. The worst case is a vague message in the right language, never a
 * precise one in the wrong language.
 */

import type { Dict } from "@/i18n";

/** Codes the UI has specific copy for. Anything absent falls back to the caller's message. */
export type ErrorCode = keyof Dict["errors"];

/**
 * Localized text for an API failure.
 *
 * @param err       the thrown value (any type — callers catch `unknown`)
 * @param t         the active dictionary
 * @param fallback  screen-appropriate message for unknown codes, already localized
 */
export function errorMessage(err: unknown, t: Dict, fallback: string): string {
  const code = apiErrorCode(err);
  if (!code) return fallback;
  const table = t.errors as Record<string, string | undefined>;
  return table[code] ?? fallback;
}

/**
 * The error code from a thrown API error, or null.
 *
 * Codes are `[a-z0-9_]+` by construction. That shape test is what lets a partially migrated API
 * stay safe: an endpoint still sending English prose ("Window is not open") fails the test, returns
 * null, and the caller's translated fallback is used instead of the prose being displayed.
 */
export function apiErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  return /^[a-z0-9_]+$/.test(message) ? message : null;
}
