// @vitest-environment jsdom
/**
 * Android BACK rules.
 *
 * The app navigates by state, not routes, so there is no history for Capacitor to pop — its default
 * would exit the app from ANY screen. Two of these three cases would silently cost a player their
 * one scored run of the day, so they're pinned.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listeners: Array<() => void> = [];
const exitApp = vi.fn();
const remove = vi.fn();

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (event: string, cb: () => void) => {
      if (event === "backButton") listeners.push(cb);
      return Promise.resolve({ remove });
    },
    exitApp: () => exitApp(),
  },
}));

const { useAndroidBackButton } = await import("@/app/useAndroidBackButton");
const { useBackInterceptor, __resetBackInterceptors } = await import("@/app/backInterceptors");

function Harness({
  inImmersiveRun,
  closeTopOverlay,
}: {
  inImmersiveRun: boolean;
  closeTopOverlay: () => boolean;
}) {
  useAndroidBackButton({ inImmersiveRun, closeTopOverlay });
  return null;
}

/** Fire the most recently registered handler (mirrors Capacitor firing the live listener). */
const pressBack = () => listeners[listeners.length - 1]?.();

beforeEach(() => {
  listeners.length = 0;
  exitApp.mockClear();
  remove.mockClear();
  __resetBackInterceptors(); // module-level stack — must not leak between cases
});

afterEach(() => vi.clearAllMocks());

describe("Android back button", () => {
  it("closes the top overlay instead of exiting", () => {
    const close = vi.fn(() => true); // something was open
    render(<Harness inImmersiveRun={false} closeTopOverlay={close} />);

    pressBack();
    expect(close).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("exits at the root, where nothing is open", () => {
    const close = vi.fn(() => false); // nothing left to close
    render(<Harness inImmersiveRun={false} closeTopOverlay={close} />);

    pressBack();
    // Trapping the user at the root is its own bug — Play reviewers flag it.
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("SWALLOWS back during a scored run — never drops out of the daily attempt", () => {
    const close = vi.fn(() => false);
    render(<Harness inImmersiveRun closeTopOverlay={close} />);

    pressBack();
    expect(exitApp).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("gives child-owned layers the press before any App-level state", () => {
    // The bug this pins: a full-screen modal owned by a child (results, live duel, sheets) matched
    // no App-level branch, so back exited the app while the player was reading their results.
    const close = vi.fn(() => false); // App level has nothing open
    const modalClose = vi.fn(() => true);

    function WithModal() {
      useBackInterceptor(true, modalClose);
      return null;
    }
    render(
      <>
        <Harness inImmersiveRun={false} closeTopOverlay={close} />
        <WithModal />
      </>,
    );

    pressBack();
    expect(modalClose).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled(); // never reached the App level
  });

  it("unregisters an interceptor once its layer closes", () => {
    const close = vi.fn(() => false);
    const modalClose = vi.fn(() => true);

    function WithModal({ open }: { open: boolean }) {
      useBackInterceptor(open, modalClose);
      return null;
    }
    const view = render(
      <>
        <Harness inImmersiveRun={false} closeTopOverlay={close} />
        <WithModal open />
      </>,
    );
    view.rerender(
      <>
        <Harness inImmersiveRun={false} closeTopOverlay={close} />
        <WithModal open={false} />
      </>,
    );

    pressBack();
    // A stale interceptor would silently swallow every future press, trapping the user.
    expect(modalClose).not.toHaveBeenCalled();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("removes the old listener when the run state changes", async () => {
    const close = vi.fn(() => false);
    const view = render(<Harness inImmersiveRun={false} closeTopOverlay={close} />);
    view.rerender(<Harness inImmersiveRun closeTopOverlay={close} />);
    // Without cleanup a stale closure still holding inImmersiveRun=false would also fire and exit
    // the app mid-question.
    await vi.waitFor(() => expect(remove).toHaveBeenCalled());
  });
});
