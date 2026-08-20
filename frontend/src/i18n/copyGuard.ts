/**
 * Copy-honesty guard policy (DESIGN §7) — the SINGLE source of truth for the banned-term lists and
 * the matcher shared by every copy-guard test (i18n + rendered-UI). Coins and Gems are a closed-loop,
 * earned-only cosmetic economy: player-facing copy must never use money / gambling framing in ANY
 * language. Centralised here so the lists can't drift across the suite.
 *
 * Matching has two tiers because some terms are safe as substrings and some are not:
 *  - BANNED_SUBSTR — matched anywhere: stems ("gambl" → gambling/gambler/gamble), non-English roots
 *    ("apuesta", "kumar"), and whole words with no benign English superword ("deposit", "redeem").
 *  - BANNED_WORD — matched on WORD BOUNDARIES only, because the term is a substring of innocent words
 *    ("bet" ⊂ better/alphabet, "stake" ⊂ mistake, "staking" ⊂ mistaking). A naive substring scan
 *    here would flag honest copy, so each inflection is enumerated and boundary-matched.
 *
 * ALLOWED_PHRASES are disavowals that legitimately contain a banned substring ("no cash value"
 * contains "cash"); they are stripped before the substring scan so the honesty copy the product is
 * REQUIRED to show is never itself counted as a violation.
 *
 * The lists cover MONEY and GAMBLING framing only. Counting language ("8 players") is no longer
 * policed here — see the note under BANNED_SUBSTR.
 */

// Substring bans (case-insensitive, matched anywhere in the text).
export const BANNED_SUBSTR: readonly string[] = [
  // money / prize framing
  "cash",
  "prize",
  "payout",
  "jackpot",
  // wagering — stems cover inflections (wager → wagering/wagered)
  "wager",
  "gambl", // gambling / gambler / gamble
  "casino",
  "lottery",
  // banking verbs — no benign English superword, so safe as substrings (catches inflections too)
  "deposit", // deposit / deposits / deposited
  "withdraw", // withdraw / withdrawal / withdrawn
  "redeem", // redeem / redeemed / redeemable
  "redemption",
  // multi-word money phrases
  "paid entry",
  "real money",
  // non-English gambling roots (es / tr)
  "loter",
  "apuesta",
  "premio",
  "bahis",
  "kumar",
  "ikramiye",
  "piyango",
];

// NOT banned: "player"/"players". It was on the substring list while a thin Daily Royale field was
// padded with cold-start bots — calling that mixed field "8 players" would have been a lie. The bots
// are gone and the field is real entries only, so naming the humans who actually played is now the
// honest wording, and the vaguer "field of 8" was the misleading one. What stays banned is
// fabricated real-time human liveness (a "4,258 watching" count, fake chat) — that is a UI concern,
// not a word this list can catch.

// Word-boundary bans — matched only as whole words. These ARE substrings of innocent words
// (better/alphabet ⊃ bet, mistake ⊃ stake, mistaking ⊃ staking), so a substring scan would
// false-positive on honest copy. Inflections are enumerated because a prefix match (\bbet…) would
// re-introduce the false positive ("better").
export const BANNED_WORD: readonly string[] = [
  "bet",
  "bets",
  "betting",
  "bettor",
  "bettors",
  "stake",
  "stakes",
  "staking",
  "staked",
];

// Disavowals allowed even though they contain a banned substring (e.g. "no cash value" ⊃ "cash").
// Stripped before the substring scan. "No cash value" is REQUIRED honesty copy, never a violation.
export const ALLOWED_PHRASES: readonly string[] = ["no cash value"];

// i18n keys (flattened "ns.key") exempt from the key-level scan: the legally-required no-cash-value
// disavowal, which by design NAMES "cash"/"redeemed" in order to disavow them. The ONLY exemption —
// the guard stays at full strength for every other string in every locale.
export const EXEMPT_KEYS: ReadonlySet<string> = new Set(["duel.disclaimer"]);

const WORD_RE = new RegExp(`\\b(?:${BANNED_WORD.join("|")})\\b`, "gi");

/**
 * Every banned term found in `text` (empty array ⇒ clean). Case-insensitive. ALLOWED_PHRASES are
 * removed first so honest disavowals aren't flagged. Use on i18n values AND on rendered UI markup.
 */
export function findBannedTerms(text: string): string[] {
  let scrubbed = text.toLowerCase();
  for (const phrase of ALLOWED_PHRASES) scrubbed = scrubbed.split(phrase).join(" ");
  const hits: string[] = [];
  for (const term of BANNED_SUBSTR) if (scrubbed.includes(term)) hits.push(term);
  const wordHits = scrubbed.match(WORD_RE);
  if (wordHits) hits.push(...wordHits);
  return hits;
}
