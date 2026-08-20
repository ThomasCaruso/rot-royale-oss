"""ESTIMATE round (Fermi estimation): server-held answer, up to 3 guesses, direction + proximity
feedback, 3/2/1/0 scoring by attempt.

The answer (and the component quantities, which would let a client derive it) never reach the
client until the round resolves — guesses get only {direction, band}. The drawn item is pinned in
an attempt-0 marker row at start so a catalog change mid-round can never switch the answer.
"""

from __future__ import annotations

from decimal import Decimal
from random import Random

import pytest
from app.models import (
    CognitionAttempt,
    CognitionEstimateItem,
    CognitionRoundInstance,
)
from app.modules.base import GenerationContext
from app.modules.estimate import (
    DEFAULT_ACCEPTABLE_PCT,
    DEFAULT_CLOSE_PCT,
    ESTIMATE_MAX_GUESSES,
    EstimateModule,
    decade_bounds,
    judge_guess,
    narrow_bounds,
)
from app.services import cognition as cog
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _item(
    session: AsyncSession,
    *,
    answer: str = "100",
    pct: str = "20",
    prompt: str = "How many candy bars tall is the Empire State Building?",
    source_id: str | None = None,
) -> CognitionEstimateItem:
    item = CognitionEstimateItem(
        prompt=prompt,
        answer=Decimal(answer),
        unit="bars",
        source_id=source_id,
        components=[
            {"label": "building height", "value": 443, "unit": "m", "source_url": "https://s1"},
            {"label": "candy bar length", "value": 0.11, "unit": "m", "source_url": "https://s2"},
        ],
        reveal_explanation="443 m ÷ 0.11 m per bar ≈ 4,027 bars.",
        intuition_note="People anchor on floors, not metres, and guess low.",
        difficulty="two_step",
        acceptable_pct=Decimal(pct),
    )
    session.add(item)
    await session.flush()
    return item


# ---------------------------------------------------------------- pure judgement + module


def test_judge_guess_direction_and_band():
    """Correct within acceptable_pct (resolves, no band); a near-miss inside close_pct feels
    different from a wild miss beyond it."""
    # answer 100: correct within 20% → [80, 120]; close within 40% → [60, 140] outside correct.
    assert judge_guess(100.0, 20.0, 40.0, 50.0) == (False, "higher", "far")
    assert judge_guess(100.0, 20.0, 40.0, 61.0) == (False, "higher", "close")
    assert judge_guess(100.0, 20.0, 40.0, 60.0) == (False, "higher", "close")  # boundary is close
    assert judge_guess(100.0, 20.0, 40.0, 139.0) == (False, "lower", "close")
    assert judge_guess(100.0, 20.0, 40.0, 150.0) == (False, "lower", "far")
    assert judge_guess(100.0, 20.0, 40.0, 80.0) == (True, None, None)
    assert judge_guess(100.0, 20.0, 40.0, 120.0) == (True, None, None)
    assert judge_guess(100.0, 20.0, 40.0, 100.0) == (True, None, None)


def test_default_pct_by_difficulty():
    assert DEFAULT_ACCEPTABLE_PCT == {"direct": 20, "two_step": 30, "counterintuitive": 40}
    # close_pct defaults to 2× acceptable_pct.
    assert DEFAULT_CLOSE_PCT == {"direct": 40, "two_step": 60, "counterintuitive": 80}


def test_decade_bounds_leak_only_magnitude():
    """Bounds = decade/10 .. decade*10, so every answer in a decade gets IDENTICAL bounds — they
    leak the order of magnitude (needed to reason) and nothing finer."""
    assert decade_bounds(183) == (10.0, 1000.0)
    assert decade_bounds(500) == (10.0, 1000.0)  # same decade → same bounds
    assert decade_bounds(999) == (10.0, 1000.0)
    assert decade_bounds(8674) == (100.0, 10000.0)
    assert decade_bounds(10) == (1.0, 100.0)
    assert decade_bounds(5) == pytest.approx((0.1, 10.0))


def test_narrow_bounds_shrinks_to_surviving_range():
    # answer 100 → decade bounds (10, 1000). Each wrong guess narrows to the survivors.
    assert narrow_bounds(100, []) == (10.0, 1000.0)
    assert narrow_bounds(100, [50]) == (50.0, 1000.0)  # 50 too low → min rises to it
    assert narrow_bounds(100, [50, 400]) == (50.0, 400.0)  # 400 too high → max drops to it
    assert narrow_bounds(100, [50, 400, 80]) == (80.0, 400.0)  # 80 too low → min rises again


