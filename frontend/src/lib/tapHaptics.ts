/**
 * App-wide tap feedback: ONE delegated listener, not a `feedback()` call in every component.
 *
 * WHY DELEGATION RATHER THAN CALL SITES. The run had haptics in nine files; the rest of the app —
 * navigation, the Vault, campaign nodes, results, duels, friends, every modal — had none, across
 * 67 files containing a raw <button>. Adding a call to each is a day of work that starts decaying
 * immediately: the next button somebody writes has no tick, and nothing anywhere fails to say so.
 * A listener at the root covers the app that exists AND the app that gets written next week.
 *
 * It also gets §7b1's hardest rule right by construction: fire on POINTER DOWN, never on click. The
 * tick has to land with the finger — waiting for `click` puts it after the decision and reads as
 * lag, and that timing is most of the difference between an app that feels responsive and one that
 * does not. A delegated pointerdown listener cannot get that wrong; sixty-seven hand-written call
 * sites eventually will.
 *
 * WHAT THIS IS NOT FOR. Only the TAP — the acknowledgement that a control was pressed. Outcomes are
 * hand-written and stay that way: `success`/`error` on a reveal, `medium` on a commit, `warning`
 * when time runs out. Those fire on events rather than on pointerdown, they carry meaning rather
 * than acknowledgement, and this listener must never speak for them.
 *
 * ON iOS THIS IS THE WHOLE POINT. Safari does not implement `navigator.vibrate`, so on the web an
 * iPhone feels none of this; inside the app it routes through `@capacitor/haptics` to the Taptic
 * Engine, which is the best feedback of any platform we ship to (§7b1).
 */

import { feedback, type Feel } from "@/lib/haptics";

/**
 * What counts as tappable.
 *
 * Deliberately conservative: real controls only. Matching something broad like `[onclick]` or any
 * element with a cursor would tick on cards, rows and scroll containers, and an app that buzzes
 * when you scroll is one the player mutes — which silences the outcomes too, since a single
 * preference governs both.
 */
const INTERACTIVE =
  'button, [role="button"], a[href], summary, input[type="checkbox"], input[type="radio"], label[for]';

/** Opt-out / override attribute. `data-haptic="off"` silences a subtree; any Feel name overrides. */
const ATTR = "data-haptic";

const FEELS = new Set<string>([
  "selection",
  "light",
  "medium",
  "heavy",
  "success",
  "warning",
  "error",
]);

function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  return false;
}

/**
 * The intent for this element: the nearest `data-haptic` ancestor wins, otherwise `selection`.
 *
 * Inherited from ANCESTORS so a whole surface can be silenced or strengthened in one place — a
 * scrolling list, a modal that is mid-animation — rather than annotating every child.
 */
function intentFor(el: Element): Feel | null {
  const owner = el.closest(`[${ATTR}]`);
  const value = owner?.getAttribute(ATTR)?.trim().toLowerCase();
  if (!value) return "selection";
  if (value === "off" || value === "none" || value === "false") return null;
  return FEELS.has(value) ? (value as Feel) : "selection";
}

/**
 * Start listening. Returns an unsubscribe so a test (or a future host) can tear it down.
 *
 * CAPTURE phase, so a component that calls `stopPropagation()` on its own pointerdown — which some
 * drag and slider handlers legitimately do — still gets its tick. PASSIVE, because this must never
 * be able to delay or cancel a gesture: a haptic is decoration, and decoration does not get to
 * interfere with scrolling.
 */
export function installTapHaptics(target: Document | null = globalThis.document ?? null): () => void {
  if (!target?.addEventListener) return () => {};

  const onPointerDown = (event: Event) => {
    const start = event.target;
    if (!(start instanceof Element)) return;
    const el = start.closest(INTERACTIVE);
    if (!el) return;
    // `closest` includes the element itself, so this covers both a disabled control and a disabled
    // ANCESTOR — a fieldset, or a card rendered inert while something loads. A dead control that
    // still ticks is worse than one that does nothing: it says the tap registered when it did not.
    if (isDisabled(el) || el.closest("[disabled], [aria-disabled='true']")) return;
    const intent = intentFor(el);
    if (intent) feedback(intent);
  };

  target.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  return () => target.removeEventListener("pointerdown", onPointerDown, { capture: true });
}
