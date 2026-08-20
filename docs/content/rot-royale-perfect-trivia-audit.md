# Rot Royale — Perfect Trivia Audit

**Author role:** Senior product strategist / trivia game designer / learning scientist / mobile QA lead
**Date:** 2026-07-07
**Scope:** Full audit of the current product and content system vs. the "perfect" version. No changes made. No new questions written. This is the strategy document that the next several PRs should be built against.

> **Read this first — the one nuance that changes several conclusions.** The raw JSON banks skew their correct answer toward index A. But `backend/app/modules/trivia.py` already **shuffles the four options server-side, deterministically per `(shuffle_seed, question_id)`**, and stores the *remapped* correctIndex. So at runtime, **players cannot exploit "always pick A."** The A-skew is a real problem — but it is an *authoring-quality and review-ergonomics* problem, not a live cheat vector. Do not spend a sprint "fixing answer randomization in the app"; it's already solved. Spend it balancing the *source banks* so reviewers, personalization, and any future non-shuffled surface aren't polluted. This distinction is threaded through Sections 4, 8, and 10.

---

## 1. Executive verdict

### What Rot Royale already does well
- **The wrapper is genuinely premium and differentiated.** The Daily Royale window model, the staged results reveal (score → rating delta → standings), the Rot Report verdict tiers ("Rot Gold" / "Rusty"), the duel "Run It Back" loop, and the honesty-first copy discipline (coins-are-cosmetic, no fake player counts, field-framed standings) are all better than 90% of trivia apps. **The game around the questions is the moat. It's real.**
- **The architecture is correct.** Anti-cheat split (`client_spec` never carries the answer), server-authoritative scoring, deterministic seeded generation, append-only coin ledger, review-gated ingestion with a locked 8-category set. This is a codebase you can scale content into without re-plumbing.
- **Learning is already wired into the moments that matter.** Explanations surface on reveal in Practice, Campaign, Rot Check, and Contest ("💡 Here's why…"). The retrieval-plus-immediate-feedback loop the research calls for **already exists in the UI.** You don't need to build the teaching surface — you need to fill it with content worth teaching.
- **Rot Check is a strong cold-open.** One-tap guest, 8-question calibration, a Brain Score + Rot Type reveal, soft account ask *after* value is shown. This is the right onboarding shape.

### What is holding it back
- **The content is the weak link, and content is the product.** A gorgeous reveal screen attached to "What is the largest planet?" is a gorgeous reveal of a question everyone already knows. The bank is **generic school trivia** in six categories and **under-built** in the two categories that are supposed to be the whole differentiation.
- **The two flagship differentiators are starved.** Money & Business has **26** questions. Street Smarts has **60**. These are the categories that make Rot Royale "the app that makes you smarter about real life" instead of "Trivia Crack with a nicer skin." Right now they're a rounding error. A player can exhaust Money & Business in **three sessions**.
- **Explanations are inconsistent.** The best ones (Money & Business credit-card compounding) teach a transferable mental model in one sentence. The worst ones (Street Smarts "A business can look successful and still run out of usable cash.") restate the answer without the *why* or the *takeaway*. There is no enforced standard, so quality is a coin flip.
- **No memory across sessions.** Missed questions are never resurfaced. There's no spaced review. The learning is real *in the moment* and then **thrown away.** The research conclusion the app most fails to honor is "spaced resurfacing of missed questions improves retention" — it does zero resurfacing.
- **Difficulty is nominal, not curated.** Difficulty is a hand-tagged enum with graceful fallback. There's no evidence the easy/medium/hard split is balanced or that "hard" actually means hard. The "I might know this ↔ damn, I learned something" zone is hit by accident, not by design.

### Closer to generic, useful, or truly differentiated?
**Today: a truly differentiated *game* wrapped around generic trivia *content*.** The shell is an 8/10. The content is a 4/10, dragged down further by the two categories that were supposed to be the point. Net product experience for a returning player after week one: **~5.5/10** — because the wrapper's novelty fades and the content underneath can't carry retention.

The gap is not "build more features." The gap is **"the questions aren't good enough or plentiful enough in the categories that make you special."**

### Top 5 fixes (highest leverage, in order)
1. **Balance and de-dupe the existing 732 across all 8 categories, and rewrite every explanation to the Section 8 standard.** Fix what you have before you add more. (Phase 1)
2. **10× Money & Business (26 → ~250) and 3× Street Smarts (60 → ~200), scenario-first.** These two categories are the product thesis. Fund them like it. (Phase 2)
3. **Ship missed-question resurfacing + lightweight spaced review.** This is the single biggest *retention* lever and it reuses existing screens. Turn one-shot learning into sticky learning. (Phase 4, but pull forward if you can)
4. **Enforce the explanation standard: answer + why + one takeaway, ≤ 240 chars.** Make it an ingest validation rule, not a hope. (Phase 3, but the *standard* lands in Phase 1)
5. **Add Category Mastery + a "Practical Intelligence" identity.** Give Money & Business and Street Smarts a home on the home screen and a progression arc, so the differentiator is *visible*, not buried in a category picker. (Phase 4)

---

## 2. Perfect trivia app definition

### What the player should feel in a 2-minute session
Sit down, get pulled into a **fast 8-beat rhythm** — read, decide under a 10s ring, lock, and get an instant green/red hit with a one-line "oh, *that's* why." Leave with **exactly one thing they didn't know before** and a **number that moved** (score, rating, streak, mastery). The emotional arc per session: *confident → challenged → surprised → slightly smarter → wanting one more.* No session should feel like studying, and no session should feel empty.

