import type { CampaignLevel } from "@/api/client";
import type { WorldTheme } from "@/lib/campaign";
import { fmt, useT } from "@/i18n/useT";
import { clearLabel } from "@/lib/campaign";
import { nodeFrameSpec } from "@/screens/campaign/components/roadStyles";
import { CrownIcon } from "@/ui/CrownIcon";
import { FitText } from "@/ui/FitText";

/** A premium milestone on the quest road. Every node sits on a grounded pedestal (never floating),
 * wrapped in the world's NODE FRAME (Science = orbital station with crossed atom rings). The CURRENT
 * mission is a full hero station — a pedestal + play module + a card naming the mission and CTA — so
 * it's unmistakably the next thing to tap. `depthScale` (1.0 near → ~0.82 far) recedes future nodes. */
const LABEL_HALO = "0 1px 2px rgba(0,0,0,.85), 0 0 7px rgba(6,3,16,.8)";

export function LevelNode({
  level,
  isCurrent,
  theme,
  depthScale,
  showLockedHint,
  labelShift = 0,
  onPlay,
}: {
  level: CampaignLevel;
  isCurrent: boolean;
  theme: WorldTheme;
  depthScale: number;
  showLockedHint: boolean;
  labelShift?: number;
  onPlay: () => void;
}) {
  const t = useT();
  const locked = !level.unlocked;

  // The current mission gets the dedicated grounded hero treatment.
  if (isCurrent && !locked) return <HeroStation level={level} theme={theme} onPlay={onPlay} />;

  const boss = level.is_boss;
  const cleared = level.cleared;
  const recede = locked && !boss ? depthScale : 1;

  const status = locked
    ? showLockedHint
      ? t.campaign.locked
      : fmt(t.campaign.levelLine, { n: level.level_number })
    : cleared
      ? fmt(t.campaign.clearedBest, { label: clearLabel(t, level.clear_status), n: level.best_correct })
      : fmt(t.campaign.levelLine, { n: level.level_number });

  const Tag = locked ? "div" : "button";
  return (
    <Tag
      {...(locked ? {} : { type: "button" as const, onClick: onPlay })}
      aria-label={
        locked
          ? fmt(t.campaign.ariaLockedLevel, { n: level.level_number, title: level.title })
          : fmt(t.campaign.ariaPlayLevel, { n: level.level_number, title: level.title })
      }
      onPointerDown={locked ? undefined : (e) => (e.currentTarget.style.transform = "scale(.94)")}
      onPointerUp={locked ? undefined : (e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={locked ? undefined : (e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 9,
        padding: "8px 10px",
        background: "none",
        border: "none",
        color: "inherit",
        cursor: locked ? "default" : "pointer",
        textAlign: "center",
        fontFamily: "inherit",
        transition: "transform 120ms ease",
      }}
    >
      <span style={{ position: "relative", display: "inline-block" }}>
        {boss && !cleared && <span style={bossBanner}>{t.campaign.boss}</span>}
        <Station level={level} theme={theme} recede={recede} />
      </span>

      <span style={{ display: "block", width: 120, transform: `translateX(${labelShift}px)` }}>
        {/* The title lives in a fixed 120px, 2-line clamp box — a longer localized title SHRINKS to
            fit both axes instead of being cut off by the clamp. */}
        <FitText
          as="span"
          size={12}
          min={0.62}
          axis="both"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            overflowWrap: "break-word",
            fontWeight: 800,
            color: locked ? "var(--muted)" : "var(--text)",
            lineHeight: 1.25,
            textShadow: LABEL_HALO,
          }}
        >
          {level.title}
        </FitText>
        <span style={{ display: "block", marginTop: 4, fontSize: 10.5, fontWeight: 700, color: locked ? "var(--faint)" : "var(--muted)", textShadow: LABEL_HALO }}>
          {status}
        </span>
      </span>
    </Tag>
  );
}

/** A grounded pedestal under any node — a glowing elliptical platform so the station sits ON the map
 * rather than floating. Brighter for reachable nodes, dim for locked. */
