/**
 * Canonical acquisition links — the ONE place the App Store destination and the public download
 * page live. Nothing else in the codebase may inline either string.
 *
 * Why the indirection: Instagram's and Facebook's in-app browsers sometimes swallow a direct
 * navigation to an `apps.apple.com` URL (the user taps Download and nothing happens). So every
 * EXTERNAL acquisition channel (IG/FB/TikTok bios, DMs, posts, QR codes) points at
 * `DOWNLOAD_PAGE_URL`, which detects the Meta WebView and escapes it before handing off to
 * `APP_STORE_URL`. The App Store URL itself stays the real href of the /download anchor, so an
 * ordinary browser just follows the link with no JavaScript involved at all.
 */

/** Apple's numeric app id. Also hardcoded (unavoidably) in the Smart App Banner meta tag in
 *  `frontend/download.html` — a static HTML file can't import from TypeScript. Keep them in sync. */
export const APPLE_APP_ID = "6781928142";

/** The real App Store destination — the anchor href on /download and nothing else. */
export const APP_STORE_URL = `https://apps.apple.com/us/app/rot-royale/id${APPLE_APP_ID}`;

/** Path of the public download page (routed in `src/app/publicRoutes.ts`). */
export const DOWNLOAD_PATH = "/download";

/** The canonical link to publish externally. Instagram/Facebook wrap it automatically; the page
 *  it lands on is the thing that knows how to get out of their WebView. */
export const DOWNLOAD_PAGE_URL = `https://rotroyale.live${DOWNLOAD_PATH}`;
