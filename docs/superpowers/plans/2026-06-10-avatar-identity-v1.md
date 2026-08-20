# Avatar / Profile Identity V1 — Implementation Plan

Branch: `feat/avatar-identity-v1` (off main `c39b993`, post Vault economy v1).
Product spec approved by the user 2026-06-10 (conversation). PLAN.md + CLAUDE.md conventions apply.
Ranked coin removal is ALREADY DONE (verified: `constants.py:19-22` zeros, `settlement.py:146-153`
guards, pinned tests) — no Phase 0.

## Product summary

Players build a visible identity: choose 1 of 8 free **avatar presets** (emoji + gradient disc,
extends the existing Avatar component), equip **frames** (pure-CSS ring/glow/ornament treatments)
bought with coins or unlocked by campaign completion, and that identity shows on the leaderboard,
podium, result reveal, home header, and profile menu. Coins stay cosmetic-only; cosmetics never
touch competitive outcomes. Also: the language selector moves to login/signup + the profile menu
only.

## Locked decisions (do not relitigate)

- Presets: 8, all free, ids `ninja fox robot owl bolt brain octopus alien`
  (🥷 🦊 🤖 🦉 ⚡ 🧠 🐙 👾). Backend validates ids only; emoji/gradients live frontend.
- `profiles.avatar_preset VARCHAR(32) NOT NULL server_default 'ninja'`;
  `profiles.equipped_frame VARCHAR(64) NULL` (NULL = no frame).
- Same migration fixes the stale `profiles.equipped_theme` server_default `'daylight'` → `'royale'`
  (no data change; registration already writes 'royale' explicitly).
- New table `user_cosmetics (user_id UUID FK users.id ON DELETE CASCADE, item_id VARCHAR(64),
  kind VARCHAR(16) NOT NULL, acquired_at timestamptz server_default now(), PK (user_id, item_id))`.
  `user_themes` is NOT touched; themes keep using it.
- Frame catalog (in `app/core/cosmetics.py` `COSMETIC_CATALOG`, kind="frame"):

  | id | cost | requirement |
  |---|---|---|
  | frame_none | 0 | None |
  | bronze_ring | 60 | None |
  | violet_glow | 100 | None |
  | gold_crown | 150 | None |
  | science_orbit | 150 | world:<Science & Nature world key> |
  | history_relic | 150 | world:<History world key> |
  | geo_compass | 150 | world:<Geography world key> |
  | arts_brush | 150 | world:<Arts & Literature world key> |
  | sports_champion | 150 | world:<Sports world key> |
  | pop_neon | 150 | world:<Pop Culture world key> |
  | crowned_scholar | 0 | all_worlds |

  The `<world key>` MUST be exactly the value stored in `user_campaign_progress.world` (verify
  against the campaign manifest/service before writing the catalog — do not guess).
- Requirement semantics (`app/services/vault.py`): `None` → met. `world:<key>` → every level of
  that world has `clear_status IS NOT NULL` for this user (expected level count comes from the
  campaign manifest, not hardcoded 10). `all_worlds` → that condition for every world in the
  manifest. Unknown requirement format → NOT met (safe default).
- Ownership rule change: implicitly owned ⇔ `cost == 0 AND requirement met`. (Today it's
  `cost == 0`.) `frame_none` is implicitly owned by everyone; `crowned_scholar` only after all
  worlds. Buying any cost-0 item still raises AlreadyOwned when owned.
- Equip semantics: kind "theme" → `profiles.equipped_theme = id` (unchanged). Kind "frame" →
  `profiles.equipped_frame = (None if id == "frame_none" else id)`. `get_vault` marks `frame_none`
  equipped when `equipped_frame IS NULL`.
- `EquipResponse` becomes `{equipped_theme: str, equipped_frame: str | None}` (additive; both
  always returned, reflecting the profile after the equip).
- Ledger for frame buys: `reason="frame_purchase", ref_type="frame", ref_key=<item id>`,
  delta = -cost. Same FOR UPDATE serialization + IntegrityError→AlreadyOwned backstop as themes,
  now writing `user_cosmetics`.
- `MeResponse` += `avatar_preset: str`, `equipped_frame: str | None`.
- New endpoint `PATCH /me/avatar` body `{preset_id: str}` → 200 `{avatar_preset: str}`;
  unknown preset → 422 with machine-readable detail `"unknown_preset"`. Auth required.
- `FieldEntry` (service dataclass + `app/schemas/contest.py` schema) += `avatar_preset: str`,
  `equipped_frame: str | None`. Real users: joined from Profile. Bots: deterministic preset from
  the existing bot seeding (`(contest_date, slot)` rng) — stable across reads — `equipped_frame=None`.
