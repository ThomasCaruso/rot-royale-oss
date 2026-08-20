// @vitest-environment jsdom
/**
 * Click behavior + the inline help panel, driven through the real hook on a real anchor.
 *
 * The headline contract: the click is NEVER intercepted, in any browser. A document-level bubble
 * listener records `defaultPrevented` and then cancels the click, so that can be asserted without
 * jsdom attempting a real navigation. Fake timers drive the escalation ladder; React state updates
 * from those timers are flushed inside `act`.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_STORE_URL } from "@/lib/appLinks";
import { RUNG_INTERVAL_MS, nav } from "@/lib/downloadBrowser";

/** Matches ANCHOR_GRACE_MS in useAppDownload — the anchor gets first refusal before rung 0. */
const ANCHOR_GRACE_MS = 400;
import { useAppDownload } from "./useAppDownload";

vi.mock("@/lib/analytics", () => ({
  trackFunnel: vi.fn(),
  trackFunnelOnce: vi.fn(),
}));

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const UA = {
  safari: `${IOS} Version/17.5 Mobile/15E148 Safari/604.1`,
  instagram: `${IOS} Mobile/15E148 Instagram 331.0.0.37.90 (iPhone14,5; iOS 17_5)`,
  facebook: `${IOS} Mobile/15E148 [FBAN/FBIOS;FBAV/468.0.0.47.108;FBDV/iPhone14,5]`,
  androidInstagram:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 331.0.0.37.90 Android",
} as const;

function Harness() {
  const { handleDownloadClick, blockedNotice } = useAppDownload();
  return (
    <>
      <a href={APP_STORE_URL} onClick={handleDownloadClick}>
        Download on the App Store
      </a>
      {blockedNotice}
    </>
  );
}

let prevented: boolean | null = null;
const suppressNavigation = (e: Event) => {
  // Runs at the bubble phase, AFTER the component's own handler: records what the handler decided
  // and then stops jsdom from trying to navigate.
  prevented = e.defaultPrevented;
  e.preventDefault();
};

function setUserAgent(value: string) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => value });
}

function tapDownload() {
  fireEvent.click(screen.getByRole("link", { name: /download on the app store/i }));
}

/** Let the anchor's grace period lapse so the ladder starts. */
async function afterGrace() {
  await act(async () => {
    vi.advanceTimersByTime(ANCHOR_GRACE_MS);
  });
}

/** Advance one rung of the ladder. */
async function nextRung(times = 1) {
  await act(async () => {
    vi.advanceTimersByTime(RUNG_INTERVAL_MS * times);
  });
}

/** Advance past every rung of the longest ladder (3 on iOS Instagram) so help appears. */
async function exhaustTheLadder() {
  await afterGrace();
  await nextRung(4);
}

beforeEach(() => {
  vi.useFakeTimers();
  prevented = null;
  document.addEventListener("click", suppressNavigation);
  vi.spyOn(nav, "assign").mockImplementation(() => {});
  vi.spyOn(nav, "open").mockImplementation(() => null);
});

afterEach(() => {
  document.removeEventListener("click", suppressNavigation);
  cleanup();
  Reflect.deleteProperty(navigator, "userAgent");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ordinary browsers — the anchor is left completely alone", () => {
  beforeEach(() => setUserAgent(UA.safari));

  it("does not preventDefault and navigates nothing itself", () => {
    render(<Harness />);
    tapDownload();
    expect(prevented).toBe(false);
    expect(vi.mocked(nav.assign)).not.toHaveBeenCalled();
    expect(vi.mocked(nav.open)).not.toHaveBeenCalled();
  });

  it("is never watched — no scheme and no help, however long you wait", async () => {
    render(<Harness />);
    tapDownload();
    await exhaustTheLadder();
    await nextRung(20);
    expect(vi.mocked(nav.assign)).not.toHaveBeenCalled();
    expect(vi.mocked(nav.open)).not.toHaveBeenCalled();
  });
});

