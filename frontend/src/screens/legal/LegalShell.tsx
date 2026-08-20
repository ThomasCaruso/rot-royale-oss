import { useEffect } from "react";
import { DEFAULT_THEME_ID, getTheme } from "@/theme/tokens";

const FOOTER_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/support", label: "Support" },
] as const;

export function LegalShell({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const theme = getTheme(DEFAULT_THEME_ID);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.vars)) {
      root.style.setProperty(k, v);
    }
  }, []);

  return (
    <div className="rr-root s-arcade" style={{ minHeight: "100dvh" }}>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 680,
          margin: "0 auto",
          padding:
            "calc(env(safe-area-inset-top) + 16px) 24px calc(env(safe-area-inset-bottom) + 56px)",
        }}
      >
        <nav style={{ paddingBottom: 16 }}>
          <a
            href="/"
            style={{
              // 44px min height + negative side margin: the tap target reaches the platform
              // guideline without the label visually shifting away from the page edge.
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              gap: 6,
              padding: "0 10px",
              margin: "0 -10px",
              color: "var(--amber)",
              fontWeight: 800,
              fontSize: 15,
              textDecoration: "none",
              letterSpacing: 0.3,
            }}
          >
            ← Home
          </a>
        </nav>

        <h1
          className="display"
          style={{
            fontSize: 30,
            color: "var(--amber)",
            marginBottom: lastUpdated ? 6 : 28,
          }}
        >
          {title}
        </h1>

        {lastUpdated && (
          <p
            style={{
              fontSize: 13,
              color: "var(--muted)",
              marginBottom: 32,
              fontWeight: 600,
            }}
          >
            Last updated: {lastUpdated}
          </p>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            fontSize: 15,
            lineHeight: 1.75,
            color: "var(--text)",
          }}
        >
          {children}
        </div>

        <div
          style={{
            marginTop: 56,
            paddingTop: 24,
            borderTop: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Footer nav. Each entry is its own 44px tap target (platform guideline) and the page
              you are already on is marked with aria-current rather than being a link to itself. */}
          <nav
            aria-label="Legal"
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              margin: "0 -12px",
            }}
          >
            {FOOTER_LINKS.map(({ href, label }) => {
              const current =
                typeof window !== "undefined" &&
                window.location.pathname === href;
              return (
                <a
                  key={href}
                  href={href}
                  aria-current={current ? "page" : undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: 44,
                    padding: "0 12px",
                    // The current page reads as a label, the others as links you can follow.
                    color: current ? "var(--text)" : "var(--amber)",
                    textDecoration: current ? "none" : "underline",
                    textUnderlineOffset: 3,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: current ? "default" : "pointer",
                  }}
                >
                  {label}
                </a>
              );
            })}
          </nav>
          <p style={{ fontSize: 12, color: "var(--faint)" }}>
            © 2026 Rot Royale
          </p>
        </div>
      </div>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {heading && (
        <h2
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: "var(--brand-2)",
            letterSpacing: 0.3,
            marginBottom: 2,
          }}
        >
          {heading}
        </h2>
      )}
      {children}
    </div>
  );
}
