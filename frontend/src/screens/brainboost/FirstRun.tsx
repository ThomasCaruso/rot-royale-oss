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
  const [showLogin, setShowLogin] = useState(false);

  if (showLogin) {
    // Returning player path. On success the session flips to a non-guest account and the app shell
    // routes past first-run automatically; this back link covers a change of mind.
    return <AuthScreen onBack={() => setShowLogin(false)} />;
  }

  return <BrainBoostIntro onStart={onPlayDaily} onLogin={() => setShowLogin(true)} />;
}
