// @vitest-environment jsdom
/**
 * Reading Google's return parameters out of the URL fragment — and, more importantly, getting them
 * back OUT of the URL.
 *
 * The handoff code is a credential for the sixty seconds it lives. It is short-lived and single-use
 * at the server, which is what makes carrying it in a URL acceptable at all, but "acceptable" still
 * means removing it at the first opportunity rather than leaving it in `location.href` for the rest
 * of the session, where it rides into history and into anything that snapshots the current URL.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeGoogleReturn,
  resetGoogleReturnForTests,
  takeGoogleReturn,
} from "./googleReturn";

function setHash(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}

describe("googleReturn", () => {
  beforeEach(() => {
    resetGoogleReturnForTests();
    window.history.replaceState(null, "", "/");
  });

  it("reads a handoff code", () => {
    setHash("#handoff=abc123");
    expect(consumeGoogleReturn()).toEqual({ kind: "handoff", code: "abc123" });
  });

  it("strips the code from the URL immediately", () => {
    setHash("#handoff=abc123");
    consumeGoogleReturn();
    // Not merely absent from the hash — absent from the whole URL.
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("abc123");
  });

  it("reads the error marker", () => {
    setHash("#auth_error=google");
    expect(consumeGoogleReturn()).toEqual({ kind: "error" });
    expect(window.location.hash).toBe("");
  });

  it("leaves an unrelated fragment alone", () => {
    // The fragment is not ours alone. Clobbering it would break anything else that uses one.
    setHash("#handoff=abc123&keep=this");
    expect(consumeGoogleReturn()).toEqual({ kind: "handoff", code: "abc123" });
    expect(window.location.hash).toBe("#keep=this");
  });

  it("reports nothing when there is nothing", () => {
    expect(consumeGoogleReturn()).toEqual({ kind: "none" });
    setHash("#something=else");
    expect(consumeGoogleReturn()).toEqual({ kind: "none" });
    // ...and does not disturb a fragment it has no business touching.
    expect(window.location.hash).toBe("#something=else");
  });

  it("takeGoogleReturn yields the code exactly once", () => {
    // The guarantee that keeps React's double-effect from redeeming one single-use code twice and
    // turning a successful sign-in into an error the player did nothing to cause.
    setHash("#handoff=abc123");
    expect(takeGoogleReturn()).toEqual({ kind: "handoff", code: "abc123" });
    expect(takeGoogleReturn()).toEqual({ kind: "none" });
    expect(takeGoogleReturn()).toEqual({ kind: "none" });
  });

  it("never carries a token — only the one-time code", () => {
    // Pins the contract with the server's callback. If anyone ever redirects with tokens in the
    // fragment, this module must not be the thing that quietly starts accepting them.
    setHash("#access_token=real-token&refresh_token=also-real");
    expect(consumeGoogleReturn()).toEqual({ kind: "none" });
  });
});
