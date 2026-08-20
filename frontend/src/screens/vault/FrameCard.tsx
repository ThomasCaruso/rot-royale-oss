import type React from "react";
import { fmt, useT } from "@/i18n/useT";
import type { VaultItem } from "@/api/client";
import { lobbyArt } from "@/assets/lobby";
import { getFrame } from "@/theme/identity";
import { useSessionStore } from "@/store/session";
import { Avatar } from "@/screens/home/Avatar";
import { CoinIcon } from "@/ui/CoinIcon";
import { GemIcon } from "@/ui/GemIcon";
import { CrownIcon } from "@/ui/CrownIcon";
import { FitText } from "@/ui/FitText";
import { GlassCard } from "@/ui/GlassCard";
import { ctaStyle } from "@/screens/vault/cardCta";
import { RarityChip } from "@/screens/vault/RarityChip";
import { RARITY_META, rarityOf } from "@/screens/vault/rarity";
import { requirementCopy } from "@/screens/vault/requirementCopy";

/**
 * One frame card — mirrors VaultItemCard's state machine exactly (equipped badge / Equip /
 * locked / gold Unlock / shortfall + progress bar; spotlight glow on the obvious next action;
 * one-shot splash + shine on `justUnlocked`), but the preview is a big live Avatar wearing the
 * frame with the PLAYER'S OWN current preset (me.avatar_preset from the store) so every preview
 * is personal: "this is what *I* would look like".
 *
 * Locked cards stay anticipation, not dead ends: the preview still wears the frame (dimmed) and
 * the blurb line becomes goal-framed requirement copy ("Complete the {world} campaign" /
 * "Complete every campaign world") — no urgency, no timers. The prestige frame (crowned_scholar)
 * keeps its gold/violet ring + glow pulse visible even while locked (the tease IS the reward
 * preview); the pulse is decorative and collapses under prefers-reduced-motion.
 *
 * Price/owned/equipped/locked/requirement come ONLY from the server item (GET /vault);
 * FRAME_STYLES supplies display name/blurb/visuals — never economy state.
 */
