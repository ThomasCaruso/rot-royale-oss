// @vitest-environment jsdom
/**
 * The sign-in flow's SHAPE, now that there is no provider-choice screen.
 *
 * There used to be one: a page whose whole job was to offer Apple / Google / email. The front
 * door's own returning-player row does that job, so the choice screen became unreachable — every
 * route into it passed `initialStep="email"` — and it was deleted. What is left is one screen
 * behind the front door, the email form.
 *
 * These tests pin the SHAPE rather than the markup, because the failure they guard against is a
 * refactor quietly reintroducing the middle step: a visitor who taps Email must land on fields, not
 * on another page asking them to choose something they already chose. The two properties that
 * changed with the deletion — Email goes straight to the form, and Back from the form leaves
 * sign-in entirely rather than falling to a choice they never saw — are asserted directly.
 *
 * Google's tile is an ordinary button now (it starts the OIDC redirect), so all three routes are
 * asserted the same way - by role, through the DOM. It used to be GIS's own rendered button, which
 * rendered nothing under the mock and had to be checked indirectly.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

import { FirstRun } from "./FirstRun";

/** Both providers usable, so the row offers all three routes. */
function withBothProviders() {
  socialProviders.mockResolvedValue({
    // No google_client_id: the browser does not start Google's flow any more, so it needs none.
    providers: ["apple", "google"],
    apple_client_id: "live.rotroyale.web",
    apple_redirect_uri: window.location.origin,
  });
}

const openEmail = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /email/i }));
  return screen.findByPlaceholderText(/email/i);
};

describe("FirstRun — front door, then the email form, with nothing in between", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    socialProviders.mockResolvedValue({ providers: [] });
    googleStart.mockResolvedValue({ authorize_url: "https://accounts.google.com/o/oauth2/v2/auth" });
    socialSignInApi.mockResolvedValue({ created: false, passwordRetired: false });
  });

  it("offers all three ways in from the front door itself", async () => {
    withBothProviders();
    render(<FirstRun onPlayDaily={async () => {}} />);

    // The play CTA is still the point of the screen; the three routes sit under it.
    expect(screen.getByText("PLAY DAILY ROYALE")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /apple/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /email/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /google/i })).toBeTruthy();
  });

  it("Email goes STRAIGHT to the form — there is no provider-choice step in between", async () => {
    withBothProviders();
    render(<FirstRun onPlayDaily={async () => {}} />);
    await openEmail();

    expect(screen.getByPlaceholderText(/password/i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /log in/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /sign up/i })).toBeTruthy();
    // The deleted screen's signature: a page offering the providers as full-width choices with no
    // fields on it. If one ever comes back, the email fields above would not be here yet.
    expect(screen.queryByText("PLAY DAILY ROYALE")).toBeNull();
  });

  it("sign-up asks for a username; log-in does not", async () => {
    withBothProviders();
    render(<FirstRun onPlayDaily={async () => {}} />);
    await openEmail();

    expect(screen.queryByPlaceholderText(/username/i)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /sign up/i }));
    expect(screen.getByPlaceholderText(/username/i)).toBeTruthy();
  });

  it("back from the email form returns to the FRONT DOOR, not to a choice screen", async () => {
    // This is the behaviour that changed. Back used to fall to the provider step when one existed;
    // there is no step behind this form any more, so it must land on the front door every time.
    withBothProviders();
    render(<FirstRun onPlayDaily={async () => {}} />);
    await openEmail();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByText("PLAY DAILY ROYALE")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/password/i)).toBeNull();
  });

  it("with no usable provider the row is Email alone, and it still reaches the form", async () => {
    // The unconfigured / offline / ad-blocked case. The row degrades to one route rather than
    // rendering a set of dead controls, and that route still works.
    render(<FirstRun onPlayDaily={async () => {}} />);
    await openEmail();

    expect(screen.getByPlaceholderText(/password/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apple/i })).toBeNull();
  });
});
