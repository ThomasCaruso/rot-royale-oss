import { useEffect, useRef } from "react";
import type { WorldDecor, WorldSilhouette, WorldTheme } from "@/lib/campaign";
import { WorldAmbient, WorldLandmarks, WorldZones } from "@/screens/campaign/components/worldEnvironments";
import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * Shared world-scenery primitives for the campaign screens (hub world cards + the world quest map):
 * background silhouettes and the medallion-on-a-stage composition. All decorative (aria-hidden),
 * CSS-only, static = cheap. Pure style helpers live in trail.ts.
 */

/**
 * The tall WORLD the roadmap travels through — drawn inside the scrolling quest board (full map
 * height), BEHIND the road. This is NOT a single-screen poster: it is a multi-screen environment that
 * reveals new zones + landmarks as the player scrolls. Science journeys bottom→top through a LAB zone
 * (trailhead) → an OBSERVATORY zone → a DEEP-SPACE / ORBITAL zone → the boss landmark at the summit.
 *
 * Depth via parallax (reduced-motion-safe): the FAR sky is the fixed WorldHorizon (slowest); the
 * MIDGROUND landmark layer here lags scroll slightly; the path + nodes (foreground) scroll normally.
 * Drop in `theme.art.backgroundImage` for a tall illustrated backdrop — the CSS zones are the fallback.
 */
export function WorldBoardSurface({ theme }: { theme: WorldTheme }) {
  const reduce = useReducedMotion();
  const midRef = useRef<HTMLDivElement>(null);

  // Midground parallax: the landmark layer lags the scroll so it reads as further away than the path.
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (midRef.current) midRef.current.style.transform = `translateY(${window.scrollY * 0.12}px)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  const { accent, spark, road } = theme;
  const hasArt = Boolean(theme.art?.backgroundImage);
  const art = theme.art;
  // A journey-layer pack (start/mid/summit set pieces) replaces the CSS landmark sprites — the zones
  // keep tinting the regions underneath, and the parallax midground still carries the ambient specks.
  const hasLayers = Boolean(art?.layerStartImage || art?.layerMidImage || art?.layerSummitImage);

  return (
    <span aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* OPTIONAL tall drop-in world art (cover, full board height). CSS zones below are the fallback. */}
      {hasArt && (
        <img src={theme.art!.backgroundImage} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      )}

      {/* Zone bands — the world's regions, revealed top→bottom as you scroll. */}
      {!hasArt && <WorldZones road={road} accent={accent} />}

      {/* The illustrated JOURNEY layers, composited as blended world ZONES (never panels): every
          bitmap is oversized past the board edges, screen-blended so its dark sky dissolves into
          the base world, and radially MASKED so no rectangular boundary can ever show. Behind the
          corridor/road/nodes; atmosphere, not posters. */}
      {art?.layerSummitImage && (
        /* The boss-zone galaxy — a full-width final-region atmosphere the summit sits INSIDE. */
        <img
          src={art.layerSummitImage}
          alt=""
          style={{
            position: "absolute",
            top: "-2%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(160%, 940px)",
            height: "26%",
            objectFit: "cover",
            mixBlendMode: "screen",
            opacity: 0.85,
            maskImage: "radial-gradient(72% 74% at 50% 44%, black 32%, transparent 78%)",
            WebkitMaskImage: "radial-gradient(72% 74% at 50% 44%, black 32%, transparent 78%)",
          }}
        />
      )}
      {art?.layerMidImage && (
        <>
          <img
            src={art.layerMidImage}
            alt=""
            style={{
              position: "absolute",
              top: "25%",
              left: "-14%",
              width: "128%",
              height: "15%",
              objectFit: "cover",
              mixBlendMode: "screen",
              opacity: 0.5,
              maskImage: "radial-gradient(66% 62% at 44% 50%, black 26%, transparent 80%)",
              WebkitMaskImage: "radial-gradient(66% 62% at 44% 50%, black 26%, transparent 80%)",
            }}
          />
          <img
            src={art.layerMidImage}
            alt=""
            style={{
              position: "absolute",
              top: "46%",
              right: "-14%",
              width: "128%",
              height: "14%",
              objectFit: "cover",
              mixBlendMode: "screen",
              opacity: 0.42,
              transform: "scaleX(-1)",
              maskImage: "radial-gradient(64% 60% at 56% 50%, black 24%, transparent 80%)",
              WebkitMaskImage: "radial-gradient(64% 60% at 56% 50%, black 24%, transparent 80%)",
            }}
          />
          <img
            src={art.layerMidImage}
            alt=""
            style={{
              position: "absolute",
              top: "64%",
              left: "-12%",
              width: "120%",
              height: "12%",
              objectFit: "cover",
              mixBlendMode: "screen",
              opacity: 0.32,
              maskImage: "radial-gradient(60% 58% at 48% 50%, black 22%, transparent 78%)",
              WebkitMaskImage: "radial-gradient(60% 58% at 48% 50%, black 22%, transparent 78%)",
            }}
          />
        </>
      )}
      {art?.layerStartImage && (
        /* The trailhead set piece — full-bleed across the base, its own alpha sky already blends;
            a soft top mask melts the horizon into the world above it. */
        <img
          src={art.layerStartImage}
          alt=""
          style={{
            position: "absolute",
            bottom: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(112%, 660px)",
            maxHeight: "30%",
            objectFit: "cover",
            objectPosition: "bottom",
            opacity: 0.95,
            maskImage: "linear-gradient(180deg, transparent 0%, black 22%)",
            WebkitMaskImage: "linear-gradient(180deg, transparent 0%, black 22%)",
          }}
        />
      )}

      {/* soft lit corridor the track runs through (subtle, full height) */}
      <span
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          width: "62%",
          transform: "translateX(-50%)",
          background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${accent} 14%, transparent) 50%, transparent)`,
        }}
      />
      {/* side vignette framing the corridor — the world recedes at the edges so the route reads as a
          lit arc travelling INTO the world, not decoration floating on a flat board */}
      <span
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg, rgba(5,3,12,.5), transparent 24%, transparent 76%, rgba(5,3,12,.5))",
        }}
      />

      {/* Midground landmark layer (parallax). Anything that shifts just reveals the fixed sky behind.
          With a journey-layer pack the CSS landmark sprites step aside for the art; the ambient
          specks stay for depth. */}
      <div ref={midRef} style={{ position: "absolute", inset: 0, willChange: "transform" }}>
        {!hasArt && (
          <>
            <WorldAmbient road={road} spark={spark} />
            {!hasLayers && <WorldLandmarks road={road} accent={accent} spark={spark} />}
          </>
        )}
      </div>
    </span>
  );
}

