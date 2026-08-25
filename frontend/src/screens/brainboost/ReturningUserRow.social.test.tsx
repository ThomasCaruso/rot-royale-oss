// @vitest-environment jsdom
/**
 * The front door's returning-player provider row.
 *
 * These tests used to run against the sign-in screen's provider step, which no longer exists — the
 * front door's own row IS the choice now. The BEHAVIOUR they pin is unchanged and lives in the
 * shared `useSocialSignIn`, so they moved here rather than being deleted with that screen.
 *
 * Two properties are worth a test rather than a look. A button for a provider the SERVER cannot
 * verify is a guaranteed dead end that the player blames on the app, so the list is asked for
 * rather than hardcoded — and the screen must still work when that request fails, because an
 * offline visitor should get the email form, not an error page.
 *
 * The third is a courtesy that is easy to drop in a refactor: when linking retires an account's
 * password, the player is told. Otherwise they discover it at some later login with no idea why it
 * stopped working.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const socialProviders = vi.fn();
const socialSignInApi = vi.fn();
/** Shaped like a real one, obviously not one. The production id lives in an env var, never here. */
const CLIENT_ID = "000000000000-testclientid.apps.googleusercontent.com";

vi.mock("@/api/client", () => ({
  api: { socialProviders: () => socialProviders(), socialSignIn: (b: unknown) => socialSignInApi(b) },
}));
vi.mock("@/api/session", () => ({
  login: vi.fn(),
  registerAndLogin: vi.fn(),
  socialSignIn: (...a: unknown[]) => socialSignInApi(...a),
}));
// GIS is the real dependency for Google on the web. Stubbed so the tests never touch the network,
// and so the credential callback can be driven directly.
const renderGoogleButton = vi.fn();
vi.mock("@/lib/googleIdentity", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/googleIdentity")>("@/lib/googleIdentity");
  return { ...actual, renderGoogleButton: (o: unknown) => renderGoogleButton(o) };
});

import { ReturningUserRow } from "./ReturningUserRow";

/** The row always offers Email; only the two social tiles are conditional. */
const renderRow = () => render(<ReturningUserRow onEmail={() => {}} />);

describe("returning-user row: social sign-in", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    socialProviders.mockResolvedValue({ providers: [], google_client_id: null });
    renderGoogleButton.mockResolvedValue(undefined);
    socialSignInApi.mockResolvedValue({ created: false, passwordRetired: false });
  });

  it("renders Google's button only once the server says Google is configured", async () => {
    socialProviders.mockResolvedValue({ providers: ["google"], google_client_id: CLIENT_ID });
    renderRow();
    await waitFor(() => expect(renderGoogleButton).toHaveBeenCalled());
    expect(renderGoogleButton.mock.calls[0][0].clientId).toBe(CLIENT_ID);
  });

  it("renders nothing for Google when the provider is absent", async () => {
    socialProviders.mockResolvedValue({ providers: [], google_client_id: null });
    renderRow();
    expect(await screen.findByRole("button", { name: /email/i })).toBeTruthy();
    await waitFor(() => expect(renderGoogleButton).not.toHaveBeenCalled());
  });

  it("renders nothing for Google when the server sends no client id", async () => {
    // Half-configured is treated as unconfigured — a button with no client id cannot work.
    socialProviders.mockResolvedValue({ providers: ["google"], google_client_id: null });
    renderRow();
    expect(await screen.findByRole("button", { name: /email/i })).toBeTruthy();
    await waitFor(() => expect(renderGoogleButton).not.toHaveBeenCalled());
  });

  it("sends the ID token from Google's callback to the backend", async () => {
    socialProviders.mockResolvedValue({ providers: ["google"], google_client_id: CLIENT_ID });
    renderRow();
    await waitFor(() => expect(renderGoogleButton).toHaveBeenCalled());
    // Drive the credential exactly as GIS would.
    renderGoogleButton.mock.calls[0][0].onCredential("google-id-token-xyz");
    await waitFor(() =>
      expect(socialSignInApi).toHaveBeenCalledWith("google", "google-id-token-xyz")
    );
  });

  it("tells the player when linking retired their password", async () => {
    socialProviders.mockResolvedValue({ providers: ["google"], google_client_id: CLIENT_ID });
    socialSignInApi.mockResolvedValue({ created: false, passwordRetired: true });
    renderRow();
    await waitFor(() => expect(renderGoogleButton).toHaveBeenCalled());
    renderGoogleButton.mock.calls[0][0].onCredential("tok");
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("surfaces a backend rejection rather than failing silently", async () => {
    socialProviders.mockResolvedValue({ providers: ["google"], google_client_id: CLIENT_ID });
    socialSignInApi.mockRejectedValue(new Error("nope"));
    renderRow();
    await waitFor(() => expect(renderGoogleButton).toHaveBeenCalled());
    renderGoogleButton.mock.calls[0][0].onCredential("tok");
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("drops Google and keeps the email route when GIS cannot load", async () => {
    // Ad blocker, offline, blocked script. A broken button is worse than no button.
    socialProviders.mockResolvedValue({ providers: ["google"], google_client_id: CLIENT_ID });
    renderGoogleButton.mockRejectedValue(new Error("blocked"));
    renderRow();
    expect(await screen.findByRole("button", { name: /email/i })).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /google/i })).toBeNull()
    );
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
