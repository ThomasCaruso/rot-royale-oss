import { useCallback, useRef, useState } from "react";
import { trackFunnel } from "@/lib/analytics";
import { APP_STORE_URL } from "@/lib/appLinks";
import type { InAppBrowser } from "@/lib/downloadBrowser";

const APP_NAME: Record<NonNullable<InAppBrowser>, string> = {
  instagram: "Instagram",
  threads: "Threads",
  facebook: "Facebook",
  messenger: "Messenger",
};

/**
 * Shown ONLY after a Download tap has demonstrably gone nowhere — never on arrival.
 *
 * The front screen stays two buttons and nothing else. Explaining Meta's block to someone whose
 * tap might be about to work is noise; explaining it the moment their tap visibly fails is the
 * answer to the question they are already asking.
 *
 * A device trace (Instagram 440, iOS 26) showed the App Store link and all three escape schemes
 * firing with not one lifecycle signal coming back, and the plain `<a href>` never navigating
 * either — so when this renders, the App Store really is unreachable from here. It does NOT repeat
 * the Play now button: that already sits directly under Download and stays put. This just names
 * what happened and spells out the ••• route for anyone who still wants the native app.
 */
export function AppStoreBlockedNotice({ browser }: { browser: NonNullable<InAppBrowser> }) {
  const linkFieldRef = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");

  const copyLink = useCallback(() => {
    void copyText(APP_STORE_URL, linkFieldRef.current).then((ok) => {
      if (ok) trackFunnel("download_link_copied");
      setCopyState(ok ? "copied" : "manual");
    });
  }, []);

  return (
    <div role="status" aria-live="polite" style={panel} className="rr-splash-in">
      <p style={lead}>{APP_NAME[browser]} blocks App Store links.</p>

      <p style={aside}>
        Play now above works right here. Want the app instead? Tap <strong style={strong}>•••</strong> at the top, choose{" "}
        <strong style={strong}>Open in browser</strong>, then tap Download there.
      </p>

      {/* Off-screen until needed: the legacy copy path needs a real focusable field holding the
          text, and it doubles as a manual selection target if every clipboard route is blocked. */}
      <input
        ref={linkFieldRef}
        readOnly
        value={APP_STORE_URL}
        aria-label="App Store link"
        onFocus={(e) => e.currentTarget.select()}
        style={copyState === "manual" ? visibleField : hiddenField}
      />

      <button type="button" onClick={copyLink} style={secondary}>
        {copyState === "copied"
          ? "Link copied"
          : copyState === "manual"
            ? "Select and copy the link above"
            : "Copy the App Store link"}
      </button>
    </div>
  );
}

/**
 * Copy with a legacy fallback. `navigator.clipboard` is unavailable or permission-blocked in
 * several in-app WebViews — exactly the environment this panel exists for — so on any failure we
 * select the read-only field and try the synchronous `execCommand("copy")` path. If even that is
 * gone the field is revealed with its text selected, which is still a usable manual path.
 */
async function copyText(value: string, field: HTMLInputElement | null): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to the selection path
    }
  }
  if (field) {
    try {
      field.focus();
      field.setSelectionRange(0, value.length);
      field.select();
      const legacyCopy = document.execCommand as ((command: string) => boolean) | undefined;
      if (legacyCopy && legacyCopy.call(document, "copy")) return true;
    } catch {
      // fall through — the field is revealed and selected, so it can still be copied by hand
    }
  }
  return false;
}

const panel: React.CSSProperties = {
  width: "100%",
  marginTop: 20,
  paddingTop: 18,
  borderTop: "1px solid var(--line)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
};

const lead: React.CSSProperties = {
  margin: 0,
  fontSize: 13.5,
  lineHeight: 1.5,
  fontWeight: 700,
  color: "var(--muted)",
};

const strong: React.CSSProperties = { color: "var(--muted)", fontWeight: 800 };

const aside: React.CSSProperties = {
  margin: 0,
  maxWidth: 320,
  fontSize: 12,
  lineHeight: 1.55,
  color: "var(--faint)",
};

const secondary: React.CSSProperties = {
  minHeight: 40,
  padding: "0 12px",
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  fontFamily: "inherit",
  fontSize: 12.5,
  fontWeight: 700,
  textDecoration: "underline",
  textUnderlineOffset: 3,
  cursor: "pointer",
};

const hiddenField: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  border: "none",
  opacity: 0,
  pointerEvents: "none",
};

const visibleField: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--panel2)",
  color: "var(--muted)",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 600,
};
