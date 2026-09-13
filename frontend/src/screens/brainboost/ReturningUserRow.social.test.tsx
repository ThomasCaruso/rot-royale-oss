// @vitest-environment jsdom
/**
 * The front door's returning-player provider row.
 *
 * These tests used to run against the sign-in screen's provider step, which no longer exists - the
 * front door's own row IS the choice now. The BEHAVIOUR they pin lives in the shared
 * `useSocialSignIn`, so they moved here rather than being deleted with that screen.
 *
 * The GOOGLE half was rewritten again when Google moved from Google Identity Services to the OIDC
 * authorization-code flow. The old tests drove a credential callback out of a GIS-rendered button;
 * there is no such button any more. What matters now is narrower and much easier to state: the tile
 * is an ordinary button, tapping it asks the server for a URL and navigates there, and the request
 * goes through the AUTHED path so a guest's progress survives the round trip.
 *
 * A button for a provider the SERVER cannot verify is a guaranteed dead end the player blames on
 * the app, so the list is asked for rather than hardcoded - and the screen must still work when
 * that request fails, because an offline visitor should get the email form, not an error page.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const socialProviders = vi.fn();
const socialSignInApi = vi.fn();
const googleStart = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    socialProviders: () => socialProviders(),
    socialSignIn: (b: unknown) => socialSignInApi(b),
    googleStart: () => googleStart(),
  },
}));
vi.mock("@/api/session", () => ({
  login: vi.fn(),
  registerAndLogin: vi.fn(),
  socialSignIn: (...a: unknown[]) => socialSignInApi(...a),
}));

// Google's tile navigates. jsdom refuses a real assignment ("Not implemented: navigation"), so the
// whole point of the tile - that it LEAVES - is asserted through this spy.
const assign = vi.fn();

// Native is a real branch now: the redirect has no origin to come back to inside Capacitor, and
// Google refuses OAuth in an embedded webview, so the tile hides itself there.
const isNative = vi.fn(() => false);
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNative() },
}));

import { ReturningUserRow } from "./ReturningUserRow";
import { useSessionStore } from "@/store/session";

/** The row always offers Email; only the two social tiles are conditional. */
const renderRow = () => render(<ReturningUserRow onEmail={() => {}} />);

