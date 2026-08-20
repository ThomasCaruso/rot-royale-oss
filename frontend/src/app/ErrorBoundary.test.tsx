// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): React.ReactElement {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React logs the caught error itself; silence it so a PASSING test isn't noisy red.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>the game</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("the game")).toBeTruthy();
  });

  it("shows a recoverable screen instead of unmounting to a blank page", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // The specific guarantee: the player is never left with an empty document and no way out.
    expect(screen.getByText("Something broke")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
