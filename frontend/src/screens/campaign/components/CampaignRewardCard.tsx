import type { CampaignLadderResponse } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { coinsToNextChest } from "@/lib/campaign";
import { CoinIcon } from "@/ui/CoinIcon";

/** Daily-chest reward card: today's campaign coins filling a chunky gold meter that runs INTO a big
 * treasure chest — a reward object, not a status bar. Honest framing (real cap, no invented reward
 * amounts; coins are cosmetic). The chest pokes above the card edge for toy-like depth. */
export function CampaignRewardCard({ ladder }: { ladder: CampaignLadderResponse }) {
  const t = useT();
  const earned = ladder.daily_coins_earned;
  const cap = ladder.daily_coins_cap;
  const remaining = coinsToNextChest(ladder);
  const full = remaining <= 0;
  const pct = cap > 0 ? Math.min(100, Math.round((earned / cap) * 100)) : 0;

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 22,
          padding: "14px 112px 14px 16px",
          minHeight: 96,
          background: "linear-gradient(180deg, rgba(64,40,10,.6), rgba(22,13,36,.94))",
          border: "1.5px solid rgba(255,201,30,.5)",
          boxShadow:
            "0 14px 34px rgba(0,0,0,.45), 0 0 22px rgba(255,201,30,.16), inset 0 1px 0 rgba(255,255,255,.08)",
        }}
      >
        {/* Gold hearth glow where the chest sits */}
        <span aria-hidden style={chestGlow} />
        <span aria-hidden style={speckles} />

        <div style={{ position: "relative" }}>
          <div className="display" style={{ fontSize: 13, letterSpacing: 1.6, color: "var(--amber)" }}>
            {t.campaign.dailyChest}
          </div>

          {/* Big count line: 40 / 300 coins today */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 5 }}>
            <CoinIcon size={16} />
            <span className="display" style={{ fontSize: 22, lineHeight: 1, color: "var(--amber)" }}>
              {earned}
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--muted)" }}>/ {cap}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--faint)" }}>{t.campaign.coinsToday}</span>
          </div>

          {/* Chunky meter that runs toward the chest */}
          <div
            style={{
              position: "relative",
              marginTop: 9,
              height: 16,
              borderRadius: 999,
              background: "rgba(8,4,20,.75)",
              border: "1px solid rgba(255,201,30,.3)",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,.55)",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                borderRadius: 999,
                background: "linear-gradient(180deg, #ffe98e 0%, #ffc931 45%, #f28a16 100%)",
                boxShadow: "0 0 14px rgba(255,193,52,.6)",
                transition: "width 450ms ease",
              }}
            >
              {/* top shine stripe */}
              <span
                aria-hidden
                style={{
                  display: "block",
                  margin: "2px 8px 0",
                  height: 4,
                  borderRadius: 999,
                  background: "rgba(255,255,255,.45)",
                  opacity: pct > 6 ? 1 : 0,
                }}
              />
            </div>
            {/* glowing coin cap at the fill tip */}
            {pct > 2 && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${pct}%`,
                  transform: "translate(-60%, -50%)",
                  filter: "drop-shadow(0 0 6px rgba(255,201,30,.8))",
                  lineHeight: 0,
                }}
              >
                <CoinIcon size={18} />
              </span>
            )}
          </div>

          <div style={{ marginTop: 7, fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
            {full ? t.campaign.chestFull : fmt(t.campaign.chestToFill, { n: remaining })}
          </div>
        </div>
      </div>

      {/* The chest object — outside the clipped card so it pokes above the top edge */}
      <Chest full={full} filling={pct >= 50} />
    </div>
  );
}

const chestGlow: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  right: -28,
  width: 150,
  height: 150,
  transform: "translateY(-50%)",
  borderRadius: "50%",
  background: "radial-gradient(circle, rgba(255,201,30,.3), transparent 66%)",
  filter: "blur(6px)",
  pointerEvents: "none",
};

const speckles: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  backgroundImage:
    "radial-gradient(1.4px 1.4px at 18% 22%, rgba(255,222,120,.6), transparent)," +
    "radial-gradient(1.2px 1.2px at 44% 80%, rgba(255,255,255,.4), transparent)," +
    "radial-gradient(1.5px 1.5px at 64% 16%, rgba(255,222,120,.5), transparent)",
  opacity: 0.6,
};

/** A chunky CSS treasure chest: lid with specular highlight, strapped body, lock plate, platform
 * shadow. Coins peek out at ≥50%; the lid lifts and it sparkles when today's chest is full. */
function Chest({ full, filling }: { full: boolean; filling: boolean }) {
  return (
    <span
      aria-hidden
      className={full ? "rr-glow-pulse" : undefined}
      style={{
        position: "absolute",
        top: -10,
        right: 14,
        width: 86,
        height: 78,
        borderRadius: 16,
        pointerEvents: "none",
      }}
    >
      {/* platform shadow */}
      <span
        style={{
          position: "absolute",
          left: "50%",
          bottom: -7,
          width: 78,
          height: 14,
          transform: "translateX(-50%)",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,0,0,.55), transparent 70%)",
          filter: "blur(3px)",
        }}
      />
      {/* coins peeking from the seam */}
      {(filling || full) && (
        <>
          <span style={{ position: "absolute", top: 22, left: 10, transform: "rotate(-14deg)", lineHeight: 0 }}>
            <CoinIcon size={16} />
          </span>
          <span style={{ position: "absolute", top: 18, left: 36, transform: "rotate(8deg)", lineHeight: 0 }}>
            <CoinIcon size={18} />
          </span>
          <span style={{ position: "absolute", top: 23, left: 60, transform: "rotate(18deg)", lineHeight: 0 }}>
            <CoinIcon size={15} />
          </span>
        </>
      )}
      {/* body */}
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "58%",
          borderRadius: "8px 8px 14px 14px",
          background: "linear-gradient(180deg, #c8841a 0%, #a3650e 55%, #7a4a08 100%)",
          border: "2px solid #5c3a06",
          boxShadow: "inset 0 2px 0 rgba(255,255,255,.22), 0 8px 18px rgba(0,0,0,.4)",
        }}
      >
        {/* straps */}
        <span style={strap("18%")} />
        <span style={strap("72%")} />
      </span>
      {/* lid */}
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "46%",
          borderRadius: "16px 16px 5px 5px",
          background: "linear-gradient(180deg, #ffe487 0%, #ffcf4d 60%, #d99b21 100%)",
          border: "2px solid #5c3a06",
          boxShadow: "inset 0 2px 0 rgba(255,255,255,.45)",
          transformOrigin: "top center",
          transform: full ? "rotateX(38deg)" : "none",
          transition: "transform 350ms ease",
        }}
      >
        {/* specular highlight */}
        <span
          style={{
            position: "absolute",
            top: 5,
            left: 10,
            width: 26,
            height: 6,
            borderRadius: 999,
            background: "rgba(255,255,255,.55)",
            transform: "rotate(-6deg)",
          }}
        />
      </span>
      {/* lock plate */}
      <span
        style={{
          position: "absolute",
          top: "38%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 18,
          height: 20,
          borderRadius: 6,
          background: "linear-gradient(180deg, #4a2f04, #2e1c02)",
          border: "2px solid #ffd24a",
          boxShadow: "0 2px 6px rgba(0,0,0,.4)",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 4,
            left: "50%",
            transform: "translateX(-50%)",
            width: 5,
            height: 8,
            borderRadius: "50% 50% 2px 2px",
            background: "#ffd24a",
          }}
        />
      </span>
      {full && (
        <>
          <span className="rr-twinkle" style={{ position: "absolute", top: -8, right: -2, fontSize: 14, color: "#fff3c4" }}>
            ✦
          </span>
          <span
            className="rr-twinkle"
            style={{ position: "absolute", top: 6, left: -8, fontSize: 11, color: "#ffe487", animationDelay: "0.6s" }}
          >
            ✦
          </span>
        </>
      )}
    </span>
  );
}

function strap(left: string): React.CSSProperties {
  return {
    position: "absolute",
    top: -2,
    bottom: -2,
    left,
    width: 8,
    background: "linear-gradient(180deg, #ffd24a, #b97b12)",
    border: "1px solid #5c3a06",
    borderRadius: 3,
  };
}
