import type React from "react";

/**
 * A round module plays one round and calls onComplete with the result to submit.
 * The contest engine looks modules up by `type` and renders/plays them (docs/architecture.md).
 * The client never receives answers — only `spec` (client_spec); scoring is server-authoritative.
 *
 * MODULES OWN THEIR OWN COPY, via `useT()` and the `rounds` dictionary section.
 *
 * This used to say the opposite — "modules carry no i18n" — and that convention was itself the bug.
 * It made an English literal the path of least resistance, so "Spot the change", "Estimate",
 * "Watch closely", "First image", "Your turn" and a dozen more shipped hardcoded and were rendered
 * verbatim to Spanish, French and Turkish players on every round they played.
 *
 * The alternative — passing every string in as a prop — was rejected because it spreads the same
 * failure across four host screens (contest, practice, campaign, duels): the moment one of them
 * forgets, that host silently renders English again, with nothing to catch it. Modules already
 * import the API client and the haptics singleton, so a store-backed `useT()` is strictly less
 * coupling than what they had.
 *
 * The dividing line: copy the module says about ITSELF lives in the module. Copy the HOST says
 * about the run (the §5f second-chance banner, the round eyebrow) still arrives as a prop.
 */
export interface RoundModule<Spec = unknown, Result = unknown> {
  type: string;
  Component: React.FC<{
    spec: Spec;
    onComplete: (result: Result) => void;
    // Optional host-supplied chrome the module renders inside its own question card: `eyebrow` above
    // the prompt (e.g. "Round 1 of 4"), `footer` below the answers (e.g. the "locked in" note). The
    // module owns the card so the countdown ring can sit in a header bar ABOVE it, unclipped.
    eyebrow?: React.ReactNode;
    footer?: React.ReactNode;
    // §5f Daily Royale second-chance (trivia only): when a wrong first pick is reported, `eliminated`
    // is the option to grey out (unclickable) and `retryMs` the retry window for one more pick. Every
    // other module ignores these, so the props are optional across the shared contract.
    eliminated?: number | null;
    retryMs?: number;
    // Host-supplied banner shown while the second chance is open; modules that don't support a
    // second chance ignore it. This is the SCREEN's message about the run, not the module's own
    // words — which is the line that decides what arrives as a prop and what doesn't (see below).
    notice?: React.ReactNode;
  }>;
  /**
   * OPTIONAL post-answer reveal — the round's payoff, owned by the module that knows what the
   * answer means.
   *
   * The generic reveal can only render a trivia option list; every other round type fell through to
   * one line of grey text ("counted" / "no points"). That threw away the most interesting moment:
   * a change round never showed WHERE the change was, and a Fermi estimate never said what the
   * answer actually was — which is the entire reason to ask the question.
   *
   * `answer` is the server_answer, released only AFTER the round is finalized (Invariant 1), so
   * rendering it here is safe by construction. `result` is whatever the module itself reported at
   * completion — the module's own memory of what the player did.
   */
  Reveal?: React.FC<{
    spec: Spec;
    answer: Record<string, unknown>;
    result: Record<string, unknown>;
    correct: boolean;
  }>;
  /** "dom" for React-rendered rounds, "phaser" for canvas mini-games */
  surface: "dom" | "phaser";
}
