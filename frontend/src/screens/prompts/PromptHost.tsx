import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { useT } from "@/i18n/useT";
import { useSessionStore } from "@/store/session";
import { enablePush } from "@/lib/push";
import { openStoreReview } from "@/lib/review";
import { PromptSheet } from "./PromptSheet";
import { ChangeUsernameSheet } from "@/screens/home/ChangeUsernameSheet";

/**
 * Asks the SERVER what to ask the player, then asks it.
 *
 * The client holds no timing rules on purpose. "After the first run" and "after the third run" live
 * in services/prompts.py, so they can be retuned on a deploy — the shipped binary can't be changed,
 * and §5f is the standing reminder of what that costs.
 *
 * Checked when the player LANDS BACK on the home screen, which is the moment a run has just ended:
 * they've finished something and are feeling good about it, which is the only honest time to ask
 * for a permission or a review.
 */
const PROMPT_GOODWILL = "goodwill_aug14";
const PROMPT_NOTIFICATIONS = "enable_notifications";
const PROMPT_RATE = "rate_app";
const PROMPT_PICK_USERNAME = "pick_username";

/** The public support page (publicRoutes.ts) — where an unhappy player is heard instead of
 *  being pushed at the App Store. */
const SUPPORT_URL = "/support";

export function PromptHost({ active }: { active: boolean }) {
  const t = useT();
  const username = useSessionStore((st) => st.me?.username);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rateStep, setRateStep] = useState<"ask" | "feedback">("ask");
  const wasActive = useRef(false);

  useEffect(() => {
    // Only on the transition INTO the home screen — polling while sitting there would re-raise a
    // prompt the player just dismissed on another tab.
    const entering = active && !wasActive.current;
    wasActive.current = active;
    if (!entering) return;
    let cancelled = false;
    // try/catch AND .catch: a synchronous throw here (an older client shape, a stubbed api) would
    // escape a promise handler entirely and take the home screen down with it. A prompt is a
    // nicety; it must never be able to break the screen it appears on.
    try {
      void api
        .nextPrompt()
        .then((r) => {
          if (!cancelled) setPrompt(r?.prompt ?? null);
        })
        .catch(() => null);
    } catch {
      /* nothing to show — carry on */
    }
    return () => {
      cancelled = true;
    };
  }, [active]);

  const close = useCallback(
    async (accepted: boolean) => {
      const id = prompt;
      if (!id) return;
      // Dismiss FIRST. The ack is bookkeeping; making the player watch a spinner to close a box
      // they didn't ask for is the opposite of the point.
      setPrompt(null);
      setBusy(false);
      setRateStep("ask");
      try {
        await api.ackPrompt(id, accepted);
      } catch {
        /* it'll simply be offered again next time — harmless */
      }
    },
    [prompt],
  );

  if (!active || !prompt) return null;

  if (prompt === PROMPT_PICK_USERNAME) {
    // Reuses the sheet from the profile menu rather than a lookalike: the handle rules, the price
    // line and every error string already live there, in four languages. A second copy would drift.
    //
    // Cancelling ACKS. Declining is an answer, and re-asking every session for a name they chose
    // not to change is how a prompt becomes nagging (docs/architecture.md §7b2).
    return (
      <ChangeUsernameSheet
        currentUsername={username ?? ""}
        title={t.changeName.pickTitle}
        sub={t.changeName.pickSub}
        onChanged={() => void close(true)}
        onClose={() => void close(false)}
      />
    );
  }

  if (prompt === PROMPT_GOODWILL) {
    return (
      <PromptSheet
        icon="🎁"
        title={t.prompts.goodwillTitle}
        body={t.prompts.goodwillBody}
        confirm={t.prompts.goodwillConfirm}
        decline={t.prompts.dismiss}
        onConfirm={() => void close(true)}
        onDecline={() => void close(false)}
      />
    );
  }

  if (prompt === PROMPT_NOTIFICATIONS) {
    return (
      <PromptSheet
        icon="🔔"
        title={t.prompts.notifyTitle}
        body={t.prompts.notifyBody}
        confirm={t.prompts.notifyConfirm}
        decline={t.prompts.notLater}
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          // The OS alert comes next. Whatever the player answers there, we never ask again —
          // that alert is one-shot per install, so a second sheet would be pure nagging.
          void enablePush()
            .catch(() => null)
            .then(() => close(true));
        }}
        onDecline={() => void close(false)}
      />
    );
  }

  if (prompt === PROMPT_RATE) {
    // Two steps on purpose. Apple allows only THREE review prompts per player per year and gives
    // no signal about what happened, so spending one on someone who is unhappy is a wasted prompt
    // AND an invitation to a one-star review. Asking how they feel first sends the happy player to
    // the store and the unhappy one somewhere we can actually learn something.
    if (rateStep === "feedback") {
      return (
        <PromptSheet
          icon="💬"
          title={t.prompts.feedbackTitle}
          body={t.prompts.feedbackBody}
          confirm={t.prompts.feedbackConfirm}
          decline={t.prompts.dismiss}
          onConfirm={() => {
            window.open(SUPPORT_URL, "_blank");
            void close(false); // not a rating — never count it as one
          }}
          onDecline={() => void close(false)}
        />
      );
    }
    return (
      <PromptSheet
        icon="⭐"
        title={t.prompts.rateTitle}
        body={t.prompts.rateBody}
        confirm={t.prompts.rateConfirm}
        decline={t.prompts.rateDecline}
        onConfirm={() => {
          void openStoreReview();
          void close(true);
        }}
        onDecline={() => setRateStep("feedback")}
      />
    );
  }

  // An id this build doesn't know about — say nothing rather than render an empty box. This is the
  // forward-compatible half of server-driven prompts: a NEW prompt can ship to new clients while
  // old ones quietly ignore it, which is exactly what §5f got wrong in the other direction.
  return null;
}
