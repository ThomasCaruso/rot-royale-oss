import { api, type CampaignLadderResponse } from "@/api/client";
import { putCampaignLevel, getCampaignLevel, putPool, setMeta, putLadder } from "./db";

export async function downloadCampaign(fetch = api.campaignOfflineBundle): Promise<void> {
  const bundle = await fetch();
  for (const lvl of bundle.levels) await putCampaignLevel(lvl);
  await setMeta({ bank_version: bundle.bank_version, fetched_at: Date.now() });
}

/**
 * Persist a freshly-fetched ladder so the campaign map renders offline. The offline bundle carries
 * level rounds but NOT the arc/star ladder structure, so the screen (Task 8b) calls this after a
 * successful `api.campaign()` while online.
 */
export async function cacheLadder(ladder: CampaignLadderResponse): Promise<void> {
  await putLadder(ladder);
}

export async function downloadPractice(
  category: string | null = null,
  fetch = api.practiceOfflinePool,
): Promise<void> {
  const pool = await fetch(category);
  await putPool(pool);
}

export async function isCampaignLevelCached(world: string, level: number): Promise<boolean> {
  return (await getCampaignLevel(world, level)) !== undefined;
}

/** Best-effort opportunistic refresh while online; safe to call on app foreground. */
export async function refreshOfflineContent(): Promise<void> {
  await Promise.allSettled([downloadCampaign(), downloadPractice(null)]);
}
