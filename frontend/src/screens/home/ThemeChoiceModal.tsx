import { useState } from "react";
import { api } from "@/api/client";
import { useT } from "@/i18n/useT";
import { useSessionStore } from "@/store/session";
import { getTheme } from "@/theme/tokens";
import { Display } from "@/ui/Display";
import { GoldButton } from "@/ui/GoldButton";

/**
 * First-login "pick your look" popup — a one-time modal (Home gates it with a device flag) that
 * previews the two default free themes with REAL app screenshots (public/assets/theme-previews/*,
 * captured from the running app in each theme) and lets the player equip one. Both themes are
 * free/implicitly-owned, so the equip always succeeds; on any hiccup we still dismiss (never trap
 * the player) and keep whatever's equipped. Styled to match the UnlockReveal earn-moment so
 * first-open feels premium, not SaaS.
 */
const CHOICES = ["starter", "blank_light"] as const;

export function ThemeChoiceModal({ onDone }: { onDone: () => void }) {
  const t = useT();
  const me = useSessionStore((s) => s.me);
  const setMe = useSessionStore((s) => s.setMe);
  const current = me?.equipped_theme;
  const [selected, setSelected] = useState<string>(
    current && (CHOICES as readonly string[]).includes(current) ? current : "starter",
  );
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      if (me && selected !== me.equipped_theme) {
        const res = await api.equipVaultItem(selected);
        setMe({ ...me, equipped_theme: res.equipped_theme });
      }
    } catch {
      // best-effort — keep whatever's equipped; the popup never blocks entry to the app.
    } finally {
      onDone();
    }
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.themeChoice.title}>
      <div className="rr-splash-in" style={card}>
        <Display gold className="rr-pop" style={{ fontSize: 28, textAlign: "center", lineHeight: 1.05 }}>
          {t.themeChoice.title}
        </Display>
        <p style={sub}>{t.themeChoice.sub}</p>

        <div style={{ display: "flex", gap: 12, width: "100%" }}>
          {CHOICES.map((id) => {
            const theme = getTheme(id);
            const isSel = selected === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelected(id)}
                aria-pressed={isSel}
                style={choiceCard(isSel)}
              >
                <img
                  // ?v=3 — these live in public/, which Vite does not content-hash, so a re-exported
                  // file keeps serving stale bytes to anyone who already fetched it (docs/architecture.md §13).
                  // Bumped when the previews were resized to 3× their render size; NOT bumped for the
                  // move to .webp, because changing the extension already changes the URL.
                  //
                  // This path is BUILT FROM A VARIABLE, which is why it is the one reference the
                  // automated .webp retarget could not resolve — it matches no file on disk to check
                  // against. A stale extension here would not fail the build; it would 404 silently
                  // at runtime. `CHOICES` above is the whole set, and both files exist as .webp.
                  src={`/assets/theme-previews/${id}.webp?v=3`}
                  alt=""
                  aria-hidden
                  draggable={false}
                  style={{
                    width: "100%",
                    height: 168,
                    objectFit: "cover",
                    objectPosition: "top center",
                    borderRadius: 12,
                    border: "1px solid var(--line)",
                    display: "block",
                  }}
                />
                <div style={themeLabel(isSel)}>
                  <span
                    aria-hidden
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      flex: "none",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      fontWeight: 900,
                      color: isSel ? "var(--ctaText)" : "transparent",
                      background: isSel ? "var(--amber)" : "transparent",
                      border: isSel ? "none" : "1.5px solid var(--line)",
                    }}
                  >
                    ✓
                  </span>
                  {theme.name}
                </div>
              </button>
            );
          })}
        </div>

        <GoldButton onClick={confirm} disabled={busy}>
          {busy ? t.themeChoice.applying : t.themeChoice.confirm}
        </GoldButton>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 110,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "clamp(16px, 5vw, 28px)",
  background: "rgba(6,3,16,.72)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
};

const card: React.CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: 400,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  padding: "24px 18px 18px",
  borderRadius: 24,
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--panel2) 92%, var(--brand)), color-mix(in srgb, var(--panel) 94%, black))",
  border: "1.5px solid color-mix(in srgb, var(--amber) 55%, transparent)",
  boxShadow:
    "0 30px 70px rgba(0,0,0,.6), 0 0 40px color-mix(in srgb, var(--amber) 24%, transparent), inset 0 1px 0 rgba(255,255,255,.1)",
};

const sub: React.CSSProperties = {
  margin: 0,
  fontSize: 13.5,
  lineHeight: 1.4,
  textAlign: "center",
  color: "var(--muted)",
};

function choiceCard(selected: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 8,
    borderRadius: 16,
    cursor: "pointer",
    background: "color-mix(in srgb, var(--panel) 78%, transparent)",
    border: selected
      ? "2px solid var(--amber)"
      : "2px solid color-mix(in srgb, var(--brand-2) 26%, var(--line))",
    boxShadow: selected ? "0 0 20px color-mix(in srgb, var(--amber) 30%, transparent)" : "none",
    transition: "border-color 140ms, box-shadow 140ms",
  };
}

function themeLabel(selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    fontSize: 13.5,
    fontWeight: 800,
    color: selected ? "var(--text)" : "var(--muted)",
  };
}
