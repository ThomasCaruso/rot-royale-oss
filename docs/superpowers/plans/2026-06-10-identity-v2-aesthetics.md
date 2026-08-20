# Identity V2 — Badges, Titles, Celebrations & the Beauty Pass

Branch: `feat/identity-v2-aesthetics` (off main `2f4dae6`, post Avatar Identity v1).
User directive: "All about aesthetics. Make it beautiful and fun and engaging." V2 scope was
pre-approved in the V1 product plan: badges (auto-granted, pick-3 visible), titles
(achievement-unlocked), world-complete "frame unlocked" celebration, plus podium/reveal polish.
PLAN.md + CLAUDE.md conventions and the game-ui-design skill apply throughout.

## Product summary

Achievements become *visible status*: auto-granted **badges** (world medals, crowns, podium honors —
never purchasable, proof not merchandise), an equippable **title** under your name on the podium and
result reveal, a **celebration moment** when clearing a world's final level unlocks its frame, and a
podium **aura** for the #1 spot. Everything derivable from existing tables; nothing touches
competitive outcomes; coins stay out of this entirely (badges/titles are earned, not bought).

## Locked decisions (do not relitigate)

- **No founder badge** in V2 (no public-launch cutoff exists yet). No streak badge (only current
  streak is stored; achievements must be monotonic). Uploads still out of scope forever-ish.
- **Badges are NEVER purchasable.** Titles are NEVER purchasable. No vault/catalog/coin involvement.
- **Badge catalog (10, ids locked)** — definitions in `app/core/achievements.py` (new), each
  `{id, kind: "badge", requirement}`:
  | id | requirement |
  |---|---|
  | medal_science | world:Science |
  | medal_history | world:History |
  | medal_geography | world:Geography |
  | medal_arts | world:Arts |
  | medal_sports | world:Sports |
  | medal_pop | world:Pop Culture |
  | crown_all | all_worlds |
  | perfectionist | perfect_world_any |
  | podium_finisher | top3:1 |
  | first_crown | first_place:1 |
- **Title catalog (6, ids locked)** — same file, `kind: "title"`:
  | id | requirement |
  |---|---|
  | crown_chaser | ranked_entries:1 |
  | world_traveler | worlds_any:3 |
  | perfect_clear | perfect_world_any |
  | podium_regular | top3:3 |
  | champion | first_place:1 |
  | trivia_menace | all_worlds |
