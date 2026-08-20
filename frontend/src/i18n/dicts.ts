import { en, type Dict } from "@/i18n/en";
import { es } from "@/i18n/es";
import { fr } from "@/i18n/fr";
import { tr } from "@/i18n/tr";
import type { Locale } from "@/i18n";

/**
 * Every dictionary in one map — for tests that must sweep ALL locales at once (the i18n structural
 * check and the copy-honesty guard, CLAUDE.md §7).
 *
 * **Do not import this from app code.** The running app loads exactly one non-English dict on
 * demand via `loadDict()` (i18n/index.ts); a static import here would pull all four back into the
 * initial bundle and undo that split. This module is deliberately test-only, and lives apart from
 * `i18n/index.ts` so that stays true by construction rather than by tree-shaking luck.
 */
export const DICTS: Record<Locale, Dict> = { en, es, fr, tr };
