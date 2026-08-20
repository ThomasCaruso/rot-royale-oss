/**
 * Path → public (unauthenticated, no-session) page. The app has no router: `main.tsx` reads
 * `window.location.pathname` once and mounts either one of these standalone pages or the app
 * shell. Extracted from `main.tsx` so the mapping itself is testable without mounting React.
 *
 * `null` means "the app shell" — every other path, including `/` and the `/?c=<id>` share links.
 */
export type PublicRoute = "privacy" | "terms" | "support" | "download";

/**
 * Trailing slashes are tolerated (some hosts normalize `/download` → `/download/`), as is the
 * built `.html` filename — `/download` is served by rewriting to `frontend/download.html`, so a
 * direct hit on `/download.html` must render the same page rather than falling through to the app.
 */
export function resolvePublicRoute(pathname: string): PublicRoute | null {
  const path = pathname.replace(/\.html$/i, "").replace(/\/+$/, "") || "/";
  switch (path) {
    case "/privacy":
      return "privacy";
    case "/terms":
      return "terms";
    case "/support":
      return "support";
    case "/download":
      return "download";
    default:
      return null;
  }
}
