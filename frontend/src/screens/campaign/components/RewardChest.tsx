import type { ChestState, ChestStyle } from "@/lib/campaign";
import { CoinIcon } from "@/ui/CoinIcon";
import { FitText } from "@/ui/FitText";

/** A flat reward milestone ON the quest road (CSS, not emoji). Generic by design — exact coin amounts
 * are revealed at level completion, not here. States: locked (future, dim), ready (working toward it,
 * soft glow), opened (chapter cleared — coins + sparkle). `isNext` marks the reward the player is
 * actively climbing toward (stronger glow + accent ring) so the road has a visible carrot. `style`
 * selects the world's chest FORM — Science gets a polished science capsule; other worlds use the
 * shared chest silhouette for now (drop in `image` for bespoke art later). */
export function RewardChest({
  state,
  label,
  style,
  boss = false,
  isNext = false,
  image,
  accent = "var(--amber)",
}: {
  state: ChestState;
  label: string;
  style: ChestStyle;
  boss?: boolean;
  isNext?: boolean;
  image?: string;
  accent?: string;
}) {
  const gold = state !== "locked";
  const opened = state === "opened";
  const stage = boss ? 70 : 58; // round stage diameter

  const ringColor = gold ? "var(--amber)" : "color-mix(in srgb, var(--brand-2) 40%, transparent)";
  // The "next reward" carrot reads even while the chest is only ready (not yet earned).
  const nextRing = isNext && !opened ? `0 0 0 2px color-mix(in srgb, ${accent} 60%, transparent)` : "";
  const baseShadow = opened
    ? "0 0 16px rgba(255,201,30,.3)"
    : isNext
      ? "0 0 16px rgba(255,201,30,.28)"
      : state === "ready"
        ? "0 0 12px rgba(255,201,30,.22)"
        : "none";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, opacity: state === "locked" ? 0.78 : 1 }}>
      {/* round stage so the chest reads as a milestone marker, consistent with the level discs */}
      <span
        aria-hidden
        className={state === "ready" || isNext ? "rr-glow-pulse" : undefined}
        style={{
          position: "relative",
          width: stage,
          height: stage,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: gold
            ? "radial-gradient(120% 120% at 50% 36%, #4a3a12, #1c1330)"
            : "radial-gradient(120% 120% at 50% 36%, color-mix(in srgb, var(--brand) 22%, var(--panel2)), var(--panel))",
          border: `3px solid ${ringColor}`,
          boxShadow: [baseShadow, nextRing].filter(Boolean).join(", "),
        }}
      >
        {/* coins peeking once opened */}
        {opened && (
          <>
            <span style={{ position: "absolute", top: stage * 0.2, left: stage * 0.2, transform: "rotate(-12deg)", lineHeight: 0 }}>
              <CoinIcon size={stage * 0.2} />
            </span>
            <span style={{ position: "absolute", top: stage * 0.16, right: stage * 0.2, transform: "rotate(12deg)", lineHeight: 0 }}>
              <CoinIcon size={stage * 0.22} />
            </span>
          </>
        )}

        {/* drop-in art wins; else the world's CSS chest form */}
        {image ? (
          <img src={image} alt="" style={{ width: stage * 0.7, height: stage * 0.7, objectFit: "contain", opacity: gold ? 1 : 0.7 }} />
        ) : style === "capsule" ? (
          <Capsule stage={stage} gold={gold} opened={opened} />
        ) : (
          <Chest stage={stage} gold={gold} opened={opened} />
        )}

        {opened && (
          <span className="rr-twinkle" style={{ position: "absolute", top: -4, right: -2, fontSize: 12, color: "#fff3c4" }}>
            ✦
          </span>
        )}
      </span>
      <FitText
        as="span"
        size={9}
        min={0.66}
        style={{
          display: "inline-block",
          maxWidth: 100,
          letterSpacing: 0.8,
          fontWeight: 900,
          textTransform: "uppercase",
          padding: "2px 9px",
          borderRadius: 999,
          background: "rgba(12,7,24,.7)",
          border: `1px solid ${state === "locked" ? "rgba(150,120,225,.3)" : "rgba(255,201,30,.4)"}`,
          color: state === "locked" ? "var(--faint)" : "var(--amber)",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {label}
      </FitText>
    </div>
  );
}

