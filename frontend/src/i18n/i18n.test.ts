import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import { fr } from "@/i18n/fr";
import { tr } from "@/i18n/tr";
import { EXEMPT_KEYS, findBannedTerms } from "@/i18n/copyGuard";
import { type Locale, detectLocale, fmt } from "@/i18n";
import { DICTS } from "@/i18n/dicts";

// Flatten a nested dict to "ns.key" → string for structural + content checks.
function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v as Record<string, unknown>, path));
    else out[path] = String(v);
  }
  return out;
}

const EN = flatten(en);
const ES = flatten(es);
const FR = flatten(fr);
const TR = flatten(tr);

// Every non-English locale, held to the identical bar. Adding a language = adding one entry here.
type LocaleDict = readonly [locale: string, dict: Record<string, string>];
const TRANSLATIONS: readonly LocaleDict[] = [
  ["es", ES],
  ["fr", FR],
  ["tr", TR],
];
// The copy-honesty guard additionally covers English (it is source copy, not a translation).
const ALL_LOCALES: readonly LocaleDict[] = [["en", EN], ...TRANSLATIONS];

describe("dictionary completeness", () => {
  it("every locale has exactly the same keys (no missing/extra translations)", () => {
    const enKeys = Object.keys(EN).sort();
    for (const [locale, dict] of TRANSLATIONS) {
      expect(Object.keys(dict).sort(), `${locale} keys`).toEqual(enKeys);
    }
  });

  it("no translated value is left empty", () => {
    for (const [locale, dict] of TRANSLATIONS) {
      for (const [key, val] of Object.entries(dict)) {
        expect(val.trim(), `${locale}.${key} is empty`).not.toBe("");
      }
    }
  });

  it("interpolation tokens match across locales (no dropped/added {placeholders})", () => {
    const tokens = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(EN)) {
      for (const [locale, dict] of TRANSLATIONS) {
        expect(tokens(dict[key]), `${locale} ${key} tokens`).toEqual(tokens(EN[key]));
      }
    }
  });

  // A translated string that is byte-identical to English is almost always an untranslated stub that
  // slipped through. Brand nouns and symbol-only values legitimately match, so this asserts on the
  // RATE: if a locale mirrors English for most of the dictionary, it was never really translated.
  it("each locale is actually translated, not an English copy", () => {
    const total = Object.keys(EN).length;
    for (const [locale, dict] of TRANSLATIONS) {
      const identical = Object.keys(EN).filter((k) => dict[k] === EN[k]).length;
      expect(identical / total, `${locale} is ${identical}/${total} identical to English`).toBeLessThan(0.5);
    }
  });
});

describe("copy honesty across all languages (DESIGN §7)", () => {
  // The banned-term policy + matcher are centralised in copyGuard.ts (single source of truth for the
  // whole suite). No money / gambling / wagering framing in ANY language; coins & Gems are cosmetic.
  // `duel.disclaimer` (EXEMPT_KEYS) is the one skipped key — it is the
  // legally-required no-cash-value DISAVOWAL, which by design names "cash"/"redeemed" to disavow
  // them. The guard blocks gambling-POSITIVE framing; a disclaimer saying Gems have no cash value is
  // the opposite. Every other string in every locale is held to the full policy.
  it.each(ALL_LOCALES)(
    "%s contains no cash/prize/gambling/wagering/fake-human language",
    (_locale, dict) => {
      const offenders: string[] = [];
      for (const [key, val] of Object.entries(dict)) {
        if (EXEMPT_KEYS.has(key)) continue;
        const hits = findBannedTerms(val);
        if (hits.length) offenders.push(`${key}: "${val}" (${hits.join(", ")})`);
      }
      expect(offenders).toEqual([]);
    },
  );

  // The no-cash-value disclaimer is mandatory player-facing honesty copy (PLAN / DESIGN §7). Pin the
  // EXACT English wording so it can't silently drift, and require the localised keys to exist and be
  // non-empty. It carries the words the rest of the guard bans — which is exactly why it's the sole
  // EXEMPT_KEYS entry above.
  it("ships the required no-cash-value Gem disclaimer (exact EN wording, present in es/fr/tr)", () => {
    expect(en.duel.disclaimer).toBe(
      "Gems are earned in-game, have no cash value, cannot be purchased, transferred, sold, or redeemed, and do not provide an advantage in Daily Royale.",
    );
    expect(EXEMPT_KEYS.has("duel.disclaimer")).toBe(true);
    expect(es.duel.disclaimer.trim().length).toBeGreaterThan(0);
    expect(fr.duel.disclaimer.trim().length).toBeGreaterThan(0);
    expect(tr.duel.disclaimer.trim().length).toBeGreaterThan(0);
    // The disavowal must actually disavow cash value in every locale (the property the exemption
    // exists to permit), so it can never be reduced to an empty/placeholder string.
    expect(en.duel.disclaimer.toLowerCase()).toContain("no cash value");
    expect(es.duel.disclaimer.toLowerCase()).toContain("efectivo"); // "valor en efectivo"
    expect(fr.duel.disclaimer.toLowerCase()).toContain("valeur monétaire"); // "aucune valeur monétaire"
    expect(tr.duel.disclaimer.toLowerCase()).toContain("nakit"); // "nakit değeri yoktur"
  });
});

describe("engine", () => {
  it("fmt interpolates and leaves unknown tokens intact", () => {
    expect(fmt("{a}/{b}", { a: 1, b: 2 })).toBe("1/2");
    expect(fmt("Top {pct}% of the field", { pct: 25 })).toBe("Top 25% of the field");
    expect(fmt("{missing}", {})).toBe("{missing}");
  });

  it("detectLocale maps BCP-47 tags, defaulting to English", () => {
    expect(detectLocale("es-ES")).toBe("es");
    expect(detectLocale("tr")).toBe("tr");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("fr-CA")).toBe("fr");
    expect(detectLocale("fr")).toBe("fr");
    expect(detectLocale("de")).toBe("en"); // unsupported → English
    expect(detectLocale(null)).toBe("en");
  });

  it("exposes a dictionary for every locale", () => {
    for (const code of ["en", "es", "fr", "tr"] as Locale[]) {
      expect(DICTS[code]).toBeDefined();
    }
  });
});