- `StandingOut` += the same two fields (standings endpoint already joins Profile).
- Frontend preset/frame visuals: `src/theme/identity.ts` exporting `AVATAR_PRESETS`
  (id → {emoji, bg gradient}) and `FRAME_STYLES` (id → {name, blurb, ring, glow?, ornament?,
  prestige?}). Frame names/blurbs are player-facing copy → covered by a copy-guard test scanning
  this file (same banned list as i18n).
- Language selector: ONLY (a) unauthenticated screens (App.tsx floating fallback) and (b) a row
  inside ProfileMenu (inline variant). Remove from HomeHeader and CampaignHero.
- Honesty rules: no scarcity/urgency/timers; requirement copy frames locked frames as goals
  ("Complete the X campaign"); banned-word guards apply to every new player-facing string in
  en/es/tr AND identity.ts.

## Verification commands

Backend (from `backend/`): `uv run alembic upgrade head` (after Task 1), `uv run ruff check .`,
`uv run mypy app`, `uv run pytest`. Frontend (from `frontend/`): `npm run typecheck`,
`npm run lint`, `npx vitest run`, `npm run build` (no phaser chunk). PowerShell 5.1: no `&&` —
run commands separately and gate on `$?`. NEVER touch ports 8000/8001 or kill by name.
Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Tests run against the
real `rot_royale` DB inside rolled-back transactions; test helpers creating Profiles must set
`equipped_theme="royale"` explicitly (and after Task 1 may rely on the new avatar default).

---

## Task 1 — Backend identity data layer

Files: `app/models/profile.py` (+2 columns), new `app/models/cosmetic.py` (UserCosmetic),
`app/models/__init__.py` export, hand-written Alembic migration (add columns, alter
equipped_theme server_default to 'royale', create user_cosmetics), `app/core/constants.py`
(`AVATAR_PRESETS: tuple[str, ...]` of the 8 ids, `DEFAULT_AVATAR_PRESET = "ninja"`),
`app/schemas/profile.py` (MeResponse fields + `AvatarUpdate {preset_id: str}` +
`AvatarResponse {avatar_preset: str}`), `app/api/me.py` (PATCH /me/avatar; 422 detail
`"unknown_preset"`; sets profile.avatar_preset, returns new value).
Migration applied to the dev DB as part of the task (`uv run alembic upgrade head`).
Tests (`tests/test_identity.py`): /me includes avatar_preset='ninja' + equipped_frame=None for a
fresh registration; PATCH /me/avatar happy path persists + reflects in /me; unknown preset → 422
detail "unknown_preset"; auth required (401 without token).
Commit: `feat(identity): avatar preset + equipped frame columns, user_cosmetics, PATCH /me/avatar`.

## Task 2 — Frames in the Vault: catalog + requirement engine + kind-aware buy/equip

Files: `app/core/cosmetics.py` (frame entries per the locked table; verify world keys from the
campaign manifest first), `app/services/vault.py` (requirement engine reading
user_campaign_progress + manifest level counts; ownership rule change; buy writes UserCosmetic for
non-theme kinds with `frame_purchase` ledger reason; equip kind-aware incl. frame_none → NULL;
get_vault computes requirement status once per request, marks locked + equipped correctly for
frames), `app/schemas/vault.py` (EquipResponse two fields), `app/api/vault.py` (response wiring
only — error mapping unchanged).
Tests (extend `tests/test_vault.py`): buy bronze_ring spends ledger (`frame_purchase`/ref_key) and
grants user_cosmetics row; equip frame sets equipped_frame; equip frame_none clears it; gated frame
locked + buy → 403 requirement_not_met before world completion and buyable after (seed
user_campaign_progress rows for a full world); crowned_scholar not owned/locked until all worlds,
then implicitly owned + equippable, and buy → 409 already_owned; double-buy race parity with
themes; fairness invariant re-asserted for a frame purchase (rating/division/streak/standings
untouched); get_vault shape for a cold user (frame_none equipped, paid frames unowned, gated
locked).
Commit: `feat(vault): frame cosmetics with campaign-gated requirements`.

## Task 3 — Identity on field + standings APIs

Files: `app/services/contest.py` `window_field` (join Profile for avatar_preset/equipped_frame;
bots get a deterministic preset chosen from AVATAR_PRESETS via the existing per-bot rng,
equipped_frame None), `app/schemas/contest.py` (FieldEntry + StandingOut fields),
`app/api/contests.py` standings row construction.
Tests: field entries carry the creator's preset/frame after PATCH+equip; bot presets stable across
two reads of the same window; standings rows carry preset/frame.
Commit: `feat(api): identity fields on field + standings rows`.

