# Onboarding conversion funnel

Lightweight internal analytics: `funnel_events` (append-only) via `POST /analytics/funnel`
(auth **optional** — top-of-funnel events fire before an account exists; a stale token degrades
to an anonymous row, never a 401). Frontend calls go through `src/lib/analytics.ts`
(`trackFunnel` / `trackFunnelOnce`) which can never throw into gameplay; a lost beacon is fine.
Event names are allowlisted on BOTH sides so the funnel stays queryable.

## Events

| Event | Fired from | Meaning |
|---|---|---|
| `intro_viewed` | BrainBoostIntro mount | a visitor saw the front door |
| `start_check_clicked` | intro CTA | tapped Start Check |
| `guest_created` | FirstRun after /auth/guest | anonymous account exists |
| `starter_check_completed` | FirstRun onFinished | finished the 8-question calibration |
| `profile_reveal_viewed` | BrainProfileReveal mount | saw their Brain Profile |
| `save_profile_clicked` | reveal CTA (`reveal`) / Home banner (`home_banner`) | opened the save screen |
| `upgrade_completed` | SaveProfileScreen success (source = reveal/home_banner/ranked_gate) | guest → saved account |
| `keep_playing_clicked` | reveal secondary CTA | skipped saving after the reveal |
| `ranked_save_gate_viewed` | RankedSaveGate mount | guest finished a ranked run, saw the gate |
| `ranked_save_completed` | RankedSaveGate save success | saved at the ranked gate |

### Acquisition (the public `/download` page)

`https://rotroyale.live/download` is the canonical external link (Instagram/Facebook/TikTok bios,
DMs, QR codes). Every row here is anonymous by nature — the page has no session and never creates a
guest — and `source`, when set, is only the coarse in-app-browser bucket
(`instagram` / `threads` / `facebook` / `messenger`). **Never a user agent.**

| Event | Fired from | Meaning |
|---|---|---|
| `download_page_view` | DownloadPage mount (once per load) | someone landed on /download |
| `download_cta_tap` | the App Store anchor | tapped Download |
| `download_meta_escape_attempt` | useAppDownload, inside the click | we intercepted a Meta in-app browser and fired a breakout |
| `download_meta_escape_signal` | escape controller | the page backgrounded → the breakout probably worked |
| `download_fallback_shown` | escape controller timeout (~1.5s) | breakout produced no signal; the manual dialog opened |
| `download_retry_tap` | fallback dialog primary action | retried the breakout by hand |
| `download_link_copied` | fallback dialog copy action | copied the raw App Store URL |

Breakout success rate per app:
`download_meta_escape_signal` ÷ `download_meta_escape_attempt`, grouped by `source`. A rising
`download_fallback_shown` share for one app means Meta changed that WebView's behavior — the schemes
all live in `frontend/src/lib/downloadBrowser.ts`.

## The funnel we care about

1. visitor → starts check: `intro_viewed → start_check_clicked`
2. starts check → completes starter: `start_check_clicked → starter_check_completed`
3. completes starter → views reveal: `starter_check_completed → profile_reveal_viewed`
4. views reveal → saves profile: `profile_reveal_viewed → upgrade_completed (source='reveal')`
5. guest home return → saves profile: `upgrade_completed (source='home_banner')`
6. guest ranked gate → saves profile: `ranked_save_gate_viewed → ranked_save_completed`

## Queries

Daily step counts (event volume, last 14 days):

```sql
SELECT created_at::date AS day, event, count(*)
FROM funnel_events
WHERE created_at > now() - interval '14 days'
GROUP BY 1, 2
ORDER BY 1, 2;
```

Reveal → save conversion by day:

```sql
SELECT day,
       reveals,
       saves,
       round(100.0 * saves / nullif(reveals, 0), 1) AS pct
FROM (
  SELECT created_at::date AS day,
         count(*) FILTER (WHERE event = 'profile_reveal_viewed') AS reveals,
         count(*) FILTER (WHERE event = 'upgrade_completed' AND source = 'reveal') AS saves
  FROM funnel_events GROUP BY 1
) f ORDER BY day;
```

Ranked gate effectiveness:

```sql
SELECT count(*) FILTER (WHERE event = 'ranked_save_gate_viewed') AS gate_views,
       count(*) FILTER (WHERE event = 'ranked_save_completed') AS gate_saves
FROM funnel_events
WHERE created_at > now() - interval '30 days';
```

Caveats: top-of-funnel rows (intro/start) are anonymous (user_id NULL) so step-to-step joins are
volume-based, not per-user, until `guest_created`; per-user funnels work from there via user_id.
Counts are client-beaconed (best-effort) — treat as directional, not billing-grade.
