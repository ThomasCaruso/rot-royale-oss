import type { NextUnlock } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { cosmeticName } from "@/lib/today";
import { FitText } from "@/ui/FitText";
import { CoinIcon } from "@/ui/CoinIcon";
import { GemIcon } from "@/ui/GemIcon";

export interface NextUnlockCardProps {
  unlock: NextUnlock;
  onOpenVault: () => void;
}

/** A locked cosmetic GOAL — the point is to make the currency feel worth earning. Shows the item, a
 *  progress bar toward its cost, and how far to go; the whole card opens the Vault. */
export function NextUnlockCard({ unlock, onOpenVault }: NextUnlockCardProps) {
  const t = useT();
  const isGems = unlock.currency === "gems";
  const CurrencyIcon = isGems ? GemIcon : CoinIcon;
  const currencyWord = isGems ? t.today.currencyGems : t.today.currencyCoins;
  const pct = Math.round(Math.max(0, Math.min(unlock.progress, 1)) * 100);
  const remainingText =
    unlock.remaining <= 0
      ? t.today.nextUnlockReady
      : fmt(t.today.nextUnlockRemaining, { n: unlock.remaining, currency: currencyWord });

  return (
    <button
      type="button"
      onClick={onOpenVault}
      onPointerDown={(e) => (e.currentTarget.style.transform = "scale(.985)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "13px 15px",
        borderRadius: 20,
        cursor: "pointer",
        color: "var(--text)",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--amber) 20%, var(--panel2)) 0%, var(--panel2) 60%, var(--panel) 100%)",
        border: "1px solid color-mix(in srgb, var(--amber) 36%, transparent)",
        boxShadow: "0 14px 30px rgba(0,0,0,.34)",
        transition: "transform 120ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span
          aria-hidden
          className="emoji"
          style={{
            width: 42,
            height: 42,
            flex: "none",
            display: "grid",
            placeItems: "center",
            fontSize: 22,
            borderRadius: 12,
            background:
              "radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--amber) 45%, var(--panel2)), var(--panel))",
            border: "1px solid color-mix(in srgb, var(--amber) 45%, transparent)",
          }}
        >
          🔒
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FitText
            as="div"
            size={10}
            min={0.66}
            style={{
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 800,
              color: "var(--amber)",
              width: "100%",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {t.today.nextUnlockEyebrow}
          </FitText>
          <FitText
            as="div"
            className="display"
            size={15}
            min={0.7}
            style={{
              lineHeight: 1.1,
              marginTop: 1,
              width: "100%",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {cosmeticName(unlock.id, unlock.kind)}
          </FitText>
        </div>
        <span
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 800,
            fontSize: 14,
            color: "var(--text)",
          }}
        >
          <CurrencyIcon size={15} />
          {unlock.cost}
        </span>
      </div>

      {/* progress bar */}
      <div
        aria-hidden
        style={{
          position: "relative",
          height: 8,
          borderRadius: 99,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            borderRadius: 99,
            background:
              "linear-gradient(90deg, color-mix(in srgb, var(--amber) 70%, white), var(--amber))",
          }}
        />
      </div>
      <div style={{ color: "var(--muted)", fontSize: 11.5, fontWeight: 700 }}>{remainingText}</div>
    </button>
  );
}