def test_estimate_module_spec_leaks_nothing():
    module = EstimateModule()
    bank = [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "prompt": "How many?",
            "answer": 100.0,
            "unit": "u",
            "difficulty": "direct",
            "acceptable_pct": 20.0,
            "close_pct": None,
            "components": [{"label": "x", "value": 1, "unit": "u", "source_url": "https://s"}],
            "reveal_explanation": "1 × 100",
            "intuition_note": None,
        }
    ]
    spec, answer = module.generate(Random(1), None, GenerationContext(bank=bank, seed=7))
    assert spec["prompt"] == "How many?"
    assert spec["max_guesses"] == ESTIMATE_MAX_GUESSES
    for leak in ("answer", "components", "reveal_explanation", "acceptable_pct", "close_pct"):
        assert leak not in spec, f"client_spec must not carry {leak}"
    assert answer["answer"] == 100.0
    assert answer["acceptable_pct"] == 20.0
    assert answer["close_pct"] == 40.0  # unset → 2× acceptable_pct


def test_estimate_module_score_is_3_2_1_0():
    module = EstimateModule()
    answer = {"item_id": "x", "answer": 100.0, "acceptable_pct": 20.0, "close_pct": 40.0}
    assert module.points(answer, {"guesses": [100.0]}) == 3
    assert module.points(answer, {"guesses": [1.0, 110.0]}) == 2
    assert module.points(answer, {"guesses": [1.0, 500.0, 90.0]}) == 1
    assert module.points(answer, {"guesses": [1.0, 500.0, 2.0]}) == 0
    assert module.points(answer, {"guesses": []}) == 0

    j = module.score(answer, {"guesses": [1.0, 110.0]})
    assert j.correct is True and j.valid is True

    # Guessing on after the round resolved (or a 4th guess) is impossible honestly.
    j2 = module.score(answer, {"guesses": [100.0, 90.0]})
    assert j2.valid is False and "guess_after_resolve" in j2.flags
    j3 = module.score(answer, {"guesses": [1.0, 2.0, 3.0, 4.0]})
    assert j3.valid is False and "too_many_guesses" in j3.flags


# ---------------------------------------------------------------- API flow


