import type { RoadStyle } from "@/lib/campaign";

/**
 * Per-world TALL environments for the campaign roadmap — the multi-screen world the path travels
 * through. Each world is three zone BANDS (bottom = trailhead/ground → top = grand summit) plus
 * LANDMARK sprites placed by percent of map height, all CSS/SVG, grounded (not fantasy). The shared
 * journey machinery (scrolling board, parallax midground, fixed far-sky) lives in scenery.tsx; this
 * file only supplies each world's regions + props, dispatched by the world's unique `road` style.
 *
 * Layering inside the board (back→front): WorldZones (bands) → corridor → [parallax] WorldAmbient +
 * WorldLandmarks → road → nodes. Drop `theme.art.backgroundImage` to replace the CSS world with art.
 */

const band = (top: string, height: string, bg: string): React.CSSProperties => ({
  position: "absolute",
  left: 0,
  right: 0,
  top,
  height,
  background: bg,
});

// A faint horizon line tying a zone's ground plane together.
function Ridge({ top, accent, op = 0.2 }: { top: string; accent: string; op?: number }) {
  return <span aria-hidden style={{ position: "absolute", top, left: 0, right: 0, height: 1, background: accent, opacity: op }} />;
}

// A soft blurred glow blob (atmosphere / light pooling).
function Glow({ top, left, w, h, color, blur = 26, op = 1 }: { top: string; left: string; w: number | string; h: number; color: string; blur?: number; op?: number }) {
  return <span aria-hidden style={{ position: "absolute", top, left, width: w, height: h, borderRadius: "50%", background: `radial-gradient(circle, ${color}, transparent 68%)`, filter: `blur(${blur}px)`, opacity: op }} />;
}

// ============================================================================================
// Dispatchers
// ============================================================================================

export function WorldZones({ road, accent }: { road: RoadStyle; accent: string }) {
  switch (road) {
    case "orbital":
      return <ScienceZones accent={accent} />;
    case "trail":
      return <HistoryZones accent={accent} />;
    case "lanes":
      return <SportsZones accent={accent} />;
    case "expedition":
      return <GeographyZones accent={accent} />;
    case "ribbon":
      return <ArtsZones accent={accent} />;
    case "marquee":
      return <PopZones accent={accent} />;
    default:
      return <ScienceZones accent={accent} />;
  }
}

export function WorldLandmarks({ road, accent, spark }: { road: RoadStyle; accent: string; spark: string }) {
  switch (road) {
    case "orbital":
      return <ScienceLandmarks accent={accent} spark={spark} />;
    case "trail":
      return <HistoryLandmarks accent={accent} spark={spark} />;
    case "lanes":
      return <SportsLandmarks accent={accent} spark={spark} />;
    case "expedition":
      return <GeographyLandmarks accent={accent} spark={spark} />;
    case "ribbon":
      return <ArtsLandmarks accent={accent} spark={spark} />;
    case "marquee":
      return <PopLandmarks accent={accent} spark={spark} />;
    default:
      return <ScienceLandmarks accent={accent} spark={spark} />;
  }
}

/** Ambient speck field for the parallax layer — stars for space, warm dust for indoor worlds, bokeh
 * for the stage, etc. Tiled vertically so it covers the whole tall board. */
export function WorldAmbient({ road, spark }: { road: RoadStyle; spark: string }) {
  if (road === "lanes" || road === "expedition") return null; // open-air worlds stay clean
  const warm = road === "trail" || road === "ribbon";
  const c1 = road === "marquee" ? spark : warm ? "rgba(255,221,150,.6)" : spark;
  const c2 = road === "marquee" ? "rgba(255,255,255,.6)" : warm ? "rgba(255,238,200,.4)" : "rgba(255,255,255,.5)";
  return <span aria-hidden style={speckField(c1, c2)} />;
}

function speckField(c1: string, c2: string): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    backgroundImage:
      `radial-gradient(1.5px 1.5px at 14% 9%, ${c1}, transparent),` +
      `radial-gradient(1.5px 1.5px at 82% 6%, ${c2}, transparent),` +
      `radial-gradient(1.2px 1.2px at 24% 18%, ${c2}, transparent),` +
      `radial-gradient(1.6px 1.6px at 70% 14%, ${c1}, transparent),` +
      `radial-gradient(1.3px 1.3px at 90% 22%, ${c2}, transparent),` +
      `radial-gradient(1.4px 1.4px at 8% 27%, ${c1}, transparent)`,
    backgroundSize: "100% 240px",
    backgroundRepeat: "repeat-y",
    opacity: 0.6,
  };
}

// ============================================================================================
// SCIENCE — deep space → observatory → lab (the reference world)
// ============================================================================================

