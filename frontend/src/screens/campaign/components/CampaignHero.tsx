import type { CampaignLadderResponse } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { journeyTotals } from "@/lib/campaign";
import { Avatar } from "@/screens/home/Avatar";
import { CoinIcon } from "@/ui/CoinIcon";
import { CrownIcon } from "@/ui/CrownIcon";
import { Display } from "@/ui/Display";
import { FitText } from "@/ui/FitText";
import { useSessionStore } from "@/store/session";

/** Campaign hero banner — a floating game-title stage: layered cosmic atmosphere (nebulas, ringed
 * planet, moons, cloudbank), a crowned CAMPAIGN wordmark on a light stage, quest chips, and a top
 * HUD row (back · coins · avatar). Feels like arriving at a major mode, before any scrolling. */
export function CampaignHero({
  ladder,
  onExit,
}: {
  ladder: CampaignLadderResponse;
  onExit: () => void;
}) {
  const t = useT();
  const coins = useSessionStore((s) => s.me?.coins_balance ?? 0);
  // Your own identity, same as every other avatar of you in the app — this one used to render the
  // default preset with no frame at all, so it showed a stranger's face on your own campaign hub.
  const avatarPreset = useSessionStore((s) => s.me?.avatar_preset);
  const equippedFrame = useSessionStore((s) => s.me?.equipped_frame ?? null);
  const j = journeyTotals(ladder.worlds);

  return (
    <div style={{ position: "relative" }}>
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: "28px 28px 34px 34px",
          padding: "14px 18px 24px",
          background:
            "radial-gradient(120% 95% at 22% 6%, color-mix(in srgb, var(--brand) 35%, var(--panel2)) 0%, var(--panel) 52%, color-mix(in srgb, var(--panel) 76%, black) 100%)",
          border: "1px solid color-mix(in srgb, var(--brand) 50%, transparent)",
          boxShadow:
            "0 22px 50px rgba(0,0,0,.55), 0 0 44px color-mix(in srgb, var(--brand) 30%, transparent), inset 0 1px 0 rgba(255,255,255,.08)",
        }}
      >
        {/* Atmosphere: stars → nebulas → planet/moons → cloudbank (back to front) */}
        <span aria-hidden style={heroStars} />
        <span aria-hidden style={nebulaViolet} />
        <span aria-hidden style={nebulaMagenta} />
        <span aria-hidden style={heroGlow} />
        <RingedPlanet />
        <span aria-hidden style={heroMoon} />
        <span aria-hidden style={heroMoonSmall} />
        <span aria-hidden style={cloudLeft} />
        <span aria-hidden style={cloudRight} />
        <Sparkle top="22%" left="10%" />
        <Sparkle top="30%" left="86%" delay="0.5s" />
        <Sparkle top="56%" left="6%" delay="1s" />
        <Sparkle top="64%" left="93%" delay="0.3s" />
        <Sparkle top="14%" left="55%" delay="0.8s" />

        {/* HUD row */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button
            type="button"
            aria-label={t.common.backToHub}
            onClick={onExit}
            style={{
              flex: "none",
              width: 38,
              height: 38,
              borderRadius: 12,
              border: "1px solid color-mix(in srgb, var(--brand) 40%, transparent)",
              background: "color-mix(in srgb, var(--panel) 60%, transparent)",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            ←
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 12px",
                borderRadius: 999,
                background: "linear-gradient(180deg, var(--panel2), var(--panel))",
                border: "1px solid var(--line)",
              }}
            >
              <CoinIcon size={16} />
              <span className="display" style={{ fontSize: 16, color: "var(--amber)", lineHeight: 1 }}>
                {coins}
              </span>
            </span>
            <button
              type="button"
              aria-label={t.common.backToHub}
              onClick={onExit}
              style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", borderRadius: "50%" }}
            >
              <Avatar size={40} online ring="var(--brand)" preset={avatarPreset} frame={equippedFrame} />
            </button>
          </div>
        </div>

        {/* Title block: crown on a light stage, dimensional wordmark, quest chips */}
        <div style={{ position: "relative", textAlign: "center", marginTop: 8 }}>
          {/* Crown stage: ray burst + gold glow disc the crown hovers over */}
          <span aria-hidden style={{ position: "relative", display: "inline-block", width: 64, height: 44 }}>
            <span style={crownRays} />
            <span style={crownGlow} />
            <span className="rr-float" style={{ position: "absolute", left: "50%", top: 2, transform: "translateX(-50%)" }}>
              <CrownIcon size={36} />
            </span>
          </span>

          {/* Wordmark with a blurred glow copy behind it for depth */}
          <div style={{ position: "relative", marginTop: -6 }}>
            <div
              aria-hidden
              className="display display-3d gold"
              style={{
                position: "absolute",
                inset: 0,
                fontSize: "clamp(42px, 13vw, 60px)",
                lineHeight: 0.95,
                filter: "blur(10px)",
                opacity: 0.55,
                pointerEvents: "none",
              }}
            >
              {t.campaign.title}
            </div>
            <Display pop gold style={{ position: "relative", fontSize: "clamp(42px, 13vw, 60px)", lineHeight: 0.95 }}>
              {t.campaign.title}
            </Display>
            {/* Under-shadow so the wordmark sits above the cloudbank */}
            <span aria-hidden style={titleShadow} />
          </div>

          <div
            style={{
              fontSize: 12,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontWeight: 800,
              color: "var(--brand-2)",
              marginTop: 8,
            }}
          >
            {t.campaign.heroTagline}
          </div>

          {/* Quest chips: the three-beat promise of the mode */}
          <div
            style={{
              position: "relative",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 6,
              marginTop: 11,
            }}
          >
            <QuestChip glyph="⛰️" label={t.campaign.heroChipWorlds} />
            <QuestChip coin label={t.campaign.heroChipCoins} />
            <QuestChip glyph="🎨" label={t.campaign.heroChipCosmetics} />
          </div>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              marginTop: 12,
              padding: "5px 13px",
              borderRadius: 999,
              background: "color-mix(in srgb, var(--panel) 55%, transparent)",
              border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)",
            }}
          >
            <CrownIcon size={14} />
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--amber)" }}>
              {fmt(t.campaign.cleared, { cleared: j.cleared, total: j.total })}
            </span>
          </span>
        </div>
      </section>

      {/* Soft glow pooling under the banner so it reads as floating above the page */}
      <span aria-hidden style={floatGlow} />
    </div>
  );
}

