"""Bias the ranked Daily Royale's trivia draw toward THINKING-shaped questions (CLAUDE.md §5c).

Why this exists
---------------
§5c is explicit that the questions are the product and that the target mix is roughly one third
recall to two thirds thinking. A bank can drift the other way without anyone noticing, because a
recall question is easy to write and reads as perfectly respectable — and then a uniform draw
spends most of the daily eight on the shape §5c calls off-target. "A pub-quiz question is off-target
even when it is a GOOD pub-quiz question": naming the Sistine Chapel's painter cannot make anyone
feel sharper, and nobody screenshots it.

(The measured composition of the current corpus, per category, is in CLAUDE.md §5c. It is NOT
repeated here on purpose: the question banks themselves live in the private content repo and are
not tracked in this tree, so quoting their size and per-category quality in a public source file
would publish metadata about withheld content — the §10 trap where a file leaks what its inputs are
classified to hide. This module needs none of those numbers to work; it derives everything it uses
from the bank it is handed at runtime.)

This is a STOPGAP with a real fix behind it. The durable repair is rewriting the recall-heavy
banks into §5c shapes; this only stops the Royale spending its eight rounds on the weakest part
of the corpus while that happens. It is written so it RETIRES ITSELF: the multiplier is derived
from the bank's actual composition on every call, so as the rewrite lands the weighting weakens
automatically, and once the bank reaches the target this returns the bank untouched. Nothing has
to be remembered, and there is no cleanup step to forget.

Why SHAPE and not category
--------------------------
Category is a near-perfect proxy TODAY — the two newest categories carry almost all of the
thinking-shaped questions — and keying on it would be simpler. It would also be wrong the moment
the rewrite starts: nothing stops a History question being a "why", so a bank rewritten into those
shapes must start being favoured the day it lands, with no code change here. Keying on shape gives
that for free; keying on category would quietly keep punishing it. §5c makes the same point — the
failure
is of SHAPE, not topic.

Why replication rather than weighted sampling
---------------------------------------------
Both draw paths call `rng.choice(...)` on a flat list (`trivia.generate` and
`royale_rounds._draw_trivia`). Repeating the favoured entries inside the pool biases the draw
without touching either, which keeps the module generic — the same reason §5a scopes categories by
PRE-FILTERING the bank rather than teaching the engine about them. Both paths already reroll on a
repeat (by client_spec signature, and by question id respectively), so a duplicate draw costs a
reroll and never a duplicate question in a run.

Determinism is preserved, and it has to be: the ranked Royale uses a SHARED per-window seed so
every player gets the identical eight questions (§9). The pool is built by a pure function over a
bank already ordered by id, so every player that day builds the identical pool.
"""

from __future__ import annotations

import math
import re
from typing import Any

# §5c's target mix, expressed as the share of ranked trivia drawn from thinking-shaped questions.
THINKING_TARGET = 0.65

# A ceiling on the replication factor. Without it a nearly-recall bank would replicate a handful of
# questions so hard that the same few appear day after day — trading a boring mix for a repetitive
# one, which §5d treats as a DISTINCT failure ("repetitive" is its own playtest verdict, kept apart
# from "boring" on purpose). On the current corpus the derived factor sits well under this, so it
# is headroom rather than a limit being hit.
MAX_REPLICATION = 8

_WHY = re.compile(r"^\s*why\b", re.IGNORECASE)
_SECOND_PERSON = re.compile(r"\byou(?:r|rs)?\b", re.IGNORECASE)
# A setup sentence followed by the question — the Scenario shape. "A raise pushes part of your
# income into a higher bracket. What actually gets taxed at the higher rate?"
_MULTI_SENTENCE = re.compile(r"[.!?]\s+\S")


def is_thinking_shaped(question: dict[str, Any]) -> bool:
    """True for §5c's Scenario / Why shapes; False for bare recall.

    Deliberately crude, and deliberately CHEAP: it reads the stem the author already wrote rather
    than requiring a new column, a migration and a backfill for a measure whose whole purpose is to
    become unnecessary. It under-counts (a gut-check phrased as a plain question reads as recall)
    and never over-counts, so the bias it produces is conservative.
    """
    prompt = (question.get("payload") or {}).get("prompt") or question.get("prompt") or ""
    if not isinstance(prompt, str):
        return False
    return bool(
        _WHY.search(prompt) or _SECOND_PERSON.search(prompt) or _MULTI_SENTENCE.search(prompt)
    )


def replication_factor(thinking: int, recall: int, target: float = THINKING_TARGET) -> int:
    """How many times to repeat each thinking-shaped question to reach `target`.

    Solving  k*T / (k*T + R) = target  for k gives  k = target*R / ((1-target)*T).
    Returns 1 (a no-op) when the bank already meets the target or has nothing to favour.
    """
    if thinking <= 0 or recall <= 0 or target <= 0 or target >= 1:
        return 1
    if thinking / (thinking + recall) >= target:
        return 1  # already there — the rewrite has done its job and this retires itself
    k = math.ceil((target * recall) / ((1 - target) * thinking))
    return max(1, min(k, MAX_REPLICATION))


def weight_ranked_bank(
    bank: list[dict[str, Any]], target: float = THINKING_TARGET
) -> list[dict[str, Any]]:
    """The ranked trivia pool, biased toward thinking-shaped questions.

    Order is preserved (thinking entries are repeated in place, not appended) so the pool stays a
    stable function of a bank ordered by id.
    """
    thinking = [q for q in bank if is_thinking_shaped(q)]
    if not thinking or len(thinking) == len(bank):
        return bank  # nothing to favour, or nothing to favour it over
    k = replication_factor(len(thinking), len(bank) - len(thinking), target)
    if k <= 1:
        return bank
    out: list[dict[str, Any]] = []
    for q in bank:
        out.extend([q] * k if is_thinking_shaped(q) else [q])
    return out
