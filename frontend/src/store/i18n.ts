import { Preferences } from "@capacitor/preferences";
import { create } from "zustand";
import { type Dict, type Locale, detectLocale, en, loadDict } from "@/i18n";

// Locale persists like the refresh token — via Capacitor Preferences (localStorage on web,
// Keychain/Keystore-adjacent on native), so the choice survives restarts.
const LOCALE_KEY = "rr.locale";

function applyDocumentLang(locale: Locale): void {
  // Sets <html lang> so CSS `text-transform` casing is locale-correct (critical for Turkish's
  // dotted/dotless i). None of en/es/tr are RTL, so no `dir` change is needed.
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

interface I18nState {
  locale: Locale;
  /** The active dictionary. Held here (rather than looked up from a static map) because non-English
   *  dicts are code-split — see `loadDict` in i18n/index.ts. `useT()` reads this synchronously. */
  dict: Dict;
  /** False only while a locale swap is in flight, so the shell can hold its splash instead of
   *  painting one English frame before the real dictionary lands. */
  ready: boolean;
  setLocale: (locale: Locale) => void;
}

export const useI18n = create<I18nState>((set) => ({
  locale: "en",
  dict: en,
  ready: true,
  setLocale: (locale) => {
    applyDocumentLang(locale);
    void Preferences.set({ key: LOCALE_KEY, value: locale });
    // Locale and dictionary are set together so no render ever sees one without the other. The
    // in-flight window is a single chunk fetch; the selector menu stays interactive throughout.
    void loadDict(locale).then((dict) => set({ locale, dict }));
  },
}));

/** Restore the persisted locale (or detect from the browser) at startup, before first paint. */
export async function restoreLocale(): Promise<void> {
  // Held down for the duration: the app shows its splash rather than a frame of English copy that
  // then swaps. (Default is `true` so a caller that never runs this — tests, the standalone public
  // pages — is simply English and never stuck.)
  useI18n.setState({ ready: false });
  let locale: Locale;
  try {
    const { value } = await Preferences.get({ key: LOCALE_KEY });
    locale = value
      ? detectLocale(value)
      : detectLocale(typeof navigator !== "undefined" ? navigator.language : "en");
  } catch {
    locale = "en";
  }
  applyDocumentLang(locale);
  let dict: Dict;
  try {
    dict = await loadDict(locale);
  } catch {
    // A dict chunk that can't be fetched (offline cold start on a locale the SW hasn't cached) must
    // not brick the app — English is always in the main bundle.
    locale = "en";
    dict = en;
  }
  useI18n.setState({ locale, dict, ready: true });
}