async def test_estimate_full_flow_correct_on_third(client: AsyncClient, db_session: AsyncSession):
    await _item(db_session)
    token = await _register(client, "est1@example.com", "estuser1")

    r = await client.post("/cognition/estimate/start", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    instance_id = body["instance_id"]
    spec = body["spec"]
    assert spec["prompt"].startswith("How many candy bars")
    assert spec["unit"] == "bars"
    assert spec["max_guesses"] == 3
    for leak in ("answer", "components", "reveal_explanation", "acceptable_pct", "seed"):
        assert leak not in spec

    # Resolve before the round is done must not leak the answer.
    r = await client.post(f"/cognition/estimate/{instance_id}/resolve", headers=_auth(token))
    assert r.status_code == 409
    assert r.json()["detail"] == "estimate_unresolved"

    # Guess 1: a wild miss → "far", go "higher".
    r = await client.post(
        f"/cognition/estimate/{instance_id}/guess", headers=_auth(token), json={"value": 10}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {
        "correct": False,
        "direction": "higher",
        "band": "far",
        "done": False,
        "guesses_left": 2,
        "points": 0,
        "slider_min": 10.0,  # answer 100 → decade bounds (10, 1000); guess 10 is at the floor
        "slider_max": 1000.0,
    }

    # Guess 2: a near-miss — outside acceptable (20% → [80,120]) but inside close (40% → [60,140]).
    r = await client.post(
        f"/cognition/estimate/{instance_id}/guess", headers=_auth(token), json={"value": 130}
    )
    out = r.json()
    assert out["direction"] == "lower"
    assert out["band"] == "close"
    assert out["correct"] is False

    # Guess 3: within 20% of 100 → correct, 1 point, no band needed.
    r = await client.post(
        f"/cognition/estimate/{instance_id}/guess", headers=_auth(token), json={"value": 90}
    )
    out = r.json()
    assert out["correct"] is True
    assert out["band"] is None
    assert out["done"] is True
    assert out["points"] == 1
    assert out["guesses_left"] == 0

    # Now resolve reveals the answer, the arithmetic, and the guess history.
    r = await client.post(f"/cognition/estimate/{instance_id}/resolve", headers=_auth(token))
    assert r.status_code == 200
    res = r.json()
    assert res["answer"] == 100.0
    assert res["points"] == 1
    assert res["acceptable_pct"] == 20.0
    assert res["close_pct"] == 40.0
    assert "443" in res["reveal_explanation"]
    assert len(res["components"]) == 2
    assert res["intuition_note"].startswith("People anchor")
    assert res["guesses"] == [10.0, 130.0, 90.0]

    inst = await db_session.get(CognitionRoundInstance, instance_id)
    assert inst is not None
    assert inst.completed_at is not None
    assert inst.final_score == 1
    assert inst.scoring_version == 2

    # A resolved round refuses further guesses.
    r = await client.post(
        f"/cognition/estimate/{instance_id}/guess", headers=_auth(token), json={"value": 100}
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "cognition_round_completed"


async def test_estimate_resolve_exposes_source_id_for_in_moment_rating(
    client: AsyncClient, db_session: AsyncSession
):
    """After the round resolves, the reveal carries the item's source_id so an admin can rate the
    item in the moment (the playtest harness). It's post-round and not answer material."""
    await _item(db_session, source_id="fer_0001")
    token = await _register(client, "estsid@example.com", "estsiduser")
    instance_id = (await client.post("/cognition/estimate/start", headers=_auth(token))).json()[
        "instance_id"
    ]
    # It must NOT appear in the client_spec at start... (checked in the full-flow test) and it
    # only appears once resolved.
    await client.post(
        f"/cognition/estimate/{instance_id}/guess", headers=_auth(token), json={"value": 100}
    )
    res = (
        await client.post(f"/cognition/estimate/{instance_id}/resolve", headers=_auth(token))
    ).json()
    assert res["id"] == "fer_0001"


async def test_estimate_start_spec_carries_slider_bounds(
    client: AsyncClient, db_session: AsyncSession
):
    await _item(db_session, answer="100")  # decade bounds (10, 1000)
    token = await _register(client, "estsl@example.com", "estsluser")
    spec = (await client.post("/cognition/estimate/start", headers=_auth(token))).json()["spec"]
    assert spec["slider_min"] == 10.0
    assert spec["slider_max"] == 1000.0
    # The bounds are magnitude-only; the answer never appears in the spec.
    assert "answer" not in spec
    assert 100.0 not in spec.values()


async def test_estimate_guess_returns_server_narrowed_bounds(
    client: AsyncClient, db_session: AsyncSession
):
    """Each wrong guess comes back with the narrowed [min, max] — the SERVER computes it; the
    client must not."""
    await _item(db_session, answer="100", pct="20")  # acceptable [80,120]; 50 & 400 are wrong
    token = await _register(client, "estsl2@example.com", "estsl2user")
    iid = (await client.post("/cognition/estimate/start", headers=_auth(token))).json()[
        "instance_id"
    ]

    r = await client.post(
        f"/cognition/estimate/{iid}/guess", headers=_auth(token), json={"value": 50}
    )
    out = r.json()
    assert out["direction"] == "higher"
    assert out["slider_min"] == 50.0  # too-low guess raised the floor to it
    assert out["slider_max"] == 1000.0

    r = await client.post(
        f"/cognition/estimate/{iid}/guess", headers=_auth(token), json={"value": 400}
    )
    out = r.json()
    assert out["direction"] == "lower"
    assert out["slider_min"] == 50.0
    assert out["slider_max"] == 400.0  # too-high guess dropped the ceiling to it


async def test_estimate_three_misses_score_zero(client: AsyncClient, db_session: AsyncSession):
    await _item(db_session)
    token = await _register(client, "est2@example.com", "estuser2")
    instance_id = (await client.post("/cognition/estimate/start", headers=_auth(token))).json()[
        "instance_id"
    ]

    for v in (1, 2, 3):
        r = await client.post(
            f"/cognition/estimate/{instance_id}/guess", headers=_auth(token), json={"value": v}
        )
        assert r.status_code == 200
    out = r.json()
    assert out["correct"] is False
    assert out["done"] is True
    assert out["points"] == 0

    res = (
        await client.post(f"/cognition/estimate/{instance_id}/resolve", headers=_auth(token))
    ).json()
    assert res["answer"] == 100.0
    assert res["points"] == 0

    inst = await db_session.get(CognitionRoundInstance, instance_id)
    assert inst is not None
    assert inst.final_score == 0


async def test_estimate_first_guess_scores_three(client: AsyncClient, db_session: AsyncSession):
    await _item(db_session)
    token = await _register(client, "est3@example.com", "estuser3")
    instance_id = (await client.post("/cognition/estimate/start", headers=_auth(token))).json()[
        "instance_id"
    ]
    r = await client.post(
        f"/cognition/estimate/{instance_id}/guess", headers=_auth(token), json={"value": 100}
    )
    out = r.json()
    assert out["correct"] is True and out["points"] == 3 and out["done"] is True


async def test_estimate_unavailable_without_items(client: AsyncClient, db_session: AsyncSession):
    token = await _register(client, "est4@example.com", "estuser4")
    r = await client.post("/cognition/estimate/start", headers=_auth(token))
    assert r.status_code == 409
    assert r.json()["detail"] == "estimate_unavailable"


async def test_estimate_owner_scoped(client: AsyncClient, db_session: AsyncSession):
    await _item(db_session)
    token_a = await _register(client, "est5@example.com", "estuser5")
    token_b = await _register(client, "est6@example.com", "estuser6")
    instance_id = (await client.post("/cognition/estimate/start", headers=_auth(token_a))).json()[
        "instance_id"
    ]
    r = await client.post(
        f"/cognition/estimate/{instance_id}/guess", headers=_auth(token_b), json={"value": 1}
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "cognition_round_not_found"


# ---------------------------------------------------------------- service-level properties


@pytest.mark.asyncio
async def test_estimate_draw_is_seed_deterministic_and_pinned(db_session: AsyncSession):
    """Same seed → same item; and the draw is pinned in the attempt-0 marker so a mid-round
    catalog change can't switch the answer under the player."""
    import uuid as _uuid

    from app.models import Profile, User

    a = await _item(db_session, prompt="Item A?")
    b = await _item(db_session, prompt="Item B?", answer="7", pct="20")
    user = User(email=f"{_uuid.uuid4().hex}@t.test", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        Profile(user_id=user.id, username=f"u{_uuid.uuid4().hex[:10]}", division="Bronze")
    )
    await db_session.flush()

    s1 = await cog.estimate_start(db_session, user.id, seed=5)
    s2 = await cog.estimate_start(db_session, user.id, seed=5)
    assert s1.spec["prompt"] == s2.spec["prompt"]

    marker = (
        await db_session.execute(
            select(CognitionAttempt).where(
                CognitionAttempt.round_instance_id == s1.instance.id,
                CognitionAttempt.attempt_index == 0,
            )
        )
    ).scalar_one()
    assert marker.payload["item_id"] in {str(a.id), str(b.id)}

    # Deactivate the drawn item mid-round: the pinned round still judges against it.
    drawn = await db_session.get(CognitionEstimateItem, _uuid.UUID(marker.payload["item_id"]))
    assert drawn is not None
    drawn.active = False
    await db_session.flush()
    out = await cog.estimate_guess(db_session, s1.instance.id, user.id, float(drawn.answer))
    assert out.correct is True


@pytest.mark.asyncio
async def test_estimate_draw_is_shared_across_users_for_one_seed(db_session: AsyncSession):
    """The property the daily gauntlet composes on: two DIFFERENT users starting from the same
    (date-derived) seed draw the same item, so the day's field competes on the same question."""
    import uuid as _uuid

    from app.models import Profile, User

    await _item(db_session, prompt="Item A?")
    await _item(db_session, prompt="Item B?", answer="7", pct="20")
    await _item(db_session, prompt="Item C?", answer="9", pct="20")

    users = []
    for _ in range(2):
        u = User(email=f"{_uuid.uuid4().hex}@t.test", password_hash="x")
        db_session.add(u)
        await db_session.flush()
        db_session.add(
            Profile(user_id=u.id, username=f"u{_uuid.uuid4().hex[:10]}", division="Bronze")
        )
        await db_session.flush()
        users.append(u)

    day_seed = 20260810
    s1 = await cog.estimate_start(db_session, users[0].id, seed=day_seed)
    s2 = await cog.estimate_start(db_session, users[1].id, seed=day_seed)
    assert s1.spec["prompt"] == s2.spec["prompt"]

    async def _pinned(instance_id):
        marker = (
            await db_session.execute(
                select(CognitionAttempt).where(
                    CognitionAttempt.round_instance_id == instance_id,
                    CognitionAttempt.attempt_index == 0,
                )
            )
        ).scalar_one()
        return marker.payload["item_id"]

    assert await _pinned(s1.instance.id) == await _pinned(s2.instance.id)