describe("returning-user row: social sign-in", () => {
  afterEach(() => {
    cleanup();
    isNative.mockReturnValue(false);
    useSessionStore.getState().setAuthFailed(false);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    socialProviders.mockResolvedValue({ providers: [] });
    googleStart.mockResolvedValue({ authorize_url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
    socialSignInApi.mockResolvedValue({ created: false, passwordRetired: false });
    assign.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign, origin: "http://localhost:3000" },
    });
  });

  it("shows Google as an ordinary button once the server says it is configured", async () => {
    socialProviders.mockResolvedValue({ providers: ["google"] });
    renderRow();
    // A real <button>, reachable by role - not a div with someone else's iframe on top of it.
    expect(await screen.findByRole("button", { name: /google/i })).toBeTruthy();
  });

  it("no longer needs a client id to show Google", async () => {
    // The browser does not start the flow any more, so it needs no client id at all. A server that
    // reports google as configured is sufficient; requiring the id here would hide a working button.
    socialProviders.mockResolvedValue({ providers: ["google"], google_client_id: null });
    renderRow();
    expect(await screen.findByRole("button", { name: /google/i })).toBeTruthy();
  });

  it("renders nothing for Google when the provider is absent", async () => {
    socialProviders.mockResolvedValue({ providers: [] });
    renderRow();
    expect(await screen.findByRole("button", { name: /email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
  });

  it("asks the server for the URL and navigates to it", async () => {
    socialProviders.mockResolvedValue({ providers: ["google"] });
    renderRow();
    fireEvent.click(await screen.findByRole("button", { name: /google/i }));
    await waitFor(() => expect(googleStart).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1")
    );
  });

  it("surfaces a failure to start rather than doing nothing", async () => {
    // The exact symptom that killed the previous implementation: a tap that silently did nothing.
    socialProviders.mockResolvedValue({ providers: ["google"] });
    googleStart.mockRejectedValue(new Error("nope"));
    renderRow();
    fireEvent.click(await screen.findByRole("button", { name: /google/i }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("SHOWS Google on native now that the deep-link flow exists", async () => {
    // This test used to assert the opposite, and the inversion is the change. Google was hidden on
    // native because the web redirect had no origin to return to — honest at the time, but it left
    // iOS with no Google sign-in at all. The native path opens SFSafariViewController and comes
    // back through a custom URL scheme (lib/googleNative.ts), so the tile now has a working flow
    // behind it on both platforms.
    isNative.mockReturnValue(true);
    socialProviders.mockResolvedValue({ providers: ["google"] });
    renderRow();
    expect(await screen.findByRole("button", { name: /google/i })).toBeTruthy();
  });

  it("SHOWS Apple on native even though the origin can never match the web Return URL", async () => {
    // The origin gate is about the WEB flow: Apple matches the Return URL exactly against the
    // Service ID. Native sign-in is ASAuthorization — no Service ID, no Return URL, no origin — so
    // applying that gate compared `capacitor://localhost` to the registered web origin, which can
    // never match, and Apple vanished from every build of the app.
    isNative.mockReturnValue(true);
    socialProviders.mockResolvedValue({
      providers: ["apple"],
      apple_client_id: "live.rotroyale.web",
      apple_redirect_uri: "https://rotroyale.live",
    });
    renderRow();
    expect(await screen.findByRole("button", { name: /apple/i })).toBeTruthy();
  });

  it("still hides Apple on a WEB origin the Return URL does not name", async () => {
    // The gate must keep doing its original job: this app is also reachable on *.onrender.com,
    // where a sign-in would open the popup and die on a generic `invalid_request`.
    isNative.mockReturnValue(false);
    socialProviders.mockResolvedValue({
      providers: ["apple"],
      apple_client_id: "live.rotroyale.web",
      apple_redirect_uri: "https://rotroyale.live",
    });
    renderRow();
    expect(await screen.findByRole("button", { name: /email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apple/i })).toBeNull();
  });

  it("reports a failed redirect that came back in the URL", async () => {
    // The callback redirects to #auth_error=google, App parks the fact in the session store, and
    // this row is where the player finds out. Without it a failed sign-in is indistinguishable from
    // a tap that did nothing - which is exactly the bug this whole change exists to kill.
    useSessionStore.getState().setAuthFailed(true);
    socialProviders.mockResolvedValue({ providers: ["google"] });
    renderRow();
    expect(await screen.findByRole("alert")).toBeTruthy();
    // ...and it is cleared, so it does not haunt every later remount.
    await waitFor(() => expect(useSessionStore.getState().authFailed).toBe(false));
  });

  // ── Apple ────────────────────────────────────────────────────────────────────────────────────

  it("shows Apple only on the origin its Return URL is registered for", async () => {
    // jsdom serves http://localhost, so an origin that does not match must hide the button rather
    // than open a popup that dies on Apple's generic invalid_request.
    socialProviders.mockResolvedValue({
      providers: ["apple"],
      google_client_id: null,
      apple_client_id: "live.rotroyale.web",
      apple_redirect_uri: "https://rotroyale.live",
    });
    renderRow();
    expect(await screen.findByRole("button", { name: /email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apple/i })).toBeNull();
  });

  it("shows Apple when the origin matches", async () => {
    socialProviders.mockResolvedValue({
      providers: ["apple"],
      google_client_id: null,
      apple_client_id: "live.rotroyale.web",
      apple_redirect_uri: window.location.origin,
    });
    renderRow();
    expect(await screen.findByRole("button", { name: /apple/i })).toBeTruthy();
  });

  it("shows Apple when the server sends no redirect uri (older server)", async () => {
    // Forward compatibility in reverse: a server that does not publish the field must not silently
    // hide a provider it says is enabled.
    socialProviders.mockResolvedValue({
      providers: ["apple"],
      google_client_id: null,
      apple_client_id: "live.rotroyale.web",
    });
    renderRow();
    expect(await screen.findByRole("button", { name: /apple/i })).toBeTruthy();
  });

  it("hides Apple when configured without a client id", async () => {
    socialProviders.mockResolvedValue({
      providers: ["apple"],
      google_client_id: null,
      apple_client_id: null,
    });
    renderRow();
    expect(await screen.findByRole("button", { name: /email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apple/i })).toBeNull();
  });
});
