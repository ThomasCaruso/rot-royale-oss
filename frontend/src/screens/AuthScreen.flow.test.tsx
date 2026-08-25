// @vitest-environment jsdom
/**
 * The sign-in flow's SHAPE: a provider-choice screen first, the email form one tap behind it.
 *
 * The point of the split is that the front door offers three equal choices and nothing else. A
 * refactor that puts the email fields back on the first screen would look harmless and would undo
 * the whole design, so the absence of them is asserted rather than assumed — as is the escape
 * hatch in the other direction: a visitor with no usable provider must never be shown a "choose how
 * to sign in" screen with nothing to choose.
 *
 * Google's button is GIS's own and renders nothing under the mock, so it is asserted through the
 * `renderGoogleButton` call rather than through the DOM (see AuthScreen.social.test.tsx).
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const socialProviders = vi.fn();
const socialSignInApi = vi.fn();
const CLIENT_ID = "000000000000-testclientid.apps.googleusercontent.com";

vi.mock("@/api/client", () => ({
  api: { socialProviders: () => socialProviders(), socialSignIn: (b: unknown) => socialSignInApi(b) },
}));
vi.mock("@/api/session", () => ({
  login: vi.fn(),
  registerAndLogin: vi.fn(),
  socialSignIn: (...a: unknown[]) => socialSignInApi(...a),
}));
const renderGoogleButton = vi.fn();
vi.mock("@/lib/googleIdentity", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/googleIdentity")>("@/lib/googleIdentity");
  return { ...actual, renderGoogleButton: (o: unknown) => renderGoogleButton(o) };
});

import { AuthScreen } from "./AuthScreen";

/** Both providers usable, so the choice screen is the one that renders. */
function withBothProviders() {
  socialProviders.mockResolvedValue({
    providers: ["apple", "google"],
    google_client_id: CLIENT_ID,
    apple_client_id: "live.rotroyale.web",
    apple_redirect_uri: window.location.origin,
  });
}

describe("AuthScreen — provider choice, then email", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    socialProviders.mockResolvedValue({ providers: [], google_client_id: null });
    renderGoogleButton.mockResolvedValue(undefined);
    socialSignInApi.mockResolvedValue({ created: false, passwordRetired: false });
  });

  it("offers exactly three ways in — Apple, Google, email — under the crown and wordmark", async () => {
    withBothProviders();
    const { container } = render(<AuthScreen />);

    expect(await screen.findByRole("button", { name: /continue with apple/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue with email/i })).toBeTruthy();
    await waitFor(() => expect(renderGoogleButton).toHaveBeenCalled());

    expect(screen.getByText("Rot Royale")).toBeTruthy();
    expect(screen.getByText("Check your brain. Get sharper every day.")).toBeTruthy();
    // The crown mark, version-agnostic on its `?v=N` cache-buster (docs/architecture.md §13).
    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(
      srcs.some((s) => s != null && s.replace(/\?v=\d+$/, "") === "/assets/themes/starter/crown.png")
    ).toBe(true);
  });

  it("keeps every email affordance OFF the choice screen", async () => {
    withBothProviders();
    render(<AuthScreen />);
    await screen.findByRole("button", { name: /continue with apple/i });

    // No fields, no Log in / Sign up control, and no second log-in CTA competing with the three.
    expect(screen.queryByPlaceholderText(/email/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/password/i)).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: /^log in$/i })).toBeNull();
  });

  it("Continue with Email opens the log-in / sign-up form", async () => {
    withBothProviders();
    render(<AuthScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /continue with email/i }));

    expect(await screen.findByPlaceholderText(/email/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/password/i)).toBeTruthy();
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /log in/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /sign up/i })).toBeTruthy();
  });

  it("sign-up asks for a username; log-in does not", async () => {
    withBothProviders();
    render(<AuthScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /continue with email/i }));
    await screen.findByPlaceholderText(/email/i);

    expect(screen.queryByPlaceholderText(/username/i)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /sign up/i }));
    expect(screen.getByPlaceholderText(/username/i)).toBeTruthy();
  });

  it("back from the email form returns to the choice screen, not out of sign-in", async () => {
    withBothProviders();
    const onBack = vi.fn();
    render(<AuthScreen onBack={onBack} />);
    fireEvent.click(await screen.findByRole("button", { name: /continue with email/i }));
    await screen.findByPlaceholderText(/email/i);

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByRole("button", { name: /continue with apple/i })).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("with no usable provider it IS the email form, and back leaves sign-in", async () => {
    // The unconfigured / offline / ad-blocked case. A choice screen with one choice on it is a
    // dead end, so there is never one to go back to.
    const onBack = vi.fn();
    render(<AuthScreen onBack={onBack} />);
    await screen.findByPlaceholderText(/email/i);

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
