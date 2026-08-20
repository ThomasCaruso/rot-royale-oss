/**
 * Campaign world / arc / level display names.
 *
 * Like categories, these arrive from the API as canonical ENGLISH strings that double as
 * identifiers (`world` keys the ladder and the art set; arc + level titles come straight from
 * `content/campaign/campaign_levels.json`). They are mapped to display names here rather than
 * translated server-side.
 *
 * The whole surface is 19 strings — 6 worlds, 3 arcs, 10 level titles — reused across every world,
 * because the manifest deliberately uses ONE generic progression scheme for all of them
 * (`test_level_titles_match_the_generated_progression_scheme` pins that). Unknown strings fall
 * through to English, so authoring a new arc server-side degrades gracefully instead of blanking.
 *
 * NOTE on "Raising the Stakes": the English title carries wagering framing that DESIGN §7 prohibits
 * and that `copyGuard.ts` bans as a word ("stake"/"stakes"). It ships today only because the backend
 * guard in `tests/test_campaign_manifest.py::_BANNED` omits "stake" while the frontend one includes
 * it — the two lists disagree. The translations below deliberately do not carry the idiom across.
 */

import type { Locale } from "@/i18n";

type Names = Record<string, string>;

const WORLDS: Record<Locale, Names> = {
  en: {},
  es: {
    Science: "Ciencia",
    History: "Historia",
    Sports: "Deportes",
    Geography: "Geografía",
    Arts: "Arte",
    "Pop Culture": "Cultura Pop",
  },
  fr: {
    Science: "Sciences",
    History: "Histoire",
    Sports: "Sports",
    Geography: "Géographie",
    Arts: "Arts",
    "Pop Culture": "Culture Pop",
  },
  tr: {
    Science: "Bilim",
    History: "Tarih",
    Sports: "Spor",
    Geography: "Coğrafya",
    Arts: "Sanat",
    "Pop Culture": "Popüler Kültür",
  },
};

const ARCS: Record<Locale, Names> = {
  en: {},
  es: { Foundations: "Fundamentos", Ascent: "Ascenso", Mastery: "Maestría" },
  fr: { Foundations: "Fondations", Ascent: "Ascension", Mastery: "Maîtrise" },
  tr: { Foundations: "Temeller", Ascent: "Yükseliş", Mastery: "Ustalık" },
};

const LEVELS: Record<Locale, Names> = {
  en: {},
  es: {
    "Warm-Up": "Calentamiento",
    "Finding Your Footing": "Encontrando el Paso",
    "Building Momentum": "Tomando Impulso",
    "Hitting Your Stride": "A Pleno Ritmo",
    "Raising the Stakes": "Subiendo el Nivel",
    "Into the Deep": "Hacia lo Profundo",
    "No Easy Answers": "Sin Respuestas Fáciles",
    "Trial by Fire": "Prueba de Fuego",
    "The Gauntlet": "El Desafío",
    "Final Trial": "Prueba Final",
  },
  fr: {
    "Warm-Up": "Échauffement",
    "Finding Your Footing": "Trouver ses Marques",
    "Building Momentum": "Prendre son Élan",
    "Hitting Your Stride": "En Pleine Foulée",
    // Deliberately not the wagering idiom — "a notch harder" instead (see the note above).
    "Raising the Stakes": "On Monte d'un Cran",
    "Into the Deep": "Plongée en Eaux Profondes",
    "No Easy Answers": "Aucune Réponse Facile",
    "Trial by Fire": "Baptême du Feu",
    "The Gauntlet": "Le Gantelet",
    "Final Trial": "Épreuve Finale",
  },
  tr: {
    "Warm-Up": "Isınma",
    "Finding Your Footing": "Ayak Uydurma",
    "Building Momentum": "İvme Kazanma",
    "Hitting Your Stride": "Tam Tempo",
    "Raising the Stakes": "Bir Üst Seviye",
    "Into the Deep": "Derinlere",
    "No Easy Answers": "Kolay Cevap Yok",
    "Trial by Fire": "Ateşten Gömlek",
    "The Gauntlet": "Çetin Sınav",
    "Final Trial": "Son Sınav",
  },
};

export function worldName(world: string, locale: Locale): string {
  return WORLDS[locale]?.[world] ?? world;
}

export function arcName(arc: string, locale: Locale): string {
  return ARCS[locale]?.[arc] ?? arc;
}

export function levelTitle(title: string, locale: Locale): string {
  return LEVELS[locale]?.[title] ?? title;
}
