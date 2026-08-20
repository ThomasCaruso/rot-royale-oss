import { trackFunnel } from "@/lib/analytics";
import type { InAppBrowser } from "@/lib/downloadBrowser";

/**
 * "Play now" — the path that cannot be blocked.
 *
 * It is a plain SAME-ORIGIN link to the app root, which is the whole point: Meta's in-app browsers
 * block the App Store destination outright (confirmed on-device), but they have no reason to
 * interfere with a link to the page's own site. Rot Royale runs in the browser with guest play and
 * no signup, so this drops the visitor straight into today's Daily Royale — one tap, no install, no
 * escape attempt, right where they already are.
 *
 * Rendered once, directly under the App Store button, and it stays there in both states — the
 * blocked notice explains the situation below it rather than repeating the button.
 */
export function PlayNowLink({ browser }: { browser: InAppBrowser }) {
  return (
    <a
      href="/"
      onClick={() => trackFunnel("download_play_now_tap", browser ?? undefined)}
      style={playNow}
    >
      ▶&nbsp; Play now — no download
    </a>
  );
}

/** Off-white outline: clearly available, clearly not competing with the App Store CTA above it. */
const playNow: React.CSSProperties = {
  width: "100%",
  minHeight: 52,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 20px",
  borderRadius: 18,
  background: "color-mix(in srgb, var(--panel) 85%, transparent)",
  border: "1.5px solid color-mix(in srgb, var(--brand) 45%, transparent)",
  color: "var(--brand)",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textDecoration: "none",
};
