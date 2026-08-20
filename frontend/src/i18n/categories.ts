/**
 * Category display names.
 *
 * Categories arrive from the API as their CANONICAL ENGLISH names ("Science & Nature") — that string
 * is an identifier as much as a label: it keys the bank, the campaign world map, and the practice
 * scoping call. So it is never translated server-side; it is mapped to a display name here.
 *
 * There are only eight, they change rarely, and the canonical list is locked backend-side
 * (`content/categories.py::CANONICAL_CATEGORIES`) — a per-question DB translation would be a lot of
 * machinery for eight strings. An unknown category falls through to the English name rather than
 * rendering blank, so adding a ninth category server-side degrades gracefully.
 */

import type { Locale } from "@/i18n";

const CATEGORY_NAMES: Record<Locale, Record<string, string>> = {
  en: {},
  es: {
    "Science & Nature": "Ciencia y Naturaleza",
    History: "Historia",
    Geography: "Geografía",
    "Arts & Literature": "Arte y Literatura",
    Sports: "Deportes",
    "Pop Culture & Entertainment": "Cultura Pop",
    "Money & Business": "Dinero y Negocios",
    "Street Smarts": "Sentido Común",
  },
  fr: {
    "Science & Nature": "Sciences et Nature",
    History: "Histoire",
    Geography: "Géographie",
    "Arts & Literature": "Arts et Littérature",
    Sports: "Sports",
    "Pop Culture & Entertainment": "Culture Pop",
    "Money & Business": "Argent et Affaires",
    "Street Smarts": "Bon Sens",
  },
  tr: {
    "Science & Nature": "Bilim ve Doğa",
    History: "Tarih",
    Geography: "Coğrafya",
    "Arts & Literature": "Sanat ve Edebiyat",
    Sports: "Spor",
    "Pop Culture & Entertainment": "Popüler Kültür",
    "Money & Business": "Para ve İş",
    "Street Smarts": "Sokak Zekâsı",
  },
};

/** Display name for a canonical category in `locale`, falling back to the English name. */
export function categoryName(category: string, locale: Locale): string {
  return CATEGORY_NAMES[locale]?.[category] ?? category;
}

export { CATEGORY_NAMES };
