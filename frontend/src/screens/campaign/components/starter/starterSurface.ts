// Shared card surface for the Starter-system campaign hub — the same liquid-glass panel the rest of
// the premium app wears (mirrors `.rr-root.s-mono .rr-glass` in global.css), expressed as an inline
// style so the hub's custom layouts (overlapping art, floating pills, borders) can compose on top of
// it. Token-driven throughout, so every normal skin (light + dark) repaints it correctly.
import type { CSSProperties } from "react";

export function panel(overrides?: CSSProperties): CSSProperties {
  return {
    position: "relative",
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-card, 26px)",
    boxShadow:
      "inset 0 1px 0 var(--sheen), 0 1px 2px rgba(17,17,17,.05), 0 14px 36px rgba(17,17,17,.08)",
    ...overrides,
  };
}