function Pedestal({ size, accent, dim }: { size: number; accent: string; dim: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        bottom: -size * 0.16,
        left: "50%",
        width: size * 1.18,
        height: size * 0.34,
        transform: "translateX(-50%)",
        borderRadius: "50%",
        background: dim
          ? "radial-gradient(circle, rgba(120,100,200,.18), transparent 70%)"
          : `radial-gradient(circle, ${accent}40, rgba(0,0,0,.35) 52%, transparent 72%)`,
        filter: "blur(1.5px)",
      }}
    />
  );
}

/** An illustrated node medallion (worlds with a full art pack): the PNG carries the frame + state
 * iconography (check/play/lock/crown) and its built-in bottom sub-badge circle hosts the CSS level
 * number — numbers/labels are never baked into art. Locked recedes + dims; perfect keeps its star. */
function ArtStation({ level, theme, recede }: { level: CampaignLevel; theme: WorldTheme; recede: number }) {
  const art = theme.art!.nodeImages!;
  const locked = !level.unlocked;
  const boss = level.is_boss;
  const cleared = level.cleared;
  const perfect = level.clear_status === "perfect";
  // Boss keeps its crowned medallion even while locked (dimmed) — the summit should always read as
  // the boss; ordinary locked levels take the sealed-lock medallion.
  const src = boss ? art.boss : locked ? art.locked : cleared ? art.completed : art.current;
  const base = boss ? 92 : cleared ? 70 : 66;
  const size = Math.round(base * recede);
  // The medallion PNGs share a ~0.84 W/H ratio (disc + bottom sub-badge).
  const h = Math.round(size / 0.84);

  return (
    <span style={{ position: "relative", display: "grid", placeItems: "center", width: size, height: h }}>
      <Pedestal size={size} accent={theme.accent} dim={locked} />
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          position: "relative",
          width: size,
          height: h,
          objectFit: "contain",
          display: "block",
          filter: locked
            ? "brightness(0.82) saturate(0.85) drop-shadow(0 6px 10px rgba(0,0,0,.5))"
            : `drop-shadow(0 6px 12px rgba(0,0,0,.55))${cleared || boss ? ` drop-shadow(0 0 10px ${theme.accent}55)` : ""}`,
        }}
      />
      {/* The level number, seated in the art's bottom sub-badge circle. */}
      <span
        className="display"
        style={{
          position: "absolute",
          bottom: h * 0.015,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: Math.max(11, size * 0.17),
          lineHeight: 1,
          color: locked ? "color-mix(in srgb, var(--text) 62%, var(--muted))" : "#fff",
          textShadow: "0 1px 2px rgba(0,0,0,.7)",
        }}
      >
        {level.level_number}
      </span>
      {/* perfect-clear corner star */}
      {cleared && perfect && (
        <span aria-hidden style={{ position: "absolute", top: -2, right: -4, fontSize: 15, color: "color-mix(in srgb, var(--amber) 65%, white)", filter: "drop-shadow(0 0 4px var(--amber))" }}>
          ★
        </span>
      )}
    </span>
  );
}

/** The non-current node disc + the world's frame. Completed = glowing badge with a check (+ star for
 * perfect); locked = a sealed pod with the lock built into the frame; available = a numbered station;
 * boss = a crowned station. */
