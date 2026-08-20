import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

/**
 * Shrink-to-fit text for i18n. English is the design size (the ceiling); a longer translation is
 * scaled DOWN until it fits the same box, so assets, spacing and element positions never move when
 * the language changes (the app's rule: match the English composition exactly, only the font gives).
 *
 * Why it's safe for English: the design size is applied as `calc(<size> * var(--fit-scale))` and
 * `--fit-scale` starts at 1 and is only ever reduced. If the text already fits at scale 1 (English,
 * and every translation that isn't longer) nothing is touched — the render is identical to before.
 * Because `<size>` stays in the `calc`, a `clamp(...)`/`cqw` ceiling keeps reacting to the viewport;
 * we just multiply whatever it resolves to.
 *
 * Placement contract: FitText fits the text to ITS OWN box, so the element must be the constrained
 * box — a definite/`max` width (or a `flex:1; min-width:0` slot) for single-line `axis="x"`, or a
 * definite height / line-clamp for `axis="y"`. It never invents the box; give it one and it fills it
 * with the largest font (≤ the design size) that fits, down to `min` (a fraction of the design size).
 * Since a definite box's border size doesn't change when the font does, the ResizeObserver can't loop.
 */
export function FitText({
  children,
  size,
  as: Tag = "span",
  min = 0.72,
  axis = "x",
  className,
  style,
  ...rest
}: {
  /** The design font-size — the ceiling. Any CSS length: a number (px), "14px", or "clamp(...)". */
  size: number | string;
  children: ReactNode;
  as?: ElementType;
  /** Legibility floor as a fraction of the design size (0–1). */
  min?: number;
  /** Which overflow to fight: "x" single-line width (default), "y" block height, or "both". */
  axis?: "x" | "y" | "both";
  className?: string;
  style?: CSSProperties;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement | null>(null);
  const sizeCss = typeof size === "number" ? `${size}px` : size;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;

    const overflows = () =>
      (axis !== "y" && el.scrollWidth > el.clientWidth + 0.5) ||
      (axis !== "x" && el.scrollHeight > el.clientHeight + 0.5);

    const fit = () => {
      el.style.setProperty("--fit-scale", "1");
      if (!overflows()) return; // fits at the design size → leave English untouched
      let lo = min;
      let hi = 1;
      let best = min;
      // Binary-search the largest scale in [min, 1] that fits. 8 steps ≈ 0.4% precision.
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        el.style.setProperty("--fit-scale", String(mid));
        if (overflows()) hi = mid;
        else {
          best = mid;
          lo = mid;
        }
      }
      el.style.setProperty("--fit-scale", String(best));
    };

    fit();
    // ResizeObserver is absent in the jsdom test env (and any non-DOM host) — the initial fit still
    // runs; we just don't re-fit on resize there.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [children, sizeCss, min, axis]);

  return (
    <Tag
      ref={ref as React.Ref<HTMLElement>}
      className={className}
      style={{ fontSize: `calc(${sizeCss} * var(--fit-scale, 1))`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
