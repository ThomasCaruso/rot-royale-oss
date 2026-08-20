import { en, type Dict } from "@/i18n/en";

export type { Dict } from "@/i18n/en";
export { en };
export type Locale = "en" | "es" | "tr" | "fr";

export interface LocaleMeta {
  code: Locale;
  label: string; // endonym, shown in the menu
  short: string; // 2-letter chip
  flag: string; // emoji flag
}

export const LOCALES: LocaleMeta[] = [
  { code: "en", label: "English", short: "EN", flag: "🇬🇧" },
  { code: "es", label: "Español", short: "ES", flag: "🇪🇸" },
  { code: "fr", label: "Français", short: "FR", flag: "🇫🇷" },
  { code: "tr", label: "Türkçe", short: "TR", flag: "🇹🇷" },
];

const SUPPORTED = new Set<Locale>(["en", "es", "fr", "tr"]);

/**
 * Load one locale's dictionary. Each non-English dict is ~37 KB of strings; importing all four
 * statically put ~112 KB of copy nobody reads into the always-downloaded shared chunk. English stays
 * static — it is the fallback, the compile-time shape (`Dict = typeof en`) and by far the common
 * case, so it must never cost a round trip.
 *
 * Callers go through `useI18n` (store/i18n.ts), which holds the resolved dict; components keep using
 * the synchronous `useT()`. The whole-dict shape is what makes this safe: a locale is swapped in one
 * assignment, so there is no half-translated render.
 */
export async function loadDict(locale: Locale): Promise<Dict> {
  switch (locale) {
    case "es":
      return (await import("@/i18n/es")).es;
    case "fr":
      return (await import("@/i18n/fr")).fr;
    case "tr":
      return (await import("@/i18n/tr")).tr;
    default:
      return en;
  }
}

/** Map a BCP-47 tag (e.g. "es-ES", "tr") to a supported locale, defaulting to English. */
export function detectLocale(tag: string | undefined | null): Locale {
  const base = (tag ?? "en").slice(0, 2).toLowerCase() as Locale;
  return SUPPORTED.has(base) ? base : "en";
}

/** Interpolate {token} placeholders. `fmt("{n}/10 cleared", { n: 3 })` → "3/10 cleared". */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}
