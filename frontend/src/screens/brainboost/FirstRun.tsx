/**
 * First-run front door for a brand-new visitor: the Daily Royale intro, with a log-in link for
 * returning players. Value first, account later — the CTA drops straight into today's ranked Daily
 * Royale as a guest (no signup wall); the save-your-account moment comes AFTER the run, at the
 * Daily Royale finish (RankedSaveGate). Nothing is ever lost — the guest is a real account behind
 * the scenes.
 */

import { useState } from "react";
import { AuthScreen } from "@/screens/AuthScreen";
import { BrainBoostIntro } from "./BrainBoostIntro";

export function FirstRun({
  onPlayDaily,
}: {
  // Launch today's Daily Royale for this visitor (App: guest session if needed → Contest).
  onPlayDaily: () => Promise<void>;
}) {
  // `null` = not signing in. Otherwise it is the step the sign-in screen should open on: the front
  // door's compact Apple/Google tiles run their flow in place, but its Email tile routes here, and
  // a returning player who has already picked their provider should not be asked to pick again.
  const [loginStep, setLoginStep] = useState<"choose" | "email" | null>(null);

  if (loginStep) {
    // Returning player path. On success the session flips to a non-guest account and the app shell
    // routes past first-run automatically; this back link covers a change of mind.
    return <AuthScreen initialStep={loginStep} onBack={() => setLoginStep(null)} />;
  }

  return <BrainBoostIntro onStart={onPlayDaily} onEmailLogin={() => setLoginStep("email")} />;
}
