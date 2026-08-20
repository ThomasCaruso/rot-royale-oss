// @vitest-environment jsdom
/**
 * The /download route itself: it must render for a total stranger — no auth, no session, no guest
 * account — and its CTA must be a real anchor pointing at the real App Store URL.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_STORE_URL } from "@/lib/appLinks";
import { nav } from "@/lib/downloadBrowser";
import { DownloadPage } from "./DownloadPage";

vi.mock("@/lib/analytics", () => ({
  trackFunnel: vi.fn(),
  trackFunnelOnce: vi.fn(),
}));

// The page must never touch these. Mocked so the assertion is real rather than aspirational.
const startGuest = vi.fn();
const restoreSession = vi.fn();
vi.mock("@/api/session", () => ({
  startGuest: (...args: unknown[]) => startGuest(...args),
  restoreSession: (...args: unknown[]) => restoreSession(...args),
}));

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

let prevented: boolean | null = null;
const suppressNavigation = (e: Event) => {
  prevented = e.defaultPrevented;
  e.preventDefault();
};

function cta() {
  return screen.getByRole("link", { name: /download on the app store/i });
}

beforeEach(() => {
  prevented = null;
  startGuest.mockClear();
  restoreSession.mockClear();
  document.addEventListener("click", suppressNavigation);
  Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => SAFARI });
  vi.spyOn(nav, "assign").mockImplementation(() => {});
  vi.spyOn(nav, "open").mockImplementation(() => null);
});

afterEach(() => {
  document.removeEventListener("click", suppressNavigation);
  cleanup();
  Reflect.deleteProperty(navigator, "userAgent");
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("DownloadPage", () => {
  it("renders without authentication", () => {
    render(<DownloadPage />);
    expect(screen.getByRole("heading", { name: "Rot Royale" })).toBeTruthy();
    expect(screen.getByText("8 questions. One shot a day.")).toBeTruthy();
    expect(screen.getByText("Available on iPhone")).toBeTruthy();
  });

  it("puts the real App Store URL on a genuine anchor", () => {
    render(<DownloadPage />);
    expect(cta().getAttribute("href")).toBe(APP_STORE_URL);
    expect(cta().tagName).toBe("A");
  });

  it("never creates a guest account or restores a session", () => {
    render(<DownloadPage />);
    fireEvent.click(cta());
    expect(startGuest).not.toHaveBeenCalled();
    expect(restoreSession).not.toHaveBeenCalled();
  });

  it("keeps ordinary-browser behavior anchor-native", () => {
    render(<DownloadPage />);
    fireEvent.click(cta());
    expect(prevented).toBe(false);
    expect(vi.mocked(nav.assign)).not.toHaveBeenCalled();
    expect(vi.mocked(nav.open)).not.toHaveBeenCalled();
  });

  it("ignores query parameters — they cannot change the destination", () => {
    window.history.replaceState({}, "", "/download?source=instagram&campaign=launch");
    render(<DownloadPage />);
    expect(cta().getAttribute("href")).toBe(APP_STORE_URL);
  });

  it("offers exactly one Play now, directly under Download, in any browser", () => {
    render(<DownloadPage />);
    const play = screen.getAllByRole("link", { name: /play now/i });
    expect(play).toHaveLength(1);
    // Same-origin: the one route Meta has no reason to block.
    expect(play[0].getAttribute("href")).toBe("/");
    // It really is the next element after the App Store CTA.
    expect(cta().nextElementSibling).toBe(play[0]);
  });

  it("keeps the front screen to two buttons — no block talk on arrival", () => {
    render(<DownloadPage />);
    expect(screen.queryByText(/blocks App Store links/i)).toBeNull();
    expect(screen.queryByText(/Open in browser/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays that simple on arrival inside Instagram too", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () =>
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23F84 Instagram 440.0.0.30.81 (iPhone15,4; iOS 26_5_2; en_US; en)",
    });
    render(<DownloadPage />);
    // Explaining Meta's block to someone whose tap might still work is noise.
    expect(screen.queryByText(/blocks App Store links/i)).toBeNull();
    expect(cta().getAttribute("href")).toBe(APP_STORE_URL);
    expect(screen.getByRole("link", { name: /play now/i })).toBeTruthy();
  });
});
