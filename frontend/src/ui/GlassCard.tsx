/**
 * Tactile glass card (DESIGN §4). Depth comes from layered surface treatment driven entirely by
 * the existing theme vars — so every theme gets the upgrade for free:
 *  - a soft top-lit radial bloom over the panel→panel2 gradient (the surface catches light)
 *  - a crisp inset top highlight + a faint inner bottom shadow (the glass has thickness)
 *  - layered ambient + contact drop-shadows so the card floats off the background
 * All static (no animation) and GPU-cheap (gradient + box-shadow only).
 */
export function GlassCard({
  children,
  style,
  className,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  /**
   * Extra classes, APPENDED to `rr-glass` rather than replacing it — so a caller can add a
   * transient animation (a win pulse, a shake) to the card without losing the surface treatment or
   * the per-art-style overrides that depend on `.rr-glass` being present.
   */
  className?: string;
}) {
  // The surface treatment (gradient, border, radius, layered shadows + the per-theme --glow bloom)
  // lives in the `.rr-glass` CSS class so the per-ART-STYLE overrides (arcade = stronger neon glow,
  // soft = rounder + pillowy bloom) can actually take effect — inline styles would otherwise win and
  // make every theme's card identical. Callers still pass layout/spacing overrides via `style`.
  return (
    <div className={className ? `rr-glass ${className}` : "rr-glass"} style={style}>
      {children}
    </div>
  );
}
