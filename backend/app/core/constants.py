"""Tunable game/economy constants kept in one place (PLAN.md §6, §7)."""

from __future__ import annotations

from datetime import date

# --- Viral share loop (challenge snapshots) ---
# Launch date the Daily Royale is numbered from ("#N"). A contest on this date is #1; each later ET
# date increments. Used by services/challenge.contest_no_for_date — the human-facing daily number in
# a share link ("Rot Royale #142"). Never move backward once launched (it would renumber history).
DAILY_ROYALE_EPOCH: date = date(2026, 6, 1)

# Anti-abuse: max anonymous guest accounts a single client IP may create per rolling hour. Guest
# creation is free + form-less (the share loop lands a visitor straight into play), so a per-IP cap
# keeps a script from minting accounts en masse. In-process limiter (app/core/ratelimit.py).
GUEST_CREATE_MAX_PER_IP_PER_HOUR: int = 30

# Auth abuse caps. Every credential endpoint runs a full argon2 hash/verify (~64 MiB, ~50 ms each),
# so an UNCAPPED login/register is both a password brute-force surface AND a cheap CPU+memory
# amplification DoS — a few hundred concurrent requests from one host exhaust the instance. These
# use the same in-process limiter as the guest cap (app/core/ratelimit.py) with the same
# soft-ceiling caveat behind multiple instances — an anti-abuse speed bump, not a security boundary.
# Windows are short so a legitimate user who fat-fingers a password is never locked out for long.
# generous for humans; kills scripted brute-force from one IP
LOGIN_MAX_PER_IP_PER_5MIN: int = 20
# per-email, so a distributed guess against one victim still can't hammer that account
LOGIN_MAX_PER_ACCOUNT_PER_5MIN: int = 8
# real users register ~once; the anonymous fast path is /auth/guest
REGISTER_MAX_PER_IP_PER_HOUR: int = 12
RATE_WINDOW_5MIN_SECONDS: float = 300.0

# Coins granted to a brand-new account. v1 = 0 (coins are earned in-game only). Change this single
# value to seed signup coins; the grant flows through the ledger so the invariant always holds.
STARTING_COINS: int = 0

# Gems granted to a brand-new account. v1 = 0 (gems are scarce, earned-only). Gems are the second
# currency; like coins, any grant flows through the gem ledger so the cache invariant holds.
STARTING_GEMS: int = 0

# Starting Elo-style rating for a new profile.
STARTING_RATING: int = 1000

# Daily Royale trivia second-chance: a WRONG first pick greys out (eliminated) and opens a fixed
# retry window of this many ms for one more pick, scored at HALF points (still counts as correct
# for streak + Rot Rating). Ranked Daily Royale trivia only (§5f); a second wrong pick or a lapsed
# window ends the round at 0. Server-authoritative — the deadline is from the first pick's instant.
#
# 8s, RAISED FROM 4s after a real player lost rounds to it. The retry arrives unannounced: the
# player's pick greys out and the ring restarts, with nothing on screen explaining that a second
# pick is owed. At 4s someone who has to work out what just happened has already lost the round
# before they can act, so the feature meant to soften a wrong answer was punishing instead.
# Derivation: the base round is 10s to read a cold question and weigh four options; a retry re-reads
# a known question with three left, so 8s is generous without exceeding the round it belongs to.
# The real fix is telling the player what happened — until then this window must not be a reflex
# test.
TRIVIA_RETRY_MS: int = 8000

# Free default theme every account owns and equips on creation (PLAN.md §11, DESIGN.md §6).
# "Starter" is the app's main visual identity (premium ivory / royal purple / gold); the Blank
# pair stays free as the minimalist alternative. The original arcade skin lives on as
# "Rot Champion" (id `royale`), reserved for the first 200 accounts via the founder:200
# requirement (see core/cosmetics.py).
DEFAULT_THEME_ID: str = "starter"

# Avatar preset ids (identity v1). Frontend renders these as illustrated portraits + gradient disc
# (see src/theme/identity.ts, images in public/avatars/); backend validates ids only.
AVATAR_PRESETS: tuple[str, ...] = (
    "knight",
    "crescent",
    "rook",
    "bishop",
    "ember",
    "sol",
    "willow",
    "onyx",
)
DEFAULT_AVATAR_PRESET: str = "knight"

