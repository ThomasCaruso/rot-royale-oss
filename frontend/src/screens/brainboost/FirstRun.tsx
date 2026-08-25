/**
 * First-run front door for a brand-new visitor: the Daily Royale intro, with a log-in link for
 * returning players. Value first, account later — the CTA drops straight into today's ranked Daily
 * Royale as a guest (no signup wall); the save-your-account moment comes AFTER the run, at the
 * Daily Royale finish (RankedSaveGate). Nothing is ever lost — the guest is a real account behind
 * the scenes.
 */

import { useState } from "react";
import { EmailAuthForm } from "@/screens/EmailAuthForm";
import { BrainBoostIntro } from "./BrainBoostIntro";

export function FirstRun({
  onPlayDaily,
}: {
  // Launch today's Daily Royale for this visitor (App: guest session if needed → Contest).
  onPlayDaily: () => Promise<void>;
}) {
  // The only screen behind the front door. There is no provider-CHOICE step: the front door's own
  // row is the choice, so Apple and Google run their flow in place and Email is the one route that
  // needs a screen of its own. A separate "pick a provider" page in front of this form would ask
  // the player to choose something they already chose.
  const [emailLogin, setEmailLogin] = useState(false);

  if (emailLogin) {
    // Returning player path. On success the session flips to a non-guest account and the app shell
    // routes past first-run automatically; this back link covers a change of mind.
    return <EmailAuthForm onBack={() => setEmailLogin(false)} />;
  }

  return <BrainBoostIntro onStart={onPlayDaily} onEmailLogin={() => setEmailLogin(true)} />;
}