function QuestChip({ label, glyph, coin = false }: { label: string; glyph?: string; coin?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: 999,
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--brand) 55%, var(--panel2)), var(--panel))",
        border: "1px solid color-mix(in srgb, var(--brand-2) 45%, transparent)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.1)",
        fontSize: 9.5,
        fontWeight: 900,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: "var(--text)",
        whiteSpace: "nowrap",
      }}
    >
      {coin ? <CoinIcon size={11} /> : <span className="emoji" style={{ fontSize: 10 }}>{glyph}</span>}
      {/* The chip is a nowrap uppercase pill; a longer localized label shrinks to fit a capped width
          rather than forcing the chip oversize / wrapping the row. */}
      <FitText as="span" size={9.5} min={0.66} style={{ display: "inline-block", maxWidth: 96, whiteSpace: "nowrap", overflow: "hidden" }}>
        {label}
      </FitText>
    </span>
  );
}

function Sparkle({ top, left, delay = "0s" }: { top: string; left: string; delay?: string }) {
  return (
    <span
      aria-hidden
      className="rr-twinkle"
      style={{
        position: "absolute",
        top,
        left,
        width: 4,
        height: 4,
        borderRadius: "50%",
        background: "#fff",
        boxShadow: "0 0 6px #fff, 0 0 10px rgba(255,201,30,.6)",
        animationDelay: delay,
      }}
    />
  );
}

/** A distant ringed planet (disc + tilted ring), far right of the title. */
function RingedPlanet() {
  return (
    <span aria-hidden style={{ position: "absolute", top: "47%", left: 14, width: 34, height: 34, pointerEvents: "none" }}>
      <span
        style={{
          position: "absolute",
          inset: 5,
          borderRadius: "50%",
          background:
            "radial-gradient(120% 120% at 35% 30%, color-mix(in srgb, var(--brand-2) 70%, white), var(--brand) 65%, color-mix(in srgb, var(--brand) 60%, black) 100%)",
          boxShadow: "0 0 14px color-mix(in srgb, var(--brand-2) 45%, transparent)",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: -4,
          right: -4,
          top: "50%",
          height: 10,
          marginTop: -5,
          borderRadius: "50%",
          border: "1.5px solid rgba(255,201,30,.55)",
          transform: "rotate(-18deg)",
        }}
      />
    </span>
  );
}

const heroStars: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  backgroundImage:
    "radial-gradient(1.5px 1.5px at 25% 24%, rgba(255,255,255,.7), transparent)," +
    "radial-gradient(1.5px 1.5px at 70% 16%, rgba(255,255,255,.5), transparent)," +
    "radial-gradient(1.2px 1.2px at 44% 70%, rgba(199,180,255,.6), transparent)," +
    "radial-gradient(1.6px 1.6px at 82% 78%, rgba(255,201,30,.5), transparent)," +
    "radial-gradient(1px 1px at 15% 86%, rgba(255,255,255,.45), transparent)," +
    "radial-gradient(1.3px 1.3px at 8% 40%, rgba(255,255,255,.5), transparent)," +
    "radial-gradient(1px 1px at 60% 44%, rgba(199,180,255,.5), transparent)," +
    "radial-gradient(1.4px 1.4px at 92% 30%, rgba(255,255,255,.55), transparent)," +
    "radial-gradient(1px 1px at 36% 10%, rgba(255,201,30,.45), transparent)",
};

