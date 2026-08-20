# iOS App Store prep — status & runbook

This documents how far the repo is prepared for an iOS App Store / TestFlight build, what is ready on
Windows, and the exact steps that still require a **Mac with Xcode**.

> The app is a Vite + React SPA wrapped with **Capacitor**. The native iOS project is generated on a
> Mac and is intentionally NOT in this repo yet (`ios/` is created by `npx cap add ios`).

---

## ✅ What has been prepared (Windows-ready)

- **Capacitor config** — `frontend/capacitor.config.ts`
  - `appId: live.rotroyale.app`
  - `appName: Rot Royale`
  - `webDir: dist`
  - **No** `server.url`, **no** localhost/127.0.0.1 → production-safe (loads the bundled web build).
- **Capacitor packages installed & version-aligned** (see `frontend/package.json`):
  | Package | Version |
  | --- | --- |
  | `@capacitor/core` | `6.2.1` |
  | `@capacitor/ios` | `6.2.1` |
  | `@capacitor/cli` | `6.2.1` |
  | `@capacitor/preferences` | `^6.0.4` (already used for the refresh token) |
- **Production API base is committed** — `frontend/.env.production` sets
  `VITE_API_BASE=https://rot-royale-api.onrender.com`, so `npm run build` bakes the live backend into
  the bundle (verified live: `/health` → `200 {"status":"ok","db":"ok"}`). See "Production API" below.
- **Mobile WebView audit done** — no `100vh` (uses `100dvh`), safe-area insets handled, no external
  link traps, no plain-HTTP (ATS-unsafe) resources. See "WebView audit" below.
- **Resources placeholder** — `frontend/resources/README.md` documents the source icon/splash needed.
- **Frontend gates green** — `typecheck`, `lint`, `test` (469), `build`.

## 🔒 Production API resolution (important)

- API base is resolved in **`frontend/src/api/client.ts`**:
  `const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";`
- It is **baked in at build time** by Vite (not read at runtime). The value depends on which env file
  is present for the build mode:
  - `npm run dev` (development) → `frontend/.env.local` → `http://localhost:8001` (local only).
  - `npm run build` (production) → `frontend/.env.production` → `https://rot-royale-api.onrender.com`.
  - If **no** env file sets it → falls back to `http://localhost:8000` (would break on a device).
- **Will the production iOS build call the live backend? YES** — as long as the build is run from this
  repo (so `.env.production` is present). `.env.local` is gitignored and does not exist on a fresh Mac
  checkout, and even if it did, the production-mode `.env.production` takes precedence.
- **CORS for the native app is handled in code.** The Capacitor iOS WebView serves the app from
  `capacitor://localhost`; the backend always allows that origin via `NATIVE_APP_ORIGINS`
  (`backend/app/core/config.py`), so **no Render env change is needed for it**. The web frontend
  origin(s) still come from the backend's `CORS_ORIGINS` env var (keep it set to e.g.
  `https://rotroyale.live`, no localhost in prod).

## 🖥️ What still requires Mac + Xcode (cannot be done on Windows)

Generating the native project, building, archiving, signing, and uploading are all macOS/Xcode-only:

```bash
# On a Mac, from the repo:
cd rot-royale/frontend
npm install
npm run build          # produces dist/ with the prod API baked in (.env.production)
npx cap add ios        # generates the native ios/ project (first time only)
npx cap sync ios        # copies the web build + plugins into the iOS project
npx cap open ios        # opens the project in Xcode
```

Then **in Xcode** (not scripted):
- Set the Development Team / signing certificate & provisioning profile.
- Set the marketing version & build number.
- **Archive** (Product → Archive) and **upload to App Store Connect / TestFlight**.

## 📋 Still remaining (mostly account/store, not code)

- Apple Developer Program membership (paid).
- App Store Connect app record for `live.rotroyale.app`.
- Signing: certificates + provisioning profiles (managed signing is fine to start).
- **App icon** (1024×1024) and **splash screen** source art — see `frontend/resources/README.md`;
  generate the iOS asset catalog later (Mac, or `@capacitor/assets` tooling).
- App Store screenshots (per device size).
- **Privacy policy URL**, **Terms of Service URL**, **Support URL** (App Store Connect requires them).
- App Privacy ("nutrition label") answers — declare data collected (account email/username, etc.).
- Age rating, category, description, keywords, promotional text.
- Push notifications: currently web-push feature-detection only (`src/lib/push.ts`); **native** push
  via Capacitor is a separate future task (M7) and needs APNs setup if enabled.

## 🔎 WebView audit findings

| Check | Result |
| --- | --- |
| `localhost` / `127.0.0.1` / `:8000` / `:8001` in `src` | Only the dev fallback in `client.ts`; handled by `.env.production`. |
| `100vh` (iOS WebView height bug) | None — app uses `100dvh` (11 files) + safe-area insets (20 files). |
| External link traps (`window.open`, `target="_blank"`, external `href`) | None. |
| Non-HTTPS resources (iOS App Transport Security) | None — only `https://fonts.googleapis.com` (fonts). |
| Token storage | `@capacitor/preferences` (native on iOS); non-critical prefs use localStorage (works in WKWebView). |

Notes (not blockers): fonts load from the Google Fonts CDN over HTTPS — fine for ATS, but could be
self-hosted later to remove a network dependency / privacy consideration.
