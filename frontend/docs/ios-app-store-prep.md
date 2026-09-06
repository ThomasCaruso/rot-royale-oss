# iOS App Store — release runbook

> **Rewritten 2026-08-28.** The previous version of this file said the native project was "not in
> this repo yet" and that native push was "a future task (M7)". Both had been false for a long time:
> `frontend/ios/` is committed, and iOS push is implemented and documented in CLAUDE.md §7b2b. It
> also quoted a test count from three hundred tests ago. A runbook that is wrong about what exists
> is worse than none, because it gets followed — check the claims below against the code before
> relying on any of them.

Listing copy, App Privacy answers and screenshot sizes live in **`docs/store-listing.md`**.

---

## What is in the repo and verified

| Area | State |
|---|---|
| Native project | `frontend/ios/` committed (Capacitor 6.2.1) |
| Bundle ID | `live.rotroyale.app` — matches `capacitor.config.ts` and the Android `applicationId` |
| Version | `MARKETING_VERSION = 1.1`; CI sets it from the single anchor in `codemagic.yaml` |
| Build number | `agvtool new-version -all "$BUILD_NUMBER"` per CI run — the literal `1` in the project is a placeholder |
| Device family | `TARGETED_DEVICE_FAMILY = 1` — **iPhone only**, so no iPad screenshots and no iPad review surface |
| Orientation | Portrait only |
| Deployment target | iOS 13.0 |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` in `Info.plist` — no annual questionnaire at upload |
| Privacy manifest | `App/PrivacyInfo.xcprivacy`, present **and in the resources build phase** |
| Push | `aps-environment = production`; `AppDelegate` posts both Capacitor notifications (§7b2b) |
| API base | Baked at build time from `.env.production` → `https://rot-royale-api.onrender.com` |
| CORS | The WebView origin `capacitor://localhost` is allowed by `NATIVE_APP_ORIGINS` server-side — no Render change needed |

**A privacy manifest that is not in the build phase is invisible to Apple.** It sits in the project
as a file and the upload is rejected for a missing manifest, which reads as though the file were
absent. Check with `grep -c PrivacyInfo.xcprivacy ios/App/App.xcodeproj/project.pbxproj` — a file
reference alone gives 2; it must appear in the resources phase too.

## Rejection risks already closed

These are the ones that actually bite this kind of app. Each is implemented, not merely planned:

- **Account deletion (Guideline 5.1.1(v)).** In-app: profile menu → delete account, two-step.
  Server: `DELETE /me` deletes the user row and every referencing table cascades at the database
  level. An app that offers account creation and no deletion path is rejected on sight.
- **Privacy policy reachable without an account.** `/privacy`, `/terms` and `/support` are public
  SPA routes. A policy behind a login wall is a routine rejection.
- **Blank screen with no network.** `offlineGate.ts` gates only the surfaces that genuinely need a
  server (`contest`, `leaderboard`, `duel`, `friends`) and renders an explanatory panel; everything
  else plays offline.
- **Sign in with Apple (Guideline 4.8).** Offered alongside email. Google deliberately hides itself
  on native (§8a), so the binary shows Apple + email.
- **No purchases.** Coins and Gems are earned-only, non-purchasable, no cash value (§8), so there is
  no IAP to declare and no external-purchase link to fall foul of 3.1.1.
- **No debug surface ships.** `PersonalizationDebug` renders nothing unless
  `VITE_PERSONALIZATION_DEBUG=true`, which no committed env file sets.

## Building

**Preferred — Codemagic (`ios-testflight` in `codemagic.yaml`).** No Mac needed. It installs deps,
runs `npm run build`, `npx cap sync ios`, `pod install`, applies signing, sets the version and build
number from the anchor, archives and uploads to TestFlight.

**Manual, on a Mac**, if you need to drive Xcode directly:

```bash
cd frontend
npm ci
npm run build          # bakes the prod API base from .env.production
npx cap sync ios       # copies the web build + plugins into ios/
npx cap open ios
```

Then in Xcode: select the team, Product → Archive, and distribute to App Store Connect.

> Do NOT run `npx cap add ios`. The project already exists and is customised — `AppDelegate.swift`,
> the entitlements and `PrivacyInfo.xcprivacy` are not what the template generates, and regenerating
> would silently drop all three.

## What only you can do

1. **Apple Developer Program** membership, and an App Store Connect record for `live.rotroyale.app`.
2. **Signing** — distribution certificate + provisioning profile. `codemagic.yaml` references the
   profile `rot_royale_push_profile_20260716` and certificate `rotroyale_distribution`; the profile
   must include the **Push Notifications** capability or the entitlement above fails to build.
3. **APNs key** (.p8) for the backend, plus its key ID and team ID, set on Render.
4. **Screenshots** — sizes and a suggested order are in `docs/store-listing.md`. Capture from the
   real app; do not paste in invented numbers (§7).
5. **App Privacy answers** — copy them from `docs/store-listing.md`. They must match the privacy
   manifest exactly; Apple cross-checks, and a mismatch is a rejection.
6. **Age rating, category, description, keywords** — all drafted in `docs/store-listing.md`.
7. Submit.

## Before you press submit

- [ ] `npm run typecheck && npm run lint && npx vitest run && npm run build` green
- [ ] Version bumped in the `app_version` anchor in `codemagic.yaml` — **the one place it lives**
- [ ] TestFlight build installs on a real iPhone and a full Daily Royale run completes
- [ ] Notifications prompt appears and a test push arrives
- [ ] Delete-account works end to end on the device, and the account is actually gone
- [ ] `/privacy`, `/terms`, `/support` load in Safari while signed out
- [ ] App Privacy answers match `PrivacyInfo.xcprivacy`

**The rating prompt never appears in TestFlight.** That is Apple, not a bug (§7b2b) — do not spend
time debugging it there.