describe("Meta in-app browsers — the App Store opens on the first tap", () => {
  it.each([
    ["Instagram on iOS", UA.instagram],
    ["Facebook on iOS", UA.facebook],
  ])("%s: leaves the click alone, then fires itms-apps:// after the grace period", async (_label, ua) => {
    setUserAgent(ua);
    render(<Harness />);
    tapDownload();
    // Critical: the anchor gets first refusal. Preventing it meant that when the scheme handoff
    // was refused too, the visitor got nothing at all.
    expect(prevented).toBe(false);
    expect(vi.mocked(nav.assign)).not.toHaveBeenCalled();

    await afterGrace();
    expect(vi.mocked(nav.assign)).toHaveBeenCalledWith(
      "itms-apps://apps.apple.com/us/app/rot-royale/id6781928142",
    );
  });

  it("answers in the same tap — no waiting to find out the App Store is unreachable", () => {
    setUserAgent(UA.instagram);
    render(<Harness />);
    tapDownload();
    // No timers advanced, nothing awaited: the explanation is already on screen.
    expect(screen.getByRole("status").textContent).toContain("Instagram blocks App Store links.");
  });

  it("a working anchor navigation cancels the ladder before it ever starts", async () => {
    setUserAgent(UA.instagram);
    render(<Harness />);
    tapDownload();
    window.dispatchEvent(new Event("pagehide")); // the real navigation took
    await exhaustTheLadder();
    // Not a single scheme was fired — the anchor did the job.
    expect(vi.mocked(nav.assign)).not.toHaveBeenCalled();
    expect(vi.mocked(nav.open)).not.toHaveBeenCalled();
  });

  it("Instagram on iOS: falls through to Safari, then the legacy hatch, silently", async () => {
    setUserAgent(UA.instagram);
    render(<Harness />);
    tapDownload();
    await afterGrace();

    await nextRung();
    expect(vi.mocked(nav.open)).toHaveBeenCalledWith(
      "x-safari-https://apps.apple.com/us/app/rot-royale/id6781928142",
      "_blank",
    );

    await nextRung();
    expect(vi.mocked(nav.assign)).toHaveBeenCalledWith(
      "instagram://extbrowser,https%3A%2F%2Fapps.apple.com%2Fus%2Fapp%2Frot-royale%2Fid6781928142",
    );
  });

  it("Android Meta: fires the exact intent URL after the grace period", async () => {
    setUserAgent(UA.androidInstagram);
    render(<Harness />);
    tapDownload();
    expect(prevented).toBe(false);
    await afterGrace();
    expect(vi.mocked(nav.assign)).toHaveBeenCalledWith(
      "intent://apps.apple.com/us/app/rot-royale/id6781928142#Intent;scheme=https;end",
    );
  });

  it("cleans up on unmount so a pending ladder can't fire later", async () => {
    setUserAgent(UA.instagram);
    const { unmount } = render(<Harness />);
    tapDownload();
    unmount();
    await exhaustTheLadder();
    expect(vi.mocked(nav.open)).not.toHaveBeenCalled();
  });
});

describe("blocked notice — instant, and only after a tap", () => {
  beforeEach(() => setUserAgent(UA.instagram));

  /** Tap once. The notice is up immediately; no timers needed. */
  function reachNotice() {
    render(<Harness />);
    tapDownload();
    return screen.getByRole("status");
  }

  it("is not there on arrival — only a tap summons it", () => {
    render(<Harness />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("appears instantly, naming the app that blocked it", () => {
    const notice = reachNotice();
    expect(notice.textContent).toContain("Instagram blocks App Store links.");
    expect(notice.getAttribute("aria-live")).toBe("polite");
    // Inline page content, not a dialog stealing focus.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not repeat the Play now button — that one stays under Download", () => {
    expect(reachNotice().querySelector('a[href="/"]')).toBeNull();
  });

  it("spells out the ••• route for anyone who still wants the app", () => {
    expect(reachNotice().textContent).toContain("Open in browser");
  });

  it("gets out of the way if a rung DOES land — the handoff still wins", async () => {
    reachNotice();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays put once the whole ladder has come back empty", async () => {
    reachNotice();
    await exhaustTheLadder();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("keeps exactly one notice after repeated taps", async () => {
    reachNotice();
    tapDownload();
    await exhaustTheLadder();
    tapDownload();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("offers the raw https link to copy, never a custom scheme", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const notice = reachNotice();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy the app store link/i }));
    });
    expect(writeText).toHaveBeenCalledWith(APP_STORE_URL);
    expect(notice.textContent).not.toContain("itms-apps://");
    expect(notice.textContent).not.toContain("instagram://");
    Reflect.deleteProperty(navigator, "clipboard");
  });
});
