import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for the iOS (and future Android) wrapper of the Rot Royale SPA.
 *
 * Production-safe by design:
 *  - NO `server.url` — the app loads the bundled web build from `webDir` (dist), never a dev server.
 *  - NO localhost / 127.0.0.1 references anywhere.
 *  - The web build's API calls go to whatever `VITE_API_BASE` was baked in at `npm run build`
 *    (see frontend/.env.production → the live backend). Capacitor itself holds no API URL.
 *
 * The native iOS project is generated later on a Mac (`npx cap add ios`); this file is what that
 * tooling reads. See docs/ios-app-store-prep.md.
 */
const config: CapacitorConfig = {
  appId: "live.rotroyale.app",
  appName: "Rot Royale",
  webDir: "dist",
};

export default config;