function ScienceZones({ accent }: { accent: string }) {
  return (
    <>
      <span style={band("0%", "38%", `linear-gradient(180deg, color-mix(in srgb, ${accent} 22%, rgba(6,5,20,.62)) 0%, rgba(8,7,26,.28) 70%, transparent 100%)`)} />
      <span style={band("34%", "34%", `linear-gradient(180deg, transparent, color-mix(in srgb, ${accent} 16%, rgba(10,12,34,.46)) 50%, transparent)`)} />
      <span style={band("62%", "38%", `linear-gradient(180deg, transparent 0%, color-mix(in srgb, ${accent} 17%, rgba(14,20,40,.42)) 40%, color-mix(in srgb, ${accent} 26%, rgba(16,24,44,.6)) 100%)`)} />
    </>
  );
}

function ScienceLandmarks({ accent, spark }: { accent: string; spark: string }) {
  return (
    <>
      <Glow top="1%" left="-18%" w="80%" h={260} color={`${accent}26`} blur={26} />
      <Glow top="16%" left="64%" w="70%" h={220} color={`color-mix(in srgb, ${spark} 30%, transparent)`} blur={28} />
      <Planet top="4%" left="60%" size={158} accent={accent} spark={spark} ring />
      <Planet top="19%" left="9%" size={80} accent={accent} spark={spark} />
      <Satellite top="12%" left="42%" accent={accent} />
      <span style={{ position: "absolute", top: "9%", left: "-12%", width: "124%", height: 230, border: `1px solid ${accent}2e`, borderRadius: "50%", transform: "rotate(-10deg)" }} />

      <Ridge top="58%" accent={accent} op={0.15} />
      <Dome left="16%" w={66} accent={accent} />
      <Dome left="62%" w={92} accent={accent} />
      <Telescope top="46%" left="78%" accent={accent} />

      <span style={gridFloor(accent)} />
      <Ridge top="98%" accent={accent} op={0.2} />
      <ConsoleBench bottom="3%" left="8%" accent={accent} spark={spark} />
      <ConsoleBench bottom="3%" left="62%" accent={accent} spark={spark} />
    </>
  );
}

function Planet({ top, left, size, accent, spark, ring = false }: { top: string; left: string; size: number; accent: string; spark: string; ring?: boolean }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: size, height: size, opacity: 0.85 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(120% 120% at 34% 28%, ${spark}66, ${accent}55 46%, color-mix(in srgb, ${accent} 50%, black) 78%, transparent 88%)`, boxShadow: `0 0 46px ${accent}40` }} />
      {ring && <span style={{ position: "absolute", left: "-14%", right: "-14%", top: "52%", height: size * 0.2, borderRadius: "50%", border: `2px solid ${accent}40`, transform: "rotate(-22deg)" }} />}
    </span>
  );
}

function Satellite({ top, left, accent }: { top: string; left: string; accent: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: 46, height: 14, opacity: 0.5 }}>
      <span style={{ position: "absolute", left: "40%", top: 0, width: "20%", height: "100%", background: `${accent}cc`, borderRadius: 2 }} />
      <span style={{ position: "absolute", left: 0, top: "20%", width: "32%", height: "60%", background: `${accent}55`, border: `1px solid ${accent}` }} />
      <span style={{ position: "absolute", right: 0, top: "20%", width: "32%", height: "60%", background: `${accent}55`, border: `1px solid ${accent}` }} />
    </span>
  );
}

function Dome({ left, w, accent }: { left: string; w: number; accent: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top: `calc(58% - ${w * 0.5}px)`, left, width: w, height: w * 0.5, opacity: 0.75 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "999px 999px 0 0", background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 30%, #0c1024), color-mix(in srgb, ${accent} 14%, #0a0c1e))`, border: `1px solid ${accent}55`, borderBottom: "none" }} />
      <span style={{ position: "absolute", left: "47%", top: "8%", width: "6%", height: "92%", background: `${accent}88` }} />
    </span>
  );
}

function Telescope({ top, left, accent }: { top: string; left: string; accent: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: 40, height: 46, opacity: 0.45 }}>
      <span style={{ position: "absolute", top: 0, left: "30%", width: "46%", height: "62%", background: `color-mix(in srgb, ${accent} 35%, #0c1024)`, border: `1px solid ${accent}66`, borderRadius: 3, transform: "rotate(38deg)", transformOrigin: "bottom center" }} />
      <span style={{ position: "absolute", bottom: 0, left: "44%", width: 1.5, height: "44%", background: `${accent}77`, transform: "rotate(20deg)", transformOrigin: "top" }} />
      <span style={{ position: "absolute", bottom: 0, left: "44%", width: 1.5, height: "44%", background: `${accent}77`, transform: "rotate(-20deg)", transformOrigin: "top" }} />
    </span>
  );
}

