/** "DAILY ROYALE" → "Daily Royale": the i18n titles are arcade-shouty uppercase; the mono skins
 * speak in title case. Locale-aware lowering so accented titles re-case correctly. */
export function titleCase(s: string): string {
  return s
    .toLocaleLowerCase()
    .split(" ")
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase() + w.slice(1) : w))
    .join(" ");
}
