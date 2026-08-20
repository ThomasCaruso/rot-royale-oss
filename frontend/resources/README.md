# App resources (icon & splash source art)

Capacitor / iOS generate the final asset catalog (every icon size, splash variants) from a couple of
**high-resolution source images**. Drop those sources here; the per-size assets are produced later on
a Mac (or with the `@capacitor/assets` tool) — do **not** hand-cut every size by hand.

## Required source files (to be added)

| File | Spec |
| --- | --- |
| `icon.png` | **1024 × 1024 PNG**, square, **no transparency** (App Store rejects transparent/alpha icons). No rounded corners — iOS applies the mask. The Rot Royale skull-crown mark on the dark violet brand background. |
| `splash.png` | **High-resolution (≥ 2732 × 2732 recommended)** dark, Rot Royale-branded splash. Keep the logo centered well inside a safe zone — it gets cropped to many aspect ratios. Match the app background (`--bg`, deep violet-black) so launch → first paint is seamless. |

Optional:

| File | Spec |
| --- | --- |
| `splash-dark.png` | Same as `splash.png` if you want an explicit dark-mode variant (the app is dark-only, so the single splash is usually enough). |

## How the final iOS assets get generated (later, on Mac)

The asset catalog is **not** generated on Windows. Once the source art exists and the native project
is created (`npx cap add ios`), generate the icon/splash sets with the Capacitor assets tool, e.g.:

```bash
# On a Mac, from frontend/
npm install -D @capacitor/assets
npx capacitor-assets generate --ios     # reads resources/icon.png + resources/splash.png
npx cap sync ios
```

This writes the `AppIcon` and splash imagesets into the native `ios/App/App/Assets.xcassets`.

> Until the source art is added, the app will build with Capacitor's default placeholder icon/splash —
> fine for a first dev/TestFlight build, but **replace before public App Store submission**.
