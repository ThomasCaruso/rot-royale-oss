import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/ui/useReducedMotion";

const COLORS = ["#FFC91E", "#7C3AED", "#A855F7", "#2FD45E", "#FFFFFF", "#FF2E4D"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
}

/**
 * One confetti burst on mount / when `burstKey` changes (DESIGN §5). Full-screen canvas overlay,
 * compositor-friendly, self-terminating (~1.6s). Disabled under prefers-reduced-motion.
 */
export function Confetti({ burstKey = 0, count = 140 }: { burstKey?: number; count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = (canvas.width = window.innerWidth * dpr);
    const h = (canvas.height = window.innerHeight * dpr);
    ctx.scale(dpr, dpr);
    const W = window.innerWidth;

    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: window.innerHeight * 0.28,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -11 - 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      size: 6 + Math.random() * 7,
      color: COLORS[(Math.random() * COLORS.length) | 0],
    }));

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.vy += 0.32; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - elapsed / 1700);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (elapsed < 1700) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [burstKey, count, reduced]);

  if (reduced) return null;
  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ position: "fixed", inset: 0, zIndex: 50, pointerEvents: "none" }}
    />
  );
}
