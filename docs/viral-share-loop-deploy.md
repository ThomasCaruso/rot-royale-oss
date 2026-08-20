# Viral share loop — go-live checklist

The Wordle-style share loop (PLAY the daily → shareable `…/c/<id>` link → friend lands, sees the
result, plays today's Daily Royale as a guest with no signup → converts). Code is fully built +
tested + verified locally. To make the link work for anyone on the public web, set these env vars on
Render and redeploy.

Live web app: **https://rot-royale-web.onrender.com** · API: **https://rot-royale-api.onrender.com**

## 1. Deploy the branch

`feat/viral-share-loop` must reach whatever branch Render builds (usually `main`). Deploying rebuilds
BOTH the API (challenge routes + migration + Pillow) and the web SPA (challenge landing + guest play).
The migration (`f5a6b7c8d9e0_challenges`) and `pillow` install run automatically — the API start
command already runs `alembic upgrade head`, and `uv sync` installs Pillow.

## 2. Backend env (`rot-royale-api`) — now pre-wired in `render.yaml`

These three are set in `render.yaml`, so a Blueprint deploy applies them automatically (no dashboard
step needed unless you override them there):

| Var | Value |
|-----|-------|
| `CORS_ORIGINS` | `https://rot-royale-web.onrender.com` (was unset — required so the web's guest calls pass CORS) |
| `WEB_BASE_URL` | `https://rot-royale-web.onrender.com` (where `/c/<id>` redirects a human to play) |
| `CHALLENGE_BASE_URL` | `https://rot-royale-api.onrender.com` (the origin embedded in the share link + OG tags) |

> If Render is NOT reading `render.yaml` (services created manually), set the same three in the
> `rot-royale-api` dashboard → Environment, then redeploy.

Custom domain later (e.g. `rotroyale.live`): add it to the `rot-royale-web` static site + DNS, then
change all three values to the new origin (and keep `CHALLENGE_BASE_URL` on whatever domain serves
`/c/<id>` — the API).

## 3. Share link shape

With `CHALLENGE_BASE_URL` = the API, shared links are:

```
https://rot-royale-api.onrender.com/c/<id>
```

A crawler (iMessage/WhatsApp/X/Discord/Slack) reads the OG/Twitter meta + the dynamic
`…/c/<id>/og.png` result card; a human is redirected to `https://rot-royale-web.onrender.com/?c=<id>` → the challenge
landing → guest play. (If you later want the prettier `https://rotroyale.live/c/<id>`, set
`CHALLENGE_BASE_URL=https://rotroyale.live` and add a rewrite so `/c/*` on the web host proxies to the
API — optional; the API-served links work today.)

## 4. Verify on the public URL (incognito, no app installed)

1. Finish a Daily Royale in the deployed web app → tap **Share** → you get a real
   `https://rot-royale-api.onrender.com/c/<id>` link.
2. Paste that link into iMessage / Slack / X → confirm it **unfurls** with the result card image.
3. Open the link in an **incognito** browser with no app installed → it redirects to the landing
   ("<name> · <score> · Top X% today · Can you beat it?") → tap **Play today's Daily Royale** → you're
   a guest playing today's daily with no signup → finish → get your own result + a save-your-streak
   prompt → share → loop.

## Ranked integrity (already enforced — no action needed)

Settlement (`services/settlement.py`) filters `User.status == GUEST_STATUS`, so guest scores **never**
enter the official standings/rating/streak/gems. A guest's run is "unofficial" and vanishes at settle
time unless they upgrade (`/auth/upgrade`, the save-your-streak prompt) before 12:15 AM ET. Guests
never receive answers client-side; the anti-cheat model is unchanged. `POST /auth/guest` is per-IP
rate-limited to blunt bulk account minting.
