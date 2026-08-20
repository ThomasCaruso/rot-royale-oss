import { CrownIcon } from "@/ui/CrownIcon";

/**
 * The Daily Royale title block — a decorative gold flourish (diamond–line–crown–line–diamond) above
 * the stacked DAILY / ROYALE wordmark (bright white / glossy gold-metal, heavy 3D game type), plus
 * the tagline subtitle whose final sentence ("One crown.") is gold. Dominates the left of the card;
 * scales with the card via cqw.
 */
export function DailyTitleBlock({ title, subtitle, goldTail = false }: { title: string; subtitle: string | null; goldTail?: boolean }) {
  const words = title.split(" ");
  return (
    <div style={{ minWidth: 0 }}>
      {/* Decorative flourish above the wordmark — deliberately dim/small so it frames the title
          without adding to the crowding (opacity + thinner lines + a smaller crown). */}
      <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: "clamp(140px, 44cqw, 260px)", marginBottom: "clamp(6px, 1.8cqw, 10px)", opacity: 0.66 }}>
        <Diamond />
        <span style={{ flex: 1, height: 1.5, borderRadius: 2, background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--amber) 78%, transparent))" }} />
        <CrownIcon size={12} style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))", flex: "none" }} />
        <span style={{ flex: 1, height: 1.5, borderRadius: 2, background: "linear-gradient(90deg, color-mix(in srgb, var(--amber) 78%, transparent), transparent)" }} />
        <Diamond />
      </div>

      <div className="display" style={{ lineHeight: 0.76 }}>
        {words.map((word, i) => {
          const gold = i === words.length - 1;
          const shared: React.CSSProperties = {
            // Deliberately a notch under its former 16.8cqw/84px — still the loudest element on the
            // card, but leaving the trophy scene room to read as the other half of the composition.
            fontSize: "clamp(38px, 14.5cqw, 72px)",
            letterSpacing: "0.002em",
          };
          // Solid bright GOLD letters (no background-clip trick — that was painting a gold rectangle
          // behind the text). The face is a clean gold; the stacked darker-gold text-shadows give the
          // extruded 3D metal depth below each letter.
          const goldStyle: React.CSSProperties = {
            ...shared,
            color: "#FFC61C",
            WebkitTextFillColor: "#FFC61C",
            WebkitTextStroke: "0.8px #7a4d00",
            textShadow:
              "0 2px 0 #E1A20E, 0 4px 0 #B98008, 0 6px 0 #8a5d00, 0 8px 0 #5c3d00, 0 11px 2px rgba(0,0,0,.42), 0 16px 28px rgba(255,201,30,.5), 0 0 20px rgba(255,214,64,.4)",
          };
          const whiteStyle: React.CSSProperties = {
            ...shared,
            color: "#FFFFFF",
            WebkitTextFillColor: "#FFFFFF",
            WebkitTextStroke: "1.6px rgba(22,11,46,.96)",
            textShadow:
              "0 3px 0 rgba(16,8,38,.78), 0 6px 0 rgba(9,4,26,.6), 0 8px 0 rgba(5,2,18,.5), 0 12px 3px rgba(0,0,0,.5), 0 16px 30px rgba(0,0,0,.62)",
          };
          return (
            <div key={i} style={gold ? goldStyle : whiteStyle}>
              {word}
            </div>
          );
        })}
      </div>

      {subtitle && <Subtitle text={subtitle} goldTail={goldTail} />}
    </div>
  );
}

/** A small gold diamond line-cap for the flourish. */
function Diamond() {
  return (
    <span
      aria-hidden
      style={{
        width: 5,
        height: 5,
        flex: "none",
        transform: "rotate(45deg)",
        background: "linear-gradient(135deg, #FFE58A, var(--amber))",
        boxShadow: "0 0 6px color-mix(in srgb, var(--amber) 70%, transparent)",
      }}
    />
  );
}

/** The tagline; when `goldTail`, the final sentence renders in gold ("…One crown."). */
function Subtitle({ text, goldTail }: { text: string; goldTail: boolean }) {
  const style: React.CSSProperties = {
    marginTop: "clamp(8px, 2.2cqw, 11px)",
    color: "color-mix(in srgb, var(--text) 78%, var(--muted))",
    fontSize: "clamp(10.5px, 2.8cqw, 12px)",
    fontWeight: 600,
    lineHeight: 1.4,
    maxWidth: "clamp(158px, 49cqw, 240px)",
    // The tagline may claim its natural width past the (narrow) flex column, riding over the arena's
    // faint halo like the wordmark does — avoids ugly mid-phrase wraps ("8 / questions") on mobile.
    minWidth: "min(49cqw, 240px)",
  };
  const idx = goldTail ? text.lastIndexOf(". ") : -1;
  if (idx < 0) return <div style={style}>{text}</div>;
  return (
    <div style={style}>
      {text.slice(0, idx + 2)}
      <span style={{ color: "var(--amber)", fontWeight: 800, textShadow: "0 0 10px rgba(255,201,30,.3)", whiteSpace: "nowrap" }}>{text.slice(idx + 2)}</span>
    </div>
  );
}
