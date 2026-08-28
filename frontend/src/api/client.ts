// Typed API client (docs/architecture.md). Base URL is env-driven (VITE_API_BASE).
// Access token comes from the in-memory session store; the refresh token is read from secure
// storage only inside the single-flight refresh path.

import { useSessionStore } from "@/store/session";
import type { Me } from "@/store/session";
import { tokenStorage } from "@/api/tokenStorage";
import { useI18n } from "@/store/i18n";
import type { CampaignBundleLevel, OfflineRound, OfflineItem } from "@/offline/types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

/** The player's in-app language, read at call time so a mid-session switch takes effect at once. */
function activeLocale(): string {
  return useI18n.getState().locale;
}

export interface HealthResponse {
  status: string;
  db: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

/** TokenResponse plus what only the server knows about this particular sign-in. */
export interface SocialTokenResponse extends TokenResponse {
  /** First sign-in for this identity — route into onboarding rather than the daily. */
  created?: boolean;
  /** The account had a password and linking a verified identity retired it. Told to the player so
   * they are not left to discover it at a later login. */
  password_retired?: boolean;
}


export interface RoundSpec {
  idx: number;
  type: string;
  client_spec: Record<string, unknown>;
}

export interface EnterResponse {
  entry_id: string;
  window_id: string;
  rounds: RoundSpec[];
}

export interface RoundSubmission {
  idx: number;
  result: Record<string, unknown>; // opaque, module-specific (server hands it to the module)
}

export interface RoundResult {
  idx: number;
  module_type: string;
  points: number;
  correct: boolean;
  answer: Record<string, unknown>; // server answer, for the post-submit reveal
}

export interface SubmitResponse {
  entry_id: string;
  total_score: number;
  provisional: boolean;
  rounds: RoundResult[];
}

export interface PracticeStartResponse {
  entry_id: string;
  rounds: RoundSpec[]; // answer-free client specs
}

export interface PracticeResultResponse {
  entry_id: string;
  accuracy: number; // 0..1
  correct: number;
  total: number;
  sharpness: number; // new sharpness (capped at 100)
  sharpness_gained: number;
  rounds: RoundResult[];
}

export interface PracticeAnswerResponse {
  idx: number;
  module_type: string;
  correct: boolean;
  valid: boolean;
  answer: Record<string, unknown>; // server answer (e.g. {correctIndex}), revealed post-lock
  explanation: string | null; // the "here's why" payload — only in practice, never in the contest
  finished: boolean;
  // populated only on the final round:
  correct_count: number | null;
  total: number | null;
  accuracy: number | null;
  sharpness: number | null;
  sharpness_gained: number | null;
}

/** Per-category read inside a Brain Boost summary (Brain Profile bars). */
export interface BrainBoostCategoryPerf {
  category: string;
  correct: number;
  total: number;
  accuracy: number; // 0..1
  score: number; // 0..100 display score
}

/** The Brain Profile read after a check — powers the reveal + the home dashboard. */
export interface BrainBoostSummary {
  entry_id: string;
  mode: "starter" | "quick";
  submitted_at: string;
  total: number;
  correct: number;
  accuracy: number;
  brain_score: number; // 300..900
  rot_type: string;
  strengths: BrainBoostCategoryPerf[]; // top ≤3, best first
  weaknesses: BrainBoostCategoryPerf[]; // bottom ≤2, weakest first
  categories: BrainBoostCategoryPerf[]; // all answered, best first
  weak_spot_topic: string | null;
  movements: Record<string, number>; // category → ± delta vs previous check
  first_check: boolean; // "early read" language when true
}

export interface BrainBoostToday {
  completed_today: boolean;
  has_any_check: boolean;
  latest: BrainBoostSummary | null;
}

/** One gameplay interaction signal, sent fire-and-forget after a round (personalization only —
 * never affects scores/coins/rating). question_id is resolved SERVER-side from (entry_id, idx). */
export interface QuestionInteractionPayload {
  mode: "practice" | "quick" | "category" | "campaign" | "ranked";
  entry_id?: string;
  idx?: number;
  question_id?: string;
  session_id?: string;
  selected_answer?: number | null;
  is_correct?: boolean | null;
  response_ms?: number | null;
  timed_out?: boolean;
  quit_after?: boolean;
  explanation_opened?: boolean;
  explanation_read_ms?: number | null;
  shared_after?: boolean;
  replayed_after?: boolean;
  streak_before?: number | null;
  streak_after?: number | null;
}

/** AI-personalization coverage readiness (GET /personalization/status — public, no auth). */
export interface AIStatus {
  coverage: number; // 0..1 — fraction of trivia questions with AI metadata
  ready: boolean; // true when coverage >= AI_READY_THRESHOLD (0.8)
}

/** Debug/dev view of the silently learned taste profile (GET /personalization/me/profile). */
export interface TasteProfile {
  user_id: string;
  category_affinity: Record<string, number>;
  subcategory_affinity: Record<string, number>;
  topic_affinity: Record<string, number>;
  difficulty_preference: number;
  humor_preference: number;
  brainrot_tolerance: number;
  novelty_preference: number;
  educational_preference: number;
  disliked_topics: string[];
  weak_but_interesting_topics: string[];
  last_seen_topic_tags: string[];
  last_seen_categories: string[];
  interaction_count: number;
  confidence_score: number;
}

export interface AnswerRoundResponse {
  idx: number;
  module_type: string;
  points: number;
  correct: boolean;
  valid: boolean;
  answer: Record<string, unknown>; // server answer, revealed post-lock
  total_score: number; // running total through this round
  finished: boolean; // entry now SUBMITTED
  // §5f Daily Royale trivia second-chance: set when a WRONG first pick opens a retry. The round is
  // NOT finalized — `eliminated` (the greyed option) and `retry_ms` drive one more pick for half
  // points. The answer stays hidden until the round actually resolves.
  retry_available?: boolean;
  eliminated?: number | null;
  retry_ms?: number;
}

export interface FieldEntry {
  username: string;
  points: number[]; // per-round points; cumulative-through-N = sum(points.slice(0, N+1))
  avatar_preset: string; // the entrant's chosen preset
  equipped_frame: string | null; // null unless they have a frame equipped
  equipped_badges: string[]; // pinned honors, ordered, ≤3
  equipped_title: string | null; // null unless they have a title equipped
}

export interface FieldResponse {
  // `entries` is the TOP SLICE by score (server-bounded for scale), not the whole field. Use
  // `field_size` for the true count and `my_rank`/`my_score` for the caller's standing — a player
  // below the slice won't appear in `entries` but still has a correct rank here.
  field_size: number;
  my_rank: number | null;
  my_score: number;
  window_id: string;
  entries: FieldEntry[];
}

export interface MyEntryResponse {
  entry_id: string | null;
  status: string | null;
  submitted_at: string | null;
}

/** A finished entry's own-run Rot Report, rebuilt from stored rounds (GET /entries/{id}/rot-report).
 *  Server shape (snake_case); `rotReportFromApi` maps it to the client's `RotReportData`. */
export interface RotReportResponse {
  score: number;
  total: number;
  incorrect: number;
  avg_ms: number | null;
  fastest_ms: number | null;
  /** Per-round outcome in play order, always `total` long — the tick/cross grid. */
  rounds: boolean[];
}

export interface CategoryItem {
  name: string;
  count: number; // servable questions in this category
}

export interface CategoriesResponse {
  categories: CategoryItem[];
}

export interface UsernameQuote {
  cost: number;                    // coins the NEXT change costs (0 while the free one is unused)
  free_changes_remaining: number;
  changes_made: number;
  balance: number;
  affordable: boolean;
}

export interface UsernameChangeResult {
  username: string;
  cost: number;                    // coins actually charged
  balance: number;                 // balance AFTER the change
  changes_made: number;
}

export interface VapidPublicKeyResponse {
  public_key: string; // empty when push is disabled server-side
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface NativePushPayload {
  device_token: string;
  platform: "ios" | "android";
  // True for a token obtained under iOS PROVISIONAL authorization: no prompt was shown and
  // delivery is quiet. Reach, not consent — the server keeps asking these players to upgrade.
  provisional?: boolean;
}

export interface SeasonStatus {
  season: string; // "YYYY-MM"
  label: string; // "July 2026"
  ends_at: string; // ISO UTC — when the season closes and the ladders soft-reset
  rating: number;
  division: string;
  duel_tier: string;
}

export interface WindowOut {
  id: string;
  slot: string;
  state: string;
  open_at: string;
  close_at: string;
  settle_at: string; // ISO — close_at + 15min; results settle at/after this instant
  entry_count: number; // real field size from entries
}

export interface CurrentContest {
  open_window: WindowOut | null;
  schedule: WindowOut[];
}

export interface HistoryItem {
  window_id: string;
  contest_date: string;
  slot: string;
  state: string;
  total_score: number | null;
  place: number | null;
  field_size: number | null;
  coins_awarded: number | null;
  rating_before: number | null;
  rating_after: number | null;
}

export type ClearStatus = "clear" | "strong" | "perfect" | null;

export interface CampaignLevel {
  level_number: number;
  title: string;
  arc_name: string;
  is_boss: boolean;
  difficulty_mix: { easy: number; medium: number; hard: number };
  unlocked: boolean;
  cleared: boolean;
  clear_status: ClearStatus;
  best_correct: number;
  /** Client-only: cleared offline, not yet server-confirmed (set by overlayLadder). */
  pending?: boolean;
}

export interface CampaignArc {
  name: string;
  levels: CampaignLevel[];
}

export interface CampaignWorld {
  world: string; // short display name
  category: string; // canonical bank category
  arcs: CampaignArc[];
  cleared_count: number;
  total_levels: number;
}

export interface CampaignLadderResponse {
  worlds: CampaignWorld[];
  daily_coins_earned: number;
  daily_coins_cap: number;
}

export interface CampaignStartResponse {
  entry_id: string;
  world: string;
  level: number;
  title: string;
  is_boss: boolean;
  rounds: RoundSpec[]; // answer-free client specs
}

export interface CampaignCompleteResponse {
  world: string;
  level: number;
  title: string;
  is_boss: boolean;
  correct: number;
  total: number;
  passed: boolean;
  clear_status: ClearStatus;
  coins_awarded: number;
  daily_cap_reached: boolean;
  first_clear: boolean;
  next_level_unlocked: boolean;
  best_correct: number;
}

// --- Offline play: prefetched bundles (campaign levels / practice pool) + offline sync payloads.
export interface CampaignBundleResp {
  bank_version: string;
  levels: CampaignBundleLevel[];
}

export interface PracticePoolResp {
  category: string | null;
  bank_version: string;
  questions: OfflineRound[];
}

export interface VaultItem {
  id: string;
  kind: string; // "theme" | "frame"
  cost: number;
  currency: string; // "coins" | "gems" — which wallet a purchase debits (drives the price icon)
  owned: boolean;
  equipped: boolean;
  locked: boolean;
  coming_soon: boolean; // unreleased — grouped under the Vault's "Coming soon" divider
  requirement: string | null;
}

export interface VaultResponse {
  items: VaultItem[];
  coins_balance: number;
  gems_balance: number;
}

/** A newly-earned, not-yet-revealed unlock (vault unlock foundation). The frontend resolves
 * `id` → display name/visual from tokens.ts / identity.ts; `acquisition` is "earned" (granted) or
 * "buy" (now purchasable). */
export interface PendingUnlock {
  id: string;
  kind: string; // "theme" | "frame"
  cost: number;
  currency: string;
  requirement: string | null;
  acquisition: string; // "earned" | "buy"
}

export interface PendingUnlocksResponse {
  items: PendingUnlock[];
}

export interface AckUnlocksResponse {
  acknowledged: string[];
}

export interface BuyVaultResponse {
  item_id: string;
  currency: string; // wallet debited for this purchase ("coins" | "gems")
  coins_balance: number;
  gems_balance: number;
}

export interface EquipVaultResponse {
  equipped_theme: string;
  equipped_frame: string | null;
}

export interface AvatarResponse {
  avatar_preset: string;
}

/** One badge/title in the identity catalog — earned is server-computed, never client-derived. */
export interface IdentityItem {
  id: string;
  earned: boolean;
  equipped: boolean;
}

export interface IdentityResponse {
  badges: IdentityItem[];
  titles: IdentityItem[];
}

export interface BadgesResponse {
  equipped_badges: string[]; // ordered, ≤3 — the server echo is the only truth for the store
}

export interface TitleResponse {
  equipped_title: string | null;
}

// --- Duel (Gems economy) — best-of-7 1v1 vs a rival bot, Gem pool to the winner. -----------------
// Gems are an in-game cosmetic-economy currency: earned in-game, no cash value, never purchasable.

export interface WalletDuel {
  bot_gem_duels_used: number; // Gem-staked duels vs bots used today
  bot_gem_duels_cap: number; // daily cap on Gem-staked bot duels
}

export interface WalletResponse {
  coins_balance: number;
  gems_balance: number;
  duel: WalletDuel;
}

export interface DuelTier {
  type: string; // duel_type: training | spark | crown | royal
  entry_gems: number; // Gems staked to enter (0 for training)
  pool_gems: number; // match pool the winner earns
  unlocked: boolean;
  unlock_wins: number; // Duel wins required to unlock (0 once unlocked)
}

export interface DuelConfigResponse {
  tiers: DuelTier[]; // ordered: training, spark, crown, royal
  bot_gem_cap: number;
  bot_gem_used: number;
  gems_balance: number;
}

export interface DuelCreateResponse {
  match_id: string;
  duel_type: string;
  entry_gems: number;
  pool_gems: number;
  rival_tier: string; // rookie | solid | sharp | elite
  rounds: RoundSpec[]; // answer-free client specs
}

export interface DuelResult {
  winner: string; // "user" | "rival"
  result_reason: string;
  user_round_wins: number;
  rival_round_wins: number;
  gem_delta: number; // signed Gems change for the user (0 for training)
  xp_awarded: number;
  perfect: boolean;
  comeback: boolean;
  duel_tier: string; // bronze | silver | gold | crown
}

export interface DuelRoundResponse {
  idx: number;
  outcome: string; // user_win | rival_win | no_point
  outcome_reason: string; // correct_vs_wrong | speed_gap | both_wrong | near_tie_correct | tiebreak_*
  your_correct: boolean;
  your_time_ms: number;
  answer: Record<string, unknown>; // server answer, revealed post-lock
  rival_correct: boolean;
  rival_time_ms: number;
  user_round_wins: number;
  rival_round_wins: number;
  phase: string; // normal | sudden_death
  next: string; // normal | sudden_death | done
  finished: boolean;
  result: DuelResult | null; // populated only on the final round
}

export interface DuelMatchStateResponse {
  match_id: string;
  duel_type: string;
  status: string;
  entry_gems: number;
  pool_gems: number;
  rival_tier: string;
  user_round_wins: number;
  rival_round_wins: number;
  rounds_played: number;
  winner: string | null;
  result_reason: string | null;
  gem_delta: number | null;
  xp_awarded: number | null;
}

export interface DuelStatsResponse {
  wins: number;
  losses: number;
  training_wins: number;
  training_losses: number;
  current_streak: number;
  best_streak: number;
  perfect_wins: number;
  comeback_wins: number;
  total_gems_won: number;
  total_gems_lost: number;
  duel_xp: number;
  duel_tier: string; // bronze | silver | gold | crown
}

// --- Friends + live friend duels (the social layer). Friend by username, then challenge a friend
// to a LIVE best-of-7 duel played in real time over a WebSocket. Free — no Gems/stakes. ------------

export interface Friend {
  user_id: string;
  username: string;
  avatar_preset: string;
  wins: number; // your head-to-head duel wins vs this friend
  losses: number; // your head-to-head duel losses vs this friend
  streak: number; // +N won last N straight / -N lost N / 0
  last_result: "won" | "lost" | null;
  last_played: string | null; // ISO timestamp
  duels_14d: number;
  equipped_frame: string | null; // worn in your friends list exactly as on the leaderboard
  equipped_title: string | null;
}

export interface FriendRequest {
  request_id: string;
  user_id: string;
  username: string;
  avatar_preset: string;
  created_at: string;
}

export interface FriendsResponse {
  friends: Friend[];
  incoming: FriendRequest[]; // requests others sent ME
  outgoing: FriendRequest[]; // requests I sent
  rival_user_id: string | null;
}

export interface FriendRequestResult {
  request_id: string;
  status: string; // pending | accepted
}

export interface FriendDuelSummary {
  duel_id: string;
  status: string; // pending | active | completed | declined | cancelled | expired
  your_side: string; // challenger | opponent
  opponent_id: string;
  opponent_username: string;
  opponent_avatar: string;
  challenger_round_wins: number;
  opponent_round_wins: number;
  created_at: string;
}

export interface FriendDuelListResponse {
  incoming: FriendDuelSummary[]; // challenges others sent ME
  outgoing: FriendDuelSummary[]; // challenges I sent
  active: FriendDuelSummary[]; // accepted, live
}

export interface FriendDuelStateResponse {
  duel_id: string;
  status: string;
  your_side: string;
  opponent_username: string;
  opponent_avatar: string;
  current_round: number;
  challenger_round_wins: number;
  opponent_round_wins: number;
  winner_side: string | null;
  result_reason: string | null;
  rounds: RoundSpec[];
}

export interface FriendsBoardRow {
  user_id: string;
  username: string;
  avatar_preset: string;
  equipped_frame: string | null;
  equipped_title: string | null;
  score: number;
  rank: number;
  is_me: boolean;
}

export interface FriendsBoardPending {
  user_id: string;
  username: string;
  avatar_preset: string;
  equipped_frame: string | null;
}

export interface FriendsBoardResponse {
  my_rank: number | null;
  friend_field_size: number;
  played: FriendsBoardRow[];
  yet_to_play: FriendsBoardPending[];
}

/** Build the live-duel WebSocket URL from the API base (http→ws, https→wss) + the access token. */
export function friendDuelSocketUrl(duelId: string, token: string): string {
  const wsBase = API_BASE.replace(/^http/, "ws");
  return `${wsBase}/friend-duels/ws/${duelId}?token=${encodeURIComponent(token)}`;
}

// --- Today Command Center (engagement layer): one aggregate read powers the home screen. -----------
export interface ChestReward {
  coins: number;
  gems: number;
  code: string; // weekday code ("mon".."sun") for chest rewards, or "streak_<n>" for streak rungs
}

export interface Mission {
  id: string; // play_royale | complete_duel | clear_campaign
  done: boolean;
}

export interface MissionsBlock {
  missions: Mission[];
  completed_count: number;
  required: number;
  chest_state: string; // in_progress | ready | claimed
  reward: ChestReward;
}

export interface StreakBlock {
  current: number;
  milestones: number[]; // the rung days (e.g. [3, 5, 7])
  next_milestone: number | null; // the next rung above `current`, or null past the last
  next_reward: ChestReward | null; // the reward for that next rung
  grace_available: boolean; // the free weekly streak-freeze is ready (a slip is forgiven this week)
}

export interface TodayStatus {
  coins_balance: number;
  gems_balance: number;
  streak_count: number;
  duel_tier: string; // bronze | silver | gold | crown
}

export interface CampaignNext {
  world: string;
  category: string;
  level_number: number;
  title: string;
  arc_name: string;
}

export interface NextUnlock {
  id: string;
  kind: string; // theme | frame
  cost: number;
  currency: string; // coins | gems
  balance: number; // the player's balance in `currency`
  remaining: number; // cost - balance, clamped at 0
  progress: number; // balance / cost, 0..1
}

export interface TodayResponse {
  status: TodayStatus;
  missions: MissionsBlock;
  streak: StreakBlock;
  campaign_next: CampaignNext | null;
  next_unlock: NextUnlock | null;
}

export interface GrowthCategory {
  category: string;
  accuracy: number;
  spark: number[];
  direction: "up" | "down" | "flat";
}
export interface GrowthResponse {
  brain_score: { current: number; delta: number };
  trend: { date: string; score: number }[];
  categories: GrowthCategory[];
  consistency: { days_played: number; streak: number };
}

export interface MasteryItem {
  category: string;
  level: number; // 0 = warming up, 1..5 (5 = Mastered)
  attempts: number;
  mastered: boolean;
}
export interface MasteryResponse {
  categories: MasteryItem[];
}

export interface ClaimChestResponse {
  reward: ChestReward;
  coins_awarded: number;
  gems_awarded: number;
  already_claimed: boolean;
  coins_balance: number;
  gems_balance: number;
  missions: MissionsBlock;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Hard deadline per request. Without one, a stalled connection (cellular handoff, WKWebView
// suspended mid-flight, cold backend) leaves the fetch promise pending for WKWebView's own 60s
// resource timeout — every screen gated on that promise shows a spinner with no way out. 15s is
// generous for a slow link but short enough that the error/retry UI appears within one sitting.
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      // X-Locale carries the language the player picked IN THE APP. Deliberately not
      // Accept-Language: that reflects the browser/OS, which routinely disagrees with the in-app
      // choice. The server serves question text in this language, falling back to English per
      // question when no approved translation exists.
      headers: {
        Accept: "application/json",
        "X-Locale": activeLocale(),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // fetch only rejects on a network-level failure (server unreachable, DNS, CORS block, mixed
    // content) or on the deadline above. Surface that distinctly from an HTTP error so it's
    // diagnosable in deploys — and name the base URL it tried so a misconfigured VITE_API_BASE
    // is obvious.
    throw new ApiError(0, `Couldn't reach the server (${API_BASE}). Check your connection.`);
  } finally {
    // Disarm once headers arrive: the deadline covers connection + response start, not body
    // download (res.json() below), so a slow-but-flowing large payload isn't cut off.
    clearTimeout(deadline);
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      detail?.detail ?? `Server error ${res.status} on ${init?.method ?? "GET"} ${path}`,
    );
  }
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// --- Single-flight refresh: concurrent 401s share one refresh round-trip. ---
let refreshInFlight: Promise<string> | null = null;

// Single-flight /contests/current (see api.currentContest below).
let currentContestInFlight: Promise<CurrentContest> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await tokenStorage.getRefreshToken();
    if (!refreshToken) throw new ApiError(401, "No refresh token");
    const data = await request<TokenResponse>(
      "/auth/refresh",
      jsonInit("POST", { refresh_token: refreshToken }),
    );
    useSessionStore.getState().setAccessToken(data.access_token);
    if (data.refresh_token) await tokenStorage.setRefreshToken(data.refresh_token);
    return data.access_token;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/** Authenticated request: attaches the access token, refreshes once on 401, retries. */
async function authedRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useSessionStore.getState().accessToken;
  const withAuth = (t: string | null): RequestInit => ({
    ...init,
    headers: { ...(init?.headers ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  });

  try {
    return await request<T>(path, withAuth(token));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      try {
        const fresh = await refreshAccessToken();
        return await request<T>(path, withAuth(fresh));
      } catch (retryErr) {
        // Only a definitive auth rejection ends the session. A network-level failure (status 0)
        // or a 5xx here means the server was unreachable mid-refresh — deleting the refresh
        // token on that turns one cold start or dead spot into a silent sign-out.
        const status = retryErr instanceof ApiError ? retryErr.status : null;
        if (status === 401 || status === 403) {
          useSessionStore.getState().setAnonymous();
          await tokenStorage.clearRefreshToken();
          throw new ApiError(401, "Session expired");
        }
        throw retryErr;
      }
    }
    throw err;
  }
}

/** Created when a player shares a finished Daily-Royale result — carries the real `…/c/<id>` link. */
export interface ChallengeCreateResponse {
  id: string;
  url: string;
  contest_no: number;
  score: number;
  place: number | null;
  field_size: number | null;
  percentile: number | null;
}

/** Public, spoiler-free challenge snapshot for the share landing (no auth required). */
export interface ChallengePublic {
  id: string;
  username: string;
  contest_no: number;
  contest_date: string;
  score: number;
  place: number | null;
  field_size: number | null;
  percentile: number | null;
  /**
   * The sharer's CURRENTLY equipped theme id — the landing paints itself in the sender's skin so
   * the link looks like the app they're playing. Read live server-side, so re-equipping restyles
   * links already sent. Cosmetic only; an unknown id falls back to the default theme.
   */
  theme: string;
  /** The window id of today's OPEN Daily Royale a visitor can play right now, or null. */
  playable_window_id: string | null;
}

export const api = {
  health: () => request<HealthResponse>("/health"),

  register: (body: { email: string; username: string; password: string }) =>
    request<TokenResponse>("/auth/register", jsonInit("POST", body)),

  login: (body: { email: string; password: string }) =>
    request<TokenResponse>("/auth/login", jsonInit("POST", body)),

  // Anonymous-first entry: a fully-seeded guest account in one tap (no form). The guest later
  /** What changing the handle costs right now (free first time, then coins). */
  usernameQuote: () => authedRequest<UsernameQuote>("/me/username/quote"),

  /** Change the public handle. Charges coins once the free change is spent. */
  setUsername: (username: string) =>
    authedRequest<UsernameChangeResult>("/me/username", jsonInit("POST", { username })),

  // SAVES the profile via upgrade — same account, all progress kept (nothing to merge).
  guest: () => request<TokenResponse>("/auth/guest", { method: "POST" }),

  upgrade: (body: { email: string; username?: string; password: string }) =>
    authedRequest<TokenResponse>("/auth/upgrade", jsonInit("POST", body)),

  /** Which provider buttons the server can actually verify. Unauthenticated — the sign-in screen
   * asks before anyone is signed in, and a button for an unconfigured provider is a dead end. */
  socialProviders: () =>
    request<{
      providers: string[];
      google_client_id?: string | null;
      apple_client_id?: string | null;
      apple_redirect_uri?: string | null;
    }>("/auth/providers"),

  /** Sign in (or up) with a verified Apple/Google identity.
   *
   * Sent through the AUTHED request path on purpose: when the caller is already a guest, their
   * token rides along and the identity attaches to the row they have been playing on, so their
   * streak, coins and rating carry over. With no session it is an ordinary anonymous sign-in —
   * the endpoint's auth is optional. */
  socialSignIn: (body: { provider: string; id_token: string; nonce?: string }) =>
    authedRequest<SocialTokenResponse>("/auth/social", jsonInit("POST", body)),

  /** Begin Sign in with Google, and get back the URL to navigate to.
   *
   * AUTHED on purpose, and this is the whole reason a guest keeps their progress. Google's callback
   * arrives at the server with no Authorization header, so the guest identity has to be captured
   * HERE — the server reads it from this request's token and binds it to the transaction. Without
   * it a guest who signs in would land on a brand-new account and lose their streak, coins and
   * rating. The user id is never sent in the body; the server resolves it from the token itself. */
  googleStart: () =>
    authedRequest<{ authorize_url: string }>("/auth/google/start", { method: "POST" }),

  /** Trade the one-time code from the URL fragment for a real session. Single-use, ~60s life. */
  googleHandoff: (handoffCode: string) =>
    request<SocialTokenResponse>(
      "/auth/google/handoff",
      jsonInit("POST", { handoff_code: handoffCode })
    ),

  refresh: refreshAccessToken,

  me: () => authedRequest<Me>("/me"),

  // Avatar preset is server-validated; the response value is the source of truth for the store.
  setAvatar: (presetId: string) =>
    authedRequest<AvatarResponse>("/me/avatar", jsonInit("PATCH", { preset_id: presetId })),

  // Badge/title catalogs with server-computed earned/equipped state.
  getIdentity: () => authedRequest<IdentityResponse>("/identity"),

  // Full ordered pick (≤3, no dups) — server validates earned/limits; response patches the store.
  setBadges: (badgeIds: string[]) =>
    authedRequest<BadgesResponse>("/me/badges", jsonInit("PATCH", { badge_ids: badgeIds })),

  // null clears the title; the response value is the source of truth for the store.
  setTitle: (titleId: string | null) =>
    authedRequest<TitleResponse>("/me/title", jsonInit("PATCH", { title_id: titleId })),

  // Single-flight: several components (a screen + the shared nav) ask for the current contest on
  // the same mount, and the endpoint does lazy provision/transition WRITE work server-side — so
  // concurrent callers share one round trip instead of doubling it. Resolved responses are not
  // cached; only overlapping in-flight calls coalesce.
  currentContest: () => {
    if (!currentContestInFlight) {
      currentContestInFlight = authedRequest<CurrentContest>("/contests/current").finally(() => {
        currentContestInFlight = null;
      });
    }
    return currentContestInFlight;
  },

  // One-time prompts. The SERVER decides which (if any) to show — see services/prompts.py — so the
  // timing can be retuned on a deploy rather than an App Store release.
  // The device's IANA zone, so evening pushes land in the player's own evening rather than the
  // contest's (ET). Fire-and-forget on app open; the server validates and ignores a repeat.
  setTimezone: (timezone: string) =>
    authedRequest<void>("/me/timezone", jsonInit("POST", { timezone })),

  nextPrompt: () => authedRequest<{ prompt: string | null; runs: number }>("/me/prompt"),

  ackPrompt: (prompt: string, accepted: boolean) =>
    authedRequest<void>("/me/prompt/ack", jsonInit("POST", { prompt, accepted })),

  history: () => authedRequest<{ items: HistoryItem[] }>("/me/history"),

  enter: (windowId: string) =>
    authedRequest<EnterResponse>(`/contests/${windowId}/enter`, { method: "POST" }),

  submit: (entryId: string, rounds: RoundSubmission[]) =>
    authedRequest<SubmitResponse>(
      `/entries/${entryId}/submit`,
      jsonInit("POST", { rounds }),
    ),

  // `supports_retry` declares that THIS build understands the §5f second chance — an offer does not
  // finalize the round, so only a client that knows to re-answer the same idx may receive one. The
  // server defaults it off for the shipped binary, which predates §5f and cannot be updated.
  answerRound: (entryId: string, idx: number, result: Record<string, unknown>) =>
    authedRequest<AnswerRoundResponse>(
      `/entries/${entryId}/answer`,
      jsonInit("POST", { idx, result, supports_retry: true }),
    ),

  // Viral share loop: turn a finished Daily-Royale entry into a shareable `…/c/<id>` challenge link.
  createChallenge: (entryId: string) =>
    authedRequest<ChallengeCreateResponse>("/challenges", jsonInit("POST", { entry_id: entryId })),

  // Public (no auth) — the anonymous landing fetches the sharer's spoiler-free snapshot by id.
  getChallenge: (id: string) => request<ChallengePublic>(`/api/challenges/${id}`),

  windowField: (windowId: string) =>
    authedRequest<FieldResponse>(`/contests/${windowId}/field`),

  myEntry: (windowId: string) => authedRequest<MyEntryResponse>(`/contests/${windowId}/entry`),

  // The caller's own finish report, REBUILT server-side from the stored rounds. The client stash in
  // localStorage is per-device, so this is what lets Home re-open a report on a device that didn't
  // play the run (or after storage was cleared). 404s for an entry you don't own.
  rotReport: (entryId: string) =>
    authedRequest<RotReportResponse>(`/entries/${entryId}/rot-report`),

  categories: () => authedRequest<CategoriesResponse>("/categories"),

  // The Brain Boost surface: today's check state + the latest Brain Profile read, and the full
  // reveal for one submitted check entry. Pure reads — no LLM, no gameplay writes.
  brainBoostToday: () => authedRequest<BrainBoostToday>("/brain-boost/today"),

  brainBoostSummary: (entryId: string) =>
    authedRequest<BrainBoostSummary>(`/brain-boost/${entryId}/summary`),

  // No category → the mixed 5-round practice. A category → a scoped 10-question trivia session.
  // mode "quick" → Quick Play: 8 mixed-category trivia questions (category is ignored server-side).
  // mode "starter" → the first-run Starter Check (calibration ramp, category-balanced bank).
  startPractice: (category?: string | null, mode?: "quick" | "starter" | null) =>
    authedRequest<PracticeStartResponse>(
      "/practice/start",
      jsonInit("POST", {
        ...(category ? { category } : {}),
        ...(mode ? { mode } : {}),
      }),
    ),

  submitPractice: (entryId: string, rounds: RoundSubmission[]) =>
    authedRequest<PracticeResultResponse>(
      `/practice/${entryId}/submit`,
      jsonInit("POST", { rounds }),
    ),

  // Lesson-mode per-round answer: returns the correct answer + explanation for the reveal.
  // Campaign play reuses this same endpoint (a campaign entry IS a window-less practice entry).
  answerPracticeRound: (entryId: string, idx: number, result: Record<string, unknown>) =>
    authedRequest<PracticeAnswerResponse>(
      `/practice/${entryId}/answer`,
      jsonInit("POST", { idx, result }),
    ),

  // --- Funnel analytics beacon: OPTIONAL auth (pre-signup events exist), a single raw fetch —
  // no 401-refresh dance, no retries, keepalive so it survives navigation. Gameplay code calls
  // the never-throws wrapper in src/lib/analytics.ts, not this. ---
  sendFunnelBeacon: (body: { event: string; source?: string | null }) => {
    const token = useSessionStore.getState().accessToken;
    return fetch(`${API_BASE}/analytics/funnel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      keepalive: true,
    });
  },

  // --- Personalization: interaction signals in (fire-and-forget via lib/interactionTracker),
  // learned profile out (debug/dev only; 404s in production unless PERSONALIZATION_DEBUG). ---
  // Public: no auth needed — fires before account creation (Brain Boost intro onboarding).
  // ready=true means coverage >= 0.8 → "AI-personalized" copy is truthful.
  aiStatus: () => request<AIStatus>("/personalization/status"),

  recordQuestionInteraction: (payload: QuestionInteractionPayload) =>
    authedRequest<{ recorded: boolean }>(
      "/personalization/events",
      jsonInit("POST", payload),
    ),

  getTasteProfile: () => authedRequest<TasteProfile>("/personalization/me/profile"),

  // --- Campaign Mode: the level ladder, starting a level (exact authored questions), and settling
  // a finished level (rewards + progress). Play itself goes through answerPracticeRound above. ---
  campaign: () => authedRequest<CampaignLadderResponse>("/campaign"),

  campaignStart: (world: string, level: number) =>
    authedRequest<CampaignStartResponse>("/campaign/start", jsonInit("POST", { world, level })),

  campaignComplete: (entryId: string) =>
    authedRequest<CampaignCompleteResponse>(`/campaign/${entryId}/complete`, { method: "POST" }),

  // --- Offline play: prefetch bundles, then sync finished runs when back online. Sync is settled
  // server-side by client_id (idempotent replay) — the offline items carry the raw picks + timing. ---
  campaignOfflineBundle: () => authedRequest<CampaignBundleResp>("/campaign/offline-bundle"),

  campaignOfflineComplete: (body: {
    world: string;
    level: number;
    client_id: string;
    items: OfflineItem[];
  }) => authedRequest<CampaignCompleteResponse>("/campaign/offline-complete", jsonInit("POST", body)),

  practiceOfflinePool: (category?: string | null) =>
    authedRequest<PracticePoolResp>(
      `/practice/offline-pool${category ? `?category=${encodeURIComponent(category)}` : ""}`,
    ),

  practiceOfflineSubmit: (body: {
    mode: string | null;
    category: string | null;
    client_id: string;
    items: OfflineItem[];
  }) => authedRequest<PracticeResultResponse>("/practice/offline-submit", jsonInit("POST", body)),

  // --- Duel: wallet (coins + gems), tier config, create a match, per-round submit, match state,
  // and lifetime duel stats. Per-round play submits an opaque module result like the contest. ---
  wallet: () => authedRequest<WalletResponse>("/me/wallet"),

  duelConfig: () => authedRequest<DuelConfigResponse>("/duel/config"),

  createDuel: (duelType: string) =>
    authedRequest<DuelCreateResponse>("/duel/create", jsonInit("POST", { duel_type: duelType })),

  submitDuelRound: (matchId: string, idx: number, result: Record<string, unknown>) =>
    authedRequest<DuelRoundResponse>(`/duel/${matchId}/round`, jsonInit("POST", { idx, result })),

  getDuel: (matchId: string) => authedRequest<DuelMatchStateResponse>(`/duel/${matchId}`),

  duelStats: () => authedRequest<DuelStatsResponse>("/me/duel-stats"),

  // --- Today Command Center: the home aggregate + the daily-mission chest claim. ---
  today: () => authedRequest<TodayResponse>("/me/today"),

  getGrowth: (days = 30) => authedRequest<GrowthResponse>(`/me/growth?days=${days}`),

  getMastery: () => authedRequest<MasteryResponse>("/me/mastery"),

  claimChest: () => authedRequest<ClaimChestResponse>("/missions/claim", { method: "POST" }),

  vault: () => authedRequest<VaultResponse>("/vault"),

  buyVaultItem: (itemId: string) =>
    authedRequest<BuyVaultResponse>(`/vault/${itemId}/buy`, { method: "POST" }),

  equipVaultItem: (itemId: string) =>
    authedRequest<EquipVaultResponse>(`/vault/${itemId}/equip`, { method: "POST" }),

  // Unlock foundation: newly-earned cosmetics awaiting their reveal, and the once-only ack that
  // confirms the celebration (empty list = acknowledge all pending).
  pendingUnlocks: () => authedRequest<PendingUnlocksResponse>("/vault/pending-unlocks"),

  ackUnlocks: (itemIds: string[] = []) =>
    authedRequest<AckUnlocksResponse>("/vault/unlocks/ack", jsonInit("POST", { item_ids: itemIds })),

  // --- Friends: the graph + requests. ---
  friends: () => authedRequest<FriendsResponse>("/friends"),

  sendFriendRequest: (username: string) =>
    authedRequest<FriendRequestResult>("/friends/requests", jsonInit("POST", { username })),

  respondFriendRequest: (requestId: string, accept: boolean) =>
    authedRequest<FriendRequestResult>(
      `/friends/requests/${requestId}/respond`,
      jsonInit("POST", { accept }),
    ),

  removeFriend: (otherUserId: string) =>
    authedRequest<{ ok: boolean }>(`/friends/${otherUserId}`, { method: "DELETE" }),

  // --- Live friend duels: challenge lifecycle (play itself runs over the WebSocket). ---
  friendDuels: () => authedRequest<FriendDuelListResponse>("/friend-duels"),

  createFriendDuel: (username: string) =>
    authedRequest<FriendDuelSummary>("/friend-duels", jsonInit("POST", { username })),

  // Async "beat my Daily Royale score" challenge: pushes the friend a nudge into today's game.
  // Distinct from a live friend duel. `sent` is false when they were already challenged today.
  challengeFriendToDaily: (username: string) =>
    authedRequest<{ ok: boolean; sent: boolean }>(
      "/friend-challenges",
      jsonInit("POST", { username }),
    ),

  respondFriendDuel: (duelId: string, accept: boolean) =>
    authedRequest<FriendDuelSummary>(
      `/friend-duels/${duelId}/respond`,
      jsonInit("POST", { accept }),
    ),

  cancelFriendDuel: (duelId: string) =>
    authedRequest<FriendDuelSummary>(`/friend-duels/${duelId}/cancel`, { method: "POST" }),

  friendDuelState: (duelId: string) =>
    authedRequest<FriendDuelStateResponse>(`/friend-duels/${duelId}`),

  // Daily friends leaderboard: who among your accepted friends has played today's window.
  friendsBoard: (windowId: string) =>
    authedRequest<FriendsBoardResponse>(`/contests/${windowId}/friends`),

  season: () => authedRequest<SeasonStatus>("/me/season"),

  vapidPublicKey: () => authedRequest<VapidPublicKeyResponse>("/push/public-key"),

  pushSubscribe: (body: PushSubscriptionPayload) =>
    authedRequest<{ ok: boolean }>("/push/subscribe", jsonInit("POST", body)),

  pushSubscribeNative: (body: NativePushPayload) =>
    authedRequest<{ ok: boolean }>("/push/subscribe-native", jsonInit("POST", body)),

  pushUnsubscribe: (body: { endpoint?: string; device_token?: string }) =>
    authedRequest<{ ok: boolean }>("/push/unsubscribe", jsonInit("POST", body)),

  deleteAccount: () => authedRequest<{ ok: boolean }>("/me", { method: "DELETE" }),

  // --- Cognition rounds (estimate, change_detection). The client_spec never carries answer
  // material; all judging is server-side. ---
  cogEstimateStart: () =>
    authedRequest<CogEstimateStart>("/cognition/estimate/start", { method: "POST" }),
  cogEstimateGuess: (id: string, value: number) =>
    authedRequest<CogEstimateGuess>(`/cognition/estimate/${id}/guess`, jsonInit("POST", { value })),
  cogEstimateResolve: (id: string) =>
    authedRequest<CogEstimateResolve>(`/cognition/estimate/${id}/resolve`, { method: "POST" }),
  /** Admin-only in-the-moment rating of the item just played (403 for non-admins). */
  cogEstimateVerdict: (sourceId: string, verdict: string, note: string | null) =>
    authedRequest<CogEstimateVerdict>(
      `/cognition/estimate/items/${encodeURIComponent(sourceId)}/verdict`,
      jsonInit("POST", { verdict, note }),
    ),

  // Change detection: submit the tap (normalized 0-1 image coords) against a bound instance.
  /** Standalone change round (playtest harness). The Royale path never calls this — its instance
   *  is created server-side and bound to (entry_id, round_idx) at entry. */
  cogChangeStart: () =>
    authedRequest<CogChangeStart>("/cognition/change/start", { method: "POST" }),
  /** x/y are NULL when the round timed out with no tap — never (-1,-1), which the API rejects. */
  cogChangeSubmit: (id: string, x: number | null, y: number | null, elapsedMs: number) =>
    authedRequest<CogChangeSubmit>(
      `/cognition/change/${id}/submit`,
      jsonInit("POST", { x, y, elapsed_ms: elapsedMs }),
    ),

  /** One of the video round's three answers.
   *
   * `choice` indexes the SERVED (shuffled) options; the server maps it back through the same
   * seeded order to judge, so the client never holds the answer key. NULL is a timeout — a real
   * outcome that scores as wrong, not an error.
   */
  cogVideoAnswer: (id: string, questionIndex: number, choice: number | null, elapsedMs: number) =>
    authedRequest<CogVideoAnswer>(
      `/cognition/video/${id}/answer`,
      jsonInit("POST", {
        question_index: questionIndex,
        choice,
        elapsed_ms: elapsedMs,
      }),
    ),
};

export interface CogVideoAnswer {
  correct: boolean;
  question_index: number;
  answered: number;
  done: boolean;
}

export interface CogChangeStart {
  instance_id: string;
  spec: {
    key: string;
    base_url: string;
    altered_url: string;
    width: number;
    height: number;
    flicker_base_ms: number;
    flicker_altered_ms: number;
    flicker_blank_ms: number;
    tolerance_frac: number;
    time_limit_ms: number;
  };
}
export interface CogChangeSubmit {
  hit: boolean;
  points: number;
  done: boolean;
  bbox: { x: number; y: number; w: number; h: number };
}

// --- Cognition playtest response types ---
export interface CogEstimateStart {
  instance_id: string;
  spec: {
    prompt: string;
    unit: string | null;
    difficulty: string;
    max_guesses: number;
    time_limit_ms: number;
    slider_min: number; // magnitude-only log-slider bounds (never the answer)
    slider_max: number;
  };
}
export interface CogEstimateGuess {
  correct: boolean;
  direction: "higher" | "lower" | null;
  band: "close" | "far" | null;
  done: boolean;
  guesses_left: number;
  points: number;
  slider_min: number; // server-narrowed surviving range after this guess
  slider_max: number;
}
export interface CogEstimateResolve {
  answer: number;
  unit: string | null;
  acceptable_pct: number;
  close_pct: number;
  points: number;
  reveal_explanation: string;
  intuition_note: string | null;
  components: Array<Record<string, unknown>>;
  guesses: number[];
  id: string | null; // content-file source_id, for in-the-moment admin rating
}
export interface CogEstimateVerdict {
  id: string;
  verdict: string;
  note: string | null;
  rated_at: string;
}

