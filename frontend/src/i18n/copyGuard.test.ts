/**
 * Self-test for the copy-honesty guard (copyGuard.ts). This proves the guard is not a no-op: every
 * banned term the product committed to blocking is actually caught, the allowed/safe vocabulary the
 * Duel + Gems UI relies on is NOT flagged, and the word-boundary tier doesn't false-positive on
 * innocent words that merely CONTAIN a short banned token (better/alphabet/mistake).
 */
import { describe, expect, it } from "vitest";
import { findBannedTerms } from "@/i18n/copyGuard";

describe("copyGuard — banned terms are caught (the guard has teeth)", () => {
  // The full Phase-6 banned list. Each must be detected inside ordinary copy.
  const MUST_FLAG: Array<[string, string]> = [
    ["bet", "Place a bet on the next round"],
    ["betting", "No betting allowed here"],
    ["wager", "Wager your coins"],
    ["wagering", "Wagering is prohibited"],
    ["stake", "Raise the stake"],
    ["staking", "Try staking your gems"],
    ["deposit", "Make a deposit"],
    ["withdraw", "Withdraw your balance"],
    ["withdrawal", "Request a withdrawal"],
    ["redeem", "Redeem your points"],
    ["redemption", "A redemption is available"],
    ["cash", "Win real cash today"],
    ["prize", "Claim your prize"],
    ["jackpot", "Hit the jackpot"],
    ["gambling", "This is gambling"],
    ["casino", "Visit the casino"],
    ["payout", "Instant payout"],
    ["paid entry", "This is a paid entry contest"],
    ["real money", "Play for real money"],
  ];

  it.each(MUST_FLAG)("flags %s", (_label, copy) => {
    expect(findBannedTerms(copy).length).toBeGreaterThan(0);
  });
});

describe("copyGuard — allowed Duel/Gems vocabulary is NOT flagged", () => {
  // The safe terms the spec requires us to preserve. None may register as a violation.
  const MUST_PASS = [
    "Gems",
    "Entry",
    "Match Pool",
    "Winner earns the pool",
    "Duel",
    "Training Duel",
    "Spark Duel",
    "Crown Duel",
    "Royal Duel",
    "No cash value", // disavowal — allowed even though it contains "cash"
    "Choose your tier",
    "Training Duel. Just for fun",
  ];

  it.each(MUST_PASS)("passes %s", (copy) => {
    expect(findBannedTerms(copy)).toEqual([]);
  });
});

describe("copyGuard — word-boundary tier doesn't false-positive on innocent words", () => {
  // "bet" ⊂ better/alphabet, "stake" ⊂ mistake, "staking" ⊂ mistaking — honest copy must pass.
  const INNOCENT = [
    "You did better than before",
    "Learn the alphabet",
    "Don't make a mistake",
    "We are mistaking the answer",
    "A sherbet reward", // contains "bet"
    "Between rounds", // contains "bet"
  ];

  it.each(INNOCENT)("passes %s", (copy) => {
    expect(findBannedTerms(copy)).toEqual([]);
  });
});
