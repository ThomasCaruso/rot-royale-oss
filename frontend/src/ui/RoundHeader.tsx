import { categoryName } from "@/i18n/categories";
import { useI18n } from "@/store/i18n";
import { useArtStyle } from "@/theme/useArtStyle";
import { CountdownRing } from "@/ui/CountdownRing";
import { FitText } from "@/ui/FitText";

/**
 * Shared in-round header BAR: a pill-shaped category chip (emoji icon + name) on the left and the
 * gold countdown ring on the right. This is rendered ABOVE the question GlassCard (not inside it),
 * so the ring's drop-shadow + final-3s red glow halo can never be clipped by the card's rounded
 * corner / backdrop-filter clip context. Used by every DOM round module (multiple-choice + memory)
 * so the three host screens (contest / practice / campaign) get the same confident top bar.
 * Pass `ring={false}` to reserve the ring's space without rendering it (memory's watch phase, where
 * the timer hasn't started).
 *
 * `category` arrives from the API as the canonical ENGLISH name (it doubles as the bank identifier),
 * so it is mapped to a display name here — one place, covering every round module.
 */
export function RoundHeader({
  category,
  icon,
  label,
  remainingMs = 0,
  totalMs = 1,
  ring = true,
  right,
}: {
  category?: string;
  icon?: string;
  /**
   * Verb label for rounds that have NO category — the interactive cognition rounds (estimate,
   * change detection) are drawn from their own content tables, not the categorised trivia bank.
   * Rendered verbatim, bypassing the category-name mapping.
   */
  label?: string;
  remainingMs?: number;
  totalMs?: number;
  ring?: boolean;
  /**
   * Replaces the ring slot entirely. Estimate has no timer (it is guess-limited, not time-limited),
   * so it puts its guess pips here instead of faking a countdown.
   */
  right?: React.ReactNode;
}) {
  const mono = useArtStyle() === "mono";
  const locale = useI18n((st) => st.locale);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        // A hair of breathing room around the bar; the ring now lives outside any overflow-clipped
        // card, so its glow halo has the whole stage to bleed into.
        padding: "2px 4px",
        marginBottom: 12,
      }}
    >
      {/* Category chip. Mono ("Blank"): a quiet hairline outline pill — small caps, no emoji, no
          fill. Arcade: the filled brand-violet gradient pill with high-contrast text + the category
          icon, so the category reads instantly against the dark stage. Theme-token-driven so it
          stays readable on every theme; compact + ellipsis-safe for long category names. */}
      <span
        style={
          mono
            ? {
                display: "inline-flex",
                alignItems: "center",
                maxWidth: "calc(100% - 84px)",
                padding: "7px 14px",
                borderRadius: 999,
                background: "transparent",
                border: "1px solid var(--line)",
              }
            : {
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                maxWidth: "calc(100% - 84px)",
                padding: "7px 14px 7px 9px",
                borderRadius: 999,
                background: "linear-gradient(135deg, var(--brand), var(--brand-2))",
                border: "1px solid color-mix(in srgb, var(--brand-2) 60%, white)",
                boxShadow:
                  "0 4px 14px color-mix(in srgb, var(--brand) 45%, transparent), inset 0 1px 0 rgba(255,255,255,.18)",
              }
        }
      >
        {icon && !mono && (
          <span
            className="emoji"
            style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}
            aria-hidden
          >
            {icon}
          </span>
        )}
        <FitText
          as="span"
          size={11.5}
          min={0.66}
          style={{
            letterSpacing: mono ? 2 : 1.5,
            textTransform: "uppercase",
            fontWeight: mono ? 600 : 800,
            // Text on the brand-gradient chip — themable (--brandText); the mono outline chip
            // speaks in the muted small-caps voice instead.
            color: mono ? "var(--muted)" : "var(--brandText, #fff)",
            textShadow: mono ? undefined : "0 1px 2px rgba(0,0,0,.35)",
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {label ?? categoryName(category ?? "", locale)}
        </FitText>
      </span>
      {right ?? (
        <>
          {ring ? (
            <CountdownRing remainingMs={remainingMs} totalMs={totalMs} size={64} />
          ) : (
            <div style={{ width: 64, height: 64, flexShrink: 0 }} aria-hidden />
          )}
        </>
      )}
    </div>
  );
}
