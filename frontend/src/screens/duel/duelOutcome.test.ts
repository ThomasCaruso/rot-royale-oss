import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { outcomeCopy, toneColor } from "@/screens/duel/duelOutcome";

const d = en.duel;

describe("outcomeCopy", () => {
  it("user_win + correct_vs_wrong → roundWon, green", () => {
    const c = outcomeCopy(en, "user_win", "correct_vs_wrong");
    expect(c).toEqual({ title: d.roundWon, sub: d.roundWonSub, tone: "win" });
  });

  it("user_win + speed_gap → speedWin, green", () => {
    const c = outcomeCopy(en, "user_win", "speed_gap");
    expect(c).toEqual({ title: d.speedWin, sub: d.speedWinSub, tone: "win" });
  });

  it("rival_win + correct_vs_wrong → roundLost (wrong sub), red", () => {
    const c = outcomeCopy(en, "rival_win", "correct_vs_wrong");
    expect(c).toEqual({ title: d.roundLost, sub: d.roundLostSubWrong, tone: "lose" });
  });

  it("rival_win + speed_gap → roundLost (speed sub), red", () => {
    const c = outcomeCopy(en, "rival_win", "speed_gap");
    expect(c).toEqual({ title: d.roundLost, sub: d.roundLostSubSpeed, tone: "lose" });
  });

  it("no_point + both_wrong → noPointBothWrong, neutral", () => {
    const c = outcomeCopy(en, "no_point", "both_wrong");
    expect(c).toEqual({ title: d.noPointBothWrong, sub: d.noPointBothWrongSub, tone: "neutral" });
  });

  it("no_point + near_tie_correct → noPointTie, neutral", () => {
    const c = outcomeCopy(en, "no_point", "near_tie_correct");
    expect(c).toEqual({ title: d.noPointTie, sub: d.noPointTieSub, tone: "neutral" });
  });

  it("user_win with a tiebreak reason still wins (falls back to roundWon)", () => {
    const c = outcomeCopy(en, "user_win", "tiebreak_speed");
    expect(c.tone).toBe("win");
    expect(c.title).toBe(d.roundWon);
  });

  it("rival_win with a tiebreak reason still loses", () => {
    const c = outcomeCopy(en, "rival_win", "tiebreak_speed");
    expect(c.tone).toBe("lose");
    expect(c.title).toBe(d.roundLost);
  });

  it("no_point with an unknown reason falls back to both-wrong copy, neutral", () => {
    const c = outcomeCopy(en, "no_point", "something_new");
    expect(c.tone).toBe("neutral");
    expect(c.title).toBe(d.noPointBothWrong);
  });
});

describe("toneColor", () => {
  it("maps tone → CSS token (win green, lose red, neutral muted)", () => {
    expect(toneColor("win")).toBe("var(--lime)");
    expect(toneColor("lose")).toBe("var(--pink)");
    expect(toneColor("neutral")).toBe("var(--muted)");
  });
});
