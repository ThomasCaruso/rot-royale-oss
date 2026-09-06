import { describe, expect, it } from "vitest";
import { clamp, fmtRatio, geomMid, roundNice } from "@/modules/estimate/logScale";

describe("roundNice — estimate guess granularity that makes practical sense", () => {
  it("rounds counts under 100 to whole numbers (no pointless 0.1)", () => {
    // The "nearest whole?" case that started this: 9.4 must read as 9, not 9.4.
    expect(roundNice(9.4)).toBe(9);
    expect(roundNice(9.6)).toBe(10);
    expect(roundNice(2.3)).toBe(2);
    expect(roundNice(1)).toBe(1);
    expect(roundNice(94)).toBe(94);
  });

  it("rounds big estimates to two significant figures (no false precision)", () => {
    expect(roundNice(117)).toBe(120);
    expect(roundNice(11736)).toBe(12000);
    expect(roundNice(462527)).toBe(460000);
    expect(roundNice(1000)).toBe(1000);
  });

  it("never produces decimals or negatives", () => {
    for (const v of [0.4, 0.9, 3.5, 47.2, 999.9, 250000.7]) {
      expect(Number.isInteger(roundNice(v))).toBe(true);
      expect(roundNice(v)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("clamp / geomMid", () => {
  it("clamps into range", () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-1, 1, 10)).toBe(1);
    expect(clamp(99, 1, 10)).toBe(10);
  });
  it("geomMid is the log-axis midpoint", () => {
    expect(geomMid(1, 100)).toBe(10);
    expect(geomMid(100, 10000)).toBe(1000);
  });
});

describe("fmtRatio — how far off, at a precision a person reads", () => {
  it("keeps a tenth where a tenth is a different guess", () => {
    expect(fmtRatio(1.818)).toBe("1.8");
    expect(fmtRatio(1.9)).toBe("1.9");
  });

  it("drops a trailing .0 so an exact double reads as a whole number", () => {
    expect(fmtRatio(2)).toBe("2");
  });

  it("stops pretending to a decimal once the ratio is large", () => {
    expect(fmtRatio(23.7)).toBe("24");
    // 2363.6x out and 2364x out are the same guess; the decimal is noise dressed as precision.
    expect(fmtRatio(2363.63)).toBe("2,400");
  });

  it("returns nothing for a ratio that is not a number", () => {
    expect(fmtRatio(Infinity)).toBe("");
    expect(fmtRatio(0)).toBe("");
  });
});
