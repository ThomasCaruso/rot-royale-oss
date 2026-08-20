import type React from "react";
import { fmt, useT } from "@/i18n/useT";
import type { VaultItem } from "@/api/client";
import { getTheme } from "@/theme/tokens";
import { CoinIcon } from "@/ui/CoinIcon";
import { GemIcon } from "@/ui/GemIcon";
import { CrownIcon } from "@/ui/CrownIcon";
import { GlassCard } from "@/ui/GlassCard";
import { FitText } from "@/ui/FitText";
import { ThemePreview } from "@/screens/vault/ThemePreview";
import { ctaStyle } from "@/screens/vault/cardCta";
import { RarityChip } from "@/screens/vault/RarityChip";
import { rarityOf } from "@/screens/vault/rarity";
import { requirementCopy } from "@/screens/vault/requirementCopy";

/**
 * One theme card. State machine (exactly one CTA per card):
 *   equipped → "Equipped" badge + crown hanging off the top edge + brand ring, no action
 *   owned    → Equip button
 *   locked   → locked label + dimmed preview (unreachable with the v1 catalog; state exists
 *              so Phase 4 gating needs no card rework)
 *   affordable   → gold Unlock + price (opens the confirm step in the parent); the cheapest
 *                  affordable card is the screen's `spotlight` — gold glow pulse + "Next unlock"
 *                  pill (the obvious next action)
 *   unaffordable → disabled CTA with the exact shortfall + a gold progress bar toward the
 *                  unlock (anticipation, not failure — no urgency/timers)
 * Prices come from the SERVER item (item.cost via GET /vault), never tokens.ts.
 * The ThemePreview renders the theme's own vars so every card previews its world live.
 * `justUnlocked` plays a one-shot splash-in + shine right after a buy (decorative; the global
 * prefers-reduced-motion rule collapses it while the owned state stays fully visible).
 */