# --- Settlement & rating (PLAN.md §7). Ranked pays NO coins — it grants rating/division/streak
# (status); coins are earned in campaign/practice and spent in the Vault. The constants stay as the
# documented tuning seam; settlement skips the ledger write entirely when an amount is 0, so the
# append-only ledger never carries zero-value rows. ---
COINS_BY_PLACE: dict[int, int] = {1: 0, 2: 0, 3: 0}  # exact placements
COINS_TOP_THIRD: int = 0  # placed in the top third (but not 1st–3rd)
COINS_PARTICIPATION: int = 0  # everyone else who submitted
STREAK_BONUS_PER_DAY: int = 0  # streak bonus coins = (streak + 1) * STREAK_BONUS_PER_DAY
RATING_K: int = 64  # Elo sensitivity

# Gap between a Daily Royale CLOSING (12:00 AM ET, midnight) and its results SETTLING (12:15 AM ET)
# — the "Results settling" beat the player sees. settle_at = close_at + SETTLE_DELAY_MINUTES
# (derived; no DB column). Settlement is gated on now >= settle_at so it never fires early, never
# via lazy/first-user-open — see app.jobs.tasks.settle_due_windows and the targeted 12:15-ET
# scheduler jobs.
SETTLE_DELAY_MINUTES: int = 15

# --- Daily Royale Gem rewards (the scarce currency). Granted at settlement, royale slot only, via
# the gem ledger (idempotency_key dr:{window_id}:{user_id}). Only the single highest tier is paid
# (never stacked). Starter +5 is a one-time grant on a player's first settled Daily Royale. ---
GEM_STARTER_DAILY_ROYALE: int = 5
# Per-tier gem amounts (tuning seam). Crown/top-3 are fixed places; the percentile tiers use
# math.ceil(field_size * frac) in gems_for_place so a small field still has a top slice.
GEM_DR_CROWN: int = 12  # 1st place
GEM_DR_TOP_3: int = 7  # places 2-3
GEM_DR_TOP_10PCT: int = 4
GEM_DR_TOP_25PCT: int = 2
GEM_DR_TOP_50PCT: int = 1

# --- Daily Missions (engagement layer): three fixed daily missions (play the Daily Royale, complete
# a duel, clear a campaign level). Complete >= DAILY_MISSIONS_REQUIRED of 3 to open the daily chest.
# The chest reward is FIXED by ET weekday (no RNG, v1); grants are idempotent per (user, ET day) via
# the daily_chest_claims PK. Reasons are free-form ledger strings (no enum migration). ---
DAILY_MISSION_IDS: tuple[str, ...] = ("play_royale", "complete_duel", "clear_campaign")
DAILY_MISSIONS_REQUIRED: int = 2  # complete this many of the three to make the chest claimable
# (coins, gems) reward indexed by ET weekday (Monday=0 .. Sunday=6 — date.weekday()). Mostly coins;
# small gem days on Tue/Fri/Sun. Keep in sync with the frontend's display rotation.
DAILY_CHEST_REWARDS: tuple[tuple[int, int], ...] = (
    (50, 0),  # Mon
    (0, 1),  # Tue
    (75, 0),  # Wed
    (50, 0),  # Thu
    (0, 1),  # Fri
    (100, 0),  # Sat
    (0, 2),  # Sun
)
DAILY_CHEST_COIN_REASON: str = "daily_chest"
DAILY_CHEST_GEM_REASON: str = "daily_chest"

# --- Streak milestone rewards (engagement layer): granted at SETTLEMENT when the Daily Royale daily
# streak first reaches one of these day-counts. EARNED, never purchasable. Idempotent via the gem
# ledger key streak:{user_id}:{milestone}:{contest_date} so a re-settle never double-grants and a
# fresh streak run that reaches the same milestone on a later date pays again. (coins, gems). ---
STREAK_MILESTONE_REWARDS: dict[int, tuple[int, int]] = {
    3: (0, 1),  # day 3 → 1 gem
    5: (0, 2),  # day 5 → 2 gems
    7: (0, 3),  # day 7 → 3 gems
}
STREAK_MILESTONE_COIN_REASON: str = "streak_milestone"
STREAK_MILESTONE_GEM_REASON: str = "streak_milestone"

