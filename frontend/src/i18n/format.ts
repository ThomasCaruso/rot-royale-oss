/**
 * Locale-aware number/date formatting bound to the APP's selected language.
 *
 * Why this exists: `n.toLocaleString()` and `new Intl.DateTimeFormat(undefined, …)` resolve against
 * the BROWSER's locale, not the one the player picked in-app. Those disagree constantly — a French
 * player on an en-US browser saw "1,448" and "JUL 29, 2026" with the app fully in French. Switching
 * language has to change the numerals and dates too, not just the words.
 *
 * Times specifically stay VIEWER-LOCAL by design (app convention, docs/architecture.md §6): the contest is
 * defined in ET wall-clock, and the client renders that instant in the viewer's own zone. Only the
 * LANGUAGE of the formatting is taken from the app locale — never the time zone.
 */

import { type Locale } from "@/i18n";
import { useI18n } from "@/store/i18n";

// App locale → BCP-47 tag. Plain language subtags are correct here: they carry the right number
// grouping (fr uses a narrow no-break space, es/tr use "."), and letting the region default keeps
// fr-CA/fr-FR players on their own conventions rather than forcing one region's.
const TAGS: Record<Locale, string> = { en: "en", es: "es", fr: "fr", tr: "tr" };

export function localeTag(locale: Locale): string {
  return TAGS[locale] ?? "en";
}

/** The active app locale OUTSIDE React (lib helpers, formatters called from plain functions). */
export function activeTag(): string {
  return localeTag(useI18n.getState().locale);
}

/** Format an integer in the app's language ("1 448" in fr, "1,448" in en). */
export function formatNumber(n: number, locale?: Locale): string {
  return n.toLocaleString(locale ? localeTag(locale) : activeTag());
}

/** Signed score/rating delta with the app's minus glyph and grouping. */
export function formatDelta(n: number, locale?: Locale): string {
  return `${n >= 0 ? "+" : "−"}${formatNumber(Math.abs(n), locale)}`;
}

/**
 * Number + date/time formatters bound to the active locale, re-computed when the player switches
 * language. Components that format anything numeric should use this rather than bare
 * `toLocaleString()`, so a language switch re-renders them with the new conventions.
 */
export function useFormat(): {
  locale: Locale;
  tag: string;
  num: (n: number) => string;
  delta: (n: number) => string;
  date: (d: Date, opts?: Intl.DateTimeFormatOptions) => string;
  time: (d: Date, opts?: Intl.DateTimeFormatOptions) => string;
} {
  const locale = useI18n((s) => s.locale);
  const tag = localeTag(locale);
  return {
    locale,
    tag,
    num: (n) => n.toLocaleString(tag),
    delta: (n) => formatDelta(n, locale),
    // Viewer-local zone (never forced to ET); only the language comes from the app locale.
    date: (d, opts = { month: "short", day: "numeric", year: "numeric" }) =>
      new Intl.DateTimeFormat(tag, opts).format(d),
    time: (d, opts = { hour: "numeric", minute: "2-digit" }) =>
      new Intl.DateTimeFormat(tag, opts).format(d),
  };
}
