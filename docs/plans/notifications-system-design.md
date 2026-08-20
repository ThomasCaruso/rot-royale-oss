# Rot Royale — Notification System Design

**Status:** Design / plan (approved 2026-07-25). Not yet implemented.
**Principle:** *Less is more.* Every push must pass one test — **"Will the player be glad they got this?"** If it's not clearly yes, we don't send it.

---

## 1. Why this doc

The push engine already works (web VAPID + iOS APNs transports, exactly-once gates, dead-token
pruning). But we send notifications with **no global frequency cap, no quiet hours, no permission
priming, no user preferences, and English-only copy** — the exact conditions that turn a valuable
channel into spam. This doc defines the notifications we'll send and the guardrails that keep them
feeling earned, not noisy.

### Research this is grounded in

- Notifications lift retention hugely **when relevant** (weekly-notified users retain ~440% better,
  daily ~820% vs none) — but **2–5 generic pushes/week makes 40%+ of users disable push**, and
  **~52% of users who disable push eventually churn** ([Localytics via Business of Apps][bofa],
  [Userpilot][userpilot]). The opt-in is a one-way resource; protect it.
- Sweet spot is **~2–4 pushes/week**; the revolt threshold is a few/day ([Business of Apps][bofa]).
- **Permission priming (a soft pre-prompt after a value moment) lifts opt-in 2–3×.** iOS cold opt-in
  is only ~44–54% ([Pushwoosh][pushwoosh], [Braze push primer][braze-primer]). Firing the OS prompt
  on first launch is the single biggest mistake.
- **iOS provisional authorization** delivers quietly to Notification Center with *no system prompt*,
  letting us prove value first and upgrade willing users later ([Braze provisional][braze-prov]).
- Trigger on **in-game behavior, timed to the player** — never calendar blasts at bad hours
  ([GameAnalytics][ga], [Braze][braze-bp]).

---

## 2. Current state (what exists today)

| Notification | Trigger | Scope | Timing | Gate |
|---|---|---|---|---|
| Window open | New OPEN window | **Broadcast, everyone** | **~12 AM ET** | `window_notifications` |
| Daily reminder | Haven't played today | Targeted, unplayed | Evening (≥8 PM ET) | `user_notifications` `daily_reminder` |
| Streak saved | Weekly grace fired | Targeted | **~12:15 AM ET** | `user_notifications` `streak_saved` |
| Friend challenge | Friend taps "Challenge" | Directed | On action | `user_notifications` `challenged` |

Engine: `backend/app/services/push.py` (notifiers + transports), `backend/app/api/push.py`
(subscribe/unsubscribe), `backend/app/models/push.py` (`PushSubscription`, `UserNotification`,
`WindowNotification`), heartbeat in `backend/app/jobs/`. Frontend: `frontend/src/lib/push.ts`,
`ProfileMenu.tsx` reminders toggle, `NotifyBell.tsx`.

**Problems baked into the current set:** window-open is a **daily midnight blast to everyone**;
streak-saved fires **in the middle of the night**; nothing caps the total per day (a user can get all
four); copy is **hardcoded English**; every push deep-links to `/`.

---

## 3. The frequency governor (the core guardrail)

A single choke-point every send routes through. Nothing sends without passing it.

```
can_send(user, kind, now) -> bool
  1. category enabled?        # user preference for this kind's category (§5)
  2. within quiet hours?      # block ~9 PM–8 AM in the user's tz (fallback ET); defer, don't drop
  3. under the daily cap?     # ≤ 1 AUTOMATED push/user/day (see budget below)
  4. per-kind once-a-day gate # the existing user_notifications claim
```

**Daily budget (approved: strict).**
- **Automated / scheduled** notifications (reminder, streak-saved, result recap, milestone,
  win-back): **at most 1 per user per ET day**, chosen by priority when several qualify.
- **User-initiated / directed** social (a friend *challenged* you, a friend *beat your score*):
  these are inherently welcome, so they get a **small separate allowance** — max **2/day** — but the
  **combined ceiling is 3 pushes/user/day**, hard.
- **Priority order** when the single automated slot is contested:
  `result recap > streak-saved > milestone > daily reminder > win-back`.

**Quiet hours.** No sends ~9 PM–8 AM local. Requires a stored per-user timezone (we don't have one —
§7). Until we do, fall back to ET and bias sends to safe hours. Night-time triggers (streak-saved at
12:15 AM) are **queued to the next morning**, not sent at night.