## Task 4 — Frontend identity core + language selector relocation

Files: new `src/theme/identity.ts` (AVATAR_PRESETS 8 entries; FRAME_STYLES for all 11 frames —
name/blurb player-facing copy, ring/glow/ornament style tokens; prestige flag for crowned_scholar),
`src/screens/home/Avatar.tsx` (props `preset?: string`, `frame?: string | null`; defaults keep all
existing call sites rendering exactly as today: ninja + no frame; frame renders ring/glow/ornament
layers, ornament positioned like the Vault equipped-crown badge; decorative motion behind
reduced-motion), `src/api/client.ts` (Me += avatar_preset/equipped_frame; `setAvatar(presetId)`
PATCH /me/avatar; EquipVaultResponse += equipped_frame), `src/store/session.ts` Me type, new
`src/screens/home/AvatarPicker.tsx` (bottom sheet, preset grid, current highlighted, taps call
api.setAvatar and patch store from the SERVER response), `src/screens/home/ProfileMenu.tsx` (avatar
shows real identity; "Edit identity" row opens AvatarPicker; new language row hosting
`<LanguageSelector variant="inline" />`), `src/screens/home/HomeHeader.tsx` (remove inline
LanguageSelector; avatar button renders me's preset+frame), `src/screens/campaign/components/CampaignHero.tsx`
(remove inline selector), `src/app/App.tsx` (floating selector ONLY when status !== "authenticated"),
i18n `identity` section in en/es/tr (title, choose, edit, frames-related strings Task 5 needs can
land here too — keep key sets identical).
Tests: identity.ts copy guard (banned words over names/blurbs); Avatar render states (preset
emoji, frame ornament, default backward-compat); AvatarPicker flow test (jsdom — server response
patches store, picker calls PATCH once); i18n parity; a test pinning that HomeHeader markup has no
LanguageSelector and ProfileMenu has one.
Commit: `feat(identity): avatar presets, frames rendering, picker, language selector relocation`.

## Task 5 — Vault frames tab

Files: `src/screens/vault/VaultScreen.tsx` (Themes | Frames tabs — segmented control styled like
LeaderboardTabs; split items by kind; frames list uses FrameCard), new
`src/screens/vault/FrameCard.tsx` (reuses the VaultItemCard state machine/CTA patterns; preview =
big Avatar wearing the frame, using the player's current preset; locked cards show requirement copy
via i18n `vault.requireWorld` "Complete the {world} campaign" / `vault.requireAllWorlds`; spotlight
+ shortfall progress bar behaviors consistent with themes), equip flow patches BOTH
equipped_theme/equipped_frame from the new EquipResponse, i18n keys (en/es/tr).
Frame display names/blurbs come from FRAME_STYLES (identity.ts), prices ONLY from server items.
Tests: extend VaultScreen tests — tab split; frame card states (equipped/owned/locked/affordable/
shortfall); locked requirement copy; buy/equip flow for a frame (jsdom, server-authoritative
assertions same rigor as themes); copy guard sweep.
Commit: `feat(vault): frames tab with live avatar previews`.

## Task 6 — Identity on every surface

Files: `src/api/client.ts` (FieldEntry/StandingOut types += fields), `src/screens/leaderboard/
LeaderboardScreen.tsx` (map fields through), `LeaderboardRow.tsx` + `PodiumTopThree.tsx`
(LeaderboardRowData += avatar_preset/equipped_frame; Avatar gets real identity; podium frame
slightly oversized), `src/screens/results/RoyaleResultsModal.tsx` (identity moment: player's
avatar+frame above the placement card at the placement stage; MiniLeaderboard rows get presets),
ProfileMenu/HomeHeader already done in Task 4 — verify.
Tests: row/podium render preset+frame from data; results modal identity header; existing markup
pins updated without weakening behavioral assertions.
Commit: `feat(identity): leaderboard, podium and result-reveal identity`.

## Task 7 — Wow pass + full verification

Game-ui-design skill pass over AvatarPicker/FrameCard/reveal identity moment (unlock moments,
glow on next affordable frame, prestige frame feels special; GPU-cheap, reduced-motion). Full
verification: backend ruff/mypy/pytest, frontend typecheck/lint/vitest/build (no phaser chunk).
Fix anything found. Commit: `feat(identity): game-feel polish pass`.

Then: final whole-branch code review, then finishing-a-development-branch.