### What makes a question *fun*
- It lands in the **"I might know this"** zone — enough of a foothold to guess, enough doubt to care about the reveal.
- The distractors are **plausible and tempting**, not obviously wrong. A question with three throwaway options isn't a question, it's a formality.
- The stem has **voice** — a scenario, a "you," a hook — not a textbook prompt.
- The reveal delivers a small **"huh, neat"** payoff even when you got it right.

### What makes a question *useful*
- The takeaway is **transferable to a real decision or conversation.** "Interest compounds against you on minimum payments" changes behavior. "Jupiter is the largest planet" changes nothing.
- It teaches a **mental model or a pattern**, not an isolated fact. Useful questions make the *next* question in that domain easier.

### What makes a question *addictive without being cheap*
- **Retrieval, not recognition.** The player pulls the answer from memory (strengthens it) rather than eliminating obviously-wrong options (teaches nothing).
- **Just-out-of-reach difficulty** that ramps with the player, so the streak feels earned.
- **A reveal that resolves tension** — the reason you tapped "next" is you *need to know if you were right and why.* That's the healthy hook. Cheap hooks (fake timers, loot noise, manufactured scarcity) are the opposite; the codebase's honesty rules already ban them — keep it that way.

### What makes the app feel *premium*
- Restraint. Green means correct, red means wrong, gold means reward — and nothing else competes. Motion is purposeful and reduced-motion-safe (already true).
- **Content that respects the player's intelligence.** Premium is 80% "these questions are worth my time" and 20% chrome. Rot Royale currently has the chrome and needs the questions.
- Consistency: every reveal teaches, every explanation is the same shape, every category feels curated rather than scraped.

