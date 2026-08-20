import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CampaignLadderResponse, CampaignWorld } from "@/api/client";
import { useT } from "@/i18n/useT";
import { currentMissionLevel, pickCurrentWorld, worldState } from "@/lib/campaign";
import { type Pt, smoothPath } from "@/screens/campaign/components/trail";
import { WorldCard } from "@/screens/campaign/components/WorldCard";
import { CrownIcon } from "@/ui/CrownIcon";

// Boustrophedon weave order across the 2-col grid: TL → TR → MR → ML → BL, then the crown.
const WEAVE = [0, 1, 3, 2, 4];

/**
 * The world-selection board: the current world as a dominant full-width card, the other five worlds
 * in a staggered 2-column grid, a bright casing+core route that weaves through them with checkpoint
 * markers in the visible gutters, and a crown podium destination at the end. The route is MEASURED
 * from the real card centers, so it self-corrects at any width / stagger (decorative; aria-hidden;
 * static = cheap).
 */
export function WorldBoard({
  ladder,
  onPick,
}: {
  ladder: CampaignLadderResponse;
  onPick: (world: CampaignWorld) => void;
}) {
  const t = useT();
  // Memoized so identities are stable across re-renders — otherwise the measure callback below would
  // be recreated every render and re-fire the layout effect in a loop.
  const currentName = useMemo(() => pickCurrentWorld(ladder.worlds), [ladder.worlds]);
  const current = useMemo(
    () => ladder.worlds.find((w) => w.world === currentName) ?? ladder.worlds[0],
    [ladder.worlds, currentName],
  );
  const others = useMemo(
    () => ladder.worlds.filter((w) => w.world !== current.world),
    [ladder.worlds, current],
  );
  const nextTitle = useMemo(() => currentMissionLevel(current)?.level.title ?? null, [current]);
  const allDone = useMemo(
    () => ladder.worlds.every((w) => w.cleared_count >= w.total_levels && w.total_levels > 0),
    [ladder.worlds],
  );

  const boardRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const crownRef = useRef<HTMLDivElement>(null);
  const [route, setRoute] = useState<{ pts: Pt[]; gold: boolean[]; w: number; h: number }>({
    pts: [],
    gold: [],
    w: 0,
    h: 0,
  });

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const b = board.getBoundingClientRect();
    const center = (el: HTMLElement | null): Pt | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 };
    };
    const cards = cardRefs.current.map(center);
    const crown = center(crownRef.current);
    if (cards.some((c) => !c) || !crown) return;
    const c = cards as Pt[];
    const order = WEAVE.filter((i) => i < c.length);
    const start: Pt = { x: b.width / 2, y: 0 };
    const pts = [start, ...order.map((i) => c[i]), crown];
    // gold[k] marks the checkpoint on the segment ARRIVING at the k-th stop (a cleared world, or
    // the crown once every world is cleared).
    const gold = [
      ...order.map((i) => others[i].cleared_count >= others[i].total_levels && others[i].total_levels > 0),
      allDone,
    ];
    const w = b.width;
    const h = b.height;
    const sig = `${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";")}|${w}|${h}|${gold
      .map((g) => (g ? 1 : 0))
      .join("")}`;
    // Only update when the geometry actually changed — guards against a measure→setState→measure loop.
    setRoute((prev) => {
      const psig = `${prev.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";")}|${prev.w}|${prev.h}|${prev.gold
        .map((g) => (g ? 1 : 0))
        .join("")}`;
      return psig === sig ? prev : { pts, gold, w, h };
    });
  }, [others, allDone]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const d = useMemo(() => smoothPath(route.pts), [route.pts]);
  // Checkpoint markers sit at segment midpoints — in the visible gutters between cards, never
  // hidden underneath them.
  const checkpoints = useMemo(() => {
    const out: { pt: Pt; gold: boolean }[] = [];
    for (let i = 0; i < route.pts.length - 1; i++) {
      out.push({
        pt: {
          x: (route.pts[i].x + route.pts[i + 1].x) / 2,
          y: (route.pts[i].y + route.pts[i + 1].y) / 2,
        },
        gold: route.gold[i] ?? false,
      });
    }
    return out;
  }, [route]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Dominant current/continue card */}
      <WorldCard
        world={current}
        state={worldState(current, currentName)}
        variant="hero"
        nextTitle={nextTitle}
        onPick={() => onPick(current)}
      />

      {/* The board: staggered 2-col grid + measured weaving route + crown podium */}
      <div ref={boardRef} style={{ position: "relative", marginTop: 4 }}>
        <svg
          aria-hidden
          width="100%"
          height="100%"
          viewBox={`0 0 ${route.w || 1} ${route.h || 1}`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "visible" }}
        >
          {d && (
            <>
              {/* casing: a soft glowing road under the dotted core, like a real board-game trail */}
              <path d={d} fill="none" stroke="rgba(124,58,237,.28)" strokeWidth={10} strokeLinecap="round" />
              <path d={d} fill="none" stroke="rgba(20,10,42,.85)" strokeWidth={5.5} strokeLinecap="round" />
              <path
                d={d}
                fill="none"
                stroke="rgba(196,140,255,.95)"
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray="0.1 12"
                style={{ filter: "drop-shadow(0 0 5px rgba(168,85,247,.9))" }}
              />
            </>
          )}
          {checkpoints.map((n, i) => (
            <g key={i}>
              <circle
                cx={n.pt.x}
                cy={n.pt.y}
                r={6}
                fill="color-mix(in srgb, var(--panel) 70%, black)"
                stroke={n.gold ? "var(--amber)" : "var(--brand-2)"}
                strokeWidth={2}
                style={{
                  filter: `drop-shadow(0 0 5px ${n.gold ? "color-mix(in srgb, var(--amber) 80%, transparent)" : "color-mix(in srgb, var(--brand-2) 80%, transparent)"})`,
                }}
              />
              <circle cx={n.pt.x} cy={n.pt.y} r={2.2} fill={n.gold ? "color-mix(in srgb, var(--amber) 60%, white)" : "color-mix(in srgb, var(--brand-2) 40%, white)"} />
              {n.gold && (
                <g transform={`translate(${n.pt.x + 4}, ${n.pt.y - 18})`}>
                  <line x1={0} y1={0} x2={0} y2={13} stroke="#fff3c4" strokeWidth={1.5} />
                  <polygon points="0,1 9,4.5 0,8" fill="#ffc91e" />
                </g>
              )}
            </g>
          ))}
        </svg>

        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            alignItems: "start",
          }}
        >
          {others.map((w, i) => (
            <div
              key={w.world}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              // Stagger: nudge the right column down so the board zig-zags like a route, not a grid.
              style={{ marginTop: i % 2 === 1 ? 30 : 0 }}
            >
              <WorldCard
                world={w}
                state={worldState(w, currentName)}
                variant="board"
                onPick={() => onPick(w)}
              />
            </div>
          ))}
        </div>

        {/* Crown podium: the visible destination the route plugs into — clear all six worlds. */}
        <div
          ref={crownRef}
          style={{
            position: "relative",
            zIndex: 1,
            marginTop: 30,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span style={{ position: "relative", width: 110, height: 96, display: "grid", placeItems: "center" }}>
            {/* ray burst behind the crown once the campaign is crowned */}
            {allDone && <span aria-hidden style={crownRays} />}
            {/* podium platform */}
            <span aria-hidden style={podium(allDone)} />
            <span
              className={allDone ? "rr-glow-pulse" : undefined}
              style={{
                position: "relative",
                width: 68,
                height: 68,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                marginBottom: 10,
                background: allDone
                  ? "radial-gradient(120% 120% at 35% 25%, #6a4e12, #1b1136 72%)"
                  : "radial-gradient(120% 120% at 35% 25%, color-mix(in srgb, var(--brand) 40%, var(--panel2)), var(--panel) 72%)",
                border: `2.5px solid ${allDone ? "var(--amber)" : "rgba(255,201,30,.45)"}`,
                boxShadow: allDone
                  ? "0 0 26px rgba(255,201,30,.55)"
                  : "0 0 14px rgba(255,201,30,.18), inset 0 2px 6px rgba(0,0,0,.5)",
              }}
            >
              <CrownIcon size={32} />
            </span>
            {!allDone && (
              <span
                aria-hidden
                className="rr-twinkle"
                style={{ position: "absolute", top: 4, right: 16, fontSize: 12, color: "#ffe487" }}
              >
                ✦
              </span>
            )}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: "var(--amber)",
              opacity: allDone ? 1 : 0.8,
            }}
          >
            {t.campaign.crownTheCampaign}
          </span>
        </div>
      </div>
    </div>
  );
}