# --- Practice Mode (M8): no stakes. Sharpness is a personal progress indicator only — never coins,
# rating, or any contest advantage. ---
SHARPNESS_MAX: int = 100  # sharpness caps here
# Sharpness granted for a perfect session; the actual grant scales with accuracy (round(accuracy *
# this)). With a 5-round practice set this equals the correct-answer count.
SHARPNESS_PER_SESSION: int = 5

# --- Campaign Mode: the PROGRESSION + primary coin source (coins are cosmetic-only, never affect
# rating/rank/standings; see services/campaign.py). A level is 10 questions from one category's
# authored ladder; clearing/unlocking is keyed off correct-count thresholds below. ---
CAMPAIGN_QUESTIONS_PER_LEVEL: int = 10
CAMPAIGN_CHEST_LEVEL: int = 5  # mid-world level that grants the one-time gem "chest" milestone
CAMPAIGN_CLEAR_THRESHOLD: int = 7  # >= this many correct (of 10) = Clear (unlocks the next level)
CAMPAIGN_STRONG_THRESHOLD: int = 8  # >= this = Strong Clear
CAMPAIGN_PERFECT_THRESHOLD: int = 10  # == this = Perfect

# Coin rewards (paid through the ledger, reason = the keys below). First clear stacks the strong /
# perfect bonuses; a REPLAY of an already-cleared level pays only the small flat amount — so coins
# can't be farmed by grinding one easy level. The whole campaign is capped per ET day.
CAMPAIGN_COIN_FIRST_CLEAR: int = 25
CAMPAIGN_COIN_STRONG_BONUS: int = 15
CAMPAIGN_COIN_PERFECT_BONUS: int = 40
CAMPAIGN_COIN_REPLAY_CLEAR: int = 5
CAMPAIGN_DAILY_COIN_CAP: int = 300  # max campaign coins earnable per America/New_York calendar day

# Ledger reason codes for campaign coin grants (ref_type="campaign", ref_id=entry_id). Kept as a
# tuple so the daily-cap query and tests share one source of truth.
CAMPAIGN_COIN_REASONS: tuple[str, ...] = (
    "campaign_first_clear",
    "campaign_strong_clear",
    "campaign_perfect",
    "campaign_replay_clear",
)

# --- Campaign Gem milestones (the scarce currency). Fixed, first-time-only (idempotency-keyed),
# server-side, NOT subject to the coin daily cap. Granted in complete_campaign_level. ---
GEM_CAMPAIGN_LEVEL5_CHEST: int = 1  # clear level 5 of any world
GEM_CAMPAIGN_BOSS_CLEAR: int = 2  # clear the level-10 boss of any world
GEM_CAMPAIGN_PERFECT_BOSS: int = 1  # boss cleared with a perfect 10/10 (first time)
GEM_CAMPAIGN_PERFECT_WORLD: int = 3  # every level of a world cleared 'perfect'
GEM_CAMPAIGN_ALL_WORLDS: int = 10  # every world fully cleared

# --- Duel tiers: entry/pool in Gems + the Gem-duel WIN count that unlocks the tier (training/spark
# always open). Training is free and pays nothing; gem duels redistribute via the pool. ---
DUEL_TYPES: dict[str, dict[str, int]] = {
    "training": {"entry": 0, "pool": 0, "unlock_wins": 0},
    "spark": {"entry": 1, "pool": 2, "unlock_wins": 0},
    "crown": {"entry": 3, "pool": 6, "unlock_wins": 5},
    "royal": {"entry": 5, "pool": 10, "unlock_wins": 25},
}
DUEL_BOT_GEM_CAP_PER_DAY: int = 3  # informational daily counter only — bot Gem duels are NOT capped
#   (per-day enforcement removed by product decision; the value is still surfaced as a "used today"
#   reference in the duel config/wallet, and is not a spending limit)
DUEL_EXPIRY_MINUTES: int = 30  # an unfinished duel expires (entry forfeit) after this
DUEL_TOTAL_ROUNDS: int = 10  # 7 normal + 3 sudden-death questions generated up front

# --- Friend duels (the social layer — live head-to-head vs a real friend, no Gems/stakes). A
# friend challenge must be ACCEPTED before play; an unaccepted challenge expires, and an accepted
# but unfinished live match expires too (so a half-played duel never lingers forever). Friend duels
# roll into the same DuelUserStats training counters (training_wins/losses + duel XP/tier) — they
# are free and pay nothing, exactly like training vs a bot. ---
FRIEND_DUEL_CHALLENGE_EXPIRY_MINUTES: int = 1440  # 24h to accept a challenge before it expires
FRIEND_DUEL_PLAY_EXPIRY_MINUTES: int = 60  # an accepted but unfinished live duel expires after this

