import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CampaignArc, CampaignLevel, CampaignWorld } from "@/api/client";
import { useT } from "@/i18n/useT";
import { arcCleared, chestState, currentMissionLevel, nextChest, worldFlavor, worldTheme } from "@/lib/campaign";
import { ChapterDivider } from "@/screens/campaign/components/ChapterDivider";
import { LevelNode } from "@/screens/campaign/components/LevelNode";
import { RewardChest } from "@/screens/campaign/components/RewardChest";
import { type RoadStroke, roadSpec } from "@/screens/campaign/components/roadStyles";
import { WorldBoardSurface } from "@/screens/campaign/components/scenery";
import { perspectiveLayout, smoothPath } from "@/screens/campaign/components/trail";
import { arcName } from "@/i18n/campaignTitles";
import { useI18n } from "@/store/i18n";

/** One <path> layer of the world's road, from a resolved RoadStroke recipe (see roadStyles.ts).
 * `flow` strokes drift their dash pattern along the route by whole periods (seamless loop) — the
 * global reduced-motion rule collapses the animation. */
function RoadStrokePath({ d, s }: { d: string; s: RoadStroke }) {
  return (
    <path
      d={d}
      fill="none"
      stroke={s.color}
      strokeWidth={s.width}
      strokeLinecap={s.cap ?? "round"}
      strokeDasharray={s.dash}
      className={s.flow ? "rr-road-flow" : undefined}
      style={{
        ...(s.glow ? { filter: `drop-shadow(0 0 ${s.glow}px ${s.color})` } : undefined),
        ...(s.flow ? ({ "--rr-flow": `${-2 * s.flow}px` } as React.CSSProperties) : undefined),
      }}
    />
  );
}

function chapterState(arc: CampaignArc): "done" | "current" | "locked" {
  if (arcCleared(arc)) return "done";
  if (arc.levels.some((l) => l.unlocked)) return "current";
  return "locked";
}

type Stop =
  | { kind: "level"; level: CampaignLevel; arcIndex: number }
  | { kind: "chest"; arc: CampaignArc; arcIndex: number; isFinal: boolean };

const PAD_TOP = 60;
const PAD_BOTTOM = 86;
const ARC_GAP_BONUS = 32; // extra room at an arc boundary so the gate sits clear of labels
const HERO_GAP_BONUS = 58; // extra room around the current-mission hero (its card is taller)
const BOSS_GAP_BONUS = 30; // the climax breathes — air above/below the boss so it never stacks
const LABEL_SHIFT = 26; // px the caption is nudged off the central path corridor

/**
 * The world quest map as a perspective adventure road: stops run NEAR→FAR (Level 1 at the bottom, the
 * boss summit at the top). The road swings wide in the foreground and converges toward a vanishing
 * point up high; future nodes recede. On entry the view auto-anchors the current mission into the
 * lower third so the player "stands" at their launch point looking up the climb. Geometry is computed
 * (only width is measured), so there is no per-node measure loop.
 */
