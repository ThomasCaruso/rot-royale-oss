# Ranked Save Gate + Funnel Analytics + Home Card Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** Guests can PLAY ranked, but leaderboard permanence (standings, rating, streak, gems at settlement) requires a saved profile; a positive "save your earned score" gate appears when a guest finishes a ranked run. A lightweight funnel-analytics layer (backend table + fire-and-forget wrapper) instruments the onboarding conversion path. Plus two Home fixes: RotCheckCard adopts the premium hub-card language (no more plain container) and the Vault card is removed from the hub (Vault stays in BottomNav + header coins pill).

**Architecture:** Settlement is the single permanence point — `settle_window` simply excludes entries whose user is still a guest at settle time (upgrade before 12:15 AM ET ⇒ included; the copy "save it before it disappears" is literally true). Entry/play/answer paths are untouched, so guests preview the full ranked flow, appear in the live field, and lose nothing else. Analytics = append-only `funnel_events` table + `POST /analytics/funnel` (auth OPTIONAL — pre-signup events exist) + `src/lib/analytics.ts` wrapper that can never throw into gameplay.

## Locked decisions
1. `GUEST_STATUS` moves to `app/models/user.py` (natural home; settlement/me/registration all import it from there).
2. Settlement filter: entries query joins `User` and keeps `status != GUEST_STATUS`. Guest entries stay SUBMITTED in the SETTLED window (harmless; no Standing → shows unplaced in history). Field-size at settlement counts saved players + bots only. No retroactive inclusion after settle (documented).
3. Live previews unchanged: `enter`, per-round answer, `windowField`, Rot Report all work for guests (honesty: they ARE real entries while the window is live).
4. Funnel events (allowlist, server-validated): intro_viewed, start_check_clicked, guest_created, starter_check_completed, profile_reveal_viewed, save_profile_clicked, upgrade_completed, keep_playing_clicked, ranked_save_gate_viewed, ranked_save_completed. Row: id, user_id (nullable FK SET NULL), event (indexed), source (≤24, nullable), created_at. Migration `cc33dd44ee55` (down `bb22cc33dd44`).
5. Frontend wrapper `trackFunnel(event, source?)` + `trackFunnelOnce` (session-dedup for mount events / StrictMode). Transport = one raw `fetch` beacon (optional bearer, `keepalive`, no refresh dance, no retry) exported from client.ts; wrapper swallows everything, `console.debug`s in dev.
6. Gate UX: `RankedSaveGate` = SaveProfileScreen with override copy ("Your score is ready" / "Save your profile to lock in your rank — keep your Rot Score, streak, and leaderboard spot.") + "Later" skip → the normal Rot Report. Shown in Contest.tsx at `phase === "finished"` when `me.is_guest`, once per run. No hostile copy anywhere.
7. SaveProfileScreen gains `title`/`subtitle`/`source` props + email autofocus; emits `upgrade_completed {source}` on success.
8. Home fixes: RotCheckCard restyled with the hub-tile card language (amber-accent gradient panel, rim ring, top sheen — no GlassCard); HubTiles → single full-width Campaign tile (vault tile deleted, `onVault` prop dropped); mono hub list drops the vault row.

## Files
Backend — modify: `models/user.py`, `services/registration.py`, `api/me.py`, `services/settlement.py`, `api/deps.py` (get_optional_user), `models/__init__.py`, `main.py`. Create: `models/analytics.py`, `schemas/analytics.py`, `api/analytics.py`, `alembic/versions/cc33dd44ee55_funnel_events.py`, `tests/test_ranked_guest_gate.py`, `tests/test_funnel_analytics.py`.
Frontend — modify: `api/client.ts` (beacon), `screens/rotcheck/{SaveProfileScreen,RotCheckIntro,RotProfileReveal,FirstRun}.tsx` (props + events), `screens/Contest.tsx` (gate), `screens/Home.tsx` (banner event, HubTiles call, mono rows), `screens/home/{RotCheckCard,HubTiles}.tsx`, `i18n/{en,es,tr}.ts`. Create: `lib/analytics.ts` (+test), `screens/rotcheck/RankedSaveGate.tsx` (+test).
Docs — create `docs/analytics-funnel.md`, `docs/deploy-checklist.md`; update `docs/rot-check.md`.

## Tests
Backend: guest plays ranked (enter+answer ok) but settlement writes NO standing/rating/streak/gems for them; upgraded-before-settle guest IS ranked + rated; mixed field ranks only saved players; existing settlement suite unchanged; starter/practice guest tests keep passing; funnel endpoint: anonymous 202 + stored null user, authed 202 + user id, unknown event 422.
Frontend: analytics wrapper (fires beacon, swallows rejection, once-dedup); RankedSaveGate (copy, save→ranked_save_completed, Later skips); SaveProfileScreen source event; existing suites green.

## Verify
Backend: ruff + format + mypy + pytest. Frontend: eslint + tsc + vitest + build. Docs written. No commits (repo rule).