**Implementation.** New module `services/notify_governor.py` exposing `can_send()` +
`record_send()`, plus a `notification_log` table (`user_id, sent_date, kind, category, created_at`)
that backs both the daily cap count and lightweight analytics (§8). Every notifier calls the governor
instead of claiming its per-kind gate directly.

---

## 4. Permission & opt-in strategy

The biggest untapped lever. Three coordinated pieces:

1. **Soft pre-prompt after a value moment — not on launch.** The moment is **the first Rot Report**
   (right after a player finishes their first Daily Royale and sees their score — peak positive
   emotion). Show a one-card primer: *"Want a heads-up so you never miss a Daily Royale or a friend
   beating your score?"* → **Enable** / **Not now**. Only if they tap Enable do we trigger the OS
   prompt. This alone is projected to 2–3× opt-in.
2. **iOS provisional authorization.** On native iOS, register with **provisional** auth so
   notifications land quietly in Notification Center from session one with **no system prompt**. The
   soft primer above then converts provisional → full (banners + sound) for engaged players. Nothing
   to fail; we start proving value immediately.
3. **Preference center as the upgrade path.** A settings surface (§5) that also exposes a
   programmatic "turn on alerts" for anyone who dismissed the primer.

Frontend touchpoints: `lib/push.ts` (add provisional path + a `primeSoftPrompt()` gate), a new
`FirstRunNotifyPrimer` card wired into the Rot Report flow, `ProfileMenu`/`NotifyBell` unchanged as
the always-available manual entry.

---

## 5. Notification catalog (the plan — deliberately tight)

Grouped into **three user-facing categories** the preference center can toggle independently:
**Reminders**, **Social**, **Results**. Copy shown is the intent; final copy gets localized (§7) and
copy-guarded (DESIGN §7 — no cash/gambling framing).

### Category: Reminders (the daily habit)
| Notification | Trigger | Timing | Deep-link | Status |
|---|---|---|---|---|
| **Daily drop (Rot Check)** | New daily is live **and** you haven't played it | Once/day at a good hour (default late-morning; user-settable later) | Today's Rot Check | 🔨 reframe existing |
| **Streak saved** | Weekly grace rescued your streak | **Next morning** (retimed off 12:15 AM) | Home / streak | ✅ built — **retime** |

**The daily drop is the anchor notification and it is NOT a streak nag** — it's the Wordle-style
"the new one is out" ping people actively *want*, riding the app's existing **Rot Check** branding
(the daily brain check; `HubTiles.tsx`). It's the fresh-game announcement, targeted only to players
who haven't played today (once you play, no ping), once per day, framed with delight.

