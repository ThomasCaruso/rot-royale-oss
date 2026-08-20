"""Build answer-bearing offline content bundles for non-ranked modes.

An OfflineRound carries the shuffled client_spec (for play) PLUS the local-reveal answer and a
shuffled->original option map so the client can record its choice as a STABLE original index. The
server re-scores that original index against the bank on sync (see services/offline_sync.py); the
device answer is reveal-only, never the scoring authority.
"""

from __future__ import annotations

import hashlib
import json
import uuid
import zlib
from random import Random
from typing import Any

from content.loader import fetch_bank
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.trivia import TRIVIA_TIME_LIMIT_MS

OFFLINE_POOL_PER_CATEGORY = 40
CAMPAIGN_LOOKAHEAD_LEVELS = 3


def _shuffle_order(shuffle_seed: int, question_id: str, n: int) -> list[int]:
    """The SAME permutation trivia_spec uses: order[j] = original index at shuffled slot j.

    INVARIANT: the salt string and seed list MUST stay byte-for-byte identical to
    app.modules.trivia.trivia_spec (`Random(f"{shuffle_seed}:{q['id']}").shuffle(list(range(n)))`).
    Offline reveal + sync re-scoring depend on this producing the exact same order as an online run.
    """
    order = list(range(n))
    Random(f"{shuffle_seed}:{question_id}").shuffle(order)
    return order


def build_offline_round(q: dict[str, Any], *, idx: int, shuffle_seed: int) -> dict[str, Any]:
    payload = q["payload"]
    options: list[str] = payload["options"]
    correct = int(payload["correctIndex"])
    order = _shuffle_order(shuffle_seed, str(q["id"]), len(options))
    shuffled = [options[i] for i in order]
    correct_index = order.index(correct)  # shuffled slot holding the correct option
    return {
        "question_id": str(q["id"]),
        "idx": idx,
        "client_spec": {
            "prompt": payload["prompt"],
            "options": shuffled,
            "category": q["category"],
            "icon": q["icon"],
            "time_limit_ms": TRIVIA_TIME_LIMIT_MS,
        },
        "option_source_index": order,  # order[slot] = original index
        "correct_index": correct_index,  # shuffled slot of correct option (reveal only)
        "explanation": q.get("explanation"),
    }


def compute_bank_version(bank: list[dict[str, Any]]) -> str:
    """A content hash: changes whenever any served question's prompt/options/correctIndex changes.
    Cheap at our bank sizes; only computed on a bundle/pool fetch. Sorted by id for stability."""
    material = [
        [
            str(q["id"]),
            q["payload"]["prompt"],
            q["payload"]["options"],
            int(q["payload"]["correctIndex"]),
        ]
        for q in sorted(bank, key=lambda q: str(q["id"]))
    ]
    digest = hashlib.md5(json.dumps(material, separators=(",", ":")).encode()).hexdigest()
    return digest[:16]


async def build_practice_pool(
    session: AsyncSession,
    *,
    category: str | None,
    limit: int = OFFLINE_POOL_PER_CATEGORY,
) -> dict[str, Any]:
    """An offline practice pool: up to `limit` servable questions (scoped to `category` if given),
    each built into an answer-bearing offline round. Practice is not leaderboard-comparable, so the
    per-question shuffle seed is a stable per-question hash (display order only)."""
    bank = await fetch_bank(session, "trivia", category)
    chosen = bank[:limit]
    rounds = [
        build_offline_round(q, idx=i, shuffle_seed=zlib.crc32(str(q["id"]).encode()) & 0x7FFFFFFF)
        for i, q in enumerate(chosen)
    ]
    return {
        "category": category,
        "bank_version": compute_bank_version(bank),
        "questions": rounds,
    }


async def build_campaign_bundle(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    lookahead: int = CAMPAIGN_LOOKAHEAD_LEVELS,
) -> dict[str, Any]:
    """An offline campaign bundle: every unlocked level (plus up to `lookahead` locked levels
    ahead per world) resolved to its exact authored questions and built into offline rounds.

    Reuses the online campaign's authored-question resolution and unlock computation. The per-(user,
    level) seed is deterministic so a re-downloaded bundle is stable; it deliberately does NOT match
    the online random seed. Sync re-scores by the stable ORIGINAL option index, not the shuffle seed
    (see services/offline_sync.py), so scoring is identical either way."""
    from app.services import campaign as camp

    bank = await fetch_bank(session, "trivia")
    version = compute_bank_version(bank)
    levels_out: list[dict[str, Any]] = []
    # One key index per category, shared across that category's levels. Rebuilding it per level
    # was O(levels × bank) SHA-1 hashing — tens of thousands of hashes per bundle request, and
    # this endpoint fires on every offline→online network edge.
    key_index: dict[str, dict[str, dict[str, Any]]] = {}
    for world, level in await camp.offline_cacheable_levels(session, user_id, lookahead=lookahead):
        by_key = key_index.get(level.category)
        if by_key is None:
            by_key = key_index[level.category] = camp.bank_key_index(level.category, bank)
        seed = camp.campaign_level_seed(user_id, world.world, level.level_number)
        rounds = [
            build_offline_round(q, idx=i, shuffle_seed=seed)
            for i, q in enumerate(camp.authored_bank_questions(level, bank, by_key=by_key))
        ]
        levels_out.append(
            {
                "world": world.world,
                "level": level.level_number,
                "title": level.title,
                "is_boss": level.is_boss,
                "seed": seed,
                "rounds": rounds,
            }
        )
    return {"bank_version": version, "levels": levels_out}