### What makes Rot Royale *different* from the incumbents
| App | Their thing | Rot Royale's wedge |
|---|---|---|
| **Trivia Crack** | Broad, casual, category wheel, cartoon | Rot Royale is *sharper and funnier* and has a **daily competitive event** with real settlement + rating. Trivia Crack has no "useful." |
| **Kahoot** | Classroom buzzer, host-driven, ephemeral | Rot Royale is **solo/async + friend duels**, persistent identity, no host needed. |
| **Duolingo** | Structured curriculum, streak guilt, feels like homework | Rot Royale is **learning by stealth** — you're competing and laughing, the smarter is a side effect. Never a lesson tree. |
| **Wordle** | One daily, shareable, pure | Rot Royale keeps the **one-daily-ritual** (Daily Royale = Wordle's discipline) but adds depth, progression, and duels underneath. |
| **Generic AI trivia apps** | Infinite bland auto-generated MC | Rot Royale is **human-reviewed, voice-y, and practical** — especially Money & Business and Street Smarts, which no AI-slop app has. |

**The one-sentence identity to defend:** *"Rot Royale is the fast, funny daily trivia game that actually makes you sharper about money, scams, and real life."* Everything in this audit serves that sentence. The six school categories are the *table stakes* that make it feel like real trivia; Money & Business + Street Smarts are the *reason it exists.*

---

## 3. Current app / product audit

### Home screen hierarchy — **7/10**
Top-to-bottom: HomeHeader (coins + avatar) → guest save banner → WelcomeCoach (first run) → **HeroCard (Daily Royale, state-machine driven)** → Battle Mode → hub rows (Brain Boost / Friends / Growth) → BottomNav (Home / Campaign / **Play** / Leaderboard / Vault).
- **Good:** The hero is genuinely state-aware (before/live/locked/settling/ready/viewed) and the Daily is correctly the marquee. Bottom nav elevates Play. Mono skin collapses to a clean single list.
- **Weak:** **The differentiators are invisible.** Money & Business and Street Smarts have no home-screen presence — they're buried inside category pickers under "Brain Boost." The home screen sells the *format* (daily, duel) but not the *promise* (get smarter about real life). A first-time visitor cannot tell this app is about practical intelligence.
- **Fix:** Add a "Practical Intelligence" / "Street Smarts of the day" surface (Section 9).

### Daily Royale — **8/10**
8-question trivia event, one seeded run per ET day, staged settlement, honest field counts. Round framing (Opening / Pressure / Crown Climb / Final Crown) is presentation-only flavor over a flat 8× trivia. Instant Rot Report on finish, dramatic Results modal after settlement.
- **Good:** This is the best thing in the app. The ritual + settlement + reveal is premium and honest.
- **Weak:** It's **trivia-only and mixed across all categories** (correctly, for fairness) — which means the Daily can never *showcase* the practical categories. It also lives or dies on bank quality: 8 mixed questions where 3 are "largest planet"-tier makes the flagship feel generic. **The Daily is a content-quality amplifier — it makes good content shine and bad content embarrassing.**

### Rot Check — **7.5/10**
One-tap guest → 8-question calibration → Brain Score + Rot Type + strengths/weaknesses + weak-spot topic → soft save. Explanations shown during the check (teaches while calibrating).
- **Good:** Best-in-class onboarding shape. "This is an early read, keep playing to refine it" is honest and inviting.
- **Weak:** The calibration is **mixed-category and doesn't meaningfully probe the practical categories**, so the "Rot Type" is really a school-trivia read. The weak-spot output isn't yet wired into resurfacing — you *tell* the player their weak spot and then never act on it. That's a broken promise the moment they notice.
- **Fix:** Make Rot Check the *entry point into a personalized learning loop* (Section 9), not a one-time vanity score.

### Duels — **8/10**
Bot duels (best-of-7, gem stakes, tiers) + live friend duels over WebSocket. Strong result screen (Victory/Perfect/Comeback/Defeat), "Run It Back" loop, honest gem framing.
- **Good:** Mechanically excellent, competitively addictive, socially real.
- **Weak (and this one matters):** **Duels show NO explanation on reveal.** The one high-frequency, high-engagement loop in the app teaches *nothing.* You've optimized duels for speed and dropped the "get smarter" pillar entirely here. A player can grind 40 duel rounds and learn zero facts.
- **Fix:** Add an optional post-duel "what you missed" recap (3 cards, the questions you got wrong, with explanations). Keep the in-round pace fast; move the teaching to the result screen. This is low-cost and reclaims the learning pillar for your stickiest loop.

### Campaign — **7/10**
Worlds → ladder → level → staged LevelComplete (coins, medals, frame unlock at world complete). Full explanations shown. Coins are cosmetic + daily-capped.
- **Good:** Good progression scaffolding; the frame-unlock-at-world-complete is a satisfying long arc; explanations always shown.
- **Weak:** Campaign is where **structured learning and mastery should live**, but it's currently a coin-earning ladder, not a curriculum. It doesn't ramp difficulty within a world in a principled way, and it doesn't feed missed questions into review. It's the natural home for Money & Business and Street Smarts "courses" and isn't using that.

### Leaderboards — **7.5/10**
Provisional/Final banners, podium, your-row-pinned, mono variant with rating ticker + sparkline + percentile. Honest field framing.
- **Good:** Competitive, honest, well-built. The mono "rating as ticker price" is a nice touch.
- **Weak:** Leaderboards are **global/ranked only.** There's no *category* leaderboard, no "Money & Business master of the week," no friend micro-leaderboard for the practical categories. The competitive loop doesn't reinforce the differentiator.

### Results / reveal screens — **8.5/10**
Best-in-class. Instant Rot Report + staged settlement modal + per-round reveal with explanation + gated confetti + count-ups. Reduced-motion-safe.
- **Weak:** The reveal shows the explanation but doesn't yet mark the question for **resurfacing** or offer a **"save this"** / "why this matters" deeper card. The learning moment is beautifully staged and then discarded.

### Question pacing — **7/10**
10s ring, splash → question → reveal, self-paced continue in practice/auto-advance in contest. Feels good. Risk: with weak distractors, 10s is too generous and the ring stops creating pressure. Pacing is only as good as difficulty calibration.

### Difficulty progression — **4/10**
Nominal enum with fallback. No evidence of a curated ramp, no adaptivity, no confidence that "hard" is hard. This is the quietest failure and it caps the "damn, I learned something" ceiling. **The perfect app tunes difficulty to the player; Rot Royale ships a static, hand-tagged, unbalanced mix.**

### Replayability — **5/10**
The *loops* are replayable (daily ritual, duels, campaign). But **content replayability is capped by bank depth**, and two categories can be exhausted in one sitting. Without resurfacing/new-content cadence, a 3-week daily player starts seeing repeats — fatal for a "daily" product.

### Reward loops — **7.5/10**
Coins (cosmetic, ledger-backed), gems (duels), frames/badges/titles, streaks, XP. Honest and non-predatory. **Weak:** rewards are all *cosmetic/competitive* — there is no reward tied to *learning* (no mastery badge, no "you've locked in 50 money concepts"). The reward system doesn't celebrate the thing the app claims to be about.

### Social / competitive loops — **8/10**
Friends graph, live duels, friends-today board on the Rot Report, leaderboards. Strong. **Weak:** no shareable *learning* moment (only shareable *scores*). "I got 6/8" is shareable; "I learned the anchoring trick that car dealers use" is *more* shareable and on-brand — and unbuilt.

### Where learning currently appears
Reveal explanations in Practice, Campaign, Rot Check, Contest. That's it. **Not in duels. Not across sessions. Not in any persistent "you're getting smarter" surface.**

### Where learning *should* appear
- **In duels** (post-match recap).
- **Across sessions** (missed-question resurfacing + spaced review).
- **On the home screen** (a practical-intelligence surface + mastery progress).
- **In a shareable moment** ("today I learned…").
- **In the reward system** (mastery badges).
- **In Rot Check's follow-through** (the weak spot becomes a training track, not a dead label).

---

## 4. Current content bank audit

**Live bank: 732 questions / 8 categories.** All four-option text MC. (Note: the seed JSON files in `backend/content/bank/` total ~686; the live DB has grown past the seeds. The audit uses the stated live figures.)

| Category | Live count | Verdict |
|---|---|---|
| Science & Nature | 122 | Deepest, most generic |
| Arts & Literature | 106 | Deep, school-flavored |
| History | 105 | Deep, date-recall risk |
| Pop Culture & Entertainment | 105 | Deep, decay risk |
| Geography | 104 | Deep, capital-recall risk |
| Sports | 104 | Deep, recall-heavy |
| **Street Smarts** | **60** | **Under-built flagship** |
| **Money & Business** | **26** | **Critically under-built flagship** |

### Category balance — **4/10**
Inverted priorities. The six commodity categories have 4–5× the depth of the two differentiators. **You have the most content in the categories that make you *least* special and the least in the ones that make you *most* special.** This is the single clearest strategic misallocation in the content set.

### Difficulty balance — **5/10 (unverified)**
Difficulty is tagged but not audited. No confidence the easy/medium/hard split matches the target (roughly 40/40/20 for a mass-market feel). Needs a distribution report per category before any conclusion — but the smart-money bet is "too easy overall" given the generic examples.

### Explanation quality — **5/10, wildly inconsistent**
- **Good (Money & Business):** *"Minimum payments mostly cover interest, so the balance barely shrinks while new interest keeps stacking on top of old interest — compounding working against you."* Answer + why + transferable model. This is the standard.
- **Weak (Street Smarts):** *"A business can look successful and still run out of usable cash."* Restates the answer, no *why*, no takeaway, no voice. Below standard.
- **Middling (Science):** *"Jupiter is the most massive planet…twice the mass of all others combined."* Factually fine but teaches nothing transferable — because the *question* has no transfer value.
- **No enforced format.** Length ranges from a fragment to two clauses. Ingest validates non-empty, nothing more. **Quality is unmanaged.**

### Duplicate risk — **6/10**
Upsert de-dupes on exact `(question, category)` — but a **stem reword creates a new key and orphans the old one** (documented in CLAUDE.md), and near-duplicate paraphrases slip through entirely. User confirms some duplicates exist. Needs a semantic-dedupe pass, not just exact-match.

### Answer-position balance — **6/10 at the bank, 9/10 at runtime**
Bank skews to A. **Runtime shuffle neutralizes the exploit** (per `trivia.py`). So: not a live fairness bug, but a real authoring/review smell and a landmine for any future non-shuffled use (exports, review tools, personalization features that read bank position). Fix at the source; don't panic about the app.

### Generic school-trivia risk — **3/10 (high risk)**
Six of eight categories read like a pub quiz or a 7th-grade worksheet. "Largest planet," "Magna Carta king," capital cities. **This is the biggest quality threat after the volume gap.** Fun trivia can be recall-based, but it needs *voice, surprise, or stakes* — most of these have none.

### Practical usefulness — **4/10**
Concentrated entirely in the two starved categories. The 570 questions in the six commodity categories are almost all "nice to know," not "changes a decision." That's fine for *some* of the bank — but the ratio is backwards for a "get smarter" product.

### Entertainment value — **5/10**
The *wrapper* is entertaining; the *questions* are mostly neutral. Few have a hook, a joke, a "no way," or a twist. The funny lives in the verdict tiers ("Rot Gold"), not in the content.

### "Would I share this?" — **3/10**
Almost no individual question is share-worthy. Nobody screenshots "the capital of Australia is Canberra." A great Street Smarts scam question or a spicy Money question *is* screenshot-bait. The share potential is unbuilt and concentrated in the two under-built categories.

### "Did I actually learn something?" — **4/10**
On a mixed Daily, a sharp adult learns ~1–2 things per 8, and often zero. In Money & Business, they learn ~5/8 — proof that the *format teaches fine when the content is good.* The content is the ceiling.

**Bank verdict:** Beautiful delivery system, under-loaded and generically loaded ammunition, with the two special rounds nearly empty.

---

## 5. Category-by-category scorecard

Scores 1–10. "Need for new content" is scored where **10 = most urgent.**

| Category | Fun | Useful | Replay | Diff. balance | Explanations | Brand fit | Viral/share | **New-content need** |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Science & Nature | 6 | 5 | 6 | 5 | 6 | 6 | 5 | 4 |
| Arts & Literature | 5 | 4 | 5 | 5 | 5 | 5 | 4 | 5 |
| History | 6 | 5 | 5 | 4 | 6 | 6 | 5 | 5 |
| Pop Culture & Ent. | 7 | 3 | 6 | 5 | 5 | 7 | 7 | 6 |
| Geography | 5 | 4 | 5 | 5 | 5 | 5 | 4 | 5 |
| Sports | 6 | 3 | 6 | 5 | 5 | 6 | 6 | 5 |
| **Street Smarts** | 7 | **9** | 7 | 4 | **4** | **10** | **9** | **9** |
| **Money & Business** | 6 | **10** | 7 | 4 | 7 | **10** | **8** | **10** |

**Reading the table:** The six commodity categories cluster at "fine, 5–6, not urgent." The two flagships score **9–10 on usefulness, brand fit, and share potential** and **9–10 on content need** — highest reward, lowest supply. **This table is the roadmap.** Money & Business explanations are the *best* in the bank (7) despite being the smallest — proof the authoring recipe is known; it just needs volume. Street Smarts explanations are the *worst* (4) despite the highest brand fit — the most urgent quality fix in the app.

**Notes:**
- **Pop Culture** has the highest decay risk (facts go stale) — needs a freshness cadence, not just volume.
- **Sports** and **Geography** are the most recall-exploitable and least useful; don't over-invest, but do add "why/how" flavor.
- **History** should shift from date-recall to cause/consequence to raise usefulness.

---

## 6. Money & Business — deep audit

**This should be Rot Royale's single strongest differentiator. Today it is the emptiest shelf in the store (26 questions).** Every serious adult wants to be smarter about money and nobody feels they are. This is the category that earns "Rot Royale made me smarter" reviews, drives word-of-mouth, and — later — justifies a premium pack. Fund it first and biggest.

### What exists now
- 26 questions. Quality of the *good* ones is high (the credit-card compounding example is a model question: scenario stem, tempting distractors, transferable takeaway). The recipe is proven; the volume is absent.

### What's missing
- **Volume** (needs ~250 to be a real category).
- **Coverage** across the subtopics below — right now it's a thin sampler.
- **A difficulty ramp** — a beginner needs "what is APR," an intermediate needs "why minimum payments trap you," an expert needs "opportunity cost of paying off a 3% mortgage early."

### Why it matters for retention & monetization
- **Retention:** practical money knowledge is *infinitely* interesting to adults and directly improves their lives — the strongest possible "one more" hook. It's also evergreen (unlike pop culture).
- **Monetization:** this is the category people would *pay* for as a premium pack ("Money Mastery: 200 scenarios"). It's the cleanest, most honest paid surface — you're selling education, not power. (v1 stays currency-only; this is the Phase 6 seam.)

### Concepts to include (the curriculum)
| Subtopic | Angle |
|---|---|
| Personal finance basics | Budgeting, emergency fund, needs vs wants, APR/interest |
| Investing basics | Compounding, diversification, index vs single stock, risk/return, time in market |
| Business models | How companies actually make money (subscription, marketplace, ads, freemium) |
| Startups | Runway, burn, product-market fit, why startups die (no customers > no cash) |
| Negotiation | Anchoring, BATNA, silence, never-split-the-difference basics |
| Pricing | Charm pricing, decoy effect, price anchoring, why "free" is a price |
| Scams / money traps | Ponzi tells, "guaranteed returns," advance-fee, MLM math |
| Consumer finance | Credit scores, minimum payments, "0% financing" catches, warranties |
| Inflation / rates | What inflation does to cash, why rates move prices, real vs nominal |
| Marketing / sales psychology | Scarcity, social proof, loss aversion in ads |
| Entrepreneurship | Margin vs volume, cash flow vs profit, unit economics |
| Wealth-building mental models | Pay yourself first, opportunity cost, compounding, asset vs liability |

### Concepts to AVOID (homework smell)
- Rote accounting definitions (debits/credits, GAAP line items).
- Tax-form minutiae, jurisdiction-specific law, anything that dates fast.
- Formula-plugging with no story ("calculate the NPV at 7%").
- Anything requiring a calculator under a 10s ring.
- Dry macroeconomic theory with no "you."

### Ideal easy/medium/hard split
**40 / 40 / 20.** Easy = recognize the concept ("What does APR mean?"). Medium = apply it to a scenario ("You pay only the minimum — what's the danger?"). Hard = a non-obvious trade-off or trap ("A 'guaranteed 12% monthly return' is most likely a…"). Skew slightly easier than the school categories — money intimidates people; the on-ramp must feel winnable.

### Ideal question templates
1. **"You…" scenario:** *"You carry a $1,000 balance at 24% APR and pay only the minimum. The real danger is…"* (the proven template — use it constantly).
2. **Spot-the-trap:** *"Which of these is the biggest red flag in an investment pitch?"*
3. **What's-really-happening:** *"A store offers '0% financing for 24 months.' What's the catch most people miss?"*
4. **Mental-model application:** *"You can pay off a 3% mortgage or invest at an expected 7%. The smarter move is usually… and the concept is called…"*
5. **How-do-they-make-money:** *"A free app with no ads and no subscription most likely makes money by…"*

### Ideal explanation style
`[Confirm the answer in 3–5 words] + [the why in one clause] + [one transferable takeaway/rule].`
Example: *"Right — interest compounds. Minimum payments mostly pay interest, so the balance barely moves. Rule of thumb: always pay more than the minimum, or the debt outlives you."*

### Bad vs perfect examples
**Bad:** *"What is the definition of a bond?"* → A) a loan to a company/government … Explanation: "A bond is a debt instrument." (Homework. Recognition, not retrieval. Zero stakes, zero takeaway.)

