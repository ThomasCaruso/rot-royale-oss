/**
 * Avatar render-state tests (static markup, node env — same pattern as VaultScreen.test.tsx).
 * The critical invariant: with NO new props the Avatar renders exactly as it did before the
 * identity feature (ninja emoji, legacy gradient, plain 2px ring, no ornament, no pulse class).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar } from "./Avatar";
import { FRAME_STYLES, getPreset } from "@/theme/identity";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

describe("Avatar — backward compatibility (no new props)", () => {
  it("default render is the knight portrait disc: image, tinted gradient, plain ring, no frame layers", () => {
    const html = renderToStaticMarkup(<Avatar />);
    expect(html).toContain("/avatars/portraits/knight.png?v=2"); // the default portrait
    expect(html).toContain(getPreset("knight").bg); // disc still tints behind the portrait
    expect(html).toContain("2px solid var(--line)");
    expect(html).not.toContain("rr-glow-pulse");
    expect(html).not.toContain("👑");
    expect(html).not.toContain("border-box"); // no frame ring layer
  });

  it("the ring prop still styles the border when no frame is present (isMe-gold rows)", () => {
    const html = renderToStaticMarkup(<Avatar ring="var(--amber)" />);
    expect(html).toContain("2px solid var(--amber)");
  });

  it("online dot renders as before", () => {
    const withDot = renderToStaticMarkup(<Avatar online />);
    expect(withDot).toContain("#43e35f");
    const without = renderToStaticMarkup(<Avatar />);
    expect(without).not.toContain("#43e35f");
  });
});

describe("Avatar — presets", () => {
  it("renders the requested preset's portrait and disc gradient", () => {
    const html = renderToStaticMarkup(<Avatar preset="bishop" />);
    expect(html).toContain("/avatars/portraits/bishop.png?v=2");
    expect(html).toContain(getPreset("bishop").bg);
    expect(html).not.toContain("/avatars/portraits/knight.png?v=2");
  });

  it("unknown preset falls back to the default portrait (server ids only — never a broken disc)", () => {
    const html = renderToStaticMarkup(<Avatar preset="zebra" />);
    expect(html).toContain("/avatars/portraits/knight.png?v=2");
    expect(html).toContain(getPreset("knight").bg);
  });
});

describe("Avatar — frames", () => {
  it("a frame replaces the plain ring with its gradient ring (border-box layer)", () => {
    const html = renderToStaticMarkup(<Avatar frame="bronze_ring" ring="var(--brand)" />);
    expect(html).toContain("border-box");
    expect(html).toContain("#e8a96b"); // bronze ring gradient
    expect(html).toContain("solid transparent");
    expect(html).not.toContain("solid var(--brand)"); // frame wins over the ring prop
  });

  it("glow joins the box-shadow; ornament emoji renders aria-hidden at the top edge", () => {
    const html = renderToStaticMarkup(<Avatar frame="gold_crown" />);
    expect(html).toContain("👑");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("255,201,30"); // gold glow
  });

  it("frame=null and frame=frame_none render exactly like no frame", () => {
    const plain = renderToStaticMarkup(<Avatar />);
    expect(renderToStaticMarkup(<Avatar frame={null} />)).toBe(plain);
    expect(renderToStaticMarkup(<Avatar frame="frame_none" />)).toBe(plain);
  });

  it("unknown frame id is ignored safely (renders plain)", () => {
    expect(renderToStaticMarkup(<Avatar frame="mystery_frame" />)).toBe(
      renderToStaticMarkup(<Avatar />),
    );
  });

  it("prestige frame (crowned_scholar) gets the dual ring, crown and the glow-pulse class", () => {
    const html = renderToStaticMarkup(<Avatar frame="crowned_scholar" />);
    expect(html).toContain("rr-glow-pulse"); // decorative; collapsed by global reduced-motion rule
    expect(html).toContain("👑");
    expect(html).toContain("conic-gradient");
    expect(html).toContain("#a855f7");
  });

  it("animated={false} drops the prestige pulse but keeps the static glow + ring (row lists)", () => {
    const html = renderToStaticMarkup(<Avatar frame="crowned_scholar" animated={false} />);
    expect(html).not.toContain("rr-glow-pulse"); // zero animation in scroll-heavy lists
    expect(html).toContain("conic-gradient"); // dual ring still reads
    expect(html).toContain("255,201,30"); // static gold glow remains in the box-shadow
    expect(html).toContain("👑");
  });

  it("preset + frame compose: the disc gradient and the ring gradient are both present", () => {
    const html = renderToStaticMarkup(<Avatar preset="rook" frame="violet_glow" />);
    expect(html).toContain("/avatars/portraits/rook.png?v=2");
    expect(html).toContain(getPreset("rook").bg);
    const ring = FRAME_STYLES.violet_glow.ring as string;
    expect(html).toContain(ring.slice(0, 30));
  });
});