function Station({ level, theme, recede }: { level: CampaignLevel; theme: WorldTheme; recede: number }) {
  const accent = theme.accent;
  const locked = !level.unlocked;
  const boss = level.is_boss;
  const cleared = level.cleared;
  const perfect = level.clear_status === "perfect";

  // Worlds with a full illustrated node pack render the art medallions instead of the CSS disc.
  if (theme.art?.nodeImages) return <ArtStation level={level} theme={theme} recede={recede} />;

  const base = boss ? 86 : cleared ? 64 : 60;
  const size = Math.round(base * recede);

  const ring = locked
    ? "color-mix(in srgb, var(--brand-2) 52%, transparent)"
    : boss
      ? "color-mix(in srgb, var(--pink) 70%, white)"
      : perfect
        ? "var(--amber)"
        : accent;

  const fill = locked
    ? "radial-gradient(120% 120% at 50% 34%, color-mix(in srgb, var(--brand) 42%, var(--panel2)), var(--panel))"
    : boss
      ? "radial-gradient(120% 120% at 50% 36%, color-mix(in srgb, var(--pink) 60%, black), color-mix(in srgb, var(--pink) 35%, black))"
      : cleared
        ? perfect
          ? "radial-gradient(120% 120% at 50% 34%, color-mix(in srgb, var(--amber) 70%, black), color-mix(in srgb, var(--amber) 42%, black))"
          : `radial-gradient(120% 120% at 50% 34%, ${accent}, color-mix(in srgb, ${accent} 55%, black))`
        : `radial-gradient(120% 120% at 50% 34%, color-mix(in srgb, ${accent} 38%, var(--panel2)), var(--panel))`;

  const glow = boss
    ? "0 0 24px color-mix(in srgb, var(--pink) 40%, transparent)"
    : cleared
      ? `0 0 16px color-mix(in srgb, ${perfect ? "var(--amber)" : accent} 45%, transparent)`
      : "none";

  return (
    <span style={{ position: "relative", display: "grid", placeItems: "center", width: size, height: size }}>
      <Pedestal size={size} accent={accent} dim={locked} />
      <NodeFrameDecor theme={theme} size={size} accent={accent} locked={locked} isCurrent={false} />

      <span
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: fill,
          border: `${boss ? 4 : 3}px solid ${ring}`,
          boxShadow: glow,
        }}
      >
        {locked ? (
          <LockSeal size={size} />
        ) : boss ? (
          <CrownIcon size={size * 0.46} />
        ) : cleared ? (
          <CheckMark size={size * 0.5} perfect={perfect} />
        ) : (
          <span className="display" style={{ fontSize: size * 0.42, color: "var(--text)" }}>
            {level.level_number}
          </span>
        )}
      </span>

      {/* perfect-clear corner star */}
      {cleared && perfect && (
        <span aria-hidden style={{ position: "absolute", top: -3, right: -3, fontSize: 14, color: "color-mix(in srgb, var(--amber) 65%, white)", filter: "drop-shadow(0 0 4px var(--amber))" }}>
          ★
        </span>
      )}
      {/* level-number tab on iconographic stations so stops stay countable */}
      {!locked && (cleared || boss) && (
        <span style={levelTab(boss)}>{level.level_number}</span>
      )}
    </span>
  );
}

/** The CURRENT mission — a grounded hero station: pedestal + play module (with the world frame) + a
 * card naming the mission and the CTA. The whole thing is the tap target. */
function HeroStation({ level, theme, onPlay }: { level: CampaignLevel; theme: WorldTheme; onPlay: () => void }) {
  const t = useT();
  const accent = theme.accent;
  const size = 90;
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={fmt(t.campaign.ariaCurrentLevel, { n: level.level_number, title: level.title })}
      onPointerDown={(e) => (e.currentTarget.style.transform = "scale(.97)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
        padding: 0,
        background: "none",
        border: "none",
        color: "inherit",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "transform 130ms ease",
        width: 212,
      }}
    >
      {/* play module on its pedestal — the illustrated play medallion when the world has node art,
          the CSS gold module otherwise */}
      <span style={{ position: "relative", display: "grid", placeItems: "center", width: size, height: size, zIndex: 1 }}>
        <Pedestal size={size} accent={accent} dim={false} />
        {/* soft hero aura */}
        <span aria-hidden style={{ position: "absolute", inset: -14, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in srgb, var(--amber) 30%, transparent), transparent 68%)" }} />
        {theme.art?.nodeImages ? (
          <span className="rr-ring-pulse" style={{ position: "relative", display: "grid", placeItems: "center" }}>
            <img
              src={theme.art.nodeImages.current}
              alt=""
              aria-hidden
              draggable={false}
              style={{
                width: size,
                height: Math.round(size / 0.84),
                objectFit: "contain",
                display: "block",
                filter: "drop-shadow(0 8px 16px rgba(0,0,0,.55)) drop-shadow(0 0 14px color-mix(in srgb, var(--amber) 45%, transparent))",
              }}
            />
            {/* level number in the art's bottom sub-badge */}
            <span
              className="display"
              style={{
                position: "absolute",
                bottom: (size / 0.84) * 0.015,
                left: "50%",
                transform: "translateX(-50%)",
                fontSize: size * 0.17,
                lineHeight: 1,
                color: "#fff",
                textShadow: "0 1px 2px rgba(0,0,0,.7)",
              }}
            >
              {level.level_number}
            </span>
          </span>
        ) : (
          <>
            <NodeFrameDecor theme={theme} size={size} accent={accent} locked={false} isCurrent />
            <span
              className="rr-ring-pulse"
              style={{
                position: "relative",
                width: size,
                height: size,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: "radial-gradient(120% 120% at 50% 32%, color-mix(in srgb, var(--amber) 92%, white), var(--amber) 55%, color-mix(in srgb, var(--amber) 60%, black))",
                border: "4px solid color-mix(in srgb, var(--amber) 80%, white)",
                boxShadow: "0 0 26px color-mix(in srgb, var(--amber) 55%, transparent), inset 0 2px 6px rgba(255,255,255,.5)",
              }}
            >
              <PlayTriangle size={size * 0.3} dark />
            </span>
          </>
        )}
      </span>

      {/* the mission card */}
      <span
        style={{
          marginTop: -14,
          paddingTop: 18,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 5,
          borderRadius: 16,
          padding: "18px 12px 12px",
          background: "linear-gradient(180deg, rgba(20,12,40,.92), rgba(12,7,26,.92))",
          border: "1px solid color-mix(in srgb, var(--amber) 40%, transparent)",
          boxShadow: "0 10px 26px rgba(0,0,0,.5), 0 0 22px color-mix(in srgb, var(--amber) 18%, transparent)",
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--amber)" }}>
          {t.campaign.currentMission}
        </span>
        <span className="display" style={{ fontSize: 16, lineHeight: 1.1, color: "var(--text)", textAlign: "center" }}>
          {level.title}
        </span>
        <span
          style={{
            marginTop: 4,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "7px 16px",
            borderRadius: 999,
            background: "linear-gradient(180deg, color-mix(in srgb, var(--amber) 92%, white), var(--amber))",
            color: "var(--btnText)",
            fontWeight: 900,
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(0,0,0,.4)",
          }}
        >
          <PlayTriangle size={9} dark />
          {t.campaign.playLine}
        </span>
      </span>
    </button>
  );
}