**Perfect:** *"You lend money by buying a bond. Interest rates then RISE. What happens to your bond's resale value?"* → A) Goes up  B) **Goes down**  C) Unchanged  D) Doubles. Explanation: *"It drops. New bonds pay more, so nobody wants your older, lower-paying one at full price — you'd have to sell at a discount. Takeaway: bond prices move opposite to rates."* (Scenario, tempting distractors, a counter-intuitive truth, a rule you keep.)

---

## 7. Street Smarts — deep audit

**This should be Rot Royale's "practical intelligence" signature — the category no competitor has and everyone wants.** It's the most viral, most brand-defining, most share-worthy category, and it's under-built (60) with the *worst* explanations in the app. Highest upside, currently squandered.

### What exists now
- 60 questions, some carrying legacy `lane`/`source` fields from a pilot ("world_works"). The good ones probe incentives and behavior; too many explanations are one flat sentence that restates the answer (the "cash flow" example). **The concept is right, the craft is thin.**

### What's missing
- Volume (needs ~200).
- **Explanation craft** — this is the category most damaged by weak explanations, because Street Smarts *is* the explanation. The whole payoff is the "here's the trick they use on you" reveal.
- Coverage of the modern-life subtopics below (scams, dark patterns, digital safety are thin).

### Why it can be extremely sticky
People are *hungry* to not be fooled. "Would I fall for this?" is irresistible, self-relevant, and immediately shareable ("sending this to my mom"). It's evergreen and emotionally charged in a good way — the player feels *protected and sharper*, not lectured.

