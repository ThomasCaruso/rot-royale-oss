import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DownloadPage } from "@/screens/download/DownloadPage";
import "@/theme/global.css";

/**
 * Entry point for `download.html` — the standalone build target behind `/download`.
 *
 * It mounts ONLY the download page: no QueryClient, no round-module registry, no session store
 * bootstrap. That keeps the marketing route small and makes it structurally impossible for a visit
 * to create a guest account or hit the API for anything but the analytics beacon. (`main.tsx` also
 * routes `/download` as a fallback, for the case where index.html is served for the path.)
 */
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <DownloadPage />
  </StrictMode>,
);