export function QuestPath({
  world,
  onPlay,
}: {
  world: CampaignWorld;
  onPlay: (level: number) => void;
}) {
  const locale = useI18n((st) => st.locale);
  const t = useT();
  const theme = worldTheme(world.world);
  const flavor = worldFlavor(t, world.world);
  const spec = useMemo(() => roadSpec(theme.road, theme.accent), [theme]);
  const next = useMemo(() => nextChest(world), [world]);
  const currentNum = currentMissionLevel(world)?.level.level_number ?? null;

  // Stops in near→far order: each arc's levels, then that arc's reward chest.
  const { stops, currentIndex, firstLockedNum } = useMemo(() => {
    const s: Stop[] = [];
    let firstLocked: number | null = null;
    world.arcs.forEach((arc, ai) => {
      for (const level of arc.levels) {
        s.push({ kind: "level", level, arcIndex: ai });
        if (!level.unlocked && firstLocked === null) firstLocked = level.level_number;
      }
      s.push({ kind: "chest", arc, arcIndex: ai, isFinal: ai === world.arcs.length - 1 });
    });
    let ci = s.findIndex((x) => x.kind === "level" && x.level.level_number === currentNum);
    if (ci < 0) ci = s.length - 1; // fully cleared → anchor at the summit
    return { stops: s, currentIndex: ci, firstLockedNum: firstLocked };
  }, [world, currentNum]);

  const n = stops.length;
  const lay = useMemo(() => perspectiveLayout(n, currentIndex), [n, currentIndex]);
  // The current mission is the focal point — pin it to centre so its hero station reads grounded and
  // the road banks toward it (other stops keep the serpentine swing).
  const layout = useMemo(
    () => lay.map((s, i) => (i === currentIndex ? { ...s, xFrac: 0.5 } : s)),
    [lay, currentIndex],
  );

  // Vertical centres (independent of width): cumulative gaps from the bottom, flipped to top-origin.
  // Crossing into a new arc adds extra room so its gate plate sits clear of the surrounding labels.
  const { yTop, height } = useMemo(() => {
    const yUp: number[] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        acc += lay[i - 1].gapAbove;
        const s = stops[i];
        if (s.kind === "level" && s.arcIndex > 0 && stops[i - 1].kind === "chest") acc += ARC_GAP_BONUS;
        // the final boss-reward chest sits above the boss node — give its label room to clear the
        // boss banner below it.
        if (s.kind === "chest" && s.isFinal) acc += ARC_GAP_BONUS;
        // the boss is the climax — extra air on both sides so node/banner/label/galaxy never stack.
        if (s.kind === "level" && s.level.is_boss) acc += BOSS_GAP_BONUS;
        if (stops[i - 1].kind === "level" && (stops[i - 1] as Extract<Stop, { kind: "level" }>).level.is_boss) acc += BOSS_GAP_BONUS / 2;
        // the current-mission hero is taller (pedestal + module + card) — pad above and below it.
        if (i === currentIndex || i === currentIndex + 1) acc += HERO_GAP_BONUS;
      }
      yUp[i] = acc;
    }
    const contentH = yUp[n - 1] ?? 0;
    const h = contentH + PAD_TOP + PAD_BOTTOM;
    const yt = yUp.map((u) => PAD_TOP + (contentH - u));
    return { yTop: yt, height: h };
  }, [lay, n, stops, currentIndex]);

  // Only the WIDTH is measured (heights are computed) — cheap, no node measuring.
  const boardRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = boardRef.current;
      if (el) setW(el.clientWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Anchor the current mission into the lower third on first entry (instant; once).
  const anchored = useRef(false);
  useLayoutEffect(() => {
    if (anchored.current || n === 0) return;
    const el = boardRef.current;
    if (!el) return;
    anchored.current = true;
    const pageY = el.getBoundingClientRect().top + window.scrollY + yTop[currentIndex];
    const target = pageY - window.innerHeight * 0.62;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.min(Math.max(0, target), max));
  }, [currentIndex, yTop, n]);

  const pts = useMemo(() => stops.map((_, i) => ({ x: layout[i].xFrac * w, y: yTop[i] })), [stops, layout, w, yTop]);
  const fullD = useMemo(() => (w ? smoothPath(pts) : ""), [pts, w]);
  // Gold "travelled" road from the trailhead up through the current mission.
  const litD = useMemo(() => (w ? smoothPath(pts.slice(0, currentIndex + 1)) : ""), [pts, w, currentIndex]);

  // Chapter gates only at real region transitions (between a chest and the next arc's first level).
  // Arc 0 needs no gate — you're already at the trailhead, and a plate there would crowd Level 1.
  const gates = useMemo(
    () =>
      world.arcs
        .map((arc, ai) => {
          if (ai === 0) return null;
          const firstIdx = stops.findIndex((s) => s.kind === "level" && s.arcIndex === ai);
          const belowIdx = firstIdx - 1;
          if (firstIdx < 0 || belowIdx < 0) return null;
          const y = (yTop[firstIdx] + yTop[belowIdx]) / 2;
          return { ai, name: arcName(arc.name, locale), state: chapterState(arc), y };
        })
        .filter((g): g is { ai: number; name: string; state: "done" | "current" | "locked"; y: number } => g !== null),
    // `locale` belongs here: the chapter label is localized inside the memo, so without it a
    // language switch would leave the old language's chapter names on the path until some other
    // dependency happened to change.
    [world.arcs, stops, yTop, locale],
  );

  return (
    <div ref={boardRef} style={{ position: "relative", height, width: "100%" }}>
      {/* The world map-board surface the road runs across (behind everything) */}
      <WorldBoardSurface theme={theme} />

      {/* Chapter gates (behind the road) */}
      {gates.map((g) => (
        <div
          key={`gate-${g.ai}`}
          style={{ position: "absolute", top: g.y, left: 0, right: 0, transform: "translateY(-50%)", zIndex: 0 }}
        >
          <ChapterDivider index={g.ai} name={g.name} state={g.state} accent={theme.accent} />
        </div>
      ))}

      {/* The road (over the gates, under the nodes) */}
      <svg
        aria-hidden
        width="100%"
        height="100%"
        viewBox={`0 0 ${w || 1} ${height}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", overflow: "visible" }}
      >
        {fullD && spec.base.map((s, i) => <RoadStrokePath key={`b${i}`} d={fullD} s={s} />)}
        {litD && spec.lit.map((s, i) => <RoadStrokePath key={`l${i}`} d={litD} s={s} />)}
      </svg>

      {/* Nodes (over the road) */}
      {stops.map((s, i) => (
        <div
          key={s.kind === "level" ? `lv-${s.level.level_number}` : `chest-${s.arcIndex}`}
          style={{
            position: "absolute",
            top: yTop[i],
            left: `${layout[i].xFrac * 100}%`,
            transform: "translate(-50%, -50%)",
            zIndex: i === currentIndex ? 3 : 2,
          }}
        >
          {s.kind === "level" ? (
            <LevelNode
              level={s.level}
              isCurrent={s.level.level_number === currentNum}
              theme={theme}
              depthScale={layout[i].recedeScale}
              showLockedHint={s.level.level_number === firstLockedNum}
              labelShift={layout[i].xFrac > 0.54 ? LABEL_SHIFT : layout[i].xFrac < 0.46 ? -LABEL_SHIFT : 0}
              onPlay={() => onPlay(s.level.level_number)}
            />
          ) : (
            <RewardChest
              state={chestState(s.arc)}
              boss={s.isFinal}
              style={theme.chestStyle}
              isNext={next?.arcIndex === s.arcIndex}
              image={theme.art?.chestImage}
              accent={theme.accent}
              label={s.isFinal ? flavor.bossChest : flavor.chest}
            />
          )}
        </div>
      ))}
    </div>
  );
}