### What makes it fun instead of preachy
- Frame as a **street-smart challenge, not a safety lecture.** "Which move keeps your money?" beats "Always be careful with strangers."
- Use **real scenarios with a villain** (the scammer, the manipulator, the dark-pattern designer) — the player outsmarts someone.
- **Name the tactic** in the reveal ("this is called *phantom scarcity*") — naming the trick is the dopamine.
- Keep it **morally light and occasionally funny.** Preachy is the failure mode; wry is the target.

### Ideal easy/medium/hard split
**35 / 45 / 20.** Street Smarts is inherently scenario-based, so lean medium. Easy = obvious tells ("A stranger emails that you won a lottery you never entered. This is…"). Medium = subtler manipulation ("A 'limited time — 3 left!' banner is designed to trigger…"). Hard = layered / counter-intuitive ("The MOST convincing scams usually start by…").

### Ideal question templates
1. **Spot-the-scam:** *"You get a text: 'Your package is held, pay $1.99 to release it.' The tell that it's a scam is…"*
2. **Name-the-tactic:** *"A salesperson goes silent after stating a price, waiting for you to speak. This tactic is…"*
3. **What-would-you-do (best move):** *"A 'friend' urgently DMs asking for gift cards. The correct move is…"*
4. **Read-the-situation:** *"Every review is 5 stars, posted the same week, in similar broken English. Most likely…"*
5. **Spot-the-dark-pattern:** *"The 'cancel' button is gray and tiny; 'keep subscription' is huge and green. This is a…"*

