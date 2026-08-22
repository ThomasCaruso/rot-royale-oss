import type React from "react";

/**
 * A round module plays one round and calls onComplete with the result to submit.
 * The contest engine looks modules up by `type` and renders/plays them (docs/architecture.md).
 * The client never receives answers — only `spec` (client_spec); scoring is server-authoritative.
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
    // Host-supplied banner shown while the second chance is open. Modules carry no copy of their
    // own (they have no i18n), so the screen passes the localized beat in; modules that don't
    // support a second chance ignore it.
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