function ConsoleBench({ bottom, left, accent, spark }: { bottom: string; left: string; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", bottom, left, width: 120, height: 34, opacity: 0.5 }}>
      <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "55%", background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 26%, #0b0f22), #090c1c)`, border: `1px solid ${accent}55`, borderRadius: 3 }} />
      {[6, 34, 62].map((x) => (
        <span key={x} style={{ position: "absolute", bottom: "52%", left: `${x}%`, width: "22%", height: "60%", background: `${spark}55`, border: `1px solid ${accent}aa`, borderRadius: 2, boxShadow: `0 0 8px ${accent}66` }} />
      ))}
    </span>
  );
}

function gridFloor(accent: string): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "16%",
    backgroundImage: `repeating-linear-gradient(90deg, transparent 0 38px, ${accent}1c 38px 39px),repeating-linear-gradient(0deg, transparent 0 26px, ${accent}14 26px 27px)`,
    maskImage: "linear-gradient(0deg, rgba(0,0,0,.9), transparent)",
    WebkitMaskImage: "linear-gradient(0deg, rgba(0,0,0,.9), transparent)",
    opacity: 0.8,
  };
}

// ============================================================================================
// HISTORY — cobblestone trailhead (torches) → hilltop ruins/columns → citadel at the summit
// ============================================================================================

function HistoryZones({ accent }: { accent: string }) {
  return (
    <>
      <span style={band("0%", "40%", `linear-gradient(180deg, color-mix(in srgb, ${accent} 26%, rgba(20,12,30,.66)) 0%, rgba(24,16,34,.3) 72%, transparent 100%)`)} />
      <span style={band("34%", "34%", `linear-gradient(180deg, transparent, color-mix(in srgb, ${accent} 17%, rgba(26,18,34,.44)) 50%, transparent)`)} />
      <span style={band("60%", "40%", `linear-gradient(180deg, transparent 0%, color-mix(in srgb, ${accent} 22%, rgba(30,20,30,.46)) 38%, color-mix(in srgb, ${accent} 32%, rgba(34,22,28,.62)) 100%)`)} />
    </>
  );
}

function HistoryLandmarks({ accent, spark }: { accent: string; spark: string }) {
  return (
    <>
      {/* ── CITADEL (summit) ── a crenellated castle on the ridge ── */}
      <Glow top="2%" left="50%" w={260} h={180} color={`${accent}26`} blur={30} />
      <Castle top="6%" left="50%" w={150} accent={accent} />
      <Column top="20%" left="10%" h={70} accent={accent} />
      <Column top="22%" left="84%" h={60} accent={accent} />

      {/* ── HILLTOP RUINS (mid) ── a colonnade ── */}
      <Ridge top="58%" accent={accent} op={0.2} />
      {[18, 34, 66, 82].map((x, i) => (
        <Column key={x} top={`${50 - (i % 2) * 4}%`} left={`${x}%`} h={56} accent={accent} />
      ))}
      <Archway top="52%" left="48%" w={70} accent={accent} />

      {/* ── COBBLESTONE TRAILHEAD (bottom) ── stones + torches + a banner ── */}
      <span style={cobbleFloor(accent)} />
      <Ridge top="97%" accent={accent} op={0.25} />
      <Torch bottom="6%" left="12%" accent={accent} spark={spark} />
      <Torch bottom="6%" left="84%" accent={accent} spark={spark} />
      <Banner top="64%" left="20%" accent={accent} />
    </>
  );
}

function Castle({ top, left, w, accent }: { top: string; left: string; w: number; accent: string }) {
  const wall = `color-mix(in srgb, ${accent} 28%, #140e1e)`;
  const edge = `${accent}66`;
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: w, height: w * 0.62, transform: "translateX(-50%)", opacity: 0.75 }}>
      {/* main keep + flanking towers */}
      {[
        { l: "8%", w: "20%", h: "78%" },
        { l: "40%", w: "24%", h: "100%" },
        { l: "74%", w: "20%", h: "70%" },
      ].map((t, i) => (
        <span key={i} style={{ position: "absolute", bottom: 0, left: t.l, width: t.w, height: t.h, background: wall, borderTop: `2px solid ${edge}`, borderLeft: `1px solid ${edge}`, borderRight: `1px solid ${edge}` }} />
      ))}
      {/* crenellations along the top of the keep */}
      {[42, 48, 54, 60].map((x) => (
        <span key={x} style={{ position: "absolute", top: 0, left: `${x}%`, width: "3%", height: "12%", background: wall }} />
      ))}
      {/* flag on the central tower */}
      <span style={{ position: "absolute", top: "-14%", left: "51%", width: 2, height: "20%", background: edge }} />
      <span style={{ position: "absolute", top: "-14%", left: "52%", width: "10%", height: "9%", background: `${accent}aa`, clipPath: "polygon(0 0, 100% 0, 70% 50%, 100% 100%, 0 100%)" }} />
    </span>
  );
}

