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
    // "First image" now appears TWICE when a beat is drawn: once in the countdown row (which is
    // present-but-hidden so the card never changes height) and once as the beat itself. A legacy
    // 80ms wipe must not draw the beat — a word flashed for 80ms is noise, not an announcement —
    // so the row's single occurrence is the only one there should be.
    expect((container.textContent?.match(/First image/g) ?? []).length).toBe(1);
    act(() => {
      vi.advanceTimersByTime(80 + 50);
    });
    const visible = [...container.querySelectorAll("img")].filter(
      (im) => (im as HTMLImageElement).style.visibility === "visible",
    );
    expect(visible).toHaveLength(1); // straight into the base frame after an 80ms wipe
  });
});

describe("ChangeRound — the card must not change size", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * The countdown row used to be unmounted during each announcement beat, so the card shrank ~35px
   * and grew back a second later — twice per flicker cycle. On a round whose entire mechanic is
   * noticing that something moved, the frame around the picture was the most animated thing on
   * screen. It is now hidden rather than removed, so its box is always reserved.
   */
  function row(container: HTMLElement): HTMLElement | undefined {
    return [...container.querySelectorAll<HTMLElement>("div")].find((d) =>
      d.style.visibility === "hidden" || d.style.visibility === "visible",
    );
  }

  it("keeps the countdown row's space reserved during the announcement beat", () => {
    const { container } = startRound();
    // Mid-beat: the row is hidden, but still in the layout.
    const during = row(container);
    expect(during).toBeTruthy();
    expect(during!.style.visibility).toBe("hidden");

    act(() => {
      vi.advanceTimersByTime(LABEL + 50);
    });
    // Frame showing: the same element, now visible. Present in BOTH states is the whole point.
    const showing = row(container);
    expect(showing).toBeTruthy();
    expect(showing!.style.visibility).toBe("visible");
  });

  it("bleeds the picture past the card's padding", () => {
    // The picture is the round; it was being drawn inside 20px of padding on each side.
    const { container } = startRound();
    const frame = [...container.querySelectorAll<HTMLElement>("div")].find((d) =>
      d.style.aspectRatio,
    );
    expect(frame).toBeTruthy();
    expect(frame!.style.margin).toContain("var(--pad-card");
  });
});
