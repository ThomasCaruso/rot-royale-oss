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