function Column({ top, left, h, accent }: { top: string; left: string; h: number; accent: string }) {
  const c = `color-mix(in srgb, ${accent} 26%, #150f1f)`;
  const edge = `${accent}55`;
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: h * 0.26, height: h, opacity: 0.55 }}>
      <span style={{ position: "absolute", top: 0, left: "-12%", right: "-12%", height: "8%", background: c, border: `1px solid ${edge}` }} />
      <span style={{ position: "absolute", top: "8%", left: "14%", right: "14%", bottom: "8%", background: `repeating-linear-gradient(90deg, ${c} 0 3px, ${accent}22 3px 4px)`, borderLeft: `1px solid ${edge}`, borderRight: `1px solid ${edge}` }} />
      <span style={{ position: "absolute", bottom: 0, left: "-14%", right: "-14%", height: "8%", background: c, border: `1px solid ${edge}` }} />
    </span>
  );
}

function Archway({ top, left, w, accent }: { top: string; left: string; w: number; accent: string }) {
  const c = `color-mix(in srgb, ${accent} 24%, #150f1f)`;
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: w, height: w * 0.7, transform: "translateX(-50%)", opacity: 0.5 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "999px 999px 0 0", border: `6px solid ${c}`, borderBottom: "none" }} />
    </span>
  );
}

function Torch({ bottom, left, accent, spark }: { bottom: string; left: string; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", bottom, left, width: 8, height: 60, opacity: 0.7 }}>
      <span style={{ position: "absolute", bottom: 0, left: "35%", width: "30%", height: "72%", background: `color-mix(in srgb, ${accent} 40%, #140e1e)`, border: `1px solid ${accent}77` }} />
      <span className="rr-twinkle" style={{ position: "absolute", top: 0, left: "50%", width: 14, height: 18, marginLeft: -7, borderRadius: "50% 50% 50% 50% / 70% 70% 40% 40%", background: `radial-gradient(circle at 50% 70%, #ffe6a0, ${spark} 55%, transparent 75%)`, boxShadow: `0 0 16px ${spark}` }} />
    </span>
  );
}

function Banner({ top, left, accent }: { top: string; left: string; accent: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: 26, height: 58, opacity: 0.5 }}>
      <span style={{ position: "absolute", top: 0, left: 0, right: 0, height: "84%", background: `linear-gradient(180deg, ${accent}cc, ${accent}66)`, clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 84%, 0 100%)", border: `1px solid ${accent}` }} />
    </span>
  );
}

function cobbleFloor(accent: string): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "15%",
    backgroundImage: `repeating-linear-gradient(90deg, transparent 0 30px, ${accent}22 30px 32px),repeating-linear-gradient(0deg, transparent 0 18px, ${accent}1a 18px 20px)`,
    maskImage: "linear-gradient(0deg, rgba(0,0,0,.9), transparent)",
    WebkitMaskImage: "linear-gradient(0deg, rgba(0,0,0,.9), transparent)",
    opacity: 0.7,
  };
}

// ============================================================================================
// SPORTS — tunnel → pitch (yard lines, goalposts) → stadium tiers + floodlights + trophy
// ============================================================================================

function SportsZones({ accent }: { accent: string }) {
  return (
    <>
      <span style={band("0%", "40%", `linear-gradient(180deg, color-mix(in srgb, ${accent} 24%, rgba(8,14,28,.62)) 0%, rgba(10,16,30,.3) 72%, transparent 100%)`)} />
      <span style={band("34%", "36%", `linear-gradient(180deg, transparent, color-mix(in srgb, ${accent} 20%, rgba(10,30,22,.46)) 50%, transparent)`)} />
      <span style={band("62%", "38%", `linear-gradient(180deg, transparent 0%, rgba(8,12,24,.44) 40%, rgba(6,10,20,.62) 100%)`)} />
    </>
  );
}

function SportsLandmarks({ accent, spark }: { accent: string; spark: string }) {
  return (
    <>
      {/* ── STADIUM (summit) ── tiers + floodlights + a trophy + scoreboard ── */}
      <Glow top="3%" left="50%" w={300} h={180} color={`${accent}24`} blur={30} />
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden style={{ position: "absolute", top: `${4 + i * 5}%`, left: `${-10 - i * 6}%`, width: `${120 + i * 12}%`, height: 120 + i * 40, border: `2px solid ${accent}${i === 0 ? "44" : "26"}`, borderRadius: "50%", opacity: 0.5 }} />
      ))}
      <Floodlight top="2%" left="14%" accent={accent} spark={spark} />
      <Floodlight top="2%" left="80%" accent={accent} spark={spark} />
      <Scoreboard top="9%" left="50%" accent={accent} spark={spark} />

      {/* ── PITCH (mid) ── yard lines + goalposts ── */}
      <span style={pitchLines(accent)} />
      <Goalpost top="46%" left="22%" accent={accent} />
      <Goalpost top="46%" left="70%" accent={accent} />

      {/* ── TUNNEL (bottom) ── the players' entrance ── */}
      <Ridge top="86%" accent={accent} op={0.25} />
      <span aria-hidden style={{ position: "absolute", bottom: "0%", left: "50%", width: 150, height: "16%", transform: "translateX(-50%)", borderRadius: "16px 16px 0 0", background: "linear-gradient(180deg, rgba(4,6,14,.85), rgba(2,3,8,.95))", border: `1px solid ${accent}44`, borderBottom: "none", boxShadow: `inset 0 8px 24px rgba(0,0,0,.7)` }} />
    </>
  );
}

