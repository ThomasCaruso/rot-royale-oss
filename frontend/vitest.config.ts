import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Dedicated Vitest config (takes precedence over vite.config.ts for tests) so the PWA plugin etc.
// aren't loaded for unit tests. Timezone is NOT pinned here — the time tests set process.env.TZ
// per-case to verify the formatter against several explicit zones.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
