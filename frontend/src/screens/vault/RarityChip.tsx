import { useT } from "@/i18n/useT";
import { FitText } from "@/ui/FitText";
import { RARITY_META, type Rarity } from "@/screens/vault/rarity";

/**
 * The small rarity label worn by every Vault card — the tier accent + name (Starter/Common/Rare/
 * Epic/Prestige). Pure presentation derived from {@link rarityOf}; carries no economy state. A tiny
 * tinted dot + uppercased label so the catalog reads as a tiered shop at a glance. Decorative tint,
 * real text (so it stays legible + copy-guarded). Used inline in the card's name row.
 */
export function RarityChip({ rarity }: { rarity: Rarity }) {
  const t = useT();
  const meta = RARITY_META[rarity];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(0,0,0,.18)",
        border: `1px solid ${meta.accent}`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,.08), 0 0 10px ${meta.accent}33`,
        fontSize: 9,
        fontWeight: 900,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: meta.accent,
        whiteSpace: "nowrap",
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          flex: "none",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: meta.accent,
          boxShadow: `0 0 6px ${meta.accent}`,
        }}
      />
      <FitText as="span" size={9} min={0.7} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
        {t.vault.rarity[meta.labelKey]}
      </FitText>
    </span>
  );
}
