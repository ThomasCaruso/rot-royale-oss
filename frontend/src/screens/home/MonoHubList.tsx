/**
 * The mono-surface Home hub. Rows are DATA (the host decides them): before today's Daily Royale
 * is played the list holds Battle/Brain Boost/Friends/Growth; after, the Daily row takes Battle's
 * slot wearing a "Completed today ✓" badge (done rows don't navigate — one attempt per day is the
 * product, not a dead end).
 *
 * Two dressings sharing one row model:
 *  - PREMIUM (a row carries `sub` — the Starter system): four SEPARATE soft feature cards, each
 *    its own glass panel with real breathing room — LEFT a large circular icon container with a
 *    simple feature glyph, CENTER a title + one-line subtitle, RIGHT a prominent contextual
 *    visual (character portraits / illustration / badge) then the chevron. Feature navigation,
 *    not a settings table.
 *  - PLAIN (no `sub` — the Blank pair): the original single grouped card (iOS Settings-style) —
 *    hairline-separated flat rows, bare icon, single label, chevron. Untouched.
 */
import { FitText } from "@/ui/FitText";

export interface MonoHubRow {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** Absent → the row renders as completed/disabled (shows `done` instead of the chevron). */
  onClick?: () => void;
  /** Trailing completed badge text (rendered with a check mark). */
  done?: string;
  /** Tint the icon soft purple (lavender, the Play-button accent) — a gentle featured accent for a
   * row like Your Growth. No badge/circle, just the colour. */
  iconAccent?: boolean;
  /** One-line subtitle under the title — opts the row into the premium (Starter) dressing. */
  sub?: string;
  /** Premium LEFT glyph as bitmap art (the Starter 3D icon set) — rendered inside the circular
   * holder in place of the CSS `icon`. Takes precedence over `icon` in the premium dressing. */
  iconArt?: string;
  /** Contextual right-side visual (character portraits / illustration / badge), rendered before
   * the chevron. Decorative — the row button carries the accessible name. */
  right?: React.ReactNode;
}

export function MonoHubList({ rows }: { rows: MonoHubRow[] }) {
  const premium = rows.some((r) => r.sub != null);

  if (premium) {
    // ONE connected surface — the four feature rows share a single glass card, split by hairline
    // dividers (iOS grouped-list). No inter-card gaps: the rows touch, the card's own generous
    // breathing room does the work — sleeker and more premium than four floating tiles.
    return (
      <section
        className="rr-glass"
        style={{ display: "flex", flexDirection: "column", padding: "2px 22px", overflow: "hidden" }}
      >
        {rows.map((row, i) => {
          const disabled = !row.onClick;
          return (
            <button
              key={row.key}
              type="button"
              className="rr-tap"
              onClick={row.onClick}
              disabled={disabled}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                width: "100%",
                minHeight: 58,
                padding: "7px 0",
                background: "transparent",
                border: "none",
                borderTop: i === 0 ? "none" : "1px solid var(--line)",
                cursor: disabled ? "default" : "pointer",
                textAlign: "left",
                color: "var(--text)",
                fontFamily: "inherit",
              }}
            >
              {/* LEFT: the Starter feature icon. `iconArt` is a self-contained circular medallion
                  (its own cream disc) → render it DIRECTLY, no extra holder disc. Only the CSS-glyph
                  path (e.g. the completed-Daily crown) wears the soft lavender holder. */}
              {row.iconArt ? (
                <img
                  src={row.iconArt}
                  alt=""
                  aria-hidden
                  draggable={false}
                  style={{
                    flex: "none",
                    width: 44,
                    height: 44,
                    objectFit: "contain",
                    display: "block",
                    opacity: disabled ? 0.5 : 1,
                    filter: "drop-shadow(0 2px 5px color-mix(in srgb, var(--brand) 14%, transparent))",
                  }}
                />
              ) : (
                <span
                  aria-hidden
                  style={{
                    // Match the iconArt medallions' EXACT footprint (44×44, flex:none, first child)
                    // so the completed-Daily crown holder is the same size + place as the other rows.
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background:
                      "radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--brand) 10%, var(--panel)) 0%, color-mix(in srgb, var(--brand) 6%, var(--panel2)) 100%)",
                    border: "1px solid color-mix(in srgb, var(--brand) 14%, var(--line))",
                    boxShadow: "inset 0 1px 0 var(--sheen), 0 2px 6px color-mix(in srgb, var(--brand) 8%, transparent)",
                    color: disabled ? "var(--faint)" : "var(--brand)",
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  {row.icon}
                </span>
              )}
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <FitText
                  as="span"
                  size={17.5}
                  min={0.62}
                  style={{
                    fontWeight: 750,
                    lineHeight: 1.15,
                    letterSpacing: "-0.015em",
                    color: disabled ? "var(--muted)" : "var(--text)",
                    width: "100%",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                >
                  {row.label}
                </FitText>
                {row.sub && (
                  <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.35, color: "var(--muted)" }}>
                    {row.sub}
                  </span>
                )}
              </span>
              {row.right && (
                <span aria-hidden style={{ display: "flex", alignItems: "center", flex: "none" }}>
                  {row.right}
                </span>
              )}
              {row.done ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid var(--line)",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--muted)",
                    whiteSpace: "nowrap",
                    flex: "0 1 auto",
                    minWidth: 0,
                  }}
                >
                  <span aria-hidden style={{ color: "var(--lime)", fontSize: 12.5, lineHeight: 1, flex: "none" }}>
                    ✓
                  </span>
                  <FitText as="span" size={12} min={0.66} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
                    {row.done}
                  </FitText>
                </span>
              ) : (
                <span
                  aria-hidden
                  style={{ color: "var(--faint)", fontSize: 20, fontWeight: 500, lineHeight: 1, flex: "none" }}
                >
                  ›
                </span>
              )}
            </button>
          );
        })}
      </section>
    );
  }

  return (
    <section
      className="rr-glass"
      style={{ display: "flex", flexDirection: "column", padding: "4px 20px", overflow: "hidden" }}
    >
      {rows.map((row, i) => {
        const disabled = !row.onClick;
        return (
          <button
            key={row.key}
            type="button"
            onClick={row.onClick}
            disabled={disabled}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              width: "100%",
              minHeight: 62,
              padding: "18px 0",
              background: "transparent",
              border: "none",
              borderTop: i === 0 ? "none" : "1px solid var(--line)",
              cursor: disabled ? "default" : "pointer",
              textAlign: "left",
              color: "var(--text)",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "flex",
                flex: "none",
                color: row.iconAccent ? "var(--brand)" : disabled ? "var(--faint)" : "var(--muted)",
              }}
            >
              {row.icon}
            </span>
            <FitText
              as="span"
              size={16}
              min={0.7}
              style={{
                flex: 1,
                minWidth: 0,
                fontWeight: 600,
                lineHeight: 1.2,
                color: disabled ? "var(--muted)" : "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              {row.label}
            </FitText>
            {row.done ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 11px",
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--muted)",
                  whiteSpace: "nowrap",
                  flex: "0 1 auto",
                  minWidth: 0,
                }}
              >
                <span aria-hidden style={{ color: "var(--lime)", fontSize: 12, lineHeight: 1, flex: "none" }}>
                  ✓
                </span>
                <FitText as="span" size={11.5} min={0.66} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
                  {row.done}
                </FitText>
              </span>
            ) : (
              <span aria-hidden style={{ color: "var(--faint)", fontSize: 17, fontWeight: 500, lineHeight: 1 }}>
                ›
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}
