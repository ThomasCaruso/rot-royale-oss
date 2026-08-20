/** Shared styles for the legal pages.
 *
 * Kept out of LegalShell.tsx so that file exports only components — a non-component export there
 * breaks React Fast Refresh for the whole module.
 */

/**
 * Inline links in legal copy (contact addresses, cross-references).
 *
 * Underlined as well as coloured: colour alone is not a sufficient affordance and fails WCAG 1.4.1
 * ("Use of Colour") for readers who cannot distinguish the amber from body text. `wordBreak` keeps
 * the 28-character contact address from pushing the page wider than a phone screen.
 */
export const legalLink: React.CSSProperties = {
  color: "var(--amber)",
  fontWeight: 700,
  textDecoration: "underline",
  textUnderlineOffset: 2,
  wordBreak: "break-word",
};
