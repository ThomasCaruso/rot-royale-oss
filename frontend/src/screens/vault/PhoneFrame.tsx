import type { ReactNode } from "react";

/**
 * A phone-shaped bezel for the Vault's theme previews.
 *
 * Pure CSS — no device image to keep in sync, and it re-colours with the surface it sits on. Three
 * parts, all derived from `width` so one component serves the 96px grid tile and the bigger featured
 * panel: the rounded titanium-ish bezel, the screen it clips, and the dynamic-island pill.
 *
 * The point is scale-reading: a theme screenshot floating in a rounded rectangle looks like a UI
 * mock, but the same screenshot inside a phone silhouette reads instantly as "this is what your app
 * will look like". The shots are captured full-page, so the whole screen is visible rather than a
 * cropped strip — which is only legible BECAUSE the frame tells you how to read it.
 */
export function PhoneFrame({
  width,
  aspect = 390 / 844,
  children,
}: {
  /** Outer bezel width in px; everything else scales from it. */
  width: number;
  /** Screen aspect (w/h). Defaults to a real iPhone's 390/844. */
  aspect?: number;
  children: ReactNode;
}) {
  const bezel = Math.max(2, Math.round(width * 0.026));
  const radius = Math.round(width * 0.155);
  const screenW = width - bezel * 2;
  const screenH = Math.round(screenW / aspect);
  const island = Math.round(width * 0.30);

  return (
    <span
      aria-hidden
      style={{
        display: "block",
        position: "relative",
        width,
        padding: bezel,
        borderRadius: radius,
        // A dark rim with a hairline light edge — enough to read as hardware without becoming a
        // decorative object competing with the artwork inside it.
        background: "linear-gradient(160deg, #3A3550, #17141F 46%, #2A2536)",
        boxShadow:
          "0 1px 2px rgba(24,18,40,.30), 0 8px 18px rgba(24,18,40,.18), inset 0 0 0 1px rgba(255,255,255,.10)",
        flex: "none",
      }}
    >
      <span
        style={{
          display: "block",
          position: "relative",
          width: screenW,
          height: screenH,
          borderRadius: Math.round(radius - bezel * 0.9),
          overflow: "hidden",
          background: "#000",
        }}
      >
        {children}
        {/* Dynamic island. Sits ON the screen, as on the real device. */}
        <span
          style={{
            position: "absolute",
            top: Math.max(2, Math.round(width * 0.022)),
            left: "50%",
            transform: "translateX(-50%)",
            width: island,
            height: Math.max(3, Math.round(width * 0.055)),
            borderRadius: 999,
            background: "#0B0910",
          }}
        />
      </span>
    </span>
  );
}
