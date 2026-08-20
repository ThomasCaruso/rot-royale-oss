// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Avatar } from "./Avatar";
import { getFrame } from "@/theme/identity";
import { useSessionStore } from "@/store/session";
import { DEFAULT_THEME_ID, THEMES } from "@/theme/tokens";

/**
 * An equipped frame must appear wherever the player's avatar appears.
 *
 * Pinned because it silently broke once and stayed broken across the whole app. Starter adopted
 * `style: "mono"` for its calm surface language, which dropped the ENTIRE Starter system into
 * `Avatar`'s art-less line-art branch — a plain hairline ring that discards the frame. The portrait
 * still rendered, so it read as a design choice rather than a bug, and the only screens showing a
 * frame were the two that passed an opt-in `fullIdentity` prop. Nine call sites did not, including
 * the Home header.
 *
 * The rule encoded here: a frame is earned merchandise, so rendering it is the Avatar's job and must
 * never depend on a call site remembering a prop.
 *
 * NB these render through jsdom, NOT `renderToStaticMarkup`. Under react-dom/server zustand v5 reads
 * `getInitialState()` rather than the live store (see the note in theme/useArtStyle.ts), so priming
 * `equipped_theme` has no effect there and every case would silently render as the DEFAULT theme —
 * the assertions would pass while testing nothing.
 */

const FRAMED = { preset: "knight", frame: "gold_crown" } as const;

/** Line-art is the art-less Blank pair's identity, and theirs alone. */
const LINE_ART = THEMES.filter((t) => t.style === "mono" && t.art == null).map((t) => t.id);
/** Everything else must show the frame — the Starter system AND the arcade Rot Champion. */
const FRAMES_SHOWN = THEMES.filter((t) => !LINE_ART.includes(t.id)).map((t) => t.id);

function paint(themeId: string, props: Partial<typeof FRAMED> & { ring?: string } = {}) {
  useSessionStore.setState({ me: { equipped_theme: themeId } } as never);
  const { container } = render(<Avatar {...FRAMED} {...props} />);
  return container.innerHTML;
}

afterEach(() => {
  cleanup();
  useSessionStore.setState({ me: null } as never);
});

describe("Avatar — an equipped frame renders wherever the avatar does", () => {
  it("splits the whole catalog between the two cases, and the default theme shows frames", () => {
    expect([...FRAMES_SHOWN, ...LINE_ART].sort()).toEqual(THEMES.map((t) => t.id).sort());
    expect(LINE_ART).toEqual(["blank", "blank_light"]);
    expect(FRAMES_SHOWN).toContain(DEFAULT_THEME_ID);
  });

  it.each(FRAMES_SHOWN)("%s paints the frame's ring gradient and ornament", (themeId) => {
    const f = getFrame(FRAMED.frame)!;
    expect(f.ring, "fixture must use a frame that HAS a ring").toBeTruthy();
    expect(f.ornament, "fixture must use a frame that HAS an ornament").toBeTruthy();
    const html = paint(themeId);
    // The ring gradient is painted into the BORDER box — its presence proves the frame rendered
    // rather than the plain `ring` fallback border.
    expect(html).toContain("border-box");
    expect(html).toContain(f.ornament!);
  });

  it.each(LINE_ART)("%s keeps its frozen art-less line-art identity", (themeId) => {
    const html = paint(themeId);
    expect(html).not.toContain("border-box");
    expect(html).not.toContain(getFrame(FRAMED.frame)!.ornament!);
  });

  it("falls back to the plain ring colour when nothing is equipped", () => {
    const html = paint(DEFAULT_THEME_ID, { frame: null as never, ring: "rgb(1, 2, 3)" });
    expect(html).toContain("rgb(1, 2, 3)");
    expect(html).not.toContain("border-box");
  });
});
