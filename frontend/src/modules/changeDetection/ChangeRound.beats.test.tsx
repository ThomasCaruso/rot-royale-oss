// @vitest-environment jsdom
/**
 * The titled beats that announce each frame. The player used to be shown two pictures with nothing
 * naming them and had to work out which was which from the image changing under them.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({ api: { cogChangeSubmit: vi.fn() } }));
vi.mock("@/lib/sfx", () => ({ haptic: vi.fn() }));

import { ChangeRound } from "./ChangeRound";

const LABEL = 900;
const BASE = 5000;
const ALTERED = 8000;

const spec = {
  cognition_instance_id: "i1",
  base_url: "/b.jpg",
  altered_url: "/a.jpg",
  width: 1024,
  height: 683,
  flicker_base_ms: BASE,
  flicker_altered_ms: ALTERED,
  flicker_blank_ms: 80,
  flicker_label_ms: LABEL,
  time_limit_ms: 30000,
};

/** Images never decode in jsdom, so the round starts via its own load-timeout cap. */
function startRound() {
  const view = render(<ChangeRound spec={spec} onComplete={() => {}} />);
  act(() => {
    vi.advanceTimersByTime(4000);
  });
  return view;
}

describe("ChangeRound — frame announcements", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces the FIRST image before showing it", () => {
    const { container } = startRound();
    expect(container.textContent).toContain("First image");
    // The picture must not be up yet — the announcement leads the frame it names.
    const visible = [...container.querySelectorAll("img")].filter(
      (im) => (im as HTMLImageElement).style.visibility === "visible",
    );
    expect(visible).toHaveLength(0);
  });

  it("shows the base image once the beat has passed", () => {
    const { container } = startRound();
    act(() => {
      vi.advanceTimersByTime(LABEL + 50);
    });
    expect(container.textContent).not.toContain("First image ");
    const visible = [...container.querySelectorAll("img")].filter(
      (im) => (im as HTMLImageElement).style.visibility === "visible",
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].getAttribute("src")).toBe("/b.jpg");
  });

  it("announces the SECOND image before showing it", () => {
    const { container } = startRound();
    act(() => {
      vi.advanceTimersByTime(LABEL + BASE + 50);
    });
    expect(container.textContent).toContain("Second image");
    const visible = [...container.querySelectorAll("img")].filter(
      (im) => (im as HTMLImageElement).style.visibility === "visible",
    );
    expect(visible).toHaveLength(0);
  });

  it("then shows the altered image", () => {
    const { container } = startRound();
    act(() => {
      vi.advanceTimersByTime(LABEL + BASE + LABEL + 50);
    });
    const visible = [...container.querySelectorAll("img")].filter(
      (im) => (im as HTMLImageElement).style.visibility === "visible",
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].getAttribute("src")).toBe("/a.jpg");
  });

  it("falls back to the bare wipe when the server sends no label duration", () => {
    // A round plan pinned before the beat existed has no flicker_label_ms. It must still play.
    const legacy = { ...spec };
    delete (legacy as Partial<typeof spec>).flicker_label_ms;
    const { container } = render(<ChangeRound spec={legacy} onComplete={() => {}} />);
    // Two steps: the flicker only arms AFTER the load cap flips `ready`, so a single advance would
    // run the wipe's timer before the effect that scheduled it existed.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(container.textContent).not.toContain("First image"); // no unreadable 80ms flash
    act(() => {
      vi.advanceTimersByTime(80 + 50);
    });
    const visible = [...container.querySelectorAll("img")].filter(
      (im) => (im as HTMLImageElement).style.visibility === "visible",
    );
    expect(visible).toHaveLength(1); // straight into the base frame after an 80ms wipe
  });
});