/** Background silhouette compositions (low-opacity, behind everything). */
export function Silhouette({ kind, accent }: { kind: WorldSilhouette; accent: string }) {
  if (kind === "temple") {
    const step = (w: string, b: number, h: number): React.CSSProperties => ({
      position: "absolute",
      left: "50%",
      transform: "translateX(-50%)",
      bottom: b,
      width: w,
      height: h,
      background: `${accent}24`,
      borderTop: `1px solid ${accent}4d`,
    });
    return (
      <span style={{ position: "absolute", inset: 0 }}>
        <span style={step("76%", 0, 12)} />
        <span style={step("56%", 12, 12)} />
        <span style={step("38%", 24, 14)} />
        {/* columns on the top step */}
        {[-12, -4, 4, 12].map((x) => (
          <span
            key={x}
            style={{
              position: "absolute",
              left: `calc(50% + ${x}px)`,
              bottom: 26,
              width: 3,
              height: 10,
              background: `${accent}40`,
            }}
          />
        ))}
      </span>
    );
  }
  if (kind === "arena") {
    const beam = (side: "left" | "right"): React.CSSProperties => ({
      position: "absolute",
      top: -10,
      [side]: "6%",
      width: "38%",
      height: "120%",
      background: `linear-gradient(180deg, ${accent}30, transparent 68%)`,
      transform: `rotate(${side === "left" ? 18 : -18}deg)`,
      transformOrigin: `top ${side}`,
    });
    return (
      <span style={{ position: "absolute", inset: 0 }}>
        <span style={beam("left")} />
        <span style={beam("right")} />
      </span>
    );
  }
  if (kind === "atlas") {
    return (
      <span style={{ position: "absolute", inset: 0 }}>
        <span
          style={{
            position: "absolute",
            right: -26,
            top: 6,
            width: 92,
            height: 92,
            borderRadius: "50%",
            border: `1.5px dashed ${accent}55`,
          }}
        />
        <span style={cloudBlob("12%", "-8%", 70)} />
        <span style={cloudBlob("60%", "70%", 56)} />
      </span>
    );
  }
  if (kind === "gallery") {
    const frame = (top: string, left: string, w: number, h: number, rot: number): React.CSSProperties => ({
      position: "absolute",
      top,
      left,
      width: w,
      height: h,
      border: `2px solid ${accent}45`,
      borderRadius: 6,
      transform: `rotate(${rot}deg)`,
    });
    return (
      <span style={{ position: "absolute", inset: 0 }}>
        <span style={frame("8%", "70%", 40, 32, -10)} />
        <span style={frame("64%", "4%", 32, 26, 8)} />
      </span>
    );
  }
  if (kind === "neon") {
    return (
      <span style={{ position: "absolute", inset: 0 }}>
        {/* marquee dot arc along the top edge */}
        <span
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: [18, 34, 50, 66, 82]
              .map((x, i) => `radial-gradient(2px 2px at ${x}% ${i % 2 === 0 ? 7 : 11}%, ${accent}aa, transparent)`)
              .join(","),
          }}
        />
        <span
          style={{
            position: "absolute",
            left: "8%",
            top: "16%",
            fontSize: 18,
            color: `${accent}66`,
            textShadow: `0 0 10px ${accent}`,
          }}
        >
          ✦
        </span>
      </span>
    );
  }
  // orbit (Science + fallback): a wide ring system spanning the card
  return (
    <span style={{ position: "absolute", inset: 0 }}>
      <span
        style={{
          position: "absolute",
          left: "-16%",
          top: "32%",
          width: "132%",
          height: "52%",
          borderRadius: "50%",
          border: `1.5px solid ${accent}40`,
          transform: "rotate(-10deg)",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: "-4%",
          top: "40%",
          width: "108%",
          height: "36%",
          borderRadius: "50%",
          border: `1px solid ${accent}2b`,
          transform: "rotate(-10deg)",
        }}
      />
    </span>
  );
}