### Ideal explanation style
`[Name the tactic/tell] + [why it works on people] + [the counter-move].`
Example: *"That's *urgency + a tiny fee* — scammers use small amounts and time pressure so you pay before thinking. Counter: real carriers never text for a $1.99 'release.' Look it up on the official site, never the link."*

### Bad vs perfect examples
**Bad (current-style):** *"Why does cash flow matter?"* → "Bills get paid with real cash, not paper profit." Explanation: *"A business can look successful and still run out of usable cash."* (Restates the answer, no tactic named, no takeaway, no voice, and honestly it's a *Money* question wearing a Street Smarts jacket.)

**Perfect:** *"A caller says he's from your bank's 'fraud team,' already knows your name and last 4 digits, and needs your code to 'stop a charge.' The safest move is…"* → A) Give the code — he already has your info  B) **Hang up and call the number on your card**  C) Ask him to verify the charge first  D) Give it only if he sounds official. Explanation: *"Hang up and call back. Knowing your name and last 4 is easy for scammers — it's *false authority*. Your real bank never needs a code you received; the code IS the key. Rule: you call them, never the other way."* (Villain, tempting "he already knows my info" distractor, named tactic, a rule that protects you for life.)

### Street Smarts subtopics to cover
Scams · Manipulation tactics · Social pressure · Negotiation · Digital safety · Fake reviews · Misinformation · Dark patterns · Decision-making biases · Safety / common sense · Real-world problem solving · Reading people & situations.

---

## 8. Perfect question formula (the writing standard)

Make this a **linted ingest rule**, not a style suggestion. Where a rule can be validated by code, validate it.

### Hard limits
- **Stem:** ≤ 120 characters (≈ 20 words). Readable in one glance under a 10s ring. Scenario stems may reach 140; never more.
- **Option:** ≤ 40 characters each. Four options must be scannable in ~2 seconds. Parallel grammatical structure.
- **Explanation:** 90–240 characters. Long enough to teach, short enough to read before the auto-advance. **Reject empty AND reject < 40 chars** (kills the "restates the answer" failure).

### Every explanation MUST contain (all three)
1. **Confirmation** of the correct answer (a few words).
2. **The why** — the mechanism/reason, not a restatement.
3. **One takeaway** — a transferable rule, model, or "so remember…". (For recall categories where a takeaway is forced, allow a "fun fact" hook instead — but prefer a takeaway.)

### How to make questions punchy
- Lead with the hook or the "you." Cut throat-clearing ("In the field of…", "It is commonly known that…").
- One idea per question. If you're testing two things, it's two questions.
- Active voice, second person where natural.

### How to be funny without cringe
- Funny lives in **distractors and voice**, rarely in the stem. One absurd-but-plausible wrong option is delightful; a joke stem is groan-y.
- Dry > zany. Let the *situation* be funny, don't editorialize.
- Never punch down, never meme-chase (dates instantly), never force it. If it's not naturally funny, be *clean* instead.

### How to avoid homework tone
- No "Which of the following is the definition of…". Convert every definition question into an *application* question.
- No pure date/name/capital recall unless there's a twist or a why.
- Always answer "why would a smart adult care?" before shipping the question.

### How to build good distractors
- All three wrong options must be **plausible to someone who half-knows** the topic.
- Include the **common misconception** as a distractor — that's where the learning happens.
- No "all/none of the above," no obvious throwaway, no joke option in serious categories.
- Same length/register as the correct answer (length is a tell — audit for it).

### How to classify easy / medium / hard
- **Easy:** a generally-informed adult gets it from recognition. ~75–85% expected correct.
- **Medium:** requires applying a concept or knowing a non-obvious fact. ~50–65%.
- **Hard:** counter-intuitive, layered, or expert. ~30–45%. Hard ≠ obscure; a good hard question is one where the *tempting* answer is wrong.
- Tag by **expected success rate**, and once live data exists, **re-tag from actual correct-rate** (Section 11).

### How to avoid ambiguity
- Exactly one defensibly-correct option. No "best answer among two rights."
- No double negatives. No "which is NOT" unless unavoidable (and then bold the NOT).
- Avoid absolutes ("always/never") in the *stem* unless the answer hinges on them.

### How to avoid outdated facts
- Prefer evergreen framings. For Pop Culture / current events, tag a **`freshness`/review-by** signal and schedule re-review.
- No "current" superlatives without a year anchor ("As of 2026, …").