export function FrameCard({
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
  const preset = useSessionStore((s) => s.me?.avatar_preset);
  const style = getFrame(item.id);
  const prestige = Boolean(style?.prestige);
  const rarity = rarityOf(item);
  // The tier accent tints the preview stage, so common → rare → epic → prestige → gem escalate
  // visibly down the catalog (the stage light gets more precious with the merchandise).
  const rarityAccent = RARITY_META[rarity].accent;
  // Currency-aware price mark: Gem frames cost Gems, everything else costs coins. The passed
  // `balance` is already the matching wallet (VaultScreen routes coins vs gems per card).
  const isGem = item.currency === "gems";
  const PriceIcon = isGem ? GemIcon : CoinIcon;
  const affordable = balance >= item.cost;
  // Earn-toward-it progress: only for the not-yet-affordable state (same rule as themes).
  const saving = !item.owned && !item.locked && !affordable && item.cost > 0;
  const progressPct = saving ? Math.min(100, Math.round((balance / item.cost) * 100)) : null;

  // Goal-framed requirement copy for locked frames; unknown formats fall back to the blurb.
  const requireCopy = item.locked ? requirementCopy(item.requirement, t) : null;

  let cta: React.ReactNode;
  if (item.equipped) {
    cta = (
      <span className="display" style={{ color: "var(--lime)", fontSize: 14 }}>
        {t.vault.equipped}
      </span>
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
        }}
      >
        {t.vault.equip}
      </button>
    );
  } else if (item.locked) {
    cta = (
      <span style={{ color: "var(--faint)", fontWeight: 800, fontSize: 13 }}>
        🔒 {t.vault.lockedLabel}
      </span>
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
        }}
      >
        {t.vault.unlockFor} <PriceIcon size={14} /> {item.cost}
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
        }}
      >
        {fmt(isGem ? t.vault.shortfallGems : t.vault.shortfall, { n: item.cost - balance })}
      </button>
    );
  }

  // Card frame by state: equipped = brand ring (prestige: gold-edged dual glow — wearing the
  // best frame should look crowned, not merely equipped); spotlight = gold ring + slow glow
  // pulse; non-equipped prestige (locked tease OR owned trophy) = a quiet gold/violet shimmer
  // so the best frame always feels special. All static box-shadows — GPU-cheap.
  const frame: React.CSSProperties = item.equipped
    ? prestige
      ? {
          position: "relative",
          border: "1.5px solid rgba(255,201,30,.55)",
          boxShadow:
            "0 18px 40px rgba(0,0,0,.35), 0 0 26px rgba(168,85,247,.3), 0 0 18px rgba(255,201,30,.22), inset 0 1px 0 rgba(255,255,255,.08)",
        }
      : {
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
      : prestige
        ? {
            position: "relative",
            border: "1.5px solid rgba(168,85,247,.5)",
            boxShadow:
              "0 18px 40px rgba(0,0,0,.35), 0 0 22px rgba(255,201,30,.14), inset 0 1px 0 rgba(255,255,255,.08)",
          }
        : { position: "relative" };

  return (
    <div className={justUnlocked ? "rr-splash-in" : undefined}>
      <GlassCard style={frame}>
        {item.equipped && (
          /* Equipped badge — the prestige frame's badge goes full gold/violet (its signature
           * palette) so wearing the all-worlds trophy reads as a coronation, not a checkbox. */
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
              background: prestige
                ? "linear-gradient(135deg, #ffd24a, #a855f7)"
                : "linear-gradient(180deg, #2a1455, #170b33)",
              border: "1.5px solid rgba(255,201,30,.6)",
              boxShadow: prestige
                ? "0 4px 14px rgba(168,85,247,.5), 0 0 10px rgba(255,201,30,.35)"
                : "0 4px 14px rgba(0,0,0,.5)",
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
              boxShadow: "0 4px 14px color-mix(in srgb, var(--amber) 40%, transparent)",
              whiteSpace: "nowrap",
            }}
          >
            {t.vault.nextUnlock}
          </span>
        )}

        {/* Compact vertical card (frames render in a 2-column grid, not full width). */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
          {/* Live preview: the illustrated player portrait wearing this frame (headroom for the
              ornament that perches above the disc), on a stage lit in the TIER's accent — a bronze
              frame sits under warm light, a gem frame under gem light. Decorative → aria-hidden.
              Locked = dimmed. */}
          <div
            aria-hidden
            style={{
              position: "relative",
              display: "grid",
              placeItems: "center",
              width: "100%",
              height: 96,
              paddingTop: style?.ornament ? 14 : 0,
              borderRadius: 14,
              overflow: "hidden",
              border: `1px solid color-mix(in srgb, ${rarityAccent} 38%, var(--line))`,
              background:
                `radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, ${rarityAccent} 20%, transparent), transparent 70%),` +
                " radial-gradient(110% 70% at 50% 115%, rgba(0,0,0,.4), transparent 65%)",
              boxShadow: `inset 0 1px 0 rgba(255,255,255,.07), inset 0 0 26px color-mix(in srgb, ${rarityAccent} 10%, transparent)`,
              opacity: item.locked ? (prestige ? 0.9 : 0.72) : 1,
            }}
          >
            <Avatar size={62} preset={preset} frame={item.id} art={lobbyArt.avatarHooded} />
            {justUnlocked && (
              <span
                className="rr-shine"
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: "45%",
                  background:
                    "linear-gradient(105deg, transparent, rgba(255,255,255,.5), transparent)",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>

          <RarityChip rarity={rarity} />
          <FitText
            as="div"
            size={13.5}
            min={0.7}
            style={{
              fontWeight: 800,
              color: "var(--text)",
              width: "100%",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {style?.name ?? item.id}
          </FitText>
          <FitText
            as="div"
            axis="y"
            size={11}
            min={0.7}
            style={{
              minHeight: 28,
              color: requireCopy ? "var(--amber)" : "var(--muted)",
              fontWeight: requireCopy ? 700 : 400,
              lineHeight: 1.25,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {requireCopy ?? style?.blurb ?? ""}
          </FitText>

          <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>{cta}</div>

          {progressPct !== null && (
            <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
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