export function VaultItemCard({
  item,
  balance,
  busy,
  onBuy,
  onEquip,
  spotlight = false,
  justUnlocked = false,
}: {
  item: VaultItem;
  balance: number;
  busy: boolean;
  onBuy: () => void;
  onEquip: () => void;
  spotlight?: boolean;
  justUnlocked?: boolean;
}) {
  const t = useT();
  const theme = getTheme(item.id);
  const rarity = rarityOf(item);
  // Locked earned-only themes show goal-framed unlock copy in place of the blurb.
  const requireCopy = item.locked ? requirementCopy(item.requirement, t) : null;
  // Currency-aware price mark (themes are coin-priced today, but keep it general). The passed
  // `balance` is already the matching wallet (VaultScreen routes coins vs gems per card).
  const isGem = item.currency === "gems";
  const PriceIcon = isGem ? GemIcon : CoinIcon;
  const affordable = balance >= item.cost;
  // Earn-toward-it progress: only for the not-yet-affordable state.
  const saving = !item.owned && !item.locked && !affordable && item.cost > 0;
  const progressPct = saving ? Math.min(100, Math.round((balance / item.cost) * 100)) : null;

  let cta: React.ReactNode;
  if (item.equipped) {
    cta = (
      <FitText as="span" className="display" size={14} min={0.6} style={{ color: "var(--lime)", minWidth: 0, maxWidth: "58%", whiteSpace: "nowrap", overflow: "hidden" }}>
        {t.vault.equipped}
      </FitText>
    );
  } else if (item.owned) {
    cta = (
      <button
        type="button"
        disabled={busy}
        onClick={onEquip}
        style={{
          ...ctaStyle("var(--brand)", "var(--brandText, #fff)"),
          boxShadow: "0 6px 18px color-mix(in srgb, var(--brand) 35%, transparent)",
          maxWidth: "58%",
        }}
      >
        <FitText as="span" size={13} min={0.6} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
          {t.vault.equip}
        </FitText>
      </button>
    );
  } else if (item.locked) {
    cta = (
      <FitText as="span" size={13} min={0.6} style={{ color: "var(--faint)", fontWeight: 800, minWidth: 0, maxWidth: "58%", whiteSpace: "nowrap", overflow: "hidden" }}>
        🔒 {t.vault.lockedLabel}
      </FitText>
    );
  } else if (affordable) {
    cta = (
      <button
        type="button"
        disabled={busy}
        onClick={onBuy}
        style={{
          ...ctaStyle(
            "linear-gradient(180deg, color-mix(in srgb, var(--amber) 78%, white), var(--amber))",
            "var(--btnText)",
          ),
          boxShadow: "0 6px 18px color-mix(in srgb, var(--amber) 40%, transparent), inset 0 1px 0 rgba(255,255,255,.5)",
          maxWidth: "62%",
        }}
      >
        <FitText as="span" size={13} min={0.6} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>{t.vault.unlockFor}</FitText> <PriceIcon size={14} /> {item.cost}
      </button>
    );
  } else {
    cta = (
      <button
        type="button"
        disabled
        style={{
          ...ctaStyle("transparent", "var(--muted)"),
          border: "1px solid var(--line)",
          cursor: "default",
          maxWidth: "62%",
        }}
      >
        <FitText as="span" size={13} min={0.6} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
          {fmt(isGem ? t.vault.shortfallGems : t.vault.shortfall, { n: item.cost - balance })}
        </FitText>
      </button>
    );
  }

  // Card frame by state: equipped = brand ring; spotlight = gold ring + slow glow pulse
  // (the "make it glow" next action). Reduced motion drops the pulse, keeps the gold ring.
  const frame: React.CSSProperties = item.equipped
    ? {
        position: "relative",
        border: "1.5px solid var(--brand-2)",
        boxShadow:
          "0 18px 40px rgba(0,0,0,.35), 0 0 26px rgba(168,85,247,.3), inset 0 1px 0 rgba(255,255,255,.08)",
      }
    : spotlight
      ? {
          position: "relative",
          border: "1.5px solid rgba(255,201,30,.55)",
          animation: "rr-glow-pulse 2.6s ease-in-out infinite",
        }
      : { position: "relative" };

  return (
    <div className={justUnlocked ? "rr-splash-in" : undefined}>
      <GlassCard style={frame}>
        {item.equipped && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -13,
              right: 14,
              zIndex: 2,
              width: 30,
              height: 30,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(180deg, #2a1455, #170b33)",
              border: "1.5px solid rgba(255,201,30,.6)",
              boxShadow: "0 4px 14px rgba(0,0,0,.5)",
            }}
          >
            <CrownIcon size={16} />
          </span>
        )}
        {spotlight && (
          <span
            style={{
              position: "absolute",
              top: -11,
              left: 16,
              zIndex: 2,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 11px",
              borderRadius: 999,
              background: "linear-gradient(90deg, color-mix(in srgb, var(--amber) 75%, white), var(--amber))",
              color: "var(--btnText)",
              fontSize: 9.5,
              fontWeight: 900,
              letterSpacing: 1,
              textTransform: "uppercase",
              boxShadow: "0 4px 14px rgba(255,201,30,.4)",
              whiteSpace: "nowrap",
              // Cap the pill inside the card (16px inset each side) so a longer localized label
              // shrinks to fit rather than running off the card edge.
              maxWidth: "calc(100% - 32px)",
            }}
          >
            <FitText as="span" size={9.5} min={0.66} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
              {t.vault.nextUnlock}
            </FitText>
          </span>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={item.locked ? { opacity: 0.75 } : undefined}>
            <ThemePreview theme={theme} shine={justUnlocked} />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ marginBottom: 4 }}>
                <RarityChip rarity={rarity} />
              </div>
              <div
                style={{
                  fontWeight: 800,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {theme.name}
              </div>
              {/* Two-line clamp kept; a longer localized blurb shrinks (axis="y") to fit those two
                  lines rather than truncating with an ellipsis. */}
              <FitText
                as="div"
                axis="y"
                size={12}
                min={0.7}
                style={{
                  color: requireCopy ? "var(--amber)" : "var(--muted)",
                  fontWeight: requireCopy ? 700 : 400,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {requireCopy ?? theme.blurb}
              </FitText>
            </div>
            {cta}
          </div>

          {progressPct !== null && (
            <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 999,
                  background: "var(--line)",
                  overflow: "hidden",
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,.3)",
                }}
              >
                <div
                  style={{
                    width: `${progressPct}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: "linear-gradient(90deg, color-mix(in srgb, var(--amber) 78%, white), var(--amber))",
                    boxShadow: "0 0 8px color-mix(in srgb, var(--amber) 50%, transparent)",
                  }}
                />
              </div>
              <PriceIcon size={13} />
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

