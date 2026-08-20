import { Capacitor } from "@capacitor/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { resolvePublicRoute } from "@/app/publicRoutes";
import "@/modules"; // register client-side round modules
import "@/theme/global.css";

// The public pages (long static legal/marketing copy, ~67 KB) are mutually exclusive with the game
// AND with each other — exactly one can ever render for a given URL. Code-split so a player opening
// the app never downloads the privacy policy, and a visitor reading the privacy policy never
// downloads the game.
const DownloadPage = lazy(() =>
  import("@/screens/download/DownloadPage").then((m) => ({ default: m.DownloadPage })),
);
const PrivacyPage = lazy(() =>
  import("@/screens/legal/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazy(() => import("@/screens/legal/TermsPage").then((m) => ({ default: m.TermsPage })));
const SupportPage = lazy(() =>
  import("@/screens/legal/SupportPage").then((m) => ({ default: m.SupportPage })),
);

const queryClient = new QueryClient();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

// Public pages mount standalone — no QueryClient, no session restore, no guest creation.
// `/download` normally arrives through its own built HTML entry (download.html, which carries the
// Smart App Banner meta and boots src/download.tsx); it is ALSO handled here so the route still
// renders if a host — or the PWA service worker's navigation fallback — serves index.html for it.
let page: React.ReactNode;
switch (resolvePublicRoute(window.location.pathname)) {
  case "privacy":
    page = <PrivacyPage />;
    break;
  case "terms":
    page = <TermsPage />;
    break;
  case "support":
    page = <SupportPage />;
    break;
  case "download":
    page = <DownloadPage />;
    break;
  default:
    page = (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );
}

// The boundary sits OUTSIDE Suspense so it also catches a failed lazy chunk (a stale index.html
// pointing at hashed files that no longer exist), not only a throw during render.
createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={null}>{page}</Suspense>
    </ErrorBoundary>
  </StrictMode>,
);

/**
 * Service worker: WEB ONLY, never inside the native app.
 *
 * On the web it is what makes the PWA installable and offline-capable. Inside Capacitor it earns
 * nothing — the build is already on disk — and it actively breaks over-the-air updates: Capacitor
 * serves both the bundled build and any live-updated build from the same fixed origin, so a worker
 * precaching index.html keeps serving the OLD index.html and its old hashed chunk names. The update
 * appears to install and silently does nothing; if those chunks are ever evicted, the app
 * white-screens on files the new bundle does not contain.
 *
 * The native branch also UNREGISTERS anything a previously shipped binary installed, so the first
 * build carrying this code cleans up after its predecessors rather than inheriting the problem.
 */
if (Capacitor.isNativePlatform()) {
  void navigator.serviceWorker
    ?.getRegistrations?.()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => {
      /* nothing to clean up, or the API is unavailable — neither is actionable */
    });
} else {
  void import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true }));
}
