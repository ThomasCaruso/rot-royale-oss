import { type Dict } from "@/i18n";
import { useI18n } from "@/store/i18n";

/** Returns the typed dictionary for the active locale. Components do `const t = useT();` then
 * `t.home.play` (autocompleted + compile-checked). Re-renders when the locale changes.
 *
 * Still synchronous even though non-English dicts are code-split: the store holds the resolved
 * dictionary and only swaps it once the chunk has landed (store/i18n.ts). */
export function useT(): Dict {
  return useI18n((s) => s.dict);
}

export { fmt } from "@/i18n";
