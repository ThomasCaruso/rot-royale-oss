import { useEffect, useState } from "react";
import { api } from "@/api/client";

/**
 * Module-level cached promise — all component instances share a single fetch.
 * Reset to null only happens at module reload (dev HMR); production never re-fetches.
 */
let _ready: Promise<boolean> | null = null;

function resolveReady(): Promise<boolean> {
  if (_ready === null) {
    // Defer the api call into a microtask so a synchronous throw (e.g. missing test mock)
    // is caught by .catch() rather than propagating to the caller.
    _ready = Promise.resolve()
      .then(() => api.aiStatus())
      .then((s) => s.ready)
      .catch(() => false);
  }
  return _ready;
}

/**
 * Returns true once /personalization/status confirms coverage >= AI_READY_THRESHOLD (0.8).
 * Defaults to false (soft copy shown) until the single shared fetch resolves. Never throws.
 *
 * Usage:
 *   const aiReady = useAiReady();
 *   <p>{aiReady ? t.brainBoost.checkMetaReady : t.brainBoost.checkMeta}</p>
 */
export function useAiReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    resolveReady().then((r) => {
      if (alive) setReady(r);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}