function cloudBlob(top: string, left: string, w: number): React.CSSProperties {
  return {
    position: "absolute",
    top,
    left,
    width: w,
    height: w * 0.42,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(255,255,255,.1), transparent 70%)",
    filter: "blur(4px)",
  };
}

/** Midground + foreground: medallion on a stage platform, decor composition, and prop glyphs that
 * overlap the disc. `overlap` lets the whole stage poke above the card's top edge. */
export function MedallionStage({
  theme,
  size,
  strong = false,
  dim = false,
  overlap = false,
}: {
  theme: WorldTheme;
  size: number;
  strong?: boolean;
  dim?: boolean;
  overlap?: boolean;
}) {
  return (
    <span
      aria-hidden
      style={{
        position: "relative",
        flex: "none",
        width: size + 14,
        height: size + 14,
        display: "grid",
        placeItems: "center",
        marginTop: overlap ? -26 : 0,
        zIndex: 1,
      }}
    >
      {/* stage platform the medallion sits on */}
      <span
        style={{
          position: "absolute",
          left: "50%",
          bottom: -3,
          width: size * 0.96,
          height: size * 0.2,
          transform: "translateX(-50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${theme.accent}38, rgba(0,0,0,.4) 55%, transparent 72%)`,
          filter: "blur(2px)",
        }}
      />
      {/* An illustrated world emblem replaces the CSS disc + decor wholesale (it IS the medallion);
          the foreground props below still break its silhouette either way. */}
      {theme.art?.worldIconImage ? (
        <img
          src={theme.art.worldIconImage}
          alt=""
          draggable={false}
          style={{
            position: "relative",
            width: size * 0.92,
            height: size * 0.92,
            objectFit: "contain",
            display: "block",
            filter: `drop-shadow(0 6px 12px rgba(0,0,0,.5))${strong ? ` drop-shadow(0 0 16px ${theme.accent}66)` : ""}`,
            opacity: dim ? 0.85 : 1,
          }}
        />
      ) : (
        <>
          <Decor decor={theme.decor} accent={theme.accent} spark={theme.spark} size={size} />
          <span
            style={{
              position: "relative",
              width: size * 0.74,
              height: size * 0.74,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: theme.medallion,
              border: `2.5px solid ${theme.accent}${dim ? "55" : "99"}`,
              boxShadow: dim
                ? "inset 0 1px 0 rgba(255,255,255,.12)"
                : `inset 0 1px 0 rgba(255,255,255,.2), 0 0 ${strong ? 28 : 18}px ${theme.accent}${strong ? "70" : "4d"}`,
            }}
          >
            {/* glossy top highlight — toy quality */}
            <span
              style={{
                position: "absolute",
                top: "7%",
                left: "16%",
                width: "52%",
                height: "30%",
                borderRadius: "50%",
                background: "linear-gradient(180deg, rgba(255,255,255,.28), transparent)",
              }}
            />
            <span className="emoji" style={{ fontSize: size * 0.4, filter: "drop-shadow(0 3px 4px rgba(0,0,0,.45))" }}>
              {theme.glyph}
            </span>
          </span>
        </>
      )}
      {/* foreground props breaking the disc's silhouette */}
      {theme.scene.props.map((p, i) => (
        <span
          key={i}
          className="emoji"
          style={{
            position: "absolute",
            top: p.top,
            left: p.left,
            fontSize: p.size * (size > 100 ? 1.25 : 1),
            transform: `rotate(${p.tilt}deg)`,
            filter: "drop-shadow(0 4px 5px rgba(0,0,0,.55))",
            opacity: dim ? 0.75 : 1,
          }}
        >
          {p.glyph}
        </span>
      ))}
    </span>
  );
}