const crownRays: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "40%",
  width: 120,
  height: 120,
  transform: "translate(-50%, -50%)",
  borderRadius: "50%",
  background:
    "conic-gradient(from -10deg, rgba(255,201,30,.3), transparent 16deg, rgba(255,201,30,.24) 34deg, transparent 50deg, rgba(255,201,30,.3) 68deg, transparent 84deg, rgba(255,201,30,.24) 102deg, transparent 118deg, rgba(255,201,30,.3) 136deg, transparent 152deg, rgba(255,201,30,.24) 170deg, transparent 186deg, rgba(255,201,30,.3) 204deg, transparent 220deg, rgba(255,201,30,.24) 238deg, transparent 254deg, rgba(255,201,30,.3) 272deg, transparent 288deg, rgba(255,201,30,.24) 306deg, transparent 322deg, rgba(255,201,30,.3) 340deg, transparent 356deg)",
  maskImage: "radial-gradient(circle, black 18%, transparent 70%)",
  WebkitMaskImage: "radial-gradient(circle, black 18%, transparent 70%)",
  pointerEvents: "none",
};

function podium(lit: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left: "50%",
    bottom: 2,
    width: 92,
    height: 20,
    transform: "translateX(-50%)",
    borderRadius: "50%",
    background: lit
      ? "radial-gradient(circle, rgba(255,201,30,.4), rgba(60,36,8,.5) 55%, transparent 75%)"
      : "radial-gradient(circle, rgba(124,58,237,.35), rgba(20,10,40,.5) 55%, transparent 75%)",
    filter: "blur(2px)",
    pointerEvents: "none",
  };
}