function Floodlight({ top, left, accent, spark }: { top: string; left: string; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: 30, height: 90, opacity: 0.6 }}>
      <span style={{ position: "absolute", top: "30%", left: "46%", width: 2, height: "70%", background: `${accent}88` }} />
      <span style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "22%", background: `${accent}66`, borderRadius: 3 }} />
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{ position: "absolute", top: `${2 + (i % 2) * 9}%`, left: `${6 + (i % 2 === 0 ? 0 : 1) * 0 + (i >> 1) * 48}%`, width: "42%", height: "9%", background: spark, boxShadow: `0 0 8px ${spark}` }} />
      ))}
      <span style={{ position: "absolute", top: "20%", left: "-40%", width: "180%", height: 90, background: `linear-gradient(180deg, ${spark}22, transparent 70%)`, clipPath: "polygon(38% 0, 62% 0, 100% 100%, 0 100%)" }} />
    </span>
  );
}

function Scoreboard({ top, left, accent, spark }: { top: string; left: string; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: 92, height: 40, transform: "translateX(-50%)", opacity: 0.6, background: "rgba(4,6,14,.8)", border: `1px solid ${accent}66`, borderRadius: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, padding: 4 }}>
      {[0, 1].map((i) => (
        <span key={i} style={{ background: `repeating-linear-gradient(90deg, ${spark}aa 0 3px, transparent 3px 6px)`, borderRadius: 2, boxShadow: `0 0 6px ${spark}55` }} />
      ))}
    </span>
  );
}

function Goalpost({ top, left, accent }: { top: string; left: string; accent: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: 48, height: 40, opacity: 0.5 }}>
      <span style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 2, background: `${accent}aa` }} />
      <span style={{ position: "absolute", top: 0, left: 0, width: 2, height: "100%", background: `${accent}aa` }} />
      <span style={{ position: "absolute", top: 0, right: 0, width: 2, height: "100%", background: `${accent}aa` }} />
    </span>
  );
}

function pitchLines(accent: string): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    top: "40%",
    height: "26%",
    backgroundImage: `repeating-linear-gradient(0deg, ${accent}22 0 2px, transparent 2px 34px)`,
    maskImage: "linear-gradient(180deg, transparent, rgba(0,0,0,.9) 40%, transparent)",
    WebkitMaskImage: "linear-gradient(180deg, transparent, rgba(0,0,0,.9) 40%, transparent)",
    opacity: 0.7,
  };
}

// ============================================================================================
// GEOGRAPHY — coast + compass → forested hills + map route → snow peak with summit flag
// ============================================================================================

function GeographyZones({ accent }: { accent: string }) {
  return (
    <>
      <span style={band("0%", "40%", `linear-gradient(180deg, color-mix(in srgb, ${accent} 24%, rgba(8,18,28,.62)) 0%, rgba(10,20,30,.3) 72%, transparent 100%)`)} />
      <span style={band("34%", "36%", `linear-gradient(180deg, transparent, color-mix(in srgb, ${accent} 20%, rgba(12,26,28,.44)) 50%, transparent)`)} />
      <span style={band("62%", "38%", `linear-gradient(180deg, transparent 0%, color-mix(in srgb, ${accent} 20%, rgba(20,26,30,.44)) 40%, color-mix(in srgb, ${accent} 28%, rgba(24,28,30,.6)) 100%)`)} />
    </>
  );
}

function GeographyLandmarks({ accent, spark }: { accent: string; spark: string }) {
  return (
    <>
      {/* ── SNOW PEAK (summit) ── a capped mountain with a summit flag ── */}
      <Glow top="2%" left="50%" w={240} h={150} color={`${accent}22`} blur={28} />
      <Mountain top="3%" left="50%" w={200} accent={accent} snow />
      <Mountain top="12%" left="16%" w={120} accent={accent} />
      <Mountain top="13%" left="74%" w={140} accent={accent} />
      <span aria-hidden style={{ position: "absolute", top: "4%", left: "50%", width: 2, height: 22, background: `${accent}aa` }} />
      <span aria-hidden style={{ position: "absolute", top: "4%", left: "51%", width: 16, height: 11, background: `${spark}cc`, clipPath: "polygon(0 0,100% 0,100% 100%,0 100%)" }} />

      {/* ── FORESTED HILLS (mid) ── pines + a winding map route + contour lines ── */}
      <span style={contourLines(accent)} />
      {[10, 22, 30, 70, 80, 90].map((x, i) => (
        <Pine key={x} top={`${52 + (i % 3) * 3}%`} left={`${x}%`} h={26 + (i % 2) * 8} accent={accent} />
      ))}

      {/* ── COAST / BASECAMP (bottom) ── compass rose + a shoreline ── */}
      <Ridge top="88%" accent={accent} op={0.22} />
      <CompassRose bottom="4%" left="44%" accent={accent} spark={spark} />
    </>
  );
}

