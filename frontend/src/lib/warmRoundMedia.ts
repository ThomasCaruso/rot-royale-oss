/**
 * Warm the media a Royale run is about to need, while the player is reading round 1.
 *
 * The rounds that carry media — change detection and the video round — fetch a 200 KB image pair or
 * a ~1.3 MB clip at the moment the round starts. On a phone on mobile data that is a visible stall
 * at exactly the wrong time: a change round that paints its first frame late has eaten part of the
 * 5s look, and a video round that buffers mid-clip reads as the game hanging.
 *
 * WHY THERE IS NO SERVER ENDPOINT FOR THIS, and why there must not be. `POST /contests/{id}/enter`
 * already returns all eight client specs at once, so the moment a player enters, the client holds
 * every media URL the run will use — there is nothing left to ask for. A "today's media" endpoint
 * would be strictly worse than free: today's Royale is the same content for everyone (the shared
 * per-window seed, CLAUDE.md §9), so an endpoint that served the day's change pair WITHOUT entering
 * would let anyone pull both images, diff them offline and know where the change is, while keeping
 * their entry unspent. Warming from specs the player has already been given adds no exposure they
 * did not already have.
 *
 * Everything here is best-effort. A failed warm is silent and costs nothing — the round fetches the
 * asset itself exactly as it would have.
 */

/** The round shape this needs: an opaque client spec that MAY carry media URLs. */
export interface WarmableRound {
  type: string;
  client_spec?: Record<string, unknown> | null;
}

/** Only these keys are ever fetched, so a spec field that merely looks like a URL is not pulled. */
const MEDIA_KEYS = ["base_url", "altered_url"] as const;

/**
 * Video is warmed LAST and separately, because it is the odd one out on cost: one clip is roughly
 * six times a change pair. Fetching it first would hold the connection while the cheap assets —
 * which are needed sooner, since the video round never sits in slot 1 — wait behind it.
 */
const HEAVY_TYPES = new Set(["video"]);

interface Connection {
  saveData?: boolean;
}

/** True when the player has asked the OS to conserve data. Warming is a courtesy, not a feature. */
function saveDataOn(): boolean {
  const conn = (navigator as Navigator & { connection?: Connection }).connection;
  return conn?.saveData === true;
}

function urlsFor(rounds: WarmableRound[], heavy: boolean): string[] {
  const out: string[] = [];
  for (const r of rounds) {
    if (HEAVY_TYPES.has(r.type) !== heavy) continue;
    for (const key of MEDIA_KEYS) {
      const v = r.client_spec?.[key];
      if (typeof v === "string" && v) out.push(v);
    }
  }
  return [...new Set(out)];
}

/**
 * Fetch one asset into the HTTP cache.
 *
 * A plain `fetch` is deliberate: the asset routes send a long `Cache-Control`, so the browser's own
 * cache is already the right store and a warmed response is reused by the `<img>`/`<video>` that
 * asks for it later. Managing a named Cache by hand would mean owning its eviction and its
 * invalidation, and would NOT be read by an ordinary element load without a service worker in the
 * path — which must not run inside the native app at all (§7c).
 */
async function warmOne(url: string, signal: AbortSignal): Promise<void> {
  try {
    const res = await fetch(url, { signal, credentials: "omit", mode: "cors" });
    // The body has to be drained or the response never lands in the cache.
    await res.arrayBuffer();
  } catch {
    /* best-effort */
  }
}

/**
 * Warm every media asset in `rounds`, cheap ones first. Returns a cancel function; call it when the
 * run ends so a warm cannot outlive the screen that wanted it.
 */
export function warmRoundMedia(rounds: WarmableRound[]): () => void {
  const controller = new AbortController();
  if (saveDataOn()) return () => controller.abort();

  const run = async () => {
    // Sequential, not Promise.all. These compete with the round the player is ACTUALLY on — for
    // its own assets and for its answer POST — and six parallel fetches on a phone is how a
    // prefetch turns into the stall it was meant to prevent.
    for (const heavy of [false, true]) {
      for (const url of urlsFor(rounds, heavy)) {
        if (controller.signal.aborted) return;
        await warmOne(url, controller.signal);
      }
    }
  };

  // On idle: round 1 is painting, and nothing here is more urgent than that.
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (idle) idle(() => void run());
  else window.setTimeout(() => void run(), 400);

  return () => controller.abort();
}
