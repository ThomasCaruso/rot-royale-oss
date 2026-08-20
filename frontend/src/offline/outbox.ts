import { create } from "zustand";
import { listOutbox, enqueue as dbEnqueue } from "./db";
import type { OutboxRecord } from "./types";

export const useOutbox = create<{ pending: number }>(() => ({ pending: 0 }));

export async function refreshOutboxCount(): Promise<void> {
  useOutbox.setState({ pending: (await listOutbox()).length });
}
export async function enqueue(r: OutboxRecord): Promise<void> {
  await dbEnqueue(r);
  await refreshOutboxCount();
}
