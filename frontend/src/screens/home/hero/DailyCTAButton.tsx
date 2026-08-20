import { lobbyArt } from "@/assets/lobby";
import { GoldButton } from "@/ui/GoldButton";

/**
 * The Daily Royale primary CTA — the shared glossy `GoldButton` (beveled gold, dark text, idle glow,
 * light sweep, 2px press) full-width, with a defined dark-gold rim so the cap reads as a machined
 * physical gate. The small flat crown-badge art (`crownCta`, background-stripped) holds the LEFT edge
 * — no plaque/box behind it, so it reads as a quiet supporting emblem on the gold cap, not a second
 * hero object — the chevron holds the right edge (nudges on card hover), and the label centres in the
 * space between them. The label is its own <span> so tests can `getByText` / click it exactly; the
 * button owns the onClick.
 */
export function DailyCTAButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    // A wrapper drop-shadow seats the button on the card like a large physical action gate (deeper than
    // GoldButton's own bevel, but scoped here so the shared button's other callers are untouched).
    <div style={{ filter: "drop-shadow(0 14px 22px rgba(0,0,0,.5))" }}>
      <GoldButton
        onClick={onClick}
        shine
        style={{
          fontSize: "clamp(16px, 5cqw, 22px)",
          letterSpacing: 0.6,
          padding: "clamp(16px, 4.8cqw, 22px) clamp(16px, 4.8cqw, 24px)",
          borderRadius: "clamp(18px, 5cqw, 24px)",
          border: "2px solid color-mix(in srgb, var(--amber) 42%, #5a3700)",
        }}
      >
        {/* Three-part row — crown holds the left edge, chevron the right, and the label centres in
            the space between them (the reference composition), so the whole line reads balanced
            instead of the icon dragging the label off-centre. */}
        <span style={{ display: "flex", alignItems: "center", width: "100%", gap: "clamp(10px, 3cqw, 14px)" }}>
          <img
            src={lobbyArt.crownCta}
            alt=""
            aria-hidden
            draggable={false}
            style={{
              height: "clamp(21px, 6.4cqw, 27px)",
              aspectRatio: "141 / 103",
              objectFit: "contain",
              display: "block",
              flex: "none",
              filter: "drop-shadow(0 2px 3px rgba(0,0,0,.4))",
            }}
          />
          <span style={{ flex: 1, minWidth: 0, textAlign: "center", whiteSpace: "nowrap" }}>{label}</span>
          <span aria-hidden className="rr-daily-chevron" style={{ flex: "none", fontWeight: 900, fontSize: "1.2em", lineHeight: 1 }}>
            ›
          </span>
        </span>
      </GoldButton>
    </div>
  );
}