function Mountain({ top, left, w, accent, snow = false }: { top: string; left: string; w: number; accent: string; snow?: boolean }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: w, height: w * 0.6, transform: "translateX(-50%)", opacity: 0.7 }}>
      <span style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 26%, #0e1622), color-mix(in srgb, ${accent} 12%, #0a0f18))`, clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />
      {snow && <span style={{ position: "absolute", top: 0, left: "50%", width: "34%", height: "34%", transform: "translateX(-50%)", background: "rgba(255,255,255,.5)", clipPath: "polygon(50% 0, 78% 100%, 64% 80%, 50% 100%, 36% 80%, 22% 100%)" }} />}
    </span>
  );
}

function Pine({ top, left, h, accent }: { top: string; left: string; h: number; accent: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: h * 0.6, height: h, opacity: 0.5 }}>
      <span style={{ position: "absolute", inset: 0, background: `color-mix(in srgb, ${accent} 30%, #0c1410)`, clipPath: "polygon(50% 0, 88% 60%, 64% 60%, 100% 100%, 0 100%, 36% 60%, 12% 60%)" }} />
    </span>
  );
}

function CompassRose({ bottom, left, accent, spark }: { bottom: string; left: string; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", bottom, left, width: 64, height: 64, opacity: 0.5 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1.5px solid ${accent}66` }} />
      <span style={{ position: "absolute", inset: "18%", borderRadius: "50%", border: `1px solid ${accent}44` }} />
      {[0, 45, 90, 135].map((d) => (
        <span key={d} style={{ position: "absolute", top: "50%", left: "50%", width: "100%", height: 1.5, background: d % 90 === 0 ? `${spark}aa` : `${accent}55`, transform: `translate(-50%,-50%) rotate(${d}deg)` }} />
      ))}
      {/* north needle */}
      <span style={{ position: "absolute", top: "8%", left: "50%", width: 6, height: "42%", marginLeft: -3, background: spark, clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />
    </span>
  );
}

function contourLines(accent: string): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    top: "40%",
    height: "30%",
    backgroundImage: `radial-gradient(120% 60px at 30% 40%, transparent 40px, ${accent}1c 41px 42px, transparent 43px),radial-gradient(120% 60px at 72% 70%, transparent 40px, ${accent}18 41px 42px, transparent 43px)`,
    backgroundSize: "100% 180px",
    backgroundRepeat: "repeat-y",
    opacity: 0.7,
  };
}

// ============================================================================================
// ARTS — study desk + candles → gallery of framed works → grand library rotunda
// ============================================================================================

function ArtsZones({ accent }: { accent: string }) {
  return (
    <>
      <span style={band("0%", "40%", `linear-gradient(180deg, color-mix(in srgb, ${accent} 26%, rgba(18,12,30,.66)) 0%, rgba(20,14,32,.3) 72%, transparent 100%)`)} />
      <span style={band("34%", "34%", `linear-gradient(180deg, transparent, color-mix(in srgb, ${accent} 18%, rgba(22,16,34,.44)) 50%, transparent)`)} />
      <span style={band("60%", "40%", `linear-gradient(180deg, transparent 0%, color-mix(in srgb, ${accent} 22%, rgba(28,18,34,.46)) 38%, color-mix(in srgb, ${accent} 32%, rgba(32,20,32,.62)) 100%)`)} />
    </>
  );
}

function ArtsLandmarks({ accent, spark }: { accent: string; spark: string }) {
  return (
    <>
      {/* ── GRAND LIBRARY ROTUNDA (summit) ── arched hall + a great tome ── */}
      <Glow top="3%" left="50%" w={250} h={170} color={`${accent}26`} blur={30} />
      <Rotunda top="5%" left="50%" w={170} accent={accent} />
      <Bookshelf top="16%" left="6%" h={92} accent={accent} />
      <Bookshelf top="18%" left="84%" h={84} accent={accent} />

      {/* ── GALLERY (mid) ── framed paintings on a wall ── */}
      <Ridge top="58%" accent={accent} op={0.2} />
      <FramePiece top="44%" left="14%" w={42} accent={accent} spark={spark} />
      <FramePiece top="48%" left="40%" w={34} accent={accent} spark={spark} />
      <FramePiece top="44%" left="70%" w={46} accent={accent} spark={spark} />

      {/* ── STUDY DESK (bottom) ── candles + quill ── */}
      <Ridge top="97%" accent={accent} op={0.24} />
      <Candle bottom="6%" left="14%" accent={accent} spark={spark} />
      <Candle bottom="5%" left="82%" accent={accent} spark={spark} />
      <span className="emoji" style={{ position: "absolute", bottom: "8%", left: "47%", fontSize: 26, opacity: 0.18, transform: "rotate(-18deg)", filter: `drop-shadow(0 0 8px ${accent})` }}>
        🖋️
      </span>
    </>
  );
}