# --- Duel mode (the repeatable competitive loop). Best-of-7, 12s/question, first to 4 round-wins.
# Knowledge wins a round; speed only breaks a both-correct tie when the gap is clear. ---
DUEL_SPEED_GAP_MS: int = 350  # both-correct: faster wins only if the time gap is >= this
DUEL_ROUNDS_TO_WIN: int = 4  # first to this many round-wins takes the match
DUEL_NORMAL_ROUNDS: int = 7  # best-of-7
DUEL_SUDDEN_DEATH_MAX: int = 3  # at most this many sudden-death questions before the tiebreak
# Must match TriviaModule.time_limit_ms (duel rounds ARE trivia rounds). It is duplicated rather
# than imported because app.core may not import app.modules; test_duel_logic pins the two together.
DUEL_QUESTION_TIME_LIMIT_MS: int = 10_000
# Duel XP (separate from Daily Royale rating). Gem duels are worth more than training.
DUEL_XP_GEM_WIN: int = 10
DUEL_XP_GEM_LOSS: int = 3
DUEL_XP_TRAINING_WIN: int = 2
DUEL_XP_TRAINING_LOSS: int = 1
DUEL_XP_PERFECT_BONUS: int = 5
DUEL_XP_COMEBACK_BONUS: int = 5
# Duel tier (status only — NEVER affects Daily Royale rating/division/streak). Cumulative XP bands.
DUEL_TIER_THRESHOLDS: tuple[tuple[str, int], ...] = (
    ("bronze", 0),
    ("silver", 100),
    ("gold", 300),
    ("crown", 700),
)

# ── Seasons (monthly soft-reset of the ranked rating + duel-tier ladders) ──────────────────────
# At each ET month rollover the previous season is closed: everyone's rating and duel XP are pulled
# halfway toward their baselines (STARTING_RATING / 0), and a one-time season-end GEM reward is paid
# by final rating division + duel tier. Status/rewards only — never touches coins, and the reset is
# exactly-once per season (see services/seasons.py).
SEASON_RESET_FACTOR: float = 0.5
SEASON_RATING_REWARDS: dict[str, int] = {
    "Bronze": 0,
    "Silver": 3,
    "Gold": 6,
    "Platinum": 10,
    "Diamond": 15,
    "Apex": 25,
}
SEASON_DUEL_REWARDS: dict[str, int] = {
    "bronze": 0,
    "silver": 3,
    "gold": 6,
    "crown": 12,
}

# --- Adaptive learning: knowledge-tracing (Phase 1) ---------------------------------------------
# Category ability is an online 1PL-IRT / Elo estimate on a logit scale; per-topic knowledge is a
# BKT posterior; a thin topic is shrunk toward its category's implied prior. Tunable here.
KT_THETA_INIT: float = 0.0  # neutral starting ability for a new (user, category)
KT_DIFFICULTY_MIN: float = -2.5  # LLM difficulty_score 0.0 maps to this item difficulty b
KT_DIFFICULTY_MAX: float = 2.5  # LLM difficulty_score 1.0 maps to this item difficulty b
KT_K_BASE: float = 0.6  # base ability learning rate
KT_K_DECAY: float = 20.0  # rate decays with attempts: K = KT_K_BASE / (1 + attempts / KT_K_DECAY)
KT_K_MIN: float = 0.08  # floor so a settled ability still tracks real change
BKT_P_L0: float = 0.30  # prior P(known) for a brand-new topic before shrinkage
BKT_P_TRANSIT: float = 0.12  # P(learn) applied after each observation
BKT_P_GUESS: float = 0.25  # 4-option MC guess floor
BKT_P_SLIP: float = 0.10  # P(slip): known but answered wrong
TOPIC_INDEPENDENCE_MIN: int = 6  # attempts before a topic fully trusts its own BKT vs prior