- **Requirement grammar extensions** (achievements engine, building on V1's checker semantics):
  `world:<key>` and `all_worlds` reuse V1 logic. New: `worlds_any:<n>` (≥n worlds fully cleared);
  `perfect_world_any` (≥1 world where EVERY level has clear_status='perfect');
  `top3:<n>` (≥n Standing rows with place ≤ 3); `first_place:<n>` (≥n Standing rows with place == 1);
  `ranked_entries:<n>` (≥n ranked entries — count Entry rows joined to non-practice windows; verify
  how practice/campaign entries are distinguished in the schema and count ONLY ranked-window
  entries). Unknown format → not earned (safe default). All aggregates computed ONCE per request.
- **Earned is computed on read** (no grant table): campaign progress and standings are persistent,
  so achievements are monotonic. One service function returns the full earned map.
- **Schema (one migration):** `profiles.equipped_badges JSONB NOT NULL server_default '[]'` (list of
  ≤3 badge ids) and `profiles.equipped_title VARCHAR(64) NULL`.
- **Endpoints:**
  - `GET /identity` → `{badges: [{id, earned, equipped}], titles: [{id, earned, equipped}]}` (auth).
  - `PATCH /me/badges` body `{badge_ids: [str]}` → 200 `{equipped_badges}`; errors (machine codes):
    422 `unknown_badge`, 400 `too_many_badges` (>3), 403 `not_earned`. Order preserved as sent;
    duplicates → 422 `unknown_badge`? NO — duplicates → 400 `duplicate_badge`.
  - `PATCH /me/title` body `{title_id: str | null}` → 200 `{equipped_title}`; 422 `unknown_title`,
    403 `not_earned`; null clears.
  - `MeResponse` += `equipped_badges: list[str]`, `equipped_title: str | None`.
  - `FieldEntry` + `StandingOut` += `equipped_badges: list[str]`, `equipped_title: str | None`
    (bots: `[]` / `None`).
- **Frontend visuals** in `src/theme/identity.ts`: `BADGE_STYLES` (id → {emoji, name, blurb, tint})
  — medals 🥇-style world medals with per-world emoji (⚗️ 🏺 🧭 🎨 🏅 ✨ family), crown_all 👑,
  perfectionist 💯, podium_finisher 🏆, first_crown 🥇; `TITLE_STYLES` (id → {name, blurb, flair
  color/gradient for the text}). ALL names/blurbs copy-guarded (no banned words; "player" banned —
  use field/rival language).
- **`cosmeticIds.json` parity fixture** gains `badges`, `titles`, and `worlds` arrays; BOTH suites
  assert their side (backend: catalogs + manifest worlds match fixture; frontend: BADGE_STYLES/
  TITLE_STYLES/WORLD_FRAMES keys match fixture).
- **`WORLD_FRAMES`** map in identity.ts (world key → frame id: Science→science_orbit,
  History→history_relic, Geography→geo_compass, Arts→arts_brush, Sports→sports_champion,
  Pop Culture→pop_neon) — used by the celebration; tested against the fixture.
- **IdentityEditor**: AvatarPicker grows into a tabbed identity editor (Avatar | Badges | Title)
  opened from ProfileMenu's existing "Edit identity" row. Badges tab: grid of all 10 with earned/
  locked states (locked = dimmed + goal copy from requirement), tap to equip/unequip up to 3, pick
  state saved via PATCH from server response only. Title tab: list of 6, one equippable, "No title"
  clears. Locked items show goal-framed copy (anticipation, never dead).
- **Surfaces:** leaderboard rows show up to 3 tiny badge emoji after the username; podium cards and
  the reveal identity moment show equipped_title under the name (flair-colored) + badges; ProfileMenu
  shows title under username + equipped badges row. Bots render nothing extra (empty/null).
- **Celebration:** when a campaign level completion makes its world fully cleared, the LevelComplete
  screen plays a "FRAME UNLOCKED" moment — the world's frame (WORLD_FRAMES) rendered on the player's
  avatar, confetti, goal copy "now waiting in the Vault" (it still costs coins — honest copy: it's
  UNLOCKED to buy, not granted; word it as "Unlocked in the Vault"). Detect via the ladder/progress
  data the screen already has or refetches — find the real data path before wiring.
- **Aura (the aesthetics ask):** podium #1 gets a subtle radial gold aura + existing twinkles behind
  the winner card; reveal placement card for 1st gets the same family. Transform/opacity only,
  reduced-motion collapsed, no new keyframe systems if existing ones fit.
- Honesty: badges/titles auto-granted (never sold); no urgency/scarcity; copy guards in en/es/tr AND
  identity.ts; field counts stay real.

## Verification commands

Backend (backend/): `uv run alembic upgrade head` (after Task 1), `uv run ruff check .`,
`uv run mypy app`, `uv run pytest -q` (263 + new). Frontend (frontend/): `npm run typecheck`,
`npm run lint`, `npx vitest run` (197 + new), `npm run build` (no phaser chunk). PS 5.1: no `&&`;
gate on `$?`. Never touch ports 8000/8001. Commits end with the Claude Fable 5 co-author line.

---

## Task 1 — Backend achievements engine + equip endpoints

Files: new `app/core/achievements.py` (badge + title catalogs per locked tables, frozen dataclass
like CosmeticItem), migration (equipped_badges JSONB '[]' + equipped_title, chained from
d1e2f3a4b5c6, coherent downgrade), `app/models/profile.py` (two columns; JSONB via
sqlalchemy.dialects.postgresql or JSON type — match repo norms), new
`app/services/achievements.py` (earned engine: extends V1 requirement semantics with the new
grammar; computes world-completion map, perfect map, standings aggregates, ranked-entry count ONCE;
exposes `earned_map(session, user_id) -> dict[str, bool]` + `get_identity(...)`), new
`app/api/identity.py` (GET /identity) + PATCH /me/badges + PATCH /me/title (in api/me.py), schemas
(`IdentityResponse`, `BadgesUpdate/BadgesResponse`, `TitleUpdate/TitleResponse`, MeResponse fields),
main.py router include. Error codes exactly: 422 unknown_badge/unknown_title, 400
too_many_badges/duplicate_badge, 403 not_earned. Migration applied to dev DB.
Tests (`tests/test_achievements.py`): catalog pins; each requirement type earned/not-earned (seed
progress + standings + entries); GET /identity shape for cold + decorated users; PATCH badges happy/
unknown/too-many/duplicate/not-earned; PATCH title happy/clear/unknown/not-earned; /me carries both
fields; fairness (equipping changes nothing competitive).
Commit: `feat(achievements): badge/title catalogs, earned engine, equip endpoints`.

## Task 2 — Identity on field + standings (V2 fields) + parity fixture

Files: `app/services/contest.py` FieldEntry += equipped_badges/equipped_title (Profile join; bots
[]/None), `app/schemas/contest.py` both schemas, `app/api/contests.py` standings rows,
`frontend/src/theme/cosmeticIds.json` += badges/titles/worlds arrays, `backend/tests/test_cosmetics.py`
parity test extended (badge/title catalogs + manifest worlds vs fixture).
Tests: field/standings carry the fields; bots empty; parity green.
Commit: `feat(api): badges/title on field + standings; parity fixture v2`.

## Task 3 — IdentityEditor (Avatar | Badges | Title) + identity.ts styles

Files: `src/theme/identity.ts` (BADGE_STYLES ×10, TITLE_STYLES ×6, WORLD_FRAMES map; helpers
getBadge/getTitle with safe fallbacks), `src/api/client.ts` (Me += equipped_badges/equipped_title;
IdentityResponse type; getIdentity/setBadges/setTitle methods), `src/store/session.ts`,
AvatarPicker → `src/screens/home/IdentityEditor.tsx` (tabbed sheet: Avatar tab = existing grid;
Badges tab = 10-badge grid with earned/locked/equipped states, pick ≤3, goal copy for locked via a
requirement→copy map mirroring FrameCard's; Title tab = 6 titles + "No title", flair-colored
preview), ProfileMenu (title under username, equipped badge row, editor wiring), i18n (identity.*
keys ×3 locales).
Tests: identity.test.ts (styles complete vs fixture incl. WORLD_FRAMES; copy guard over badge/title
names+blurbs); editor flow tests (jsdom: equip badge calls setBadges once with server-authoritative
patch; 4th badge tap blocked client-side with the 3 already chosen; title set + clear); ProfileMenu
pins; i18n parity.
Commit: `feat(identity): badges & title editor with earned/locked states`.

## Task 4 — Surfaces: leaderboard badges, podium titles + winner aura, reveal

Files: `src/api/client.ts` FieldEntry += the two fields; LeaderboardScreen mapping;
LeaderboardRow (≤3 tiny badge emoji after username, aria-hidden, no layout jump when absent);
PodiumTopThree (title under name in flair color; #1 card gets the gold aura — radial glow +
existing rr-twinkle sparkles, reduced-motion safe); RoyaleResultsModal (identity moment gains the
title under the avatar + equipped badges; 1st-place placement card aura family); MiniLeaderboard
badges optional (small — only if clean at 28px, else skip and say so).
Tests: row badges from data; bot rows render nothing extra; podium title + aura markers; reveal
title; no weakened assertions.
Commit: `feat(identity): badges and titles on leaderboard, podium and reveal`.

## Task 5 — World-complete celebration in LevelComplete

Files: `src/screens/campaign/LevelComplete.tsx` (+ whatever data path it has — READ IT FIRST: how
does it know level/world results? Does the complete response or refetched ladder reveal that the
world just became fully cleared? Wire detection so the moment fires exactly when THIS completion
finished the world, not on replays of already-complete worlds), celebration UI: "FRAME UNLOCKED"
display moment — player's avatar wearing WORLD_FRAMES[world] (size ~80), confetti burst, honest
copy "Unlocked in the Vault" (it costs coins to buy — never imply it was granted), CTA hint toward
the Vault if a nav path exists cleanly (else just the moment). For perfect-clear of a world also
acknowledge `perfectionist` progress subtly if cheap. i18n ×3.
Tests: celebration renders when the completing level finishes the world; does NOT render on a
replay/non-final clear; copy guard.
Commit: `feat(campaign): world-complete frame-unlock celebration`.

## Task 6 — Beauty pass + full verification + final review

Game-ui-design pass over everything V2 added (editor tab transitions, badge pick feedback, aura
tuning, celebration timing) + a sweep of V1+V2 identity surfaces for visual coherence. Full
verification both sides incl. build chunk check. Then final whole-branch review +
finishing-a-development-branch.
Commit: `feat(identity): v2 beauty pass`.
