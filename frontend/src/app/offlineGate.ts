// Which App surfaces REQUIRE a live network. Ranked/social play is server-authoritative and
// real-time — it cannot run offline — so we render an "online required" panel instead of the screen
// when the device is offline. Everything else (campaign, practice, category picker, growth, vault,
// home) is offline-OK: those play from the cached content bundle and queue results into the outbox.
export type Surface =
  | "home"
  | "contest"
  | "practice"
  | "category"
  | "campaign"
  | "leaderboard"
  | "duel"
  | "friends"
  | "vault"
  | "growth"
  | "playtest";

// contest    = the ranked Daily Royale (server-seeded/settled) — must be online.
// leaderboard = live standings from the server — must be online.
// duel        = bot/Gem duels via DuelFlow (server-authoritative per-round) — must be online.
// friends     = the Friends hub is primarily the LIVE friend-duel entry point (add-by-username +
//               polled request lists + a WebSocket head-to-head). None of it works offline, so the
//               whole surface is gated online-only rather than showing an inert, un-actionable list.
// playtest = the cognition harness; every round is server-judged, so it needs the network.
const ONLINE_ONLY: Surface[] = ["contest", "leaderboard", "duel", "friends", "playtest"];

export function requiresOnline(surface: Surface): boolean {
  return ONLINE_ONLY.includes(surface);
}
