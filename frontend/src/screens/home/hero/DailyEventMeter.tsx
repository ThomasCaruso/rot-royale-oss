import { UsersIcon } from "@/ui/icons";

/**
 * The event meta row above the CTA — "N IN THE FIELD" (gold number) on the left and a single premium
 * gold event track filling the rest of the row. The track shows the elapsed-fraction of the OPEN
 * window as a decorative activity meter; the countdown is NOT repeated here (it lives in the top-right
 * status pill) so the row stays focused on field + progress.
 *
 * IMPORTANT: the meter FILL is a <div> with a `linear-gradient(90deg …)` background and is the ONLY
 * such <div> in the whole card — HeroCard.test keys off exactly that to assert the bar renders in
 * `live` and NOT in pre-open states. So it renders only when `progress != null`; keep the 90deg fill
 * unique (the track itself must stay a non-90deg / span so it isn't double-counted).
 */
export function DailyEventMeter({ fieldText, progress }: { fieldText: string | null; progress: number | null }) {
  const pct = progress == null ? 0 : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const hasMeter = progress != null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "clamp(10px, 3cqw, 15px)" }}>
      {fieldText && <FieldLabel text={fieldText} />}

      {hasMeter && (
        <div
          style={{
            // A long, clean, thin dark-VIOLET track (not a near-black input field): flat fill, a hair
            // of a brand-violet border, and only a whisper of an inner shadow so it reads as a slim
            // event rail rather than a form input.
            position: "relative",
            flex: 1,
            minWidth: 0,
            height: 9,
            borderRadius: 999,
            background: "color-mix(in srgb, var(--brand-2) 22%, #0b0620)",
            border: "1px solid color-mix(in srgb, var(--brand-2) 36%, transparent)",
            overflow: "visible",
            boxShadow: "inset 0 1px 3px rgba(0,0,0,.5)",
          }}
        >
          {/* The one 90deg gold fill — HeroCard.test counts this div. Clipped to the track radius. */}
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: 999,
              background: "linear-gradient(90deg, color-mix(in srgb, var(--amber) 60%, #b85c00), var(--amber) 70%, color-mix(in srgb, var(--amber) 82%, white))",
              boxShadow: "0 0 10px color-mix(in srgb, var(--amber) 60%, transparent)",
            }}
          />
          {/* Glowing gold endpoint — the bright "now" marker riding the head of the fill. */}
          <span
            aria-hidden
            className="rr-aura"
            style={{
              position: "absolute",
              top: "50%",
              left: `${pct}%`,
              width: 12,
              height: 12,
              marginLeft: -6,
              marginTop: -6,
              borderRadius: "50%",
              background: "radial-gradient(circle, #fff 0%, color-mix(in srgb, var(--amber) 92%, white) 50%, transparent 72%)",
              boxShadow: "0 0 15px 4px color-mix(in srgb, var(--amber) 85%, white)",
              pointerEvents: "none",
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * "N IN THE FIELD" — for the simple "{n} in the field" form the leading number is gold and the rest
 * uppercase; other states (e.g. "field still moving · N in the field") render plain to stay readable.
 */
function FieldLabel({ text }: { text: string }) {
  const m = /^(\d[\d,]*)(.*)$/.exec(text);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flex: "none", minWidth: 0, maxWidth: "56%" }}>
      <UsersIcon size={12} style={{ color: "var(--amber)", flex: "none" }} />
      {m ? (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, overflow: "hidden" }}>
          <span className="display" style={{ fontSize: "clamp(11px, 3.1cqw, 13px)", color: "var(--amber)", lineHeight: 1 }}>{m[1]}</span>
          <span style={{ fontSize: "clamp(9px, 2.5cqw, 10.5px)", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "color-mix(in srgb, var(--text) 82%, var(--muted))", whiteSpace: "nowrap" }}>{m[2].trim()}</span>
        </span>
      ) : (
        <span style={{ fontSize: "clamp(10px, 2.8cqw, 12px)", fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
      )}
    </span>
  );
}
