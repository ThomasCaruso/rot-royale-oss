import { get, set, del, keys, createStore } from "idb-keyval";
import type { CampaignLadderResponse } from "@/api/client";
import type { CampaignBundleLevel, PracticePool, OutboxRecord } from "./types";

const content = createStore("rr-offline-content", "kv");
const outbox = createStore("rr-offline-outbox", "kv");

const campKey = (world: string, level: number) => `campaign:${world}:${level}`;

export async function putCampaignLevel(l: CampaignBundleLevel): Promise<void> {
  await set(campKey(l.world, l.level), l, content);
}
export async function getCampaignLevel(world: string, level: number): Promise<CampaignBundleLevel | undefined> {
  return get(campKey(world, level), content);
}
export async function putPool(p: PracticePool): Promise<void> {
  await set(`pool:${p.category ?? "_mixed"}`, p, content);
}
export async function getPool(category: string | null): Promise<PracticePool | undefined> {
  return get(`pool:${category ?? "_mixed"}`, content);
}
export async function putLadder(l: CampaignLadderResponse): Promise<void> {
  await set("ladder", l, content);
}
export async function getLadder(): Promise<CampaignLadderResponse | undefined> {
  return get("ladder", content);
}
export async function setMeta(v: { bank_version: string; fetched_at: number }): Promise<void> {
  await set("meta", v, content);
}
export async function getMeta(): Promise<{ bank_version: string; fetched_at: number } | undefined> {
  return get("meta", content);
}

export async function enqueue(r: OutboxRecord): Promise<void> {
  await set(r.client_id, r, outbox);
}
export async function listOutbox(): Promise<OutboxRecord[]> {
  const ks = await keys(outbox);
  const recs = await Promise.all(ks.map((k) => get(k as string, outbox) as Promise<OutboxRecord>));
  return recs.filter(Boolean).sort((a, b) => a.created_at - b.created_at);
}
export async function removeFromOutbox(client_id: string): Promise<void> {
  await del(client_id, outbox);
}
export async function bumpAttempts(client_id: string): Promise<void> {
  const r = (await get(client_id, outbox)) as OutboxRecord | undefined;
  if (r) await set(client_id, { ...r, attempts: r.attempts + 1 }, outbox);
}
