/**
 * First-run state for the Brain Boost onboarding (Capacitor Preferences — device-local).
 *
 * The flow never blocks play behind an account: a brand-new (anonymous) visitor sees the Rot
 * Check intro; a guest who hasn't finished their Starter Check resumes it; everyone else gets the
 * normal app. `starterDone` is device-local by design — a logged-in account on a new device is
 * `is_guest=false`, so it bypasses first-run regardless of this flag.
 */

import { Preferences } from "@capacitor/preferences";
import type { SessionStatus } from "@/store/session";

const STARTER_DONE_KEY = "rr.starter_check_done";

export async function loadStarterDone(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: STARTER_DONE_KEY });
    return value === "1";
  } catch {
    return false;
  }
}

export async function markStarterDone(): Promise<void> {
  try {
    await Preferences.set({ key: STARTER_DONE_KEY, value: "1" });
  } catch {
    // device storage hiccup — worst case the intro shows once more
  }
}

export type FirstRunStep = "intro" | "check" | "none";

/** Where the app shell should route (pure — unit-tested).
 * - anonymous visitor → the Brain Boost intro (never a login wall)
 * - authenticated guest who hasn't completed the Starter Check → resume the check flow
 * - everyone else (registered users, guests past first-run) → the normal app
 */
export function resolveFirstRunStep(
  status: SessionStatus,
  isGuest: boolean,
  starterDone: boolean,
): FirstRunStep {
  if (status === "anonymous") return "intro";
  if (status === "authenticated" && isGuest && !starterDone) return "check";
  return "none";
}