### How to tag for future personalization
Recommend extending the ingest schema (or a sidecar) with optional metadata — several of these already have hooks in the AI-personalization work:
- `subtopic` (e.g., "negotiation", "scams") — enables mastery & resurfacing by concept.
- `skill_type`: `recall | application | reasoning` — powers difficulty adaptivity.
- `practical` (bool) — flags "changes a decision" content for the practical-intelligence surface.
- `freshness`: `evergreen | dated` + optional review-by.
- `expected_correct_rate` (author estimate → replaced by live rate).
- `share_worthy` (bool) — candidate for the shareable-learning-moment surface.

---

## 9. Game design recommendations

Product changes that make the content hit harder. Ordered by leverage.

### Missed-question resurfacing (highest leverage)
When a player misses a question, mark it. Re-serve it (reshuffled) 1–3 sessions later in Practice/Campaign. This is the retrieval-practice spacing effect — **the single biggest retention + "actually got smarter" lever**, and it reuses existing screens. Store per-user miss records; inject a few "review" slots into practice generation. Never inject into ranked Daily (fairness).

### Spaced review
Layer a light SM-2-style interval on top of resurfacing: a missed concept comes back sooner, a mastered one drifts away. Surface as a "Sharpen" / "Review" mode. Keep it invisible and game-y — **never a Duolingo lesson tree.**

### "Why this matters" reveal cards
For `practical`-tagged questions, add an optional expandable card on reveal: one extra sentence of real-world application ("Dealers use this exact anchor on the sticker price"). Opt-in tap, not forced. This is where Money & Business and Street Smarts earn their reviews.

### Category mastery
Per category (per subtopic ideally): a mastery meter that fills as you answer correctly across sessions (weighted to first-try + resurfaced-and-now-correct). Show it on the home screen and category screens. This gives the six commodity categories a *reason to replay* and gives the flagships a progression arc.

### Practical Intelligence badges
A distinct badge/identity track for Money & Business + Street Smarts ("Scam-Proof", "Money Mind", "Street Smart"). These are the *on-brand* rewards the current cosmetic-only system lacks. Tie to mastery, not spend — no pay-to-win.

### Weekly themed packs
A rotating themed set ("Scam-Proof Week", "Money Traps", "How Companies Make Money"). Free, drives weekly return, showcases the flagships, and is the content shape that *later* becomes a premium pack (Phase 6). Gives the Daily/home something fresh weekly without needing 300 new questions a week.

### Streak protection without pay-to-win
A "streak freeze" earned through play (e.g., one banked per 7-day streak, or a Campaign reward) — **never purchasable.** Protects the daily ritual without becoming a Duolingo-style guilt-monetization. Honesty rules already point here; keep it earned-only.

### Shareable learning moments
A one-tap "I learned…" share on reveal for `share_worthy` questions: a clean card with the scenario + the takeaway (not the answer key — tease it). Street Smarts scam cards and spicy Money cards are the growth engine here. Currently you only share *scores*; share *smarts*.

### Better campaign integration
Turn Campaign worlds into **practical courses** for the flagships: a "Money Mastery" world, a "Street Smarts" world, with a real difficulty ramp and mastery payoff. Campaign becomes the curriculum home; Daily stays the mixed arena.

### Better Rot Check integration
Close the loop: the weak spot Rot Check identifies should **auto-seed a review/training track** and appear as a home-screen nudge ("Your weak spot: Money traps — train it"). Right now Rot Check diagnoses and then abandons the patient.

### How Money & Business + Street Smarts should show up on the home screen
- A dedicated **"Sharpen your real-world smarts"** surface (below the Daily hero): a rotating Street-Smart-of-the-day and Money-move-of-the-day card — one tap, one question, one great reveal. Low-commitment, high-brand, daily.
- A **Practical Intelligence progress** strip (mastery meters for the two flagships) so the differentiator is *visible* on the primary screen.
- This is what tells a new user in 3 seconds that Rot Royale is *not* generic trivia.

---

## 10. Perfect Rot Royale roadmap

### Phase 1 — Fix what you have (bank quality + the answer-position smell)
- Audit difficulty distribution per category; produce the real easy/medium/hard split.
- Semantic de-dupe pass (beyond exact-match) across all 732; kill near-duplicates and orphaned stems.
- Rewrite every explanation to the Section 8 standard; add the ingest lint (≥ 40 chars, three-part structure where checkable).
- **Balance correct-answer positions in the source banks** (not the app — runtime shuffle already handles fairness; this is authoring hygiene + future-proofing).
- Convert the worst "definition/recall" questions in the six commodity categories into application framings.
- *Exit criterion:* every served question passes the lint; no category has a > 45% single-position skew at source; zero known duplicates.

### Phase 2 — Expand the differentiators
- **Money & Business 26 → ~250**, scenario-first, 40/40/20, full subtopic coverage (Section 6).
- **Street Smarts 60 → ~200**, 35/45/20, tactic-named explanations, modern subtopics (Section 7).
- Add `subtopic`, `skill_type`, `practical`, `share_worthy` tags during authoring.
- *Exit criterion:* both flagships are deep enough that a daily player can't exhaust them in a week; both score ≥ 7 on explanation quality.

### Phase 3 — Explanations / reveals
- Ship "why this matters" cards for `practical` questions.
- Add the post-duel "what you missed" recap (reclaims learning in the stickiest loop).
- Shareable-learning-moment card for `share_worthy` questions.

### Phase 4 — Mastery + spaced review
- Missed-question resurfacing (per-user miss store → practice injection).
- Spaced-review "Sharpen" mode.
- Category/subtopic mastery meters + Practical Intelligence badges.
- Wire Rot Check weak-spot → training track.
- Home-screen practical-intelligence surface + mastery strip.

