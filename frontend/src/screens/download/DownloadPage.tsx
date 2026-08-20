import { useEffect } from "react";
import { trackFunnelOnce } from "@/lib/analytics";
import { APP_STORE_URL } from "@/lib/appLinks";
import { STARTER_ART, getTheme } from "@/theme/tokens";
import { Display } from "@/ui/Display";
import { DownloadDiagnostics } from "./DownloadDiagnostics";
import { PlayNowLink } from "./PlayNowLink";
import { useAppDownload } from "./useAppDownload";

/**
 * `https://rotroyale.live/download` — the canonical public acquisition page. This is the link that
 * goes in the Instagram/Facebook/TikTok bio, in DMs, in posts and on QR codes, INSTEAD of a direct
 * App Store link: Meta's in-app browsers sometimes swallow a navigation straight to
 * `apps.apple.com`, and this page knows how to get out of them (see `lib/downloadBrowser`).
 *
 * Deliberately inert: no auth, no session restore, no guest creation, no API reads, no gameplay
 * navigation — a first-time stranger with no Rot Royale session must be able to load it, refresh
 * it, and tap one link. The CTA is a genuine `<a href>` so an ordinary browser follows it with no
 * JavaScript at all.
 *
 * Skinned with Starter — the app's default theme and main visual identity (warm ivory, royal
 * purple, gold, Playfair display face). The page carries no bespoke color: it applies the theme's
 * own vars and its `s-mono` art-style class, so the landing page is the same world a new player
 * lands in after installing.
 */
const DOWNLOAD_THEME = getTheme("starter");

export function DownloadPage() {
  const { handleDownloadClick, blockedNotice, inAppBrowser, debugLog } = useAppDownload();
  const showDiagnostics =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");

  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(DOWNLOAD_THEME.vars)) {
      root.style.setProperty(key, value);
    }
  }, []);

  useEffect(() => {
    trackFunnelOnce("download_page_view");
  }, []);

  return (
    <div className={`rr-root s-${DOWNLOAD_THEME.style}`} style={{ minHeight: "100dvh" }}>
      <main style={shell}>
        <img
          src={STARTER_ART.logo}
          alt=""
          aria-hidden
          draggable={false}
          width={120}
          height={120}
          style={{ width: 120, height: 120, objectFit: "contain", display: "block" }}
        />

        <Display as="h1" gold pop style={wordmark}>
          Rot Royale
        </Display>

        <p style={tagline}>8 questions. One shot a day.</p>

        {/* A real anchor, always — and never intercepted. On iOS a genuine tap on this link is
            what triggers the Universal Link into the App Store app; a scripted navigation is not.
            `handleDownloadClick` fires telemetry and (inside a Meta WebView) arms a silent
            watchdog, but it never calls preventDefault. */}
        <a href={APP_STORE_URL} onClick={handleDownloadClick} style={cta}>
          Download on the App Store
        </a>

        {/* The second way in, directly under the first, in both states. No explanation attached —
            if the App Store tap works, the visitor never needs to know Meta blocks anything. */}
        <PlayNowLink browser={inAppBrowser} />

        <p style={platformNote}>Available on iPhone</p>

        {/* Appears ONLY after a Download tap has visibly gone nowhere. */}
        {blockedNotice}

        {showDiagnostics && <DownloadDiagnostics log={debugLog} />}
      </main>
    </div>
  );
}

const shell: React.CSSProperties = {
  position: "relative",
  zIndex: 1,
  minHeight: "100dvh",
  width: "100%",
  maxWidth: 430,
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 14,
  textAlign: "center",
  padding: "calc(env(safe-area-inset-top) + 32px) 24px calc(env(safe-area-inset-bottom) + 32px)",
};

const wordmark: React.CSSProperties = {
  fontSize: "clamp(34px, 11vw, 44px)",
  lineHeight: 1.05,
  margin: 0,
};

const tagline: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: "var(--muted)",
};

/**
 * The primary CTA — Starter's signature royal-purple plaque, matching the app's own marquee
 * control (MonoDailyCard's "ENTER DAILY ROYALE"): the `--cta` gradient under a specular top gloss,
 * uppercase Manrope at 0.08em, a soft brand lift and a quiet inner press.
 *
 * Written as styles on an anchor rather than reusing GoldButton because GoldButton renders a
 * `<button>`, and this must stay a real `<a href>` so ordinary browsers navigate natively.
 */
const cta: React.CSSProperties = {
  marginTop: 14,
  marginBottom: -4, // pulls Play now up so the two read as one pair of choices
  width: "100%",
  minHeight: 56,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "15px 22px",
  borderRadius: 18,
  background:
    "linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,0) 46%), var(--cta)",
  color: "var(--ctaText)",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textDecoration: "none",
  boxShadow:
    "0 12px 26px color-mix(in srgb, var(--brand) 30%, transparent), 0 2px 6px color-mix(in srgb, var(--brand) 22%, transparent), inset 0 2px 0 rgba(255,255,255,.30), inset 0 -4px 9px rgba(0,0,0,.18)",
};

const platformNote: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 0.4,
  // --muted, not --faint: on Starter's ivory field --faint is a whisper tone meant for tertiary
  // lines, and this one has to stay legible in daylight on a phone.
  color: "var(--muted)",
};

