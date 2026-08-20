# Rot Royale — Question Content Standard

The rules every trivia question must meet. This is the human-readable spec behind the linter
(`backend/content/question_lint.py`); the linter is the machine enforcement of this doc. When the
two disagree, fix whichever is wrong so they agree again.

**How it's enforced**
- **Existing bank** (the committed `content/bank/*.json` + the live DB): linted in **report** mode.
  It predates this standard, so report mode *surfaces* problems but never blocks.
- **New / generated imports** (a single `--file`): linted in **strict** / **ci** mode. Errors fail
  the import. The two flagship categories are held to a higher bar (practical metadata required).

```
uv run python scripts/lint_question_bank.py --source db   --mode report   # existing bank
uv run python scripts/lint_question_bank.py --source files --mode report   # committed banks
uv run python scripts/lint_question_bank.py --file new.json --mode strict  # a new import (fails on errors)
uv run python scripts/lint_question_bank.py --source files --mode ci       # concise, non-zero on errors
```

> **Answer position is NOT a live exploit.** The banks skew their stored correct answer toward A,
> but `app/modules/trivia.py` shuffles the four options server-side (deterministic per
> `(shuffle_seed, question_id)`) and remaps `correctIndex` before serving. Position balance (Q029)
> is an **authoring-hygiene** signal only. Do not "fix" it in gameplay; balance it in the source
> banks when authoring/reseeding.

---

## 1. Question-writing rules

Every question is a four-option, single-correct multiple-choice item. Write for a fast mobile
session: readable in one glance, one clean idea, a tempting wrong answer, and a reveal that teaches.

| Field | Rule | Rule ID |
|---|---|---|
| Stem | Present, **4–22 words**, **≤ 140 chars** (≤ 200 for `format_type: scenario`) | Q001, Q022, Q023, Q010 |
| Category | Exactly one of the 8 canonical categories | Q002 |
| Difficulty | `easy` \| `medium` \| `hard` | Q003 |
| Options | Exactly **4**, all non-empty, all distinct, each **≤ 60 chars** | Q004, Q005, Q006, Q011 |
| Correct index | Integer 0–3, pointing at the right option | Q007 |
| Index key name | Generated imports must use snake_case `correct_index` (the ingest input key), **not** `correctIndex` (the internal payload key). Strict/new-import only. | Q012 |
| No "all/none of the above" | Banned — they test test-taking, not knowledge | Q025 |
| No placeholder text | No "lorem", "test question", "option a", TODO, etc. | Q026 |
| Distractors | Plausible to someone who half-knows it; include the common misconception | (review) |
| Length parity | Don't let the correct option be conspicuously the longest — it's a tell | Q024 |

**Punchy, not textbook.** Lead with the hook or a "you". Cut "In the field of…", "It is commonly
known that…". One idea per question. Prefer an *application* framing over a *definition* framing.

**Funny without cringe.** Humor lives in a distractor or the situation, never a joke stem. Dry beats
zany. If it isn't naturally funny, be clean instead.

**No ambiguity.** Exactly one defensibly-correct option. No "best of two rights", no double
negatives, no "which is NOT" unless unavoidable (then bold the NOT).

**Evergreen by default.** Avoid facts that rot. For genuinely time-bound facts, anchor a year and
tag `evergreen: false` so review can catch them.

---

## 2. Explanation standard

Every explanation follows one shape:

> **Correct answer + why + one useful takeaway.**

- **Length:** target **12–28 words**; hard minimum **40 characters** (Q009) and never missing
  (Q008).
- **Must add a *why*, not restate the answer.** "Plants take in carbon dioxide" for the question
  "what do plants take in?" is a restatement (Q020) — say *why it matters* or *how it works*.
- **End with something transferable** — a rule, a model, or a memorable hook. Explanations with no
  why/takeaway cue are flagged (Q021).

**Example shape:** *"Right — interest compounds. Minimum payments mostly cover interest, so the
balance barely moves. Rule of thumb: always pay more than the minimum."*

---

## 3. Difficulty definitions

Tag by **expected success rate**, not by obscurity. A good `hard` question is one where the
*tempting* answer is wrong — not one about a fact nobody has heard of.

| Level | Meaning | Rough correct-rate |
|---|---|---|
| `easy` | A generally-informed adult gets it from recognition | ~75–85% |
| `medium` | Requires applying a concept or a non-obvious fact | ~50–65% |
| `hard` | Counter-intuitive, layered, or expert | ~30–45% |

**Target mix per category:**
- General categories (Science, History, Geography, Arts, Sports, Pop Culture): **40 / 40 / 20**.
- **Money & Business** and **Street Smarts**: **35 / 45 / 20** (lean medium/scenario; a friendly
  on-ramp because these topics intimidate people).

Once live data exists, re-tag difficulty from the actual correct-rate.

---

## 4. Money & Business rules

This is a flagship differentiator, judged harder in strict mode. Write **scenario-first** — real
decisions, not accounting definitions.

**Include:** personal-finance basics, investing basics, business models, startups, negotiation,
pricing, scams/money traps, consumer finance, inflation/rates, marketing psychology,
entrepreneurship, wealth-building mental models.

**Avoid (homework smell):** rote accounting (debits/credits/GAAP), tax-form minutiae,
jurisdiction-specific law, formula-plugging with no story, anything needing a calculator under a 10s
timer. Definition-only stems in this category are flagged (Q046).