### Phase 5 — Special formats / images / events
- Introduce **scenario** and **image** module types (the plugin system supports adding module types without touching the engine — this is a content+component add, not a re-architecture).
- Weekly themed packs as a recurring event.
- Rare, deliberate use of true/false only inside a special mode (never in ranked — guess rate too high).

### Phase 6 — Monetization around premium practical packs
- Premium content packs (Money Mastery, Scam-Proof) as the honest paid surface — selling education, not power. Keep coins/gems cosmetic-and-earned; premium is *content depth*, never advantage. (v1 stays currency-only; this is the seam the ledger already anticipates.)

---

## 11. Brutal priority list

### Top 10 to fix IMMEDIATELY
1. **Money & Business is 26 questions. That's not a category, it's a sample.** Fund it to 250.
2. **Street Smarts explanations are the worst in the app** and it's your most on-brand category. Rewrite every one to name-the-tactic + why + counter-move.
3. **Enforce the explanation standard as an ingest lint** (≥ 40 chars, three-part). Stop shipping "restates the answer" explanations.
4. **De-dupe the bank** — semantic, not just exact-match. Duplicates in a "daily" product are a credibility hit.
5. **Balance correct-answer positions at the source.** (Authoring hygiene — the app already shuffles; do NOT rebuild randomization in the app.)
6. **Convert the worst commodity-category recall questions to application framings** — kill the "largest planet" energy.
7. **Audit and re-tag difficulty** so easy/medium/hard mean something and the ramp is real.
8. **Add a home-screen practical-intelligence surface** so a new user instantly sees the differentiator.
9. **Add the post-duel "what you missed" recap** — your highest-frequency loop currently teaches nothing.
10. **Wire Rot Check's weak spot to an actual training nudge** — stop diagnosing and abandoning.

### Top 10 NOT to waste time on yet
1. **Rebuilding answer randomization in the app** — already solved by runtime shuffle.
2. **Phaser mini-games / new game modes** — Phaser is unused scaffolding; content is the bottleneck, not modes.
3. **More Science/Sports/Geography questions** — deep enough; low differentiation ROI.
4. **True/false format** — guess rate too high; defer to a special mode only.
5. **Image/scenario module types** — Phase 5; don't block on new formats while MC content is thin.
6. **New cosmetic themes/frames** — the Vault is rich enough; cosmetics aren't the retention gap.
7. **Real-money / payments** — out of v1 scope; the ledger seam is enough for now.
8. **Complex adaptive-difficulty ML** — start with the simple resurfacing + expected-correct-rate loop.
9. **A social feed / chat / DMs** — explicitly out of scope; friends + duels are enough.
10. **Category leaderboards** — nice, but after the content is worth competing over.

### What Claude should implement NEXT (after this audit)
1. **A bank-analysis script** (read-only) that reports, per category: count, difficulty split, correct-answer-position distribution *at source*, explanation-length histogram, and exact/near-duplicate candidates. This turns every Phase 1 claim into a number and defines the cleanup work precisely. **Do this first — measure before authoring.**
2. Then the **ingest explanation lint** (Section 8 rules) so no new content lands below standard.
3. Then begin the **Money & Business content generation** against the Section 6 spec.

### What content should be generated NEXT
- **Money & Business, ~225 new questions** to the Section 6 spec (40/40/20, all subtopics, scenario-first, tagged). Highest ROI in the entire product.
- Then **Street Smarts, ~140 new questions** to the Section 7 spec.
- In parallel, **rewrite the existing Street Smarts 60 explanations** to standard (small, high-impact).

### What metrics to track once new questions go live
- **Per-question actual correct-rate** → re-tag difficulty from reality; flag "hard" that's really easy and vice-versa.
- **Explanation read-time** (`explanation_read_ms` already tracked) → are the practical explanations actually being read?
- **Category selection & completion rate** — do Money/Street Smarts get *picked* once surfaced? (The bet is yes.)
- **Resurfacing outcome** — % of previously-missed questions answered correctly on second exposure (the direct "did learning happen" metric).
- **D1/D7/D30 retention split by whether the player touched a flagship category** (the differentiation thesis test).
- **Share rate on learning moments** vs. score shares (growth-engine test).
- **"Item quality" flags:** questions with near-random correct-rate (ambiguous), near-100% (too easy/filler), or high skip/timeout (too hard/confusing) → author review queue.

---

## Closing summary

1. **Current score:** **5.5 / 10** — a premium, differentiated *game* (8/10 wrapper) wrapped around generic, under-built *content* (4/10), with the two categories that justify the app's existence nearly empty.
2. **Perfect-version target:** **9 / 10** — same premium wrapper, now loaded with deep, scenario-first, genuinely-useful content; Money & Business and Street Smarts as flagship differentiators; a resurfacing/mastery loop that turns momentary learning into retained learning.
3. **Top 5 highest-leverage fixes:** (1) Fix & de-dupe the existing 732 + rewrite explanations to standard; (2) 10× Money & Business and 3× Street Smarts, scenario-first; (3) missed-question resurfacing + spaced review; (4) enforce the explanation standard as an ingest lint; (5) surface Practical Intelligence (mastery + home-screen presence) so the differentiator is visible.
4. **Next implementation step:** Build the **read-only bank-analysis script** (per-category count, difficulty split, source answer-position distribution, explanation-length histogram, duplicate candidates). Measure the bank precisely, then land the explanation lint, then generate Money & Business content. **Measure first, author second.**