/** Per-world decorative layer behind/around the medallion (CSS only). */
export function Decor({
  decor,
  accent,
  spark,
  size,
}: {
  decor: WorldDecor;
  accent: string;
  spark: string;
  size: number;
}) {
  const ring = (rx: number, ry: number, rot: number, op = 0.5): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    margin: "auto",
    width: rx,
    height: ry,
    borderRadius: "50%",
    border: `1.5px solid ${accent}`,
    opacity: op,
    transform: `rotate(${rot}deg)`,
  });
  const dot = (top: string, left: string, c: string, d = 5): React.CSSProperties => ({
    position: "absolute",
    top,
    left,
    width: d,
    height: d,
    borderRadius: "50%",
    background: c,
    boxShadow: `0 0 6px ${c}`,
  });

  if (decor === "orbit") {
    return (
      <span aria-hidden className="rr-orbit" style={{ position: "absolute", inset: 0 }}>
        <span style={ring(size, size * 0.62, 0, 0.45)} />
        <span style={dot("8%", "50%", spark)} />
        <span style={dot("78%", "20%", accent)} />
      </span>
    );
  }
  if (decor === "stone") {
    return (
      <span aria-hidden style={{ position: "absolute", inset: 0 }}>
        <span style={ring(size, size, 0, 0.35)} />
        <span style={ring(size * 0.86, size * 0.86, 0, 0.25)} />
      </span>
    );
  }
  if (decor === "rays") {
    return (
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: `conic-gradient(from 0deg, ${accent}33, transparent 18deg, ${accent}33 36deg, transparent 54deg, ${accent}33 72deg, transparent 90deg, ${accent}33 108deg, transparent 126deg, ${accent}33 144deg, transparent 162deg, ${accent}33 180deg, transparent 198deg)`,
          opacity: 0.4,
          maskImage: "radial-gradient(circle, transparent 36%, black 38%, black 62%, transparent 64%)",
          WebkitMaskImage:
            "radial-gradient(circle, transparent 36%, black 38%, black 62%, transparent 64%)",
        }}
      />
    );
  }
  if (decor === "meridian") {
    return (
      <span aria-hidden style={{ position: "absolute", inset: 0 }}>
        <span style={ring(size * 0.5, size, 0, 0.5)} />
        <span style={ring(size * 0.82, size, 28, 0.4)} />
      </span>
    );
  }
  if (decor === "dabs") {
    return (
      <span aria-hidden style={{ position: "absolute", inset: 0 }}>
        <span style={dot("12%", "16%", "#FF6FB3", 6)} />
        <span style={dot("20%", "78%", "#FFD24A", 6)} />
        <span style={dot("80%", "70%", "#6EE7E0", 6)} />
      </span>
    );
  }
  // neon
  return (
    <span aria-hidden style={{ position: "absolute", inset: 0 }}>
      <span
        style={{
          position: "absolute",
          inset: size * 0.08,
          borderRadius: "50%",
          boxShadow: `0 0 18px ${accent}, inset 0 0 12px ${accent}66`,
          opacity: 0.5,
        }}
      />
      <span className="rr-twinkle" style={dot("6%", "70%", spark, 5)} />
      <span className="rr-twinkle" style={dot("74%", "12%", "#fff", 4)} />
    </span>
  );
}