function Rotunda({ top, left, w, accent }: { top: string; left: string; w: number; accent: string }) {
  const c = `color-mix(in srgb, ${accent} 24%, #160f24)`;
  const edge = `${accent}55`;
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: w, height: w * 0.66, transform: "translateX(-50%)", opacity: 0.7 }}>
      {/* dome */}
      <span style={{ position: "absolute", top: 0, left: "18%", right: "18%", height: "34%", borderRadius: "999px 999px 0 0", background: c, border: `1px solid ${edge}`, borderBottom: "none" }} />
      {/* arched colonnade */}
      <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "62%", display: "flex", justifyContent: "space-between" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ width: "16%", height: "100%", borderRadius: "999px 999px 0 0", border: `2px solid ${edge}`, borderBottom: "none", background: `${accent}10` }} />
        ))}
      </span>
    </span>
  );
}

function Bookshelf({ top, left, h, accent }: { top: string; left: string; h: number; accent: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: h * 0.4, height: h, opacity: 0.5, background: `color-mix(in srgb, ${accent} 18%, #140e20)`, border: `1px solid ${accent}44`, display: "flex", flexDirection: "column", gap: 2, padding: 2 }}>
      {[0, 1, 2, 3].map((row) => (
        <span key={row} style={{ flex: 1, display: "flex", gap: 1.5, borderBottom: `1px solid ${accent}33` }}>
          {[0, 1, 2, 3, 4].map((b) => (
            <span key={b} style={{ flex: 1, background: `color-mix(in srgb, ${accent} ${30 + ((row + b) % 3) * 14}%, #0c0a16)` }} />
          ))}
        </span>
      ))}
    </span>
  );
}

function FramePiece({ top, left, w, accent, spark }: { top: string; left: string; w: number; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: w, height: w * 0.78, opacity: 0.55, background: `color-mix(in srgb, ${accent} 20%, #100b1c)`, border: `2px solid ${accent}88`, borderRadius: 2, boxShadow: `0 0 10px ${accent}33` }}>
      <span style={{ position: "absolute", inset: "16%", background: `radial-gradient(circle at 40% 35%, ${spark}55, ${accent}44 60%, transparent)` }} />
    </span>
  );
}

function Candle({ bottom, left, accent, spark }: { bottom: string; left: string; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", bottom, left, width: 10, height: 46, opacity: 0.7 }}>
      <span style={{ position: "absolute", bottom: 0, left: "30%", width: "40%", height: "62%", background: `color-mix(in srgb, ${accent} 24%, #e8dcc0)`, opacity: 0.5 }} />
      <span className="rr-twinkle" style={{ position: "absolute", top: 0, left: "50%", width: 8, height: 14, marginLeft: -4, borderRadius: "50% 50% 50% 50% / 70% 70% 40% 40%", background: `radial-gradient(circle at 50% 70%, #fff0c0, ${spark} 60%, transparent 78%)`, boxShadow: `0 0 14px ${spark}` }} />
    </span>
  );
}

// ============================================================================================
// POP CULTURE — neon street → stage + curtains → marquee finale + spotlights
// ============================================================================================

function PopZones({ accent }: { accent: string }) {
  return (
    <>
      <span style={band("0%", "40%", `linear-gradient(180deg, color-mix(in srgb, ${accent} 26%, rgba(20,8,28,.66)) 0%, rgba(22,10,30,.3) 72%, transparent 100%)`)} />
      <span style={band("34%", "34%", `linear-gradient(180deg, transparent, color-mix(in srgb, ${accent} 20%, rgba(24,10,30,.46)) 50%, transparent)`)} />
      <span style={band("60%", "40%", `linear-gradient(180deg, transparent 0%, color-mix(in srgb, ${accent} 22%, rgba(28,10,30,.46)) 38%, color-mix(in srgb, ${accent} 32%, rgba(30,10,28,.62)) 100%)`)} />
    </>
  );
}

