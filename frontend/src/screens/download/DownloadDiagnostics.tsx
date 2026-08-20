import { APP_STORE_URL } from "@/lib/appLinks";
import { detectInAppBrowser, planEscapes } from "@/lib/downloadBrowser";

/**
 * On-device diagnostics for `/download?debug=1`.
 *
 * This exists because two rounds of reasoning about Instagram's WebView from a laptop produced two
 * wrong fixes. The only way to know what that WebView actually does is to read it off the phone
 * that is in it. Everything here renders locally — nothing is uploaded, logged or beaconed.
 *
 * Hidden unless the query parameter is present, so a normal visitor never sees it.
 */
export function DownloadDiagnostics({ log }: { log: string[] }) {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const detected = detectInAppBrowser();
  const plan = planEscapes(APP_STORE_URL);

  const rows: [string, string][] = [
    ["build", BUILD_STAMP],
    ["detected", detected ?? "none (ordinary browser)"],
    ["platform", plan?.platform ?? "—"],
    ["rungs", plan ? plan.attempts.map((a) => a.kind).join(" → ") : "none (anchor only)"],
    ["href", APP_STORE_URL],
  ];

  return (
    <div style={panel}>
      <p style={heading}>Diagnostics</p>
      {rows.map(([k, v]) => (
        <p key={k} style={row}>
          <span style={key}>{k}</span>
          <span style={value}>{v}</span>
        </p>
      ))}
      <p style={row}>
        <span style={key}>user agent</span>
        <span style={{ ...value, wordBreak: "break-all" }}>{ua}</span>
      </p>
      <p style={{ ...heading, marginTop: 10 }}>Trace</p>
      {log.length === 0 ? (
        <p style={value}>— tap Download, then read this list —</p>
      ) : (
        log.map((line, i) => (
          <p key={i} style={value}>
            {i + 1}. {line}
          </p>
        ))
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  width: "100%",
  marginTop: 22,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--panel2)",
  textAlign: "left",
};

const heading: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--brand)",
};

const row: React.CSSProperties = {
  margin: "0 0 4px",
  display: "flex",
  gap: 8,
  fontSize: 11,
  lineHeight: 1.45,
};

const key: React.CSSProperties = {
  flex: "0 0 74px",
  color: "var(--faint)",
  fontWeight: 700,
};

const value: React.CSSProperties = {
  margin: 0,
  flex: 1,
  minWidth: 0,
  fontSize: 11,
  lineHeight: 1.45,
  color: "var(--muted)",
  fontWeight: 600,
};
