import type { PendingUnlock } from "@/api/client";
import { lobbyArt } from "@/assets/lobby";
import { fmt, useT } from "@/i18n/useT";
import { Avatar } from "@/screens/home/Avatar";
import { ThemePreview } from "@/screens/vault/ThemePreview";
import { useSessionStore } from "@/store/session";
import { getFrame } from "@/theme/identity";
import { getTheme } from "@/theme/tokens";
import { Confetti } from "@/ui/Confetti";
import { Display } from "@/ui/Display";
import { GoldButton } from "@/ui/GoldButton";

/**
 * The earn-moment unlock reveal — a celebratory overlay listing what the player just unlocked, shown
 * by the Home net (and reusable by results screens). One card per unlock: a theme shows a live
 * ThemePreview swatch, a frame shows the player's own avatar wearing it (mirrors the campaign
 * FRAME UNLOCKED pattern). `acquisition` drives the honest sub-line — "earned, it's yours" for
 * granted items vs "now in the Vault" for unlock-then-buy. Dismissing acknowledges (the caller acks
 * server-side), so it fires exactly once. Confetti + entrance collapse under reduced motion.
 */
export function UnlockReveal({
  items,
  onDismiss,
  onOpenVault,
}: {
  items: PendingUnlock[];
  onDismiss: () => void;
  onOpenVault?: () => void;
}) {
  const t = useT();
  const preset = useSessionStore((s) => s.me?.avatar_preset);
  if (items.length === 0) return null;

  return (
    <div style={overlay} role="dialog" aria-modal="true">
      <Confetti burstKey={items.length} />
      <div className="rr-splash-in" style={card}>
        <Display gold className="rr-pop" style={{ fontSize: 30, textAlign: "center", lineHeight: 1.05 }}>
          {items.length === 1 ? t.unlocks.one : fmt(t.unlocks.many, { n: items.length })}
        </Display>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
          {items.map((it) => (
            <UnlockRow key={it.id} item={it} preset={preset} t={t} />
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, width: "100%" }}>
          <GoldButton onClick={onDismiss}>{t.unlocks.collect}</GoldButton>
          {onOpenVault && (
            <button type="button" onClick={onOpenVault} style={ghost}>
              {t.unlocks.viewInVault}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function UnlockRow({
  item,
  preset,
  t,
}: {
  item: PendingUnlock;
  preset?: string;
  t: ReturnType<typeof useT>;
}) {
  const isTheme = item.kind === "theme";
  const theme = isTheme ? getTheme(item.id) : null;
  const frame = !isTheme ? getFrame(item.id) : null;
  const name = theme?.name ?? frame?.name ?? item.id;
  const acqLine = item.acquisition === "earned" ? t.unlocks.earned : t.unlocks.toBuy;

  return (
    <div style={row}>
      <div style={{ flex: "none", width: 96 }}>
        {isTheme && theme ? (
          <ThemePreview theme={theme} height={72} shine />
        ) : (
          <div style={{ display: "grid", placeItems: "center", paddingTop: frame?.ornament ? 16 : 0 }}>
            <Avatar size={62} preset={preset} frame={frame?.id ?? null} art={lobbyArt.avatarHooded} />
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="display" style={{ fontSize: 17, color: "var(--text)", lineHeight: 1.1 }}>
          {name}
        </div>
        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, color: "var(--amber)" }}>
          <span aria-hidden>{item.acquisition === "earned" ? "🔓 " : "🛒 "}</span>
          {acqLine}
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
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
  maxWidth: 380,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  padding: "24px 18px 18px",
  borderRadius: 24,
  background: "linear-gradient(180deg, color-mix(in srgb, var(--panel2) 92%, var(--brand)), color-mix(in srgb, var(--panel) 94%, black))",
  border: "1.5px solid color-mix(in srgb, var(--amber) 55%, transparent)",
  boxShadow: "0 30px 70px rgba(0,0,0,.6), 0 0 40px color-mix(in srgb, var(--amber) 24%, transparent), inset 0 1px 0 rgba(255,255,255,.1)",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: 12,
  borderRadius: 16,
  background: "color-mix(in srgb, var(--panel) 78%, transparent)",
  border: "1px solid color-mix(in srgb, var(--brand-2) 30%, var(--line))",
};

const ghost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid var(--line)",
  background: "transparent",
  color: "var(--muted)",
  fontWeight: 800,
  fontSize: 12.5,
  cursor: "pointer",
};