/**
 * Viewport-fixed world atmosphere behind the quest map: a hazy accent horizon + distant feature at
 * the TOP (the vanishing point the road climbs toward), star depth (dense/small up high, sparse/large
 * low), nebula haze, and a clear darker foreground at the bottom. Because it is fixed to the viewport,
 * scrolling the map upward always travels toward the haze → the road reads as receding into distance.
 * Decorative, aria-hidden, static (one twinkle set), reduced-motion-safe via global CSS.
 */
export function WorldHorizon({ theme }: { theme: WorldTheme }) {
  const { accent, spark, art } = theme;
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* OPTIONAL drop-in backdrop art — sits under the CSS depth layers so they still tint it. When
          no asset is set, the CSS atmosphere below carries the scene unchanged. */}
      {art?.backgroundImage && (
        <img src={art.backgroundImage} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }} />
      )}
      {/* depth gradient: accent haze at the summit → deep violet → clear dark foreground */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, ${accent}2e 0%, ${accent}12 16%, rgba(10,6,24,0) 42%, rgba(8,4,18,.55) 84%, rgba(6,3,14,.85) 100%)`,
        }}
      />
      {/* horizon glow — the vanishing point the road travels toward */}
      <div
        style={{
          position: "absolute",
          top: "-18%",
          left: "50%",
          width: 440,
          height: 300,
          transform: "translateX(-50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent}2b, transparent 66%)`,
          filter: "blur(12px)",
        }}
      />
      {/* nebula haze, concentrated up high */}
      <div style={nebulaBlob(accent, "4%", "-12%", 300, 200)} />
      <div style={nebulaBlob("var(--brand)", "10%", "78%", 280, 200)} />
      {/* star depth: far band (small/dense, top) + near band (larger/sparse, lower) */}
      <div style={farStars} />
      <div style={nearStars} />
      {/* distant world feature at the horizon (the slowest, fixed parallax layer) */}
      <HorizonFeature kind={theme.scene.silhouette} accent={accent} spark={spark} />
      {/* a few live twinkles up in the far field */}
      <Twinkle top="9%" left="22%" c={spark} />
      <Twinkle top="6%" left="68%" c="#fff" delay="0.7s" />
      <Twinkle top="15%" left="48%" c={accent} delay="1.1s" />
      {/* ground mist hugging the foreground */}
      <div
        style={{
          position: "absolute",
          left: "-10%",
          right: "-10%",
          bottom: -40,
          height: 150,
          background: `radial-gradient(120% 100% at 50% 100%, ${accent}1f, transparent 70%)`,
          filter: "blur(12px)",
        }}
      />
      {/* OPTIONAL drop-in atmosphere + ambient props (all CSS-fallback-safe when unset) */}
      {art?.ambientOverlayImage && (
        <img src={art.ambientOverlayImage} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.5, mixBlendMode: "screen" }} />
      )}
      {art?.foregroundLeftImage && (
        <img src={art.foregroundLeftImage} alt="" style={{ position: "absolute", left: 0, bottom: 0, maxWidth: "42%", maxHeight: "34%", objectFit: "contain", objectPosition: "left bottom" }} />
      )}
      {art?.foregroundRightImage && (
        <img src={art.foregroundRightImage} alt="" style={{ position: "absolute", right: 0, bottom: 0, maxWidth: "42%", maxHeight: "34%", objectFit: "contain", objectPosition: "right bottom" }} />
      )}
    </div>
  );
}

function Twinkle({ top, left, c, delay = "0s" }: { top: string; left: string; c: string; delay?: string }) {
  return (
    <span
      className="rr-twinkle"
      style={{
        position: "absolute",
        top,
        left,
        width: 3,
        height: 3,
        borderRadius: "50%",
        background: c,
        boxShadow: `0 0 6px ${c}`,
        animationDelay: delay,
      }}
    />
  );
}