*Copy (primary, anticipatory):* *"Today's Rot Check is live 🧠 — how bad is your brainrot?"* /
*"Fresh Rot Check just dropped. Check your brainrot before midnight."*
*Copy (secondary, only when they hold a streak and it's late in the day):* *"Your {n}-day streak's on
the line — today's Rot Check closes at midnight."* Streak urgency is a **flavor** layered on for
streak-holders, never the default frame.

*Streak-saved copy:* *"Your {n}-day streak survived — that was your free save this week."*

> This anchor replaces the purpose of the old midnight window-open blast: one well-timed, on-brand,
> targeted daily drop instead of a midnight broadcast to everyone.

### Category: Social (feels personal — the highest-welcome tier)
| Notification | Trigger | Timing | Deep-link | Status |
|---|---|---|---|---|
| **A friend beat your score** | A friend posts a higher Daily Royale score than yours today | On event (directed allowance) | Friends-today board | 🔨 new |
| **A friend challenged you** | Friend taps "Challenge" | On action | Today's Royale | ✅ built |

*Copy:* *"Maya just beat your 742 — reclaim it?"* / *"{friend} challenged you! Beat their score?"*
Both are directed and inherently wanted, so they draw on the directed allowance (max 2/day),
de-duped so ten friends beating you ≠ ten pushes (one digest: *"3 friends passed your score today"*).

### Category: Results (earned / rewarding)
| Notification | Trigger | Timing | Deep-link | Status |
|---|---|---|---|---|
| **Your result is in** | Daily Royale settled | **Next morning** (not the 12:15 AM settle) | Standings | 🔨 new |
| **Milestone** | Division promotion or a notable badge — **real milestones only** | On event | Growth/profile | 🔨 new (later) |

*Copy:* *"You finished #3 of 128 today (+18 rating)."* / *"You reached the Gold division."* Never
fire on every micro-level — only genuine achievements.

### Category: Win-back (dormant only — Phase 3, hard-capped)
| Notification | Trigger | Cap |
|---|---|---|
| **Cold streak** | ~3–7 days inactive | Once per lapse, then exponential back-off |

*Copy:* *"Your streak's gone cold — your friends are pulling ahead."* This is the one segmented,
lifecycle-triggered message; it must never nag.

### Cut
- **Window-open midnight broadcast — removed.** It's a daily blast to everyone at the worst hour. The
  targeted evening reminder already drives daily play, better-timed and only to people who haven't
  played. Deleting it is the single biggest "less is more" win. (`notify_open_windows` +
  `window_notifications` retired; the daemon step is dropped.)

---

## 6. Deep-link routing

Payloads carry a typed `url` the client routes on tap (web via a service-worker `notificationclick`
handler — currently missing; native via the existing push-tap listener):
`reminder`/`challenge` → today's Royale · `friend-beat` → Friends-today board · `result` → standings
· `milestone` → Growth. No more blanket `/`.

---

## 7. Localization of push copy

Push copy is **hardcoded English in `push.py`** while the app is EN/ES/TR. To localize server-sent
push we need the **recipient's language**, which we don't store today.

- Add `locale` to `Profile` (or `User`), set from the client on login/language change (migration +
  a tiny `PATCH /me/locale`).
- Move push copy into a small server-side message catalog keyed by `(kind, locale)` with `{token}`
  interpolation, mirroring the honesty/copy-guard rules. Fallback to English when a locale is missing.

---

## 8. Analytics (lightweight)

The `notification_log` from §3 doubles as analytics: rows record `kind`, `category`, `sent_date`. Add
an **open** signal by tagging each push `url` with a `?n=<kind>` param the client reports on launch.
That's enough to see per-kind send/open rates and tune — without a heavy analytics dependency.

---

## 9. Phasing

**Phase 1 — Make the current system safe & valued (the "get ready" work).**
1. Frequency governor: `can_send()` + `notification_log` + daily cap + quiet hours.
2. Retime streak-saved to the morning; **cut** the midnight window-open blast.
3. Localize the existing copy (add `Profile.locale` + message catalog).
4. Permission priming: soft pre-prompt on the first Rot Report + iOS provisional auth.
5. Web service-worker `notificationclick` handler + per-kind deep-link routing.

**Phase 2 — High-value additions.**
6. "A friend beat your score" (with digest de-dup).
7. "Your result is in" morning recap.

**Phase 3 — Depth.**
8. Preference center (Reminders / Social / Results toggles) + backend prefs model.
9. Milestones, win-back segmentation, richer analytics, badge counts, Android FCM.

---

## 10. Non-goals (for now)

- Android FCM transport (no Android build shipping yet).
- A/B copy testing framework.
- Marketing/promotional pushes (this is a habit/social product; promo blasts are explicitly out).
- Rich media / images in notifications.

---

## Sources

- [Business of Apps — Push Notification Statistics][bofa]
- [Userpilot — Push Notification Best Practices to Reduce Churn][userpilot]
- [Pushwoosh — Increase Push Notification Opt-In][pushwoosh]
- [Braze — What's a Push Primer][braze-primer]
- [Braze — Mastering Provisional Push][braze-prov]
- [Braze — Push Notification Best Practices][braze-bp]
- [GameAnalytics — Push Notification Best Practices for Mobile Games][ga]

[bofa]: https://www.businessofapps.com/marketplace/push-notifications/research/push-notifications-statistics/
[userpilot]: https://userpilot.com/blog/push-notification-best-practices/
[pushwoosh]: https://www.pushwoosh.com/blog/increase-push-notifications-opt-in/
[braze-primer]: https://www.braze.com/resources/articles/whats-a-push-primer
[braze-prov]: https://www.braze.com/resources/articles/mastering-provisional-push
[braze-bp]: https://www.braze.com/resources/articles/push-notifications-best-practices
[ga]: https://www.gameanalytics.com/blog/learn-push-notifications-best-practices
