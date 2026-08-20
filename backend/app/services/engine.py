"""Contest engine: build a seeded round set (PLAN.md §4, §5, §7).

build_round_set is a PURE function of (seed, template, ctx): same inputs → same output. This is what
makes an entry reproducible from its stored seed; entries.round_set JSONB is just an audit copy.
The engine iterates the template and looks each module up by type — it never knows module internals.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from random import Random
from typing import Any

from app.modules.base import GenerationContext
from app.modules.registry import get_module
from app.services.templates import ContestTemplate

_MAX_REROLLS = 25  # avoid duplicate rounds within one contest; deterministic given the seed


@dataclass
class GeneratedRound:
    idx: int
    module_type: str
    client_spec: dict[str, Any]
    server_answer: dict[str, Any]


def build_round_set(
    seed: int, template: ContestTemplate, ctx: GenerationContext
) -> list[GeneratedRound]:
    rng = Random(seed)
    rounds: list[GeneratedRound] = []
    seen: set[str] = set()
    for idx, slot in enumerate(template.rounds):
        module = get_module(slot.type)
        client_spec, server_answer = module.generate(rng, slot.difficulty, ctx)
        signature = json.dumps(client_spec, sort_keys=True)
        attempts = 0
        while signature in seen and attempts < _MAX_REROLLS:
            client_spec, server_answer = module.generate(rng, slot.difficulty, ctx)
            signature = json.dumps(client_spec, sort_keys=True)
            attempts += 1
        seen.add(signature)
        rounds.append(GeneratedRound(idx, slot.type, client_spec, server_answer))
    return rounds
