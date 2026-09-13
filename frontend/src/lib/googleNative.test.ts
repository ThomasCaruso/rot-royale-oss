/**
 * Reading the native Google sign-in's deep-link return.
 *
 * The handoff code is a one-time credential for a real session, so the parsing here is worth
 * pinning: it must find the code in a fragment (never a query string, which would mean the server
 * had put it somewhere that reaches logs), and it must ignore deep links that are not ours rather
 * than resolving a sign-in on whatever else the app is handed.
 */

import { describe, expect, it } from "vitest";

import { readHandoffFromUrl } from "./googleNative";

describe("readHandoffFromUrl", () => {
  it("reads the handoff code out of the fragment", () => {
    expect(readHandoffFromUrl("live.rotroyale.app://auth#handoff=abc123")).toEqual({
      code: "abc123",
    });
  });

  it("reads the opaque error the callback sends on failure", () => {
    expect(readHandoffFromUrl("live.rotroyale.app://auth#auth_error=google")).toEqual({
      error: true,
    });
  });

  it("ignores a deep link that carries no fragment", () => {
    // Some other feature's link (a share, a push tap). Returning null leaves it for its owner
    // instead of resolving the sign-in promise on an unrelated URL.
    expect(readHandoffFromUrl("live.rotroyale.app://something-else")).toBeNull();
  });

  it("ignores a fragment that is not ours", () => {
    expect(readHandoffFromUrl("live.rotroyale.app://auth#other=1")).toBeNull();
  });

  it("does NOT read a code from the query string", () => {
    // If a code ever showed up here it would mean the server had put a live credential somewhere
    // that travels in the request line — into access logs, proxies and Referer headers. Refusing to
    // read it keeps this parser from quietly normalising that mistake.
    expect(readHandoffFromUrl("live.rotroyale.app://auth?handoff=abc123")).toBeNull();
  });

  it("takes the fragment even when the path differs", () => {
    // iOS delivers the URL verbatim; the app must not depend on an exact path match to find its
    // own return, or a trailing slash from the redirect chain would silently break sign-in.
    expect(readHandoffFromUrl("live.rotroyale.app://auth/#handoff=xyz")).toEqual({ code: "xyz" });
  });

  it("handles an empty or malformed url without throwing", () => {
    expect(readHandoffFromUrl("")).toBeNull();
    expect(readHandoffFromUrl("#")).toBeNull();
  });
});