/** Shared boxy treasure chest (History/Geography/Sports/Arts/Entertainment placeholder + fallback). */
function Chest({ stage, gold, opened }: { stage: number; gold: boolean; opened: boolean }) {
  const w = stage * 0.62;
  const h = w * 0.82;
  const body = gold ? "#caa12a" : "color-mix(in srgb, var(--brand) 40%, var(--panel2))";
  const bodyEdge = gold ? "#8a6a14" : "color-mix(in srgb, var(--brand) 30%, black)";
  const lid = gold ? "#ffd866" : "color-mix(in srgb, var(--brand-2) 45%, var(--panel))";
  return (
    <span style={{ position: "relative", width: w, height: h }}>
      <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "60%", borderRadius: "4px 4px 6px 6px", background: body, border: `2px solid ${bodyEdge}` }} />
      <span
        style={{
          position: "absolute",
          left: -1,
          right: -1,
          top: 0,
          height: "48%",
          borderRadius: "6px 6px 3px 3px",
          background: lid,
          border: `2px solid ${bodyEdge}`,
          transformOrigin: "top center",
          transform: opened ? "rotateX(40deg)" : "none",
          transition: "transform 320ms ease",
        }}
      />
      <span
        style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          transform: "translateX(-50%)",
          width: w * 0.2,
          height: w * 0.22,
          borderRadius: 3,
          background: gold ? "#7a5a12" : "color-mix(in srgb, var(--panel) 80%, black)",
          border: `1.5px solid ${gold ? "#ffd866" : "color-mix(in srgb, var(--brand-2) 50%, var(--panel))"}`,
        }}
      />
    </span>
  );
}

/** Science capsule: a sealed specimen pod (rounded gold cylinder, glass window, seam). Reads as a
 * lab cache, not a pirate chest — the Science world's distinct reward form. */
function Capsule({ stage, gold, opened }: { stage: number; gold: boolean; opened: boolean }) {
  const w = stage * 0.64;
  const h = w * 0.92;
  const shell = gold ? "#caa12a" : "color-mix(in srgb, var(--brand) 40%, var(--panel2))";
  const shellEdge = gold ? "#8a6a14" : "color-mix(in srgb, var(--brand) 30%, black)";
  const cap = gold ? "#ffd866" : "color-mix(in srgb, var(--brand-2) 45%, var(--panel))";
  const glass = gold ? "color-mix(in srgb, #bfe7ff 70%, transparent)" : "color-mix(in srgb, var(--brand-2) 30%, transparent)";
  return (
    <span style={{ position: "relative", width: w, height: h }}>
      {/* cylinder body */}
      <span style={{ position: "absolute", inset: 0, borderRadius: "999px 999px 999px 999px / 60% 60% 60% 60%", background: shell, border: `2px solid ${shellEdge}` }} />
      {/* top cap, hinges open when the chapter is cleared */}
      <span
        style={{
          position: "absolute",
          left: -1,
          right: -1,
          top: -1,
          height: "30%",
          borderRadius: "999px 999px 40% 40%",
          background: cap,
          border: `2px solid ${shellEdge}`,
          transformOrigin: "top center",
          transform: opened ? "translateY(-30%) rotate(-8deg)" : "none",
          transition: "transform 320ms ease",
        }}
      />
      {/* glass window showing the specimen glow */}
      <span style={{ position: "absolute", left: "26%", right: "26%", top: "38%", height: "34%", borderRadius: 999, background: `linear-gradient(180deg, ${glass}, transparent)`, border: `1px solid ${gold ? "#ffe9aa" : "transparent"}` }} />
    </span>
  );
}