**Templates that work:** "You…" scenarios, spot-the-trap, what's-really-happening, mental-model
application, how-do-they-make-money.

**Explanation style:** `confirm (3–5 words) + the mechanism + one rule you keep`.

**Strict-mode metadata (required for new imports):** `subtopic`, `cognitive_type`,
`practical_value` (Q040–Q042); `practical_value` must not be `low` (Q043).

---

## 5. Street Smarts rules

The "practical intelligence" flagship — the most viral, most brand-defining category. Frame as a
**street-smart challenge, not a safety lecture.** Give the player a villain to outsmart and **name
the tactic** in the reveal.

**Include:** scams, manipulation tactics, social pressure, negotiation, digital safety, fake
reviews, misinformation, dark patterns, decision biases, safety/common sense, real-world problem
solving, reading people/situations.

**Fun, not preachy.** "Which move keeps your money?" beats "always be careful." Wry, occasionally
funny, never a lecture.

**Templates that work:** spot-the-scam, name-the-tactic, best-move, read-the-situation,
spot-the-dark-pattern.

**Explanation style:** `name the tactic/tell + why it works on people + the counter-move`.

**Strict-mode metadata (required for new imports):** same as Money & Business — `subtopic`,
`cognitive_type`, `practical_value`, and `practical_value` not `low`.

---

## 6. Metadata / tagging rules

The ingest format today is `{category, question, options[4], correct_index, difficulty,
explanation, confidence}`. The linter also **accepts** (and, for flagship new imports, **requires**)
these optional fields — add them going forward so personalization, mastery, and spaced review can be
built on top:

| Field | Values | Notes |
|---|---|---|
| `subtopic` | free text (e.g. `negotiation`, `scams`) | **Required** for new flagship imports (Q040) |
| `format_type` | `standard` \| `scenario` \| `image` | `scenario` relaxes stem length limits |
| `cognitive_type` | `recall` \| `scenario` \| `application` \| `trick` \| `calculation` \| `judgment` | **Required** for new flagship imports (Q041) |
| `practical_value` | `low` \| `medium` \| `high` | **Required** for new flagship imports; not `low` (Q042, Q043) |
| `evergreen` | `true` \| `false` | Flag time-bound facts for review |
| `locale_specific` | `true` \| `false` | Flag region-specific answers |
| `source` | free text | Where the fact came from |
| `author` | free text | Who wrote it |
| `reviewed_by` | free text | Who reviewed it |
| `approved_at` | ISO date | When it was approved |

No metadata is required **globally** yet. `confidence` remains a review aid and is never stored.

---

## 7. Examples: bad vs acceptable vs excellent

**Money & Business**

- ❌ **Bad:** *"What is the definition of a bond?"* → "A bond is a debt instrument." (Definition,
  recognition-only, no stakes, no takeaway. Fails Q046; explanation would trip Q020/Q021.)
- 🟡 **Acceptable:** *"Rising interest rates make existing bond prices do what?"* → "Fall." Expl:
  "Bond prices move opposite to rates." (Correct, has a why, a bit terse.)
- ✅ **Excellent:** *"You bought a bond, then interest rates RISE. What happens to its resale
  value?"* → "It drops." Expl: *"It drops — new bonds pay more, so nobody buys your older, lower one
  at full price. Takeaway: bond prices move opposite to rates."* (`subtopic: investing`,
  `cognitive_type: scenario`, `practical_value: high`.)

**Street Smarts**

- ❌ **Bad:** *"Why does cash flow matter?"* → "Bills get paid with real cash." Expl: "A business can
  run out of cash." (Restates, no tactic named, no takeaway — Q020/Q021; arguably mis-categorized.)
- ✅ **Excellent:** *"A caller says he's your bank's 'fraud team', knows your name and last 4, and
  needs your code to 'stop a charge'. Safest move?"* → "Hang up and call the number on your card."
  Expl: *"That's false authority — knowing your name and last 4 is easy for scammers. The code IS
  the key; your bank never needs it. Rule: you call them, never the reverse."*
  (`subtopic: scams`, `cognitive_type: judgment`, `practical_value: high`.)

---

## 8. Import checklist

Before importing a new/generated batch:

1. **Format:** JSON array (or CSV) in ingest shape; exactly 4 options; `correct_index` 0–3.
2. **Explanations:** every row has one, ≥ 40 chars, follows answer + why + takeaway.
3. **No restatements / placeholders / all-of-the-above.**
4. **Difficulty tagged** and roughly on target for the category (40/40/20, flagships 35/45/20).
5. **Flagship rows** (Money & Business, Street Smarts) carry `subtopic`, `cognitive_type`,
   `practical_value` (not `low`).
6. **Source answer positions** roughly balanced within the batch (no single position > 40%).
7. **De-duped** against itself (the linter flags exact + near duplicates within the batch); run the
   read-only analyzer to check against the whole existing bank.
8. **Run the linter in strict mode and get a clean pass:**
   ```
   uv run python scripts/lint_question_bank.py --file your_batch.json --mode strict
   ```
   Fix every error. Warnings are advisory — review them, but they don't block.

**CI note:** once a generated-question import pipeline exists, wire the strict lint into CI on new
import files. Do **not** make the existing bank strict until it has been cleaned up to this standard
(track that with the read-only analyzer's numbers).
