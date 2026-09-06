// Log-scale slider math + value formatting, shared by the LogSlider component, the Royale estimate
// round, and the dev harness. Kept in its own (non-component) module so fast-refresh stays happy.

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const geomMid = (a: number, b: number) => Math.sqrt(a * b); // midpoint on a log axis

/**
 * Round an estimate guess to a value that makes practical sense at its scale. Estimate answers are
 * whole counts ("how many X"), so under 100 we round to whole numbers — no 0.1, which was pointless
 * against a percentage acceptable band and outright contradicted the "nearest whole" prompts. Above
 * 100 we round to TWO significant figures, so a Fermi estimate reads "460,000", not a false-precision
 * "462,527". Purely cosmetic/granularity — the server still judges the guess against the band.
 */
export const roundNice = (v: number): number => {
  if (v <= 0) return 0;
  if (v < 100) return Math.round(v);
  const mag = 10 ** (Math.floor(Math.log10(v)) - 1); // 2 significant figures
  return Math.round(v / mag) * mag;
};
export const fmtNum = (v: number) => roundNice(v).toLocaleString();

/**
 * Format HOW FAR OFF a guess was, as a ratio ("1.8", "24", "2,400").
 *
 * Precision has to shrink as the ratio grows, which is why this is not just `toLocaleString`. Being
 * 1.8x out and 1.9x out are meaningfully different guesses, so the tenth earns its place. Being
 * 2,363.6x out and 2,364x out are the same guess — the decimal is noise dressed as precision, and
 * on a reveal card it reads as a machine talking rather than a game.
 */
export const fmtRatio = (r: number): string => {
  if (!isFinite(r) || r <= 0) return "";
  if (r < 10) {
    // One decimal, with a trailing ".0" dropped so an exact double reads "2", not "2.0".
    return String(Math.round(r * 10) / 10);
  }
  if (r < 100) return String(Math.round(r));
  // Past a hundred, two significant figures is all anyone reads anyway.
  return roundNice(r).toLocaleString();
};
