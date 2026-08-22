"""Trivia round module (docs/architecture.md).

client_spec = {prompt, options, category, icon, time_limit_ms} — never the answer.
server_answer = {correctIndex, question_id} — stored server-side only.
Content comes from the question bank via the GenerationContext (ordered for determinism).
"""

from __future__ import annotations

from random import Random
from typing import Any

from app.modules.base import GenerationContext, RoundJudgement, clamp_elapsed_ms

TRIVIA_TIME_LIMIT_MS = 10000  # every question gets a flat 10s timer


def trivia_spec(
    q: dict[str, Any],
    *,
    shuffle_seed: int,
    time_limit_ms: int = TRIVIA_TIME_LIMIT_MS,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build the (client_spec, server_answer) pair for ONE bank question — the single place the
    anti-cheat split lives. Used by the random `generate()` (ranked/practice) and by Campaign Mode,
    which serves specific authored questions rather than random draws.

    The displayed option order is SHUFFLED server-side so the served position is decorrelated from
    the bank's source order (some banks are skewed — every question has correctIndex=0 — which would
    otherwise show "every answer is A"). Properties this guarantees:

    - Anti-cheat: the remapped `correctIndex` goes ONLY into server_answer; client_spec carries the
      shuffled options but never the answer.
    - Reproducible: the shuffle is a PURE function of (shuffle_seed, q["id"]). The seed is the entry
      seed, so an entry is fully regenerable from its stored seed — `build_round_set` stays pure.
    - Draw-order independent: keying the salt on the question id (not on rng draw order) means the
      SAME question always yields the SAME client_spec within one entry, preserving the engine's
      client_spec-hash dedup.

    Remap: `order` is a permutation of range(len(options)); `shuffled[j] = options[order[j]]`, so
    the originally-correct option lands at the position j where order[j] == correct, i.e.
    `new_correct = order.index(correct)` (and `shuffled[new_correct] == options[correct]`).

    The salt is a STRING seed (`"{shuffle_seed}:{id}"`) so it is stable across processes and
    independent of PYTHONHASHSEED — never use the builtin hash() here.
    """
    payload = q["payload"]
    # The DISPLAY view: the player's language when an approved translation exists, else the English
    # original (fetch_bank always supplies it; the fallback keeps direct callers/tests working).
    # `correctIndex` indexes the CANONICAL order, and display options are validated to preserve that
    # order 1:1 — so the shuffle below remaps the answer correctly in any language.
    display = q.get("display") or {}
    options = list(display.get("options") or payload["options"])
    correct = int(payload["correctIndex"])
    if len(options) != len(payload["options"]):  # defensive: never shuffle a mismatched list
        options = list(payload["options"])

    order = list(range(len(options)))
    Random(f"{shuffle_seed}:{q['id']}").shuffle(order)
    shuffled = [options[i] for i in order]
    new_correct = order.index(correct)

    client_spec = {
        "prompt": display.get("prompt") or payload["prompt"],
        "options": shuffled,
        "category": q["category"],
        "icon": q["icon"],
        "time_limit_ms": time_limit_ms,
    }
    server_answer = {
        "correctIndex": new_correct,
        "question_id": q["id"],
        "difficulty": q.get("difficulty"),
    }
    return client_spec, server_answer


class TriviaModule:
    type = "trivia"
    time_limit_ms = TRIVIA_TIME_LIMIT_MS

    def generate(
        self, rng: Random, difficulty: str | None, ctx: GenerationContext
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        # difficulty=None → any difficulty (ranked/mixed). Otherwise prefer it, but fall
        # back to the whole (already category-scoped) bank when it has none — a thin category must
        # still yield a full session rather than erroring.
        pool = ctx.bank
        if difficulty is not None:
            pool = [q for q in ctx.bank if q.get("difficulty") == difficulty] or ctx.bank
        if not pool:
            raise ValueError("trivia bank is empty")
        q = rng.choice(pool)
        # The shuffle salt is ctx.seed (NOT consumed from rng) so a duplicate draw of the same q
        # produces an identical client_spec — preserving the engine's dedup.
        return trivia_spec(q, shuffle_seed=ctx.seed, time_limit_ms=self.time_limit_ms)

    def score(self, server_answer: dict[str, Any], submission: dict[str, Any]) -> RoundJudgement:
        choice = submission.get("choice")
        # elapsed_ms is client-asserted → clamp to the SERVER's limit; never trust a client time.
        elapsed = clamp_elapsed_ms(
            submission.get("elapsed_ms", self.time_limit_ms), self.time_limit_ms
        )
        time_frac = (self.time_limit_ms - elapsed) / self.time_limit_ms
        correct = choice == server_answer["correctIndex"]
        return RoundJudgement(correct=correct, time_frac=time_frac, valid=True, flags=[])