/** The per-world frame around a node disc. Science (orbit) = crossed atom ellipses + an electron;
 * other worlds use simpler halo/ticks/bulbs. `theme.art.nodeFrameImage` overrides with art. */
function NodeFrameDecor({ theme, size, accent, locked, isCurrent }: { theme: WorldTheme; size: number; accent: string; locked: boolean; isCurrent: boolean }) {
  if (theme.art?.nodeFrameImage) {
    return (
      <img aria-hidden src={theme.art.nodeFrameImage} alt="" style={{ position: "absolute", inset: -size * 0.28, width: size * 1.56, height: size * 1.56, objectFit: "contain", opacity: locked ? 0.5 : 1, pointerEvents: "none" }} />
    );
  }
  const spec = nodeFrameSpec(theme.nodeFrame);
  const c = locked ? "color-mix(in srgb, var(--brand-2) 45%, transparent)" : accent;
  const op = locked ? 0.45 : 0.9;

  if (spec.orbit) {
    // Science: two crossed orbital ellipses (atom) with a travelling electron.
    const ow = size * 1.62;
    const oh = size * 0.82;
    const ring = (rot: number, o: number): React.CSSProperties => ({
      position: "absolute",
      inset: 0,
      margin: "auto",
      width: ow,
      height: oh,
      borderRadius: "50%",
      border: `${isCurrent ? 2 : 1.5}px solid ${c}`,
      opacity: o,
      transform: `rotate(${rot}deg)`,
    });
    return (
      <span aria-hidden className={isCurrent && !locked ? "rr-orbit" : undefined} style={{ position: "absolute", width: ow, height: ow, display: "grid", placeItems: "center", pointerEvents: "none" }}>
        <span style={ring(-22, op)} />
        <span style={ring(34, op * 0.7)} />
        {!locked && (
          <span style={{ position: "absolute", top: "12%", left: "50%", width: Math.max(5, size * 0.1), height: Math.max(5, size * 0.1), marginLeft: -size * 0.05, borderRadius: "50%", background: theme.spark, boxShadow: `0 0 7px ${theme.spark}` }} />
        )}
      </span>
    );
  }
  if (spec.halo) {
    return <span aria-hidden style={{ position: "absolute", width: size * 1.26, height: size * 1.26, borderRadius: "50%", border: `2px ${theme.nodeFrame === "tome" ? "double" : "solid"} ${c}`, opacity: op, pointerEvents: "none" }} />;
  }
  if (spec.bulbs) {
    const r = size * 0.66;
    return (
      <span aria-hidden style={{ position: "absolute", width: size * 1.32, height: size * 1.32, pointerEvents: "none" }}>
        {[0, 60, 120, 180, 240, 300].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          return <span key={deg} style={{ position: "absolute", top: `calc(50% + ${Math.sin(rad) * r}px)`, left: `calc(50% + ${Math.cos(rad) * r}px)`, width: 4, height: 4, marginTop: -2, marginLeft: -2, borderRadius: "50%", background: locked ? c : "#fff", boxShadow: locked ? "none" : `0 0 6px ${accent}` }} />;
        })}
      </span>
    );
  }
  if (spec.ticks > 0) {
    const count = spec.ticks;
    const r = size * 0.62;
    const step = 360 / (count === 4 ? 4 : 3);
    const start = count === 4 ? 0 : -90;
    return (
      <span aria-hidden style={{ position: "absolute", width: size * 1.3, height: size * 1.3, pointerEvents: "none" }}>
        {Array.from({ length: count }, (_, i) => {
          const deg = start + i * step;
          const rad = (deg * Math.PI) / 180;
          return <span key={i} style={{ position: "absolute", top: `calc(50% + ${Math.sin(rad) * r}px)`, left: `calc(50% + ${Math.cos(rad) * r}px)`, width: 7, height: 2.5, marginTop: -1.25, marginLeft: -3.5, borderRadius: 2, background: c, opacity: op, transform: `rotate(${deg + 90}deg)` }} />;
        })}
      </span>
    );
  }
  return null;
}

