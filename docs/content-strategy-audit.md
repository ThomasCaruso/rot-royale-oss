# Rot Royale — Content System Audit & Strategy (pre-content pass)

> Audit + strategy only. No code, no new banks, no ingestion. North star: **fun trivia about how
> the world actually works — useful by accident, addicting by curiosity, smarter without feeling
> responsible.**

## 1. Executive summary

Rot Royale's **shell is excellent and on-vibe**; its **content is not**. The loops (guest-first,
Starter Check → Brain Profile reveal → save-after-value), the reveal moment, the share titles ("Final
Boss", "Brain Rot Detected"), the Rot Types ("Space Goblin", "Meme Scholar"), and the duel loop
("Run It Back") are Wordle/Trivia-Crack-grade. The **questions are pub-quiz-app-grade**: 672 rows,
of which ~600 are generic recall ("capital of Australia", "which organ pumps blood", "what is 15% of
200") and the one category built for the new direction — **Money & Business (26 Q)** — is roughly
half genuinely on-vibe (loss leaders, Ponzi schemes, manufactured urgency) and half
**financial-literacy-class chores** (emergency fund, tax brackets, ETF/bond/dividend definitions,
GDP). So the game currently *teaches to the wrong north star* in the one place it tries hardest.

Three structural facts shape everything:

- **The AI layer is empty.** Only **3 / 672** questions are classified (`question_ai_metadata`). The
  bulk classify run was killed mid-job. So personalization ranking is a near-total pass-through,
  `weak_spot_topic` is `null` for essentially everyone, and the "AI-personalized" copy is currently
  a promise with nothing behind it.
- **88% of the bank is untracked.** ~593 of 672 questions were ingested from JSON files that are
  **not in the repo**. They can't be reviewed, diffed, or regenerated. Only Money & Business (26) and
  the tiny legacy `trivia.json` (40) + `sample_bank.json` (13) are in version control.
- **The taxonomy is locked at 7 categories**, but the new direction ("Scam Radar", "Empire Mode",
  "Tech Traps") is a set of **cross-category vibes**, not new categories. The clean move is to
  express lanes as **subcategory + topic_tags + curated collections** over the locked 7 — the
  metadata fields for this already exist and are unused.

The good news: the fix is **content + a thin lane/tag layer**, not a rebuild. The shell is ready.

## 2. Biggest current risk

**The content violates the two research failure modes the shell was built to avoid.**

- **QuizUp failure ("broad trivia, no reason to care"):** the base 600 are context-free recall. A
  player who knows "capital of Australia" feels nothing; one who doesn't, learns nothing worth
  saying out loud. There is no *reason to care*, so there's no reason to return for the content
  itself — only for the streak/leaderboard scaffolding, which HQ/QuizUp proved is not durable alone.
- **Educational-game failure ("instruction before gameplay"):** the moment Rot Royale reaches for
  "useful," it slides into a literacy worksheet (emergency fund, marginal tax brackets, "define
  diversification"). That's the exact "school but gamified" trap. Useful is fine; *responsible* is
  poison.

Second-order risk: the **"AI-personalized" promise is unfunded** (3/672 classified). Shipping copy
that claims personalization the engine can't deliver erodes trust and wastes the best asset (the
metadata schema, which is genuinely well-designed).

**One-line risk:** *A world-class trivia shell wrapped around forgettable and/or homework-y
questions, promising an AI personalization it hasn't turned on.*

## 3. Product loop audit (first session)

| Step | Value before friction? | Next action obvious? | Game or productivity? | Notes |
|---|---|---|---|---|
| **Open / splash** | n/a | n/a | Neutral | Bare "Rot Royale…" loader; fine. |
| **Intro (BrainBoostIntro)** | ✅ yes | ✅ "START CHECK" | Game, mostly | "8 questions. 2 minutes." + "No signup needed." is strong. Drag: the sub-label **"8 questions · 2 min · AI-personalized"** — "AI-personalized" reads like a feature spec, and it's currently untrue. |
| **Guest creation** | ✅ silent (one call, no form) | ✅ drops into check | Game | Best-in-class. No wall. |
| **Starter Check (8Q)** | ✅ playing immediately | ✅ per-question Continue | Game | Self-paced reveal + "💡 Here's why". BUT the questions are the generic base bank → the calibration feels like a quiz, not a hook. This is the first place the content undercuts the shell. |
| **Brain Profile reveal** | ✅ big payoff | ✅ "SAVE MY PROFILE" / "Keep playing" | Game (peak moment) | Confetti, CountUp score, Rot Type, Sharpest/Needs-work. Strongest moment in the app. Two frictions: (a) **"Brain Score" 642 with no scale** — 300–900 is never shown, so the number is meaningless on first read; (b) **"Needs work"** reads like a report card ("Blind spot"/"Room to grow" is more game-world); (c) `weak_spot_topic` is usually `null` because metadata is empty, so the sharpest "we read you" line often doesn't fire. |
| **Save Profile** | ✅ after value | ✅ Save / "Not now" | Slightly SaaS | "Save your Brain Profile" reframe is good. Drag: **"Keep your streak, rank, and AI-personalized questions."** — three SaaS benefits in a clinical list. |
| **Home** | ✅ | Mostly | Game | Daily Royale hero is dominant and clear. Drags below. |

**Home hierarchy:** Daily Royale hero (clear, great) → Battle Mode → Friends row → Brain Boost / Your
Growth tiles. Issues: (1) **Brain Boost** — the second daily ritual — is a *small tile*, under-weighted
vs its role; (2) **"Your Growth"** is generic wellness-tracker language and its subtitle ("Keep
playing to build your trend.") describes a chore, not a reward; (3) the Friends row is visually
sandwiched between two stronger cards.

**Does it communicate "fun trivia about how the world works"?** Partially. The *tone* does (Rot
Report titles, Rot Types). The *content* and a few labels ("AI-personalized", "Your Growth", "Needs
work") pull toward productivity/education. **"Brain Boost"** itself is a good edgy brand term — it
reads as a mode within two lines of context; keep it.

**Confusing/too-serious flags:** "AI-personalized" (×2), "Your Growth", "Needs work", "Brain Score"
without a scale, and the practice result line **"No coins, no rating — practice makes you sharper,
not screen time,"** which ends the session on a self-deprecating negative.

## 4. Content inventory

| Bank / source | Path | Category | # in DB | Style pattern | Fits new direction? | Fun? | Feels useful? | Homework risk | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Legacy seed | `backend/content/trivia.json` | 6 base cats (40 rows) | (subset of below) | All easy, pure recall + literal school math ("15% of 200", "plural of cactus") | ✗ | Low | ✗ | **High** (worksheet) | Rewrite/retire the school-math/vocab items |
| Dev placeholder | `backend/content/sample_bank.json` | mixed (13) | dev only | ingest-format sample | ✗ | — | — | — | Keep as fixture, never ship |
| **Money & Business** | `backend/content/bank/money_business.json` | Money & Business (26) | 26 | Scenario-framed; **split**: ~8 hidden-incentive/scam gems vs ~18 finance-class/vocab/adulting | **Partial** | Mixed | Yes (too much) | **Med-High** | **Keep ~8, rewrite ~10, cut ~8** |
| **Untracked bank** | *(not in repo)* | Science 122, Arts 106, History 105, PopCult 105, Geo 104, Sports 104 | ~593 | ~44/40/20 easy/med/hard template; **easy tier = generic recall/worksheet**, **hard tier = genuinely good** | ✗ (as-is) | Hard tier yes, easy tier no | ✗ | Med (easy tier) | **Get the source into the repo; classify; cull the easy tier; keep the hard tier** |

Key observations:
- **Easy tier is the weakest content in the game** across every category ("which organ pumps
  blood", capital cities, "value of pi"). **Hard tier is the best** (Eddy Merckx "The Cannibal",
  Emil Zátopek "Czech Locomotive", Ferdowsi/Shahnameh, Boxer Rebellion, Edict of Milan, Strait of
  Malacca) — these already have the "wait, really / I'd say that in conversation" quality.
- **Money & Business is thin at the top** (only **2 hard** questions) — a category session draws 2
  hard and will repeat them every time. Fragile.
- **Governance:** the ~593 untracked questions are a real risk — recover the source files into the
  repo before any expansion, or the bank can't be audited or evolved.

## 5. Question quality rubric

Scored 0–5. To stay readable I show the six load-bearing dimensions (Curiosity **Hook**, **Aha**,
**Conversation**, **Chore** risk, **Generic** risk, **Fit**); Fun tracks Hook, Hidden-Utility tracks
Aha, and Ambiguity/Staleness are low across this evergreen bank except where noted in the reason.
**Higher Chore/Generic = worse.** All 26 Money & Business questions are graded; a representative
cross-category sample follows (the base bank is heavily templated, so these patterns generalize —
full per-question grading of the 593 untracked rows should be done by the AI classifier once run).

### Money & Business (all 26)

| # | Question (abbrev) | Hook | Aha | Conv | Chore | Gen | Fit | Verdict — reason |
|---|---|---|---|---|---|---|---|---|
| 1 | Supermarket sells milk below cost → *loss leader* | 4 | 5 | 5 | 1 | 1 | 5 | **KEEP** — model hidden-incentive Q |
| 2 | Oil spikes → groceries pricier (cost ripple) | 4 | 4 | 4 | 1 | 1 | 5 | **KEEP** — "how the world works" |
| 3 | Fund pays old investors w/ new money → *Ponzi* | 4 | 4 | 5 | 1 | 1 | 5 | **KEEP** — Scam Radar |
| 4 | "3 spots left, decide now" → why urgency | 4 | 4 | 4 | 1 | 1 | 5 | **KEEP** — matches approved vibe |
| 5 | "Mentor" guarantees 30%/mo → red flag | 4 | 4 | 4 | 2 | 1 | 5 | **KEEP** — Scam Radar |
| 6 | Phishing "verify your login" email | 3 | 3 | 3 | 3 | 2 | 3 | **KEEP-lite** — edges toward security-awareness training; reframe to "why does urgency + a link work?" |
| 7 | Payday loans dangerous (300–400% APR) | 3 | 4 | 4 | 2 | 1 | 4 | **KEEP** — "sounds fake but true" |
| 8 | Currency weakens → imports pricier first | 3 | 3 | 3 | 2 | 2 | 4 | **KEEP** — reframe hookier ("why your phone gets pricier when the currency drops") |
| 9 | SaaS: $29/mo vs $300 once → model name | 2 | 2 | 2 | 2 | 3 | 3 | **REWRITE** → "Why do companies want you on a subscription instead of one payment?" |
| 10 | Central bank raises rates to cool inflation | 2 | 3 | 3 | 3 | 2 | 3 | **REWRITE** → "Why does raising interest rates cool down prices?" (mechanism, not term) |
| 11 | Higher promised return = higher risk | 3 | 3 | 3 | 2 | 2 | 3 | **KEEP-lite** — fine as Scam Radar primer |
| 12 | Min payment on 24% APR → compounding danger | 2 | 3 | 3 | 3 | 1 | 3 | **REWRITE** → "Why do credit-card companies *love* minimum payments?" (incentive flip) |
| 13 | S&P 500 "is up" = index of ~500 firms | 2 | 2 | 2 | 3 | 3 | 2 | **REWRITE/CUT** — definitional |
| 14 | Trade deficit = imports > exports | 1 | 1 | 2 | 3 | 3 | 2 | **CUT** — vocabulary |
| 15 | Company revenue $5M × 20% margin = ? | 1 | 1 | 1 | 3 | 3 | 1 | **CUT** — math worksheet |
| 16 | Sales − costs = profit ($1,500) | 1 | 1 | 1 | 4 | 3 | 1 | **CUT** — accounting worksheet |
| 17 | $50/signup = *customer acquisition cost* | 1 | 1 | 2 | 3 | 3 | 2 | **CUT** — jargon flashcard |
| 18 | Buying a bond = you're a lender | 2 | 2 | 2 | 3 | 3 | 2 | **REWRITE/CUT** — definitional |
| 19 | Dividend = share of profits | 1 | 1 | 2 | 3 | 3 | 2 | **CUT** — definitional |
| 20 | What is an ETF | 1 | 1 | 1 | 3 | 4 | 1 | **CUT** — flashcard |
| 21 | Diversification protects vs one blow-up | 1 | 1 | 2 | 4 | 3 | 1 | **CUT** — user's explicit "define diversification" reject |
| 22 | Compound interest = interest on interest | 2 | 2 | 2 | 3 | 2 | 2 | **REWRITE** → "Why do the rich borrow against assets instead of selling?" (compounding, but a power move) |
| 23 | Inflation 5% vs savings 0.5% → buying power | 2 | 3 | 3 | 3 | 2 | 3 | **KEEP-lite / reframe** → "Why is cash in the bank quietly losing?" |
| 24 | GDP = value of goods & services | 1 | 1 | 1 | 4 | 4 | 1 | **CUT** — school |
| 25 | Marginal tax bracket mechanics | 2 | 3 | 3 | **5** | 1 | 2 | **CUT** — tax-filing chore (hard cut rule) |
| 26 | Emergency fund's main job | 1 | 1 | 1 | **5** | 2 | 1 | **CUT** — pure adulting (hard cut rule) |

M&B tally: **~8 keep, ~7 rewrite, ~11 cut.** The keepers are the template for the whole new
direction. The cuts are the "financial literacy class" the north star forbids.

### Representative cross-category sample

| Question | Cat | Hook | Aha | Conv | Chore | Gen | Fit | Verdict |
|---|---|---|---|---|---|---|---|---|
| Cyclist nicknamed "The Cannibal" (Merckx) | Sports | 4 | 4 | 4 | 0 | 1 | 5 | **KEEP** — nickname hooks |
| "Czech Locomotive" runner (Zátopek) | Sports | 4 | 4 | 4 | 0 | 1 | 5 | **KEEP** |
| Persian poet of the Shahnameh (Ferdowsi) | Arts | 3 | 3 | 4 | 0 | 1 | 4 | **KEEP** — niche pride |
| Edict of Milan granted… (toleration) | History | 3 | 4 | 3 | 1 | 1 | 4 | **KEEP** — "why it mattered" |
| Strait of Malacca between Malaya &… (Sumatra) | Geo | 3 | 3 | 3 | 0 | 2 | 4 | **KEEP** — chokepoint intrigue |
| Dunder Mifflin sitcom (The Office) | PopCult | 3 | 1 | 3 | 0 | 2 | 4 | **KEEP** — recognition fun |
| Which organ pumps blood (Heart) | Sci | 0 | 0 | 0 | 3 | 5 | 0 | **CUT** — worksheet |
| Which gas do we breathe (Oxygen) | Sci | 0 | 0 | 0 | 3 | 5 | 0 | **CUT** |
| Value of pi to 2 dp (3.14) | Sci | 0 | 0 | 0 | 3 | 5 | 0 | **CUT** — math class |
| What is 15% of 200 (30) | Sci | 0 | 0 | 0 | 4 | 5 | 0 | **CUT** — arithmetic |
| Plural of "cactus" (cacti) | Arts | 0 | 1 | 1 | 3 | 5 | 0 | **CUT** — vocab flashcard |
| Letters in the alphabet (26) | Arts | 0 | 0 | 0 | 4 | 5 | 0 | **CUT** |
| Capital of Australia (Canberra) | Geo | 1 | 2 | 2 | 0 | 4 | 2 | **KEEP-lite** — the Canberra-not-Sydney twist saves it |
| Longest river (Nile) | Geo | 1 | 1 | 2 | 0 | 4 | 2 | **REWRITE** → "Why did the Nile decide where a civilization could exist?" |
| Hardest natural material (Diamond) | Sci | 1 | 1 | 2 | 1 | 4 | 2 | **REWRITE** → "Why is a diamond basically forever but a pencil isn't, from the same element?" |
| WWII ended in (1945) | History | 1 | 1 | 2 | 1 | 4 | 2 | **KEEP-lite** — canonical anchor |
| Ring of Fire surrounds… (Pacific) | Geo | 2 | 3 | 2 | 0 | 2 | 3 | **KEEP** — has a "why" |
| Guernica painter (Picasso) | Arts | 2 | 2 | 3 | 0 | 2 | 3 | **KEEP-lite** |

**Pattern:** across the base bank, **hard ≈ keep, easy ≈ cut/rewrite.** The single highest-leverage
content move is to **cull/rewrite the easy tier and preserve the hard tier**, then bend everything
toward the "why / how it works" frame.

## 6. Category naming audit

The 7 canonical names are **LOCKED** (`content/categories.py`; picker + ingest + campaign depend on
them; ingest rejects non-canonical). **Do not rename the stored categories.** There is **no
display-name alias layer today** (the picker shows the raw canonical strings). So the recommendation
is: **add a display-name/lane layer later; rename nothing now.**

| Current (stored — keep) | Recommended *display* name | Reason | Risk of changing | Files affected if we add an alias layer |
|---|---|---|---|---|
| Money & Business | **Money Moves** (+ sub-lanes Scam Radar, Power Plays) | "Money Moves" is curiosity/status; "Business" reads corporate | Low (display only) if aliased; **High** if the stored string changes (ingest/campaign/migrations) | `frontend/src/i18n/*`, a new `categoryDisplay` map, `CategorySelect.tsx` |
| Science & Nature | **Science & Nature** (add lane **Tech Traps**) | Name is fine; the *content* needs a "how it works" lane | Low | i18n, tag layer |
| Geography | keep; add lane **World Control / Empire Mode** | "Geography" is a school word; the fun is power/chokepoints | Low | i18n, tag layer |
| History | keep; add lane **Empire Mode** | Fun is "why it changed the world", not dates | Low | i18n, tag layer |
| Pop Culture & Entertainment | keep; add lanes **Brand Games / Internet IQ** | Brands/internet psychology live here + M&B | Low | i18n, tag layer |
| Sports | keep; add lane **Sports Money** | Business-of-sports is the hook | Low | i18n, tag layer |
| Arts & Literature | keep; add lane **Culture Money** | Why culture is worth what it's worth | Low | i18n, tag layer |

**Recommendation:** lanes ("Scam Radar", "Empire Mode", "Tech Traps", "Brand Games") are the
*Sporcle identity layer* — but implement them as **`subcategory` + `topic_tags` + curated
collections over the locked 7**, never as new top-level categories. The metadata schema already has
`subcategory`, `topic_tags`, `audience_tags` — this is exactly what they're for, and they're empty
today.

## 7. Addictiveness / pitfall audit

| Lesson | Grade | Evidence | Risk | Recommendation |
|---|---|---|---|---|
| **A. Wordle** (simple, scarce, daily, shareable) | **4/5** | Daily Royale = one attempt, 8Q, settles at a time; Rot Report has Wordle-style share titles + copy-link | Scarcity/share are strong; the *content* being generic dilutes the "worth sharing" feeling | Keep the one-shot daily; upgrade the questions so the share is a flex about *knowing something*, not luck |
| **B. Connections** (aha, misdirection, reveal) | **2/5** | Almost all questions are pure recall; only the M&B keepers + hard tier have an "aha". No misdirection/trap format | This is the biggest *design* gap: the fun of Connections is discovering the trick | Make the **"why/incentive/trap"** frame the default; explanations already deliver the reveal — lead the *question* with the hook |
| **C. Duolingo** (habit + progress, but content must be fun) | **3/5** | Streaks, sharpness, Your Growth, daily ritual all exist | Gamification is real but "cannot save boring content" — and the content is boring | Fix content first; the scaffolding is already good |
| **D. Trivia Crack** (fast, social, easy) | **4/5** | Battle Mode (Bo7, 10s timer, "Run It Back") is fast + social + clear | Duels over generic-recall are less fun than duels over "wait, really?" | Bias Battle toward the punchiest lanes (Scam Radar, Brand Games) |
| **E. Sporcle** (curiosity lanes, "I'm good at X") | **1/5** | No lane identity — 7 school-subject categories; `subcategory`/tags unused; Rot Types hint at identity but aren't lanes | Highest *untapped* upside | Build the lane/tag layer so a player can *be* "a Scam Radar sniper" |
| **F. HQ (cash/hype over-reliance)** | **5/5 (safe)** | Coins/gems are closed-loop, no cash (DESIGN §7 enforced); framing is "bragging rights" | None — correctly avoided | Keep the honesty rules exactly as-is |
| **G. QuizUp (breadth, no daily reason, unclear progression)** | **3/5** | Daily reason exists (Royale + Brain Boost); progression exists (rank, streak, growth, campaign) | Breadth-without-reason-to-care lives in the *content*, not the structure | Narrow content toward high-curiosity lanes; don't add more generic breadth |
| **H. Educational-game (instruction before gameplay)** | **2/5** | Gameplay-first structurally, BUT Money & Business content leads with instruction (emergency fund, tax brackets) | The one place it reaches for "useful" trips the wire | Enforce "hook first, learning as side effect" at the content-rubric level (Section 8) |

Headline: **structure grades ~3.5/5; content grades ~2/5.** Fix content and the lane layer and most
grades jump.

## 8. Approved question formula

**Rule:** every question leads with a *hook* (a "why/really/trap"), the answer delivers an *aha*,
and the explanation makes it *sayable in conversation*. Learning is the **side effect**, never the
pitch. One of these 14 hook types (from the brief) should be identifiable in every question:

1. Why do rich people do this? · 2. Why do companies do this? · 3. What's the hidden incentive? ·
4. What's the scam/trap? · 5. Why does this place control money/power? · 6. Why did this event change
the world? · 7. Why does this app/platform manipulate behavior? · 8. Why is this brand worth so
much? · 9. Why do markets react like this? · 10. What sounds fake but is true? · 11. Why does this
famous thing exist? · 12. What's the status game? · 13. What's the power move? · 14. What's the trick
everyone misses?

**Pass bar (all true):** curiosity hook ≥3, aha ≥3, conversation ≥3, **chore ≤1**, **generic ≤2**,
fit ≥4, one clearly-correct answer, plausible distractors, evergreen (or the date *is* the point).

**Vibe anchors (approved):** casino chips = psychological distance · luxury brands destroy stock =
scarcity · startup loses money yet worth billions = betting on dominance · streak reminders = loss
aversion · Taiwan = chips.

**Rejected (auto-fail):** "You are renting an apartment…", "A worker receives a 1099…", "filing
taxes…", "signs a lease…", "calculate your monthly budget…", "What does APR stand for?", "Define
diversification.", "What year did X happen?" *unless the year itself is the point.*

**Explanation style:** one or two sentences, ends on the transferable insight ("chips create
psychological distance from real money"), never a lecture. The existing "💡 Here's why" panel is the
right home for it — keep it.

## 9. Rewrite / cut / keep / missing (candidates)

**KEEP as-is (20)** — the model set:
1. Loss leader (milk below cost) · 2. Oil→groceries ripple · 3. Ponzi (new money pays old) · 4.
Manufactured urgency · 5. "Mentor" guarantees 30%/mo · 6. Payday loan 300–400% APR · 7. "The
Cannibal" (Merckx) · 8. "Czech Locomotive" (Zátopek) · 9. Ferdowsi/Shahnameh · 10. Edict of Milan ·
11. Strait of Malacca · 12. Boxer Rebellion · 13. Meiji Restoration · 14. Ring of Fire (Pacific) ·
15. Dunder Mifflin (The Office) · 16. Doom → id Software · 17. Dark Side of the Moon → Pink Floyd ·
18. Higher return = higher risk · 19. Guernica → Picasso · 20. Currency weakens → imports pricier.

**REWRITE (20)** — right topic, wrong frame (show: current → problem → better hook):
1. "What is an ETF" → *flashcard* → **"Why does owning 500 companies at once beat picking one?"**
2. "Define diversification" → *vocab* → **"Why do smart investors avoid putting it all on one bet?"**
3. "S&P 500 is up = ?" → *definition* → **"When the news says 'the market' moved, what actually
moved?"**
4. Min-payment/APR danger → *literacy* → **"Why do credit-card companies love minimum payments?"**
5. Compound interest def → *class* → **"Why do the rich borrow against assets instead of selling?"**
6. Central bank raises rates → *econ term* → **"Why does making loans pricier cool down inflation?"**
7. SaaS model name → *jargon* → **"Why does every app want a subscription instead of one payment?"**
8. Bond = lender → *definition* → **"Why would you lend a government money for 30 years?"**
9. Inflation vs savings → *literacy* → **"Why is cash sitting in a bank quietly shrinking?"**
10. "Longest river = Nile" → *recall* → **"Why did a river decide where the first cities could
exist?"** 11. "Hardest material = diamond" → *recall* → **"Same element as pencil lead — why is one
priceless and one worthless?"** 12. "Which gas do plants absorb" → *worksheet* → **"How does a tree
build itself almost entirely out of thin air?"** 13. "Fastest land animal" → *recall* → **"Why can a
cheetah only sprint for ~20 seconds?"** 14. "Chemical symbol for gold (Au)" → *recall* → **"Why has
gold been money on every continent for 5,000 years?"** 15. "Largest mammal = blue whale" → *recall* →
**"Why can a blue whale get bigger than any dinosaur — but only in the ocean?"** 16. "How many bones"
→ *recall* → **"Why are babies born with ~100 more bones than adults?"** 17. "Capital of Australia" →
*recall* → **"Why isn't Sydney the capital of Australia?"** 18. "Phishing email" → *training* →
**"Why does 'your account is locked — click here' work so well?"** 19. GDP def → *school* → **"Why do
countries obsess over one number going up?"** (or cut) 20. "Instrument with 88 keys" → *recall* →
**"Why does a piano have exactly 88 keys?"**

**CUT / hide (20)** — chore or generic, no easy rescue:
1. Emergency fund (adulting) · 2. Marginal tax brackets (tax chore) · 3. Revenue−costs=profit (math)
· 4. $5M×20% margin (math) · 5. CAC jargon · 6. Dividend def · 7. Trade deficit def · 8. "15% of
200" · 9. "Plural of cactus" · 10. "Letters in the alphabet" · 11. "Which number is prime" · 12.
"How many sides has a hexagon" · 13. "How many legs has a spider" · 14. "Value of pi to 2dp" · 15.
"Which organ pumps blood" · 16. "Which gas do humans need" · 17. "Roots absorb water" · 18. "How many
players on a soccer team" · 19. "What does KO stand for" · 20. "How many strings on a guitar".

**MISSING hooks to create later (20)** — net-new, none in the bank:
1. Why do casinos use chips instead of cash? · 2. Why do luxury brands destroy unsold stock? · 3.
Why can a startup lose money and be worth billions? · 4. Why do apps send streak reminders? · 5. Why
is Taiwan the center of tech geopolitics? · 6. Why do two identical white tees sell for $15 and $500?
· 7. Why do sneakers resell above retail? · 8. Why do athletes take equity over salary? · 9. Why do
free apps make more money than paid ones? · 10. Why did the Suez Canal being blocked cost billions a
day? · 11. Why do grocery stores put milk at the back? · 12. Why do pump-and-dumps need hype? · 13.
Why is a barrel of oil priced in dollars everywhere? · 14. Why do celebrities launch tequila
brands? · 15. Why does "buy now, pay later" make you spend more? · 16. Why do airlines overbook
flights on purpose? · 17. Why is the De Beers "a diamond is forever" line one of history's best
scams? · 18. Why did one country cornering chip-making reshape world power? · 19. Why do slot
machines almost let you win? · 20. Why do social apps show likes a few minutes late?

## 10. Manual 30-question pilot plan (hooks only — do NOT write full questions yet)

Six lanes × 5 killer questions = 30. **Each lane maps to a locked canonical category at ingest**
(lanes are the display/tag layer). For each lane: 10 candidate hooks (pick 5 later), why it's fun,
what to avoid, pass/fail test.

### Lane 1 — Money Moves → **Money & Business**
*Fun:* power/status framing of money; feels like insider knowledge. *Avoid:* budgeting, saving
advice, definitions, anything with "you" filing/renting. *Pass:* a power move or hidden incentive;
*Fail:* a personal-finance instruction.
Hooks: 1. Why do the rich borrow against assets instead of selling? · 2. Why do companies prefer
subscriptions? · 3. Why do billion-dollar startups lose money on purpose? · 4. Why do high interest
rates scare tech stocks? · 5. Why do credit-card companies love minimum payments? · 6. Why do
airlines overbook on purpose? · 7. Why does "buy now, pay later" make you spend more? · 8. Why do
companies do stock buybacks? · 9. Why do free apps out-earn paid ones? · 10. Why do stores end prices
in .99?

### Lane 2 — Scam Radar → **Money & Business**
*Fun:* "spot the trap" makes players feel street-smart; high conversation value. *Avoid:*
security-awareness-training tone, "always do X" advice. *Pass:* reveals *why* a trick works on the
brain; *Fail:* reads like a compliance module.
Hooks: 1. Why do guaranteed returns scream scam? · 2. Why do scammers manufacture urgency? · 3. Why
do pump-and-dumps need hype? · 4. Why do fake gurus film in rented mansions? · 5. Why do overpayment
scams work? · 6. Why do Ponzi schemes always collapse eventually? · 7. Why do "you've won" texts want
a small fee first? · 8. Why do romance scams move you off the app fast? · 9. Why do fake shortages
sell out real fast? · 10. Why did Bernie Madoff's returns being *too smooth* give him away?

### Lane 3 — Brand Games / Status → **Money & Business** (some Pop Culture)
*Fun:* explains the invisible game behind logos people already know. *Avoid:* "what year was brand X
founded", logo-recognition recall. *Pass:* scarcity/status/pricing psychology; *Fail:* brand trivia
with no "why".
Hooks: 1. Why do two identical white tees sell for $15 and $500? · 2. Why do luxury brands limit
supply? · 3. Why do sneakers resell above retail? · 4. Why do celebrities launch tequila/skincare
lines? · 5. Why do athletes want equity, not just salary? · 6. Why do luxury brands destroy unsold
bags? · 7. Why is "a diamond is forever" a marketing masterstroke? · 8. Why do brands pay for the
worst airport billboard on purpose? · 9. Why do Veblen goods sell *more* when priced higher? · 10.
Why do fast-fashion brands drop new styles weekly?

### Lane 4 — Empire Mode / World Control → **Geography** (some History)
*Fun:* turns maps/history into power and money; "why this place matters". *Avoid:* capital cities,
dates, "which is bigger". *Pass:* why a place/event controls money/power; *Fail:* a location recall.
Hooks: 1. Why is Taiwan central to tech geopolitics? · 2. Why did blocking the Suez Canal cost
billions a day? · 3. Why is the Strait of Hormuz a global pressure point? · 4. Why did control of
spice routes make tiny nations rich? · 5. Why is the US dollar the world's reserve currency? · 6. Why
did the Panama Canal reshape trade? · 7. Why is the Strait of Malacca one of the most valuable water
lanes on earth? · 8. Why did whoever controlled salt once control empires? · 9. Why does a landlocked
country pay a premium to trade? · 10. Why did the printing press break the medieval power structure?

### Lane 5 — Internet IQ / Tech Traps → **Pop Culture & Entertainment** (some Science & Nature)
*Fun:* explains the manipulation people feel but can't name; instantly relatable. *Avoid:* "when was
app X founded", feature recall. *Pass:* a behavioral mechanism (loss aversion, variable reward);
*Fail:* app trivia. **Note:** this is the one lane that strains the taxonomy — tag it and file under
Pop Culture (attention economy) or Science & Nature (psychology).
Hooks: 1. Why do apps send streak reminders? · 2. Why does infinite scroll never end? · 3. Why do
likes sometimes show up late? · 4. Why do free apps make more money than paid ones? · 5. Why does
autoplay start the next video instantly? · 6. Why do games give near-misses? · 7. Why do
notifications use red? · 8. Why do apps ask for a rating right after a win? · 9. Why does "verified"
change how you read a post? · 10. Why do slot machines and mobile games feel the same?

### Lane 6 — Sports Money / Culture Money → **Sports** + **Arts/Pop Culture**
*Fun:* the business behind fandom; surprises even fans. *Avoid:* stats recall, "who won in year X".
*Pass:* the money/incentive behind a sports/culture fact; *Fail:* a box-score question.
Hooks: 1. Why are sports teams worth billions while barely profitable? · 2. Why do leagues share TV
money between teams? · 3. Why do athletes go broke after huge careers? · 4. Why is a stadium named
after a company? · 5. Why do transfer fees keep breaking records? · 6. Why do movies make more from
merchandise than tickets? · 7. Why do music artists tour instead of relying on streaming? · 8. Why
did streaming change what songs sound like? · 9. Why are sequels and reboots so dominant? · 10. Why
do luxury watches hold value like assets?

## 11. UX / content integration recommendations

- **Best first mode to test the new style: the Brain Boost / Starter Check calibration bank.** It's
  no-stakes, it's the highest-intent moment (first session, deciding whether to save), it's already
  self-paced with the "💡 Here's why" reveal, and it's a **`starter` SAFE_MODE** so no fairness rule
  is touched. Swap ~8–16 of the calibration questions for pilot lanes and measure conversion. Quick
  Play is the second-best surface (also SAFE_MODE, high volume).
- **Daily Royale stays broad and fair** — do **not** personalize or lane-scope it. It's the shared,
  comparable, Wordle-style event. It should *sample the best evergreen curiosity questions across all
  7*, but stay mixed and un-personalized (`PERSONALIZE_RANKED_DAILY=false`).
- **Brain Boost leans into personalization + lanes** — this is where "you're sharp at Scam Radar" pays
  off. Requires the AI classifier to actually run (currently 3/672).
- **Battle favors punchy lanes** — bias its pool toward Scam Radar / Brand Games / Internet IQ (most
  "fun to argue over"), still mixed for fairness.
- **Explanations:** already well-placed; tighten copy to end on the transferable line, and make the
  *question* carry the hook (don't hide the "why" only in the explanation).
- **Result screen:** it does reinforce "I got sharper" via the accuracy/sharpness CountUp, but
  **drop the "not screen time" self-deprecation** and add a one-line "here's the sharpest thing you
  learned today" recap to make the getting-smarter payoff explicit. Add a **share card to Rot
  Check/practice** (only the Daily Royale has one today).
- **Fix the copy drags:** replace "AI-personalized" with plain benefit language ("questions that
  learn you" or nothing); rename "Your Growth" display to something on-brand ("Your Brain Trend");
  change "Needs work" → "Blind spots"; show the 300–900 scale (or a label) beside the first Rot
  Score.

**How to measure "is the new content fun" (funnel + interaction signals that already exist):**
- **Content-is-boring signals:** low **answer completion rate**, high **quit point by category/lane**
  (`question_interaction_events` already logs quit + per-question), low **explanation open/read
  rate** (already tracked: `explanation_opened`, `explanation_read_ms`).
- **Content-is-working signals:** high **explanation-read rate**, **replay/share rate**, **Battle
  rematch ("Run It Back") rate**, **category/lane return rate**, **weak-spot training clicks**, and —
  the money metric — **`upgrade_completed` conversion after `profile_reveal_viewed`** (does a better
  Starter Check convert more guests?). All these events exist (`docs/analytics-funnel.md` + the
  interaction-event schema). Add a simple per-lane cut of quit-rate and explanation-read-rate.

## 12. Prioritized next actions

**Immediate (no code / content-safe):**
- **Recover the ~593 untracked questions into the repo** (find/commit the source JSON) — governance
  blocker before any expansion.
- **Cut/hide list:** flag the 20 hard-cut questions (Section 9) and all M&B chores (emergency fund,
  tax brackets, definitions, margin math). Don't delete yet — mark for review.
- **Rename decisions (display only):** approve the lane display names (Section 6) but change nothing
  stored.
- **Guard to add later (not now):** a lightweight **content lint** at ingest that flags rejected
  vibes (regex for "you are renting/leasing/filing taxes", "define ___", "what does ___ stand for",
  "what year did") → `needs_review`, plus a rubric checklist in the ingest doc. (Design only in this
  pass.)
- **Draft the 30-question pilot** manually, together, from the Section 10 hooks — approve hooks
  first, then write, then human-review.

**Next:**
- Ingest the approved 30 into their canonical categories, `status='approved'`, tagged with lane
  `subcategory`/`topic_tags`.
- **Turn the AI classifier on** and run it over the whole bank (fix the killed job) so
  personalization, weak-spots, and lanes actually have data (3/672 → full).
- Test the pilot in **Brain Boost + Battle**; compare per-lane completion/explanation-read/quit and
  `upgrade_completed` vs the old calibration set.

**Later (only after the pilot proves fun):**
- Scale to 150+ **only in the winning lanes**, culling the generic easy tier as new content lands.
- Build the **lane identity layer** (Sporcle-style collections + "you're a Scam Radar sniper" badge)
  off `subcategory`/`topic_tags`.
- New formats beyond MC (odd-one-out "which is the scam", "sounds fake but true" true/false streaks),
  Brain Boost **share card**, and lane badges in the Brain Profile.

## 13. Files inspected

- `backend/content/bank/money_business.json` (26), `backend/content/trivia.json` (40),
  `backend/content/sample_bank.json` (13), `backend/content/categories.py`, `backend/content/ingest.py`,
  `backend/content/loader.py`
- DB `questions` (672) + `question_ai_metadata` (3) — counts, difficulty spread, per-category samples
- `backend/app/schemas/ai_metadata.py`, `backend/app/services/personalization.py`,
  `backend/app/services/taste_profile.py`, `backend/app/services/brain_boost.py`,
  `backend/app/services/brain_score.py`, `backend/app/services/contest.py`,
  `backend/app/services/templates.py`, `backend/app/services/practice.py`,
  `backend/app/services/duel.py`
- Frontend: `src/app/App.tsx`, `src/screens/brainboost/*` (intro, BrainProfileReveal, SaveProfileScreen),
  `src/screens/Home.tsx`, `src/screens/home/*`, `src/screens/duel/*`, `src/screens/growth/GrowthScreen.tsx`,
  `src/i18n/en.ts`
- Docs: `brain-boost.md`, `personalization.md`, `analytics-funnel.md`, `growth.md`, `deploy-checklist.md`;
  `CLAUDE.md`, `PLAN.md` §6/§13, `DESIGN.md` §7

## 14. Files likely affected when we implement (later, not now)

- **Content:** new pilot bank file under `backend/content/bank/` (e.g. `pilot_world_works.json`),
  ingested via `python -m app.jobs.run ingest`. Recover the untracked banks into `backend/content/bank/`.
- **Lane/display layer:** a new `categoryDisplay`/lane map (frontend `src/i18n/*` +
  `CategorySelect.tsx`); `subcategory`/`topic_tags` populated via the classifier (no schema change —
  fields exist).
- **Calibration swap:** the Starter Check / Quick Play question selection (`services/templates.py`,
  `services/practice.py`, `services/brain_boost.py` bank source) if we point calibration at pilot content.
- **Classifier run:** `app/services/ai_classifier.py` + `app/jobs/run.py classify` (no code change —
  just run it; fix whatever killed the batch).
- **Optional content-lint guard:** `backend/content/ingest.py` (add vibe-flag warnings) + the ingest doc.
- **Analytics:** a per-lane cut of existing events (no new events required).

## 15. "Do not do" list

- ❌ Do **not** bulk-generate a question bank yet. Approve 30 hooks → write → human-review first.
- ❌ Do **not** add or rename **canonical categories** (locked; ingest/campaign/migrations depend on
  them). Lanes are a display/tag layer only.
- ❌ Do **not** ship "practical / financial-literacy / adulting / tax / lease / budgeting / contract"
  questions. Emergency fund, tax brackets, "define diversification" = cut.
- ❌ Do **not** lead with instruction. Hook first; learning is the side effect.
- ❌ Do **not** personalize or lane-scope the **Daily Royale** (`PERSONALIZE_RANKED_DAILY` stays
  false) — it's the fair, shared, comparable event.
- ❌ Do **not** call the LLM during gameplay. Classification stays batch/CLI.
- ❌ Do **not** claim "AI-personalized" in copy until the classifier has actually run (3/672 today).
- ❌ Do **not** break the DESIGN §7 honesty rules (no cash/bet/jackpot; no fake player counts).
- ❌ Do **not** delete the untracked ~593 before recovering the source — governance first.
- ❌ Do **not** commit anything or add bank files in this pass.
