# Rot Check — Anonymous-First Onboarding + Daily Brain Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New users open the app and play a Starter Check immediately (no signup wall), get a Rot Profile reveal (strengths, weak spots, Rot Type, Rot Score), and are then invited to *save* their profile; Home becomes a daily brain dashboard led by "Today's Rot Check".

**Architecture:** Guest users are REAL users (`POST /auth/guest` → User+Profile with auto-username + unusable password + `status="guest"`), so every existing endpoint (practice, events, personalization, vault) works anonymously and **upgrade-in-place** (`POST /auth/upgrade` sets email+password, flips status to active) makes progress-merge a non-event — same user row, nothing to migrate. Rot Check = the existing quick-play template reframed; the Starter Check adds a `starter_8` template drawing from a balanced per-category calibration bank. A new `rot_check` service computes the reveal (per-category performance, Rot Type, clamped 300–900 Rot Score, movement vs the previous check) from stored round results — **no LLM, no new gameplay writes**.

**Tech stack:** existing — FastAPI/SQLAlchemy/Alembic, Vite/React/TS, Zustand session store, typed i18n (en/es/tr), Capacitor Preferences.

**Constraints honored:** no LLM in gameplay; ranked personalization gate untouched; existing modes/routes intact; honesty copy rules (no fabricated counts, no casino words); i18n-typed copy in all three locales; no commits (user's rule).

---

## Locked decisions

1. **Guest = real user.** Email `guest-<hex>@guest.invalid`, username `rot_<hex6>` (collision-retried), argon2 hash of a random 32-byte secret, `status="guest"`. `/me` gains `is_guest`. Refresh-token persistence (already built) keeps the guest signed in across restarts; 30-day TTL is the natural "save your profile" pressure.
2. **Upgrade-in-place, not merge.** `POST /auth/upgrade {email, password}` → 409 if email taken, 409 if not a guest. Username stays auto-generated (editable later is a follow-up; identity editor doesn't edit usernames today). Fresh TokenResponse returned. Login/register/refresh untouched.
3. **`entries.mode`** nullable String(16) column (migration `bb22cc33dd44`, down `aa11bb22cc33`) set by `start_practice` ("practice"/"quick"/"category"/"starter"). Legacy rows stay null. "Today's check" = latest SUBMITTED entry with mode in ("quick","starter") on today's ET date.
4. **Starter Check** = `STARTER_CHECK` template (`starter_8`: trivia ×8 — easy×3, medium×4, hard×1) + `_calibration_bank(bank, seed)`: seeded round-robin across categories (≤6 per category) so the 8 draws spread. Personalization skipped for starter (cold start is a no-op anyway, but explicit `mode="starter"` isn't in SAFE_MODES... it should be — add "starter" to SAFE_MODES for consistency; the cold-start gate makes it a pass-through on first run regardless).
5. **Rot Check summary** (`app/services/rot_check.py`): per-category {correct,total,accuracy,avg_time_frac} from RoundResult+RoundAnswer(question_id)+Question; strengths = top ≤3 categories (min 1 answered), weaknesses = bottom ≤2; `rot_score = clamp(300 + 400*accuracy + 120*avg_time_frac + 15*best_streak + 5*hard_corrects, 300, 900)`; Rot Type = deterministic map from top category (Money & Business→Market Menace, Sports→Sports Demon, History→History Menace, Geography→Geography Ghost, Science & Nature→Space Goblin, Arts & Literature→Culture Killer, Pop Culture & Entertainment→Meme Scholar, fallback→Internet Scholar; overall accuracy <0.375 → Money Rookie). Weak-spot topic = most common AI-metadata topic among missed questions (null when unclassified — graceful fallback). Movements = per-category accuracy delta ×10 (rounded) vs previous check entry; `first_check=true` when none.
6. **Endpoints** `app/api/rot_check.py` (`/rot-check`): `GET /rot-check/{entry_id}/summary` (own submitted practice entry) and `GET /rot-check/today` → `{completed_today, has_any_check, today: Summary|null, latest: Summary|null}`.
7. **"Money & Business"** added to CANONICAL_CATEGORIES (+💰 icon backend & CategorySelect); the two locked-category tests updated to seven. Seed bank `content/bank/money_business.json` (~24 scenario-style questions across Money Basics / Investing / Business / World Economy / Scams — literacy, not advice; ingest-validated by a test but NOT auto-ingested).
8. **Frontend flow** (state-routed in App.tsx):
   - `anonymous` → `FirstRun` (intro step; "Log in" link → existing AuthScreen).
   - `authenticated && me.is_guest && !starterDone(Preferences)` → `FirstRun` at check step (guest created on "Start Check": `startGuest()` → establish tokens → Practice `mode="starter"` → `RotProfileReveal` → `SaveProfileScreen` or Keep Playing → mark starterDone).
   - guests past first-run see a slim "Save your Brain Profile" banner on Home → SaveProfileScreen.
   - Existing authenticated users bypass everything (is_guest false).
9. **Home reframe (surgical):** insert `RotCheckCard` (primary daily CTA; done-state shows Rot Score, movement chips, weak spot + Train Weak Spot → category practice) and `BrainProfileCard` (category bars from latest summary) above the existing hero in both arcade and mono branches; HeroCard/DuelCard/HubTiles/BottomNav untouched. Visual: GlassCard + tokens, restrained (one gold CTA, no extra glows).
10. **Practice extension:** props `mode?: "quick" | "starter"`, optional `onFinished(entryId)` (replaces the built-in result view — used by FirstRun to route to the reveal). Client `startPractice` accepts "starter".

## Files

Backend — modify: `app/api/auth.py`, `app/schemas/auth.py`, `app/services/registration.py`, `app/api/me.py`(+schema `is_guest`), `app/services/practice.py`, `app/services/templates.py`, `app/services/personalization.py` (SAFE_MODES), `app/models/contest.py` (mode col), `app/main.py`, `content/categories.py`, `tests/test_canonical_categories.py`.
Backend — create: `alembic/versions/bb22cc33dd44_entries_mode.py`, `app/services/rot_check.py`, `app/schemas/rot_check.py`, `app/api/rot_check.py`, `content/bank/money_business.json`, `tests/test_guest_auth.py`, `tests/test_rot_check.py`.
Frontend — modify: `src/api/client.ts`, `src/api/session.ts`, `src/store/session.ts` (Me.is_guest passthrough — Me type in client), `src/app/App.tsx`, `src/screens/Practice.tsx`, `src/screens/AuthScreen.tsx` (copy/polish), `src/screens/Home.tsx`, `src/screens/CategorySelect.tsx` (icon), `src/i18n/{en,es,tr}.ts`.
Frontend — create: `src/lib/firstRun.ts`, `src/screens/rotcheck/RotCheckIntro.tsx`, `src/screens/rotcheck/RotProfileReveal.tsx`, `src/screens/rotcheck/SaveProfileScreen.tsx`, `src/screens/rotcheck/FirstRun.tsx`, `src/screens/home/RotCheckCard.tsx`, `src/screens/home/BrainProfileCard.tsx`, tests for intro/reveal/save/RotCheckCard/firstRun routing.
Docs: extend `docs/personalization.md` or new `docs/rot-check.md`.

## Tasks (condensed execution order)

1. Backend guest+upgrade (+`is_guest` in /me) + tests → run.
2. Migration `entries.mode` + starter template + calibration bank + practice wiring + tests → run.
3. rot_check service + schemas + API + tests → run.
4. Money & Business category + icon + test updates + seed bank + seed-validation test → run.
5. Backend full verify (ruff/mypy/pytest).
6. Frontend client/session/firstRun lib.
7. FirstRun screens (intro/reveal/save) + Practice extension.
8. App.tsx routing + AuthScreen copy + i18n ×3.
9. Home RotCheckCard + BrainProfileCard + CategorySelect icon.
10. Frontend tests + full verify (typecheck/lint/vitest/build).
11. Docs + final report.

Self-review: spec coverage — no-signup flow (T1,6-8), starter check (T2), reveal w/ Rot Type+Score (T3,7), save-profile framing (T7,8), home dashboard (T9), finance content (T4), fairness untouched (no ranked changes; SAFE_MODES addition only affects practice-family), no LLM in gameplay (rot_check reads stored rows only). Not doing: Apple/Google/magic link (no infra — honest email+password styled as "save"), username editing, campaign world for money, mono-specific bespoke layouts beyond token-driven cards.
