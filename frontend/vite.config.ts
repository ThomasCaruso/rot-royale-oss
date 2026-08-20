import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * `/download` is served from its own HTML entry (download.html) so the Apple Smart App Banner meta
 * ships in the initial response for that route only. Production does this with a host rewrite
 * (render.yaml: /download → /download.html); this plugin does the same thing for `npm run dev` and
 * `npm run preview`, so the route behaves identically everywhere. The query string is preserved.
 */
function downloadRouteAlias(): Plugin {
  const alias = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, _res, next) => {
      if (req.url) {
        const [path, query] = req.url.split("?");
        if (path === "/download" || path === "/download/") {
          req.url = query ? `/download.html?${query}` : "/download.html";
        }
      }
      next();
    });
  };
  return {
    name: "rr-download-route-alias",
    configureServer: alias,
    configurePreviewServer: alias,
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    downloadRouteAlias(),
    VitePWA({
      // Ship updates without a manual user action: a new SW takes over on next load.
      registerType: "autoUpdate",
      // Register from app code (src/main.tsx), NOT from an auto-injected snippet in index.html.
      // The injected snippet runs before any of our code, so there is no way to opt out of it —
      // and the service worker MUST NOT run inside the native app. Capacitor serves the web build
      // from the app bundle at a fixed origin; a live-updated bundle lands at that same origin, so
      // a service worker precaching index.html would keep serving the OLD index.html (and its old
      // hashed chunk names) forever. The update silently never applies, or worse the cached chunks
      // are evicted and the app white-screens on files the new bundle no longer contains.
      injectRegister: null,
      // Copy these from public/ into the precache so the icon set is available offline/installed.
      includeAssets: ["favicon.png", "icons/*.png"],
      manifest: {
        name: "Rot Royale",
        short_name: "Rot Royale",
        description: "Windowed daily skill contests — play one seeded run, climb the ladder, win coins.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        // Blank identity (the default blank_light skin + the crown-? icon set): warm cream.
        // Icons regenerate from a single source via scripts/make_icons.py.
        background_color: "#F8F3EA",
        theme_color: "#F8F3EA",
        icons: [
          { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Web Push (M9): pull the push + notificationclick handlers into the generated SW.
        // Resolves to /push-sw.js at the SW's root scope (file lives in public/).
        importScripts: ["push-sw.js"],
        // Offline app shell: precache the small core assets and fall back to index.html for
        // navigations (the app is a single-route SPA).
        globPatterns: ["**/*.{js,css,html,svg,woff,woff2}"],
        // Forward scaffolding for the planned Phaser hub scene (§10): no module currently imports
        // Phaser, so no phaser chunk is emitted today. If one returns, do NOT precache it (precaching
        // downloads every globbed asset on SW install, re-introducing a ~1.5 MB eager load) — these
        // rules cache it at runtime on first use instead.
        globIgnores: ["**/phaser-*.js"],
        navigateFallback: "/index.html",
        // ...except /download, which must come from the network so the host's rewrite serves
        // download.html (with its Smart App Banner meta) rather than the app shell. It's an
        // acquisition page for people who don't have the app — offline support is meaningless.
        navigateFallbackDenylist: [/^\/download\/?$/],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/phaser-.*\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "phaser-chunk",
              expiration: { maxEntries: 2 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Theme art (Starter crown/brain/shield etc.) — cache each image the first time
            // it's requested while online so themed play renders offline on later loads. Runtime
            // (not precache) keeps the initial install light: images download on first use only.
            urlPattern: /\/assets\/themes\/.*\.(png|webp)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "theme-art",
              expiration: { maxEntries: 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // No service worker in dev (avoids stale-cache surprises while iterating).
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Stamped into the bundle so /download?debug=1 can prove which build a device is actually
  // running — an in-app browser serving a stale cached bundle is otherwise invisible.
  define: {
    BUILD_STAMP: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + "Z"),
  },
  build: {
    rollupOptions: {
      // Two HTML entries: the SPA shell, and the standalone /download acquisition page (which
      // carries route-specific head metadata the shared index.html can't).
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        download: fileURLToPath(new URL("./download.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
  },
});