/** A sealed lab-pod lock built into the node (not a bare padlock emoji). */
function LockSeal({ size }: { size: number }) {
  const s = size * 0.4;
  return (
    <span aria-hidden style={{ position: "relative", width: s, height: s, display: "grid", placeItems: "center" }}>
      {/* shackle */}
      <span style={{ position: "absolute", top: 0, width: s * 0.52, height: s * 0.5, borderRadius: "999px 999px 0 0", border: `${Math.max(2, s * 0.13)}px solid color-mix(in srgb, var(--brand-2) 70%, white)`, borderBottom: "none", opacity: 0.85 }} />
      {/* body */}
      <span style={{ position: "absolute", bottom: 0, width: s, height: s * 0.62, borderRadius: 3, background: "color-mix(in srgb, var(--brand) 45%, var(--panel))", border: "1.5px solid color-mix(in srgb, var(--brand-2) 60%, white)" }} />
    </span>
  );
}

/** A crisp drawn check for a cleared station (no emoji). */
function CheckMark({ size, perfect }: { size: number; perfect: boolean }) {
  const color = perfect ? "#3a2700" : "#fff";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.4))" }}>
      <path d="M5 13l4.5 4.5L19 7" stroke={color} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A clean play triangle (border trick). `dark` for use on a gold module. */
function PlayTriangle({ size, dark = false }: { size: number; dark?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 0,
        height: 0,
        marginLeft: size * 0.2,
        borderTop: `${size * 0.62}px solid transparent`,
        borderBottom: `${size * 0.62}px solid transparent`,
        borderLeft: `${size}px solid ${dark ? "#3a2700" : "#fff"}`,
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,.3))",
      }}
    />
  );
}

function levelTab(boss: boolean): React.CSSProperties {
  return {
    position: "absolute",
    bottom: -6,
    left: "50%",
    transform: "translateX(-50%)",
    minWidth: 16,
    padding: "0 5px",
    borderRadius: 999,
    fontSize: 9,
    fontWeight: 900,
    lineHeight: "15px",
    color: "var(--btnText)",
    background: boss ? "color-mix(in srgb, var(--pink) 70%, white)" : "var(--amber)",
    boxShadow: "0 2px 5px rgba(0,0,0,.4)",
  };
}

const bossBanner: React.CSSProperties = {
  position: "absolute",
  top: -12,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 2,
  fontSize: 8.5,
  fontWeight: 900,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color: "#fff",
  background: "linear-gradient(90deg, color-mix(in srgb, var(--pink) 75%, white), color-mix(in srgb, var(--pink) 80%, black))",
  padding: "2px 10px",
  borderRadius: 999,
  boxShadow: "0 3px 10px rgba(0,0,0,.45)",
};