# --- Adaptive learning: adaptive selection (Phase 2) --------------------------------------------
KT_TARGET_SUCCESS: float = 0.82  # fun-first: aim questions at ~82% predicted success
LEARNING_WARM_MIN_ATTEMPTS: int = 15  # total category attempts before learning-need shapes picks
W_LEARNING_NEED: float = 0.35  # weight of the learning-need term added in score_question
LIKED_CATEGORY_MIN_AFFINITY: float = 0.1  # category affinity >= this = in the player's wheelhouse
WEAK_ONRAMP_CHANCE: float = 0.15  # per session: chance of one EASY on-ramp from a weak subject
WEAK_TOPIC_P_KNOWN_MAX: float = 0.60  # a topic counts as "weak" when effective P(known) < this
REVIEW_BASE_HOURS: float = 8.0  # shortest review gap after a correct answer
REVIEW_MAX_HOURS: float = 168.0  # longest review gap (7 days) at high mastery

# --- Adaptive learning: mastery levels (Phase 3) ------------------------------------------------
MASTERY_LEVELS: int = 5  # levels 1..5 (5 = Mastered)
# answers in a category before a real level is shown (else "warming up" = 0)
MASTERY_MIN_ATTEMPTS: int = 5
# theta boundaries between levels 1..5
MASTERY_LEVEL_CUTS: tuple[float, ...] = (-0.8, -0.2, 0.5, 1.3)

# --- Rot Rating (Glicko-2 sharpness rating, CLAUDE.md §5e) --------------------------------------
# The headline profile "sharpness" number, PARALLEL to the placement Elo (STARTING_RATING above),
# never merged with it. Each Daily Royale round is one Glicko-2 game (pass/fail, round-as-opponent);
# one run is one rating period. Three sub-ratings (notice/estimate/know) each update from their
# verb's rounds; the headline is DERIVED (precision-weighted mean), never a fourth rating. Speed is
# deliberately excluded — points reward speed, Rot Rating measures sharpness. NEVER labeled IQ.
ROT_RATING_VERSION: int = 1  # bump when scoring semantics change; exposures must not mix versions
ROT_TAU: float = 0.5  # Glicko-2 system constant (volatility change rate)
ROT_SEED_RATING: float = 1500.0  # new sub-rating / never-seen difficulty prior
ROT_SEED_RD: float = 350.0
ROT_SEED_VOL: float = 0.06
# RD floor: deliberately HIGH so the number visibly moves after a strong run — a rating that shifts
# 3 points is a dead stat. Trades precision for responsiveness; retune DOWN once real distributions
# exist. Because RD never drops below this, "provisional" keys off rounds played, NOT RD.
ROT_RD_FLOOR: float = 200.0
ROT_PROVISIONAL_ROUNDS: int = 15  # headline is provisional until this many rated rounds (~2 runs)
ROT_SUB_PROVISIONAL_ROUNDS: int = (
    5  # a sub-rating is provisional until this many of its verb's rounds
)
# Royale round type -> Rot Rating verb. Only the Royale pool types matter; others default to "know".
ROT_TYPE_VERB: dict[str, str] = {
    "trivia": "know",
    "rapid_math": "know",
    "memory_flash": "know",
    "span": "know",
    "estimate": "estimate",
    "crowd": "estimate",
    "change_detection": "notice",
}
ROT_VERBS: tuple[str, ...] = ("notice", "estimate", "know")
# Difficulty seed rating by band. A difficulty rating starts here and (for FLOATING pools only)
# converges on observed pass rate in the daily batch. Trivia difficulties are the fixed ANCHOR —
# they stay at these seeds and never converge (956-item corpus = the stable reference scale).
ROT_DIFFICULTY_SEED: dict[str, float] = {"easy": 1300.0, "medium": 1500.0, "hard": 1700.0}
ROT_DIFFICULTY_SEED_DEFAULT: float = 1500.0  # unknown/missing band
# Verbs whose difficulty ratings FLOAT (converge daily + get pool-mean re-centred to their seed mean
# so a strong cohort can't drift the scale). "know" (trivia) is absent → fixed anchor.
ROT_FLOATING_VERBS: frozenset[str] = frozenset({"notice", "estimate"})

# --- Username changes -------------------------------------------------------------------------
# The handle is public identity (leaderboards, friends, share links), so changing it is allowed but
# deliberately not frictionless: the first change is free — a player who got an auto-generated guest
# handle, or simply picked badly, should not have to pay to fix it — and every change after that
# costs coins. Coins are cosmetic-only (DESIGN §7), so this never gates competitive standing.
USERNAME_FREE_CHANGES = 1
USERNAME_CHANGE_COST = 300
