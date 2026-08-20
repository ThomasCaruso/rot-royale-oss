import { lobbyArt } from "@/assets/lobby";

// Podium portrait registry. The current art set is small (one hooded hero + one bot), so opponents
// repeat for now. This module is the single seam for richer avatars later: drop new image paths into
// OPPONENT_AVATARS and the podium picks them up automatically (seeded by name → stable per player),
// with NO layout changes needed. The champion / current user always wear the hooded hero.
export const CHAMPION_AVATAR: string = lobbyArt.avatarHooded;

export const OPPONENT_AVATARS: readonly string[] = [
  lobbyArt.avatarBot,
  // ↓ add new avatar image imports here as they ship; variety appears automatically.
];

export type PodiumAvatar = { src: string; kind: "hooded" | "bot" };

function seedHash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Resolve a podium portrait. The champion (#1) and the current user get the hooded hero; everyone
 * else gets a stable opponent avatar chosen from the registry by a hash of their name.
 */
export function podiumAvatar({
  seed,
  isMe,
  champion,
}: {
  seed: string;
  isMe?: boolean;
  champion?: boolean;
}): PodiumAvatar {
  if (isMe || champion) return { src: CHAMPION_AVATAR, kind: "hooded" };
  const pool = OPPONENT_AVATARS.length ? OPPONENT_AVATARS : [lobbyArt.avatarBot];
  return { src: pool[seedHash(seed) % pool.length], kind: "bot" };
}