/** A distant, low-opacity world landmark sitting on the horizon band (top ~6–24% of the viewport). */
function HorizonFeature({ kind, accent, spark }: { kind: WorldSilhouette; accent: string; spark: string }) {
  if (kind === "temple" || kind === "gallery") {
    // a faint skyline of columns/rooftops along the horizon
    const cols = [12, 24, 38, 50, 62, 76, 88];
    return (
      <div style={{ position: "absolute", top: "13%", left: 0, right: 0, height: 60, opacity: 0.5 }}>
        {cols.map((x, i) => (
          <span
            key={x}
            style={{
              position: "absolute",
              left: `${x}%`,
              bottom: 0,
              width: 10,
              height: 22 + (i % 3) * 12,
              background: `linear-gradient(180deg, ${accent}33, ${accent}10)`,
              borderTop: `2px solid ${accent}44`,
            }}
          />
        ))}
        <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: `${accent}33` }} />
      </div>
    );
  }
  if (kind === "arena" || kind === "neon") {
    // stadium / city light beams sweeping up from the horizon
    return (
      <div style={{ position: "absolute", top: "8%", left: 0, right: 0, height: 200, opacity: 0.45 }}>
        {[20, 50, 80].map((x, i) => (
          <span
            key={x}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: 30,
              width: 60,
              height: 170,
              transform: `translateX(-50%) rotate(${(i - 1) * 12}deg)`,
              transformOrigin: "top center",
              background: `linear-gradient(180deg, ${accent}3a, transparent 72%)`,
              filter: "blur(2px)",
            }}
          />
        ))}
      </div>
    );
  }
  // orbit / atlas: a distant ringed planet rising at the horizon
  return (
    <div style={{ position: "absolute", top: "5%", left: "50%", width: 134, height: 134, transform: "translateX(-50%)", opacity: 0.5 }}>
      <span
        style={{
          position: "absolute",
          inset: "26% 18% 0",
          borderRadius: "50%",
          background: `radial-gradient(120% 120% at 38% 28%, ${spark}55, ${accent}33 55%, transparent 72%)`,
          boxShadow: `0 0 36px ${accent}33`,
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "44%",
          height: 26,
          borderRadius: "50%",
          border: `2px solid ${accent}55`,
          transform: "rotate(-16deg)",
        }}
      />
    </div>
  );
}

function nebulaBlob(color: string, top: string, left: string, w: number, h: number): React.CSSProperties {
  return {
    position: "absolute",
    top,
    left,
    width: w,
    height: h,
    borderRadius: "50%",
    // color-mix (not `${color}26`) so this accepts BOTH a per-world hex accent AND a theme CSS var
    // (var(--brand)) — appending an alpha hex to a var() would be invalid.
    background: `radial-gradient(circle, color-mix(in srgb, ${color} 15%, transparent), transparent 68%)`,
    filter: "blur(20px)",
  };
}

const farStars: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  backgroundImage:
    "radial-gradient(1px 1px at 12% 8%, rgba(255,255,255,.55), transparent)," +
    "radial-gradient(1px 1px at 34% 5%, rgba(199,180,255,.5), transparent)," +
    "radial-gradient(1px 1px at 58% 11%, rgba(255,255,255,.5), transparent)," +
    "radial-gradient(1px 1px at 80% 6%, rgba(255,255,255,.45), transparent)," +
    "radial-gradient(1px 1px at 92% 14%, rgba(199,180,255,.5), transparent)," +
    "radial-gradient(1px 1px at 22% 20%, rgba(255,255,255,.4), transparent)," +
    "radial-gradient(1px 1px at 68% 22%, rgba(255,255,255,.4), transparent)",
  backgroundRepeat: "no-repeat",
};

const nearStars: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  backgroundImage:
    "radial-gradient(1.6px 1.6px at 16% 52%, rgba(255,255,255,.45), transparent)," +
    "radial-gradient(1.6px 1.6px at 84% 60%, rgba(255,255,255,.4), transparent)," +
    "radial-gradient(1.8px 1.8px at 40% 74%, rgba(255,201,30,.4), transparent)," +
    "radial-gradient(1.6px 1.6px at 70% 88%, rgba(255,255,255,.35), transparent)",
  backgroundRepeat: "no-repeat",
};
