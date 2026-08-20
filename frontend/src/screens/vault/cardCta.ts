import type React from "react";

/** Shared CTA pill style for Vault cards (VaultItemCard + FrameCard) so the two card families
 * stay in visual lockstep. Lives in its own module (not a component file) for fast-refresh. */
export function ctaStyle(background: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minHeight: 44,
    padding: "10px 16px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 13,
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    background,
    color,
  };
}
