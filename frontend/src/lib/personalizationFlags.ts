/** Build-time flag for the dev-only taste-profile inspector. Baked in by Vite; set
 * VITE_PERSONALIZATION_DEBUG=true only in a gitignored .env.local, never in production builds. */
export function isPersonalizationDebugEnabled(): boolean {
  return import.meta.env.VITE_PERSONALIZATION_DEBUG === "true";
}