const nebulaViolet: React.CSSProperties = {
  position: "absolute",
  top: "-12%",
  left: "-16%",
  width: 220,
  height: 170,
  borderRadius: "50%",
  background: "radial-gradient(circle, color-mix(in srgb, var(--brand) 32%, transparent), transparent 68%)",
  filter: "blur(14px)",
  pointerEvents: "none",
};

const nebulaMagenta: React.CSSProperties = {
  position: "absolute",
  bottom: "-18%",
  right: "-14%",
  width: 240,
  height: 180,
  borderRadius: "50%",
  background: "radial-gradient(circle, color-mix(in srgb, var(--pink) 22%, transparent), transparent 66%)",
  filter: "blur(16px)",
  pointerEvents: "none",
};

const heroGlow: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "30%",
  width: 230,
  height: 230,
  transform: "translateX(-50%)",
  borderRadius: "50%",
  background: "radial-gradient(circle, rgba(255,196,49,.2), transparent 65%)",
  filter: "blur(8px)",
  pointerEvents: "none",
};

const heroMoon: React.CSSProperties = {
  position: "absolute",
  top: 58,
  right: 22,
  width: 46,
  height: 46,
  borderRadius: "50%",
  background:
    "radial-gradient(120% 120% at 35% 30%, color-mix(in srgb, var(--brand-2) 55%, white), color-mix(in srgb, var(--brand) 18%, transparent) 60%, transparent 72%)",
  boxShadow: "0 0 26px color-mix(in srgb, var(--brand-2) 35%, transparent)",
  pointerEvents: "none",
};

const heroMoonSmall: React.CSSProperties = {
  position: "absolute",
  top: "68%",
  right: "16%",
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: "radial-gradient(120% 120% at 35% 30%, rgba(255,233,170,.55), rgba(255,201,30,.15) 65%, transparent 75%)",
  boxShadow: "0 0 12px rgba(255,201,30,.3)",
  pointerEvents: "none",
};

// Low cloudbank along the banner's bottom edge — the title floats above it.
const cloudLeft: React.CSSProperties = {
  position: "absolute",
  bottom: -26,
  left: -30,
  width: "65%",
  height: 64,
  borderRadius: "50%",
  background:
    "radial-gradient(circle, color-mix(in srgb, var(--brand) 45%, transparent), color-mix(in srgb, var(--brand) 22%, transparent) 60%, transparent 75%)",
  filter: "blur(10px)",
  pointerEvents: "none",
};

const cloudRight: React.CSSProperties = {
  position: "absolute",
  bottom: -30,
  right: -36,
  width: "70%",
  height: 70,
  borderRadius: "50%",
  background:
    "radial-gradient(circle, color-mix(in srgb, var(--brand) 48%, transparent), color-mix(in srgb, var(--brand) 24%, transparent) 58%, transparent 75%)",
  filter: "blur(11px)",
  pointerEvents: "none",
};

const crownRays: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 86,
  height: 86,
  transform: "translate(-50%, -50%)",
  borderRadius: "50%",
  background:
    "conic-gradient(from -8deg, rgba(255,201,30,.28), transparent 14deg, rgba(255,201,30,.22) 30deg, transparent 44deg, rgba(255,201,30,.28) 60deg, transparent 74deg, rgba(255,201,30,.22) 90deg, transparent 104deg, rgba(255,201,30,.28) 120deg, transparent 134deg, rgba(255,201,30,.22) 150deg, transparent 164deg, rgba(255,201,30,.28) 180deg, transparent 194deg, rgba(255,201,30,.22) 210deg, transparent 224deg, rgba(255,201,30,.28) 240deg, transparent 254deg, rgba(255,201,30,.22) 270deg, transparent 284deg, rgba(255,201,30,.28) 300deg, transparent 314deg, rgba(255,201,30,.22) 330deg, transparent 344deg)",
  maskImage: "radial-gradient(circle, black 20%, transparent 70%)",
  WebkitMaskImage: "radial-gradient(circle, black 20%, transparent 70%)",
  pointerEvents: "none",
};

const crownGlow: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 52,
  height: 52,
  transform: "translate(-50%, -50%)",
  borderRadius: "50%",
  background: "radial-gradient(circle, rgba(255,201,30,.38), transparent 68%)",
  filter: "blur(3px)",
  pointerEvents: "none",
};

const titleShadow: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: -12,
  width: "62%",
  height: 16,
  transform: "translateX(-50%)",
  borderRadius: "50%",
  background: "radial-gradient(circle, rgba(0,0,0,.55), transparent 70%)",
  filter: "blur(4px)",
  pointerEvents: "none",
};

const floatGlow: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: -14,
  width: "78%",
  height: 26,
  transform: "translateX(-50%)",
  borderRadius: "50%",
  background: "radial-gradient(circle, color-mix(in srgb, var(--brand) 32%, transparent), transparent 70%)",
  filter: "blur(10px)",
  pointerEvents: "none",
  zIndex: -1,
};
