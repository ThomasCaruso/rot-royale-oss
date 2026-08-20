# Android / Google Play — release prep

Companion to the iOS lane. The web app is identical on both platforms; only the wrapper, push
transport and store paperwork differ.

## What is already done (in the repo)

- **Android platform scaffolded** — `frontend/android/`, `applicationId` / `namespace`
  `live.rotroyale.app` (matches the iOS bundle ID and `capacitor.config.ts`).
- **Icons + splash generated** for every density, including adaptive `mipmap-anydpi-v26`.
- **`targetSdk` / `compileSdk` = 35.** Capacitor 6's template ships 34, which Play **rejects** —
  new apps and updates have had to target API 35+ since 2025-08-31.
- **`POST_NOTIFICATIONS` declared.** Android 13+ gates notifications behind a runtime permission;
  without it the prompt never appears and reminders silently do nothing.
- **Release signing wired** in `app/build.gradle`, reading an untracked `key.properties`. A release
  build without it fails loudly rather than emitting an unsigned artifact.
- **FCM push implemented server-side** (`services/push.py`) — before this, `platform == "android"`
  fell through to a skip branch: the device registered and no notification ever arrived.
- **Codemagic `android-play` workflow** — Linux, no Mac required.

## What still needs doing (needs your accounts)

### 1. Firebase / FCM
Create a Firebase project against `live.rotroyale.app`, then:
- Download `google-services.json` → `frontend/android/app/google-services.json` (**gitignored**;
  add it to Codemagic as a secure file). The Capacitor build already applies the
  `com.google.gms.google-services` plugin when this file is present.
- Project settings → Service accounts → **Generate new private key**. From that JSON set three
  backend env vars on Render:

  | Env var | JSON field |
  |---|---|
  | `FCM_PROJECT_ID` | `project_id` |
  | `FCM_CLIENT_EMAIL` | `client_email` |
  | `FCM_PRIVATE_KEY` | `private_key` |

  Paste the private key as-is; the config validator restores `\n` escapes automatically.
  `settings.fcm_enabled` flips on only when all three are set — until then Android push is a clean
  no-op, exactly as it is today.

### 2. Upload keystore
Generate once and **never lose it** — losing it means you cannot update the app.

```
keytool -genkey -v -keystore rot-royale-upload.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias rot-royale
```

Add to a Codemagic variable group named `google_play`: `CM_KEYSTORE` (base64 of the .jks),
`CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, `CM_KEY_PASSWORD`. Enable Play App Signing so Google holds
the distribution key and this one is only the upload key.

### 3. Play Console
- Create the app, then a **service account** with "Release to testing tracks" and wire it to
  Codemagic as `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`.
- **Data safety form.** Declare what's collected: email + username (account), and notifications.
  Say plainly that data is not sold and that account deletion is available in-app.
- **Content rating** questionnaire. Trivia with no gambling and no UGC rates low; answer the
  gambling questions carefully — coins and Gems are earned-only, never purchasable or cashable
  (CLAUDE.md §8), which keeps you outside the Real-Money Gambling policy.
- **Account deletion URL.** Play requires an in-app path *and* a web-reachable one. In-app exists
  (profile menu → Delete account, two-step, `DELETE /me`). Point the web field at `/support`.
- **Closed testing:** a new *personal* developer account must run a closed test with **12 testers
  for 14 continuous days** before production access. This is a calendar constraint, not engineering
  — start it early. Organisation accounts are exempt.

## Known risks

**API 36 deadline — 2026-08-31.** The next annual bump lands within weeks. Capacitor 6 officially
supports up to 35, so meeting it most likely means upgrading to **Capacitor 7**, not editing
`variables.gradle`. Plan that before late August.

**Edge-to-edge on Android 15.** targetSdk 35 makes content draw behind the system bars. The app
already pads with `env(safe-area-inset-*)` everywhere for the iOS notch — the same mechanism — but
this needs eyes on a real device before release. It is the most likely visual surprise.

**Unverified locally.** The Android project has never been compiled here: this machine has no
Android SDK or JDK. Gradle syntax was reviewed by hand, but the **first Codemagic run is the real
test** of the signing block and the build. Expect to iterate once.

## Build locally (optional)

Needs Android Studio / SDK + JDK 17:

```
cd frontend
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug     # release needs key.properties
```
