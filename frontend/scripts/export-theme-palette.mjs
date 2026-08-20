/**
 * Export the theme palette for server-side rendering.
 *
 * The share card (`GET /c/{id}/og.png`) is drawn by Pillow on the backend, in the sender's equipped
 * theme. That needs the theme colours in Python — but `frontend/src/theme/tokens.ts` is the ONE
 * source of truth for them (CLAUDE.md §4: don't encode the same truth twice). So instead of
 * hand-copying a palette into the backend, this script transpiles `tokens.ts`, reads the real
 * THEMES array, and writes a flat JSON the backend loads at render time.
 *
 * Run it whenever a theme's colours change:
 *     npm run export:palette
 *
 * `backend/tests/test_theme_palette.py` regenerates and diffs, so a drifted JSON fails CI rather
 * than silently shipping a share card in stale colours.
 *
 * Only the handful of solid colours the card actually paints are exported. CSS gradients
 * (`--bg`, `--cta`) are deliberately NOT exported: Pillow can't evaluate them, and approximating
 * them here would be a second source of truth. The card derives its own background ramp from the
 * solid tokens instead.
 */
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const tokensEntry = resolve(here, "..", "src", "theme", "tokens.ts");
const outFile = resolve(repoRoot, "backend", "content", "theme_palette.json");

/** Solid tokens the share card paints with. Gradient-valued tokens are excluded by design. */
const COLOR_KEYS = [
  "--panel",
  "--panel2",
  "--line",
  "--brand",
  "--brand-2",
  "--amber",
  "--lime",
  "--text",
  "--muted",
  "--faint",
  "--btnText",
  "--ctaText",
];

/** `--font-display` stack → the TTF committed at backend/app/assets/fonts. */
function displayFontFor(stack) {
  const s = String(stack ?? "");
  if (s.includes("Playfair Display")) return "PlayfairDisplay-Bold.ttf";
  if (s.includes("Luckiest Guy")) return "LuckiestGuy-Regular.ttf";
  return "Manrope-Bold.ttf";
}

const tmp = await mkdtemp(join(tmpdir(), "rr-palette-"));
try {
  const bundle = join(tmp, "tokens.mjs");
  // `tokens.ts` pulls in asset imports (theme art) via the `@/` alias; stub them to plain strings
  // so this runs outside Vite. We only read colours, never art.
  await build({
    entryPoints: [tokensEntry],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    loader: { ".png": "text", ".jpg": "text", ".webp": "text", ".svg": "text" },
    plugins: [
      {
        name: "alias-and-assets",
        setup(b) {
          b.onResolve({ filter: /^@\// }, (args) => ({
            path: resolve(here, "..", "src", args.path.slice(2)),
          }));
          b.onResolve({ filter: /\.(png|jpg|jpeg|webp|svg)$/ }, (args) => ({
            path: args.path,
            namespace: "asset-stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "asset-stub" }, () => ({
            contents: "export default \"\";",
            loader: "js",
          }));
        },
      },
    ],
  });

  const mod = await import(pathToFileURL(bundle).href);
  const themes = mod.THEMES ?? mod.themes;
  if (!Array.isArray(themes) || themes.length === 0) {
    throw new Error("tokens.ts did not export a THEMES array");
  }

  const palette = {};
  for (const theme of themes) {
    const vars = theme.vars ?? {};
    const entry = { name: theme.name, style: theme.style, font: displayFontFor(vars["--font-display"]) };
    for (const key of COLOR_KEYS) {
      const value = vars[key];
      // A gradient would poison the card; skip anything that isn't a flat colour.
      if (typeof value === "string" && !value.includes("gradient(")) {
        entry[key.replace(/^--/, "")] = value;
      }
    }
    palette[theme.id] = entry;
  }

  const json = `${JSON.stringify({ generated_by: "frontend/scripts/export-theme-palette.mjs", themes: palette }, null, 2)}\n`;

  // Only rewrite on a real change, so re-running doesn't churn the file's mtime.
  const previous = await readFile(outFile, "utf8").catch(() => null);
  if (previous !== json) {
    await writeFile(outFile, json, "utf8");
    console.log(`wrote ${outFile} (${Object.keys(palette).length} themes)`);
  } else {
    console.log(`up to date (${Object.keys(palette).length} themes)`);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}
