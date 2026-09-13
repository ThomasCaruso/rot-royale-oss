// @vitest-environment jsdom
/**
 * App-wide tap feedback.
 *
 * This listener is the only thing giving 67 screens' worth of raw <button> any feel at all, so the
 * properties worth pinning are the ones whose failure is INVISIBLE: it must fire once (not twice),
 * on pointerdown (not click), never on a dead control, and never on the page furniture — an app
 * that buzzes while you scroll gets muted, and the single preference would silence the outcome
 * haptics along with it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const feedback = vi.fn();
vi.mock("@/lib/haptics", () => ({ feedback: (f: string) => feedback(f) }));

import { installTapHaptics } from "./tapHaptics";

let uninstall: () => void;

/** A real pointerdown, as the browser would deliver it. */
function press(el: Element) {
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  feedback.mockClear();
  document.body.innerHTML = "";
  uninstall = installTapHaptics(document);
});
afterEach(() => uninstall?.());

describe("tap haptics", () => {
  it("ticks a button once per press", () => {
    document.body.innerHTML = `<button id="b">Play</button>`;
    press(document.getElementById("b")!);
    expect(feedback).toHaveBeenCalledTimes(1);
    expect(feedback).toHaveBeenCalledWith("selection");
  });

  it("ticks when the press lands on something INSIDE the control", () => {
    // Real buttons wrap icons and labels, so the event target is almost never the button itself.
    document.body.innerHTML = `<button id="b"><span id="label">Play</span></button>`;
    press(document.getElementById("label")!);
    expect(feedback).toHaveBeenCalledTimes(1);
  });

  it("fires on POINTERDOWN, not click", () => {
    // §7b1: the tick has to land with the finger. Waiting for `click` puts it after the decision
    // and reads as lag — which is most of the difference between responsive and not.
    document.body.innerHTML = `<button id="b">Play</button>`;
    document.getElementById("b")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(feedback).not.toHaveBeenCalled();
  });

  it("covers the other real controls, not just <button>", () => {
    document.body.innerHTML = `
      <a id="a" href="/x">link</a>
      <div id="r" role="button">pressable</div>
      <input id="c" type="checkbox" />`;
    for (const id of ["a", "r", "c"]) press(document.getElementById(id)!);
    expect(feedback).toHaveBeenCalledTimes(3);
  });

  it("stays silent on page furniture", () => {
    // The conservative matcher is the point: ticking on cards, rows or scroll containers would make
    // scrolling buzz, and a player who mutes that also mutes every outcome.
    document.body.innerHTML = `
      <div id="card">a card</div>
      <p id="text">prose</p>
      <a id="anchor">no href</a>`;
    for (const id of ["card", "text", "anchor"]) press(document.getElementById(id)!);
    expect(feedback).not.toHaveBeenCalled();
  });

  it("stays silent on a DISABLED control", () => {
    // A dead control that still ticks is worse than one that does nothing: it reports that the tap
    // registered when it did not.
    document.body.innerHTML = `
      <button id="b" disabled>Play</button>
      <div id="r" role="button" aria-disabled="true">Play</div>`;
    press(document.getElementById("b")!);
    press(document.getElementById("r")!);
    expect(feedback).not.toHaveBeenCalled();
  });

  it("stays silent inside a disabled ANCESTOR", () => {
    document.body.innerHTML = `<fieldset disabled><button id="b">Play</button></fieldset>`;
    press(document.getElementById("b")!);
    expect(feedback).not.toHaveBeenCalled();
  });

  it("honours a data-haptic intent override", () => {
    // A primary CTA earns a firmer knock than a list row — declared on the element rather than
    // fired by hand, so the one listener stays the only thing that decides WHEN.
    document.body.innerHTML = `<button id="b" data-haptic="light">Play</button>`;
    press(document.getElementById("b")!);
    expect(feedback).toHaveBeenCalledWith("light");
  });

  it("data-haptic='off' silences a whole subtree", () => {
    document.body.innerHTML = `<div data-haptic="off"><button id="b">Quiet</button></div>`;
    press(document.getElementById("b")!);
    expect(feedback).not.toHaveBeenCalled();
  });

  it("falls back to selection for an unrecognised intent", () => {
    // A typo must not silence a control, and must not throw an unknown value at the platform.
    document.body.innerHTML = `<button id="b" data-haptic="sparkle">Play</button>`;
    press(document.getElementById("b")!);
    expect(feedback).toHaveBeenCalledWith("selection");
  });

  it("the nearest data-haptic wins over an outer one", () => {
    document.body.innerHTML = `<div data-haptic="off"><button id="b" data-haptic="heavy">X</button></div>`;
    press(document.getElementById("b")!);
    expect(feedback).toHaveBeenCalledWith("heavy");
  });

  it("still ticks when a handler stops propagation", () => {
    // Sliders and drag handles legitimately call stopPropagation on pointerdown. Capture phase is
    // what keeps those controls from silently losing their feel.
    document.body.innerHTML = `<button id="b">Play</button>`;
    const b = document.getElementById("b")!;
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    press(b);
    expect(feedback).toHaveBeenCalledTimes(1);
  });

  it("uninstalls cleanly", () => {
    document.body.innerHTML = `<button id="b">Play</button>`;
    uninstall();
    press(document.getElementById("b")!);
    expect(feedback).not.toHaveBeenCalled();
  });

  it("installing with no document is a harmless no-op", () => {
    expect(() => installTapHaptics(null)()).not.toThrow();
  });
});