function PopLandmarks({ accent, spark }: { accent: string; spark: string }) {
  return (
    <>
      {/* ── MARQUEE FINALE (summit) ── a lit marquee sign + crossing spotlights ── */}
      <Spotlight top="0%" left="20%" rot={16} accent={accent} spark={spark} />
      <Spotlight top="0%" left="80%" rot={-16} accent={accent} spark={spark} />
      <Marquee top="8%" left="50%" w={170} accent={accent} spark={spark} />

      {/* ── STAGE (mid) ── curtains framing + a film reel ── */}
      <Curtain side="left" accent={accent} />
      <Curtain side="right" accent={accent} />
      <Reel top="46%" left="12%" accent={accent} />
      <Reel top="50%" left="80%" accent={accent} />

      {/* ── NEON STREET (bottom) ── a bulb strip + tickets ── */}
      <Ridge top="92%" accent={accent} op={0.24} />
      <span aria-hidden style={{ position: "absolute", bottom: "10%", left: 0, right: 0, height: 4, backgroundImage: `radial-gradient(2px 2px at 6% 50%, ${spark}, transparent), radial-gradient(2px 2px at 18% 50%, ${spark}, transparent), radial-gradient(2px 2px at 30% 50%, ${spark}, transparent), radial-gradient(2px 2px at 42% 50%, ${spark}, transparent), radial-gradient(2px 2px at 54% 50%, ${spark}, transparent), radial-gradient(2px 2px at 66% 50%, ${spark}, transparent), radial-gradient(2px 2px at 78% 50%, ${spark}, transparent), radial-gradient(2px 2px at 90% 50%, ${spark}, transparent)`, opacity: 0.7 }} />
      <Ticket bottom="3%" left="40%" accent={accent} spark={spark} />
    </>
  );
}

function Marquee({ top, left, w, accent, spark }: { top: string; left: string; w: number; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: w, height: w * 0.4, transform: "translateX(-50%)", opacity: 0.85, borderRadius: 8, background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 30%, #1a0a1e), #120816)`, border: `2px solid ${spark}aa`, boxShadow: `0 0 22px ${accent}55` }}>
      {/* bulb border */}
      {Array.from({ length: 14 }).map((_, i) => (
        <span key={i} style={{ position: "absolute", top: 3, left: `${4 + i * 6.8}%`, width: 3, height: 3, borderRadius: "50%", background: spark, boxShadow: `0 0 5px ${spark}` }} />
      ))}
      <span style={{ position: "absolute", inset: "30% 16%", background: `repeating-linear-gradient(90deg, ${spark}66 0 4px, transparent 4px 9px)`, borderRadius: 3 }} />
    </span>
  );
}

function Spotlight({ top, left, rot, accent, spark }: { top: string; left: string; rot: number; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: 60, height: 260, transform: `translateX(-50%) rotate(${rot}deg)`, transformOrigin: "top center", opacity: 0.4 }}>
      <span style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${spark}55, ${accent}22 40%, transparent 78%)`, clipPath: "polygon(40% 0, 60% 0, 100% 100%, 0 100%)" }} />
    </span>
  );
}

function Curtain({ side, accent }: { side: "left" | "right"; accent: string }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: "34%",
        [side]: 0,
        width: "18%",
        height: "30%",
        opacity: 0.5,
        background: `repeating-linear-gradient(90deg, color-mix(in srgb, ${accent} 40%, #14060f) 0 8px, color-mix(in srgb, ${accent} 22%, #0c040a) 8px 16px)`,
        borderRadius: side === "left" ? "0 0 40px 0" : "0 0 0 40px",
        maskImage: "linear-gradient(180deg, rgba(0,0,0,.95), transparent)",
        WebkitMaskImage: "linear-gradient(180deg, rgba(0,0,0,.95), transparent)",
      }}
    />
  );
}

function Reel({ top, left, accent }: { top: string; left: string; accent: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", top, left, width: 40, height: 40, opacity: 0.45, borderRadius: "50%", border: `3px solid ${accent}88` }}>
      {[0, 72, 144, 216, 288].map((d) => (
        <span key={d} style={{ position: "absolute", top: "50%", left: "50%", width: 7, height: 7, marginTop: -3.5, marginLeft: -3.5, borderRadius: "50%", background: `${accent}aa`, transform: `rotate(${d}deg) translateY(-11px)` }} />
      ))}
      <span style={{ position: "absolute", inset: "40%", borderRadius: "50%", background: `${accent}cc` }} />
    </span>
  );
}

function Ticket({ bottom, left, accent, spark }: { bottom: string; left: string; accent: string; spark: string }) {
  return (
    <span aria-hidden style={{ position: "absolute", bottom, left, width: 40, height: 22, opacity: 0.55, transform: "rotate(-8deg)", background: `linear-gradient(180deg, ${accent}aa, ${accent}66)`, borderRadius: 3, border: `1px dashed ${spark}` }}>
      <span style={{ position: "absolute", top: 2, bottom: 2, left: "62%", width: 1, borderLeft: `1px dashed ${spark}aa` }} />
    </span>
  );
}
