// Starter-system campaign hub art — the illustrated pieces of the reference campaign redesign that
// every NORMAL theme (Starter + its skins) shares. Backgrounds are stripped to transparency + the
// art is tight-cropped by scripts/prep_starter_campaign_art.py (the ./raw originals are the source),
// so each piece sits cleanly on both the light skins (Starter/Daylight/Bubblegum…) and the dark ones
// (Midnight/Apex/Champion…). Like the other campaign art these load on demand (not PWA-precached);
// all text (titles, counts, CTAs) is rendered in React/CSS, never baked into the art.
import heroCrownMap from "./campaign-hero-crown-map.png";
import badgeArts from "./world-badge-arts.png";
import badgeGeography from "./world-badge-geography.png";
import badgeHistory from "./world-badge-history.png";
import badgePop from "./world-badge-pop.png";
import badgeScience from "./world-badge-science.png";
import badgeSports from "./world-badge-sports.png";
import sceneArts from "./world-scene-arts.png";
import sceneGeography from "./world-scene-geography.png";
import sceneHistory from "./world-scene-history.png";
import scenePop from "./world-scene-pop.png";
import sceneScience from "./world-scene-science.png";
import sceneSports from "./world-scene-sports.png";

/** The gold-crown-on-a-map hero illustration for the "Campaign" banner card. */
export const starterHeroArt = heroCrownMap;

export interface StarterWorldArt {
  /** Round gold-framed category medallion (the world's colour identity). */
  badge: string;
  /** Soft line-art establishing scene (observatory, temple, arena…) faded into the card. */
  scene: string;
}

/** Keyed by the server world name (CampaignWorld.world). */
export const starterWorldArt: Record<string, StarterWorldArt> = {
  Science: { badge: badgeScience, scene: sceneScience },
  History: { badge: badgeHistory, scene: sceneHistory },
  Sports: { badge: badgeSports, scene: sceneSports },
  Geography: { badge: badgeGeography, scene: sceneGeography },
  Arts: { badge: badgeArts, scene: sceneArts },
  "Pop Culture": { badge: badgePop, scene: scenePop },
};

export function starterWorldArtFor(world: string): StarterWorldArt | null {
  return starterWorldArt[world] ?? null;
}
