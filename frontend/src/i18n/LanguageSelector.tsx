import { useEffect, useRef, useState } from "react";
import { LOCALES } from "@/i18n";
import { useT } from "@/i18n/useT";
import { useI18n } from "@/store/i18n";

/**
 * Language selector. `floating` pins it to the top-right corner of the viewport (used on every
 * screen except Home, which renders an `inline` one inside its header). A compact flag+code chip
 * opens a themed dropdown of the three languages; the active one is gold-checked.
 */
export function LanguageSelector({ variant = "floating" }: { variant?: "floating" | "inline" }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const wrap: React.CSSProperties =
    variant === "floating"
      ? {
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 10px)",
          right: 12,
          zIndex: 50,
        }
      : { position: "relative" };

  return (
    <div ref={ref} style={wrap}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t.lang.select}: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        // rr-menu-chip: the mono ("Blank") skins flatten this to a hairline panel chip via CSS.
        // rr-grow: the same cursor affordance as every other control on the screens this chip
        // appears over (it renders on every UNAUTHENTICATED screen, so its blast radius is the
        // front door, sign-in and the legal pages — all of which now answer the cursor the same way).
        className="rr-menu-chip rr-grow"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 36,
          padding: "0 10px",
          borderRadius: 999,
          cursor: "pointer",
          background: "linear-gradient(180deg, rgba(45,20,90,.92), rgba(24,11,48,.92))",
          border: "1px solid var(--line)",
          color: "var(--text)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.06)",
        }}
      >
        <span aria-hidden className="emoji" style={{ fontSize: 15 }}>
          {current.flag}
        </span>
        {/* Floating has room for the 2-letter code; inline (Home header) stays flag-only to fit 360px. */}
        {variant === "floating" && (
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5 }}>{current.short}</span>
        )}
        <span aria-hidden style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t.lang.select}
          // rr-menu: shared popup surface — the mono skins restyle it to frosted liquid glass.
          className="rr-menu"
          style={{
            position: "absolute",
            top: 42,
            right: 0,
            zIndex: 60, // above page content (e.g. the Home hero card) when rendered inline
            minWidth: 168,
            padding: 6,
            borderRadius: 14,
            background: "linear-gradient(180deg, var(--panel2), var(--panel))",
            border: "1px solid var(--line)",
            boxShadow: "0 18px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {LOCALES.map((l) => {
            const active = l.code === locale;
            return (
              <button
                key={l.code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setLocale(l.code);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "9px 11px",
                  borderRadius: 10,
                  cursor: "pointer",
                  border: "none",
                  textAlign: "left",
                  // Token-driven active tint (gold on classic themes, quiet ink on the mono skins).
                  background: active ? "color-mix(in srgb, var(--amber) 14%, transparent)" : "transparent",
                  color: active ? "var(--amber)" : "var(--text)",
                  fontWeight: active ? 800 : 600,
                  fontSize: 14,
                }}
              >
                <span aria-hidden className="emoji" style={{ fontSize: 17 }}>
                  {l.flag}
                </span>
                <span style={{ flex: 1 }}>{l.label}</span>
                {active && (
                  <span aria-hidden style={{ color: "var(--amber)" }}>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
