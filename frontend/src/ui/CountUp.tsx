import { useEffect, useState } from "react";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { activeTag } from "@/i18n/format";

/** Animates a number 0 → value (DESIGN §5 score/coins count-up). Reduced-motion shows it instantly. */
export function CountUp({
  value,
  durationMs = 900,
  className,
  style,
}: {
  value: number;
  durationMs?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      setN(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setN(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, reduced]);

  return (
    <span className={className} style={style}>
      {n.toLocaleString(activeTag())}
    </span>
  );
}
