"""Category selection + category-scoped sessions (categories milestone).

Players pick a category for a no-stakes scoped 10-question trivia session. The category list and the
session-start path use the SAME serving gate, so a draft-only category never appears
and never 500s on start. Ranked windows never take a category.
"""

from __future__ import annotations

from app.models import Question
from content.loader import list_categories
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _q(prompt: str, *, category: str, status: str = "approved") -> Question:
    return Question(
        module_type="trivia",
        category=category,
        icon="🔬",
        difficulty="easy",
        status=status,
        explanation="x",
        payload={"prompt": prompt, "options": ["a", "b", "c", "d"], "correctIndex": 0},
    )


async def test_list_categories_excludes_all_draft_categories(db_session: AsyncSession):
    db_session.add_all(
        [
            _q("a1", category="Approved", status="approved"),
            _q("a2", category="Approved", status="approved"),
            _q("d1", category="DraftOnly", status="draft"),
        ]
    )
    await db_session.flush()
    cats = {c["name"]: c["count"] for c in await list_categories(db_session)}
    assert cats.get("Approved") == 2  # served category with its servable count
    assert "DraftOnly" not in cats  # a draft-only category is never offered


async def test_categories_endpoint_returns_servable_categories(
    client: AsyncClient, db_session: AsyncSession
):
    db_session.add_all([_q("s1", category="Science"), _q("h1", category="History")])
    await db_session.flush()
    token = await _register(client, "cat1@example.com", "cat1")
    r = await client.get("/categories", headers=_auth(token))
    assert r.status_code == 200, r.text
    names = {c["name"] for c in r.json()["categories"]}
    assert {"Science", "History"} <= names


async def test_category_practice_is_scoped_to_ten_trivia_of_that_category(
    client: AsyncClient, db_session: AsyncSession
):
    db_session.add_all([_q(f"sci-{n}", category="Science") for n in range(8)])
    await db_session.flush()
    token = await _register(client, "cat2@example.com", "cat2")

    r = await client.post("/practice/start", headers=_auth(token), json={"category": "Science"})
    assert r.status_code == 200, r.text
    rounds = r.json()["rounds"]
    assert len(rounds) == 10  # category sessions are 10 questions
    assert all(rnd["type"] == "trivia" for rnd in rounds)
    assert all(
        rnd["client_spec"]["category"] == "Science" for rnd in rounds
    )  # scoped to one category


async def test_practice_without_category_is_the_unchanged_mixed_session(
    client: AsyncClient, db_session: AsyncSession
):
    from content.loader import load_trivia

    await load_trivia(db_session)
    token = await _register(client, "cat3@example.com", "cat3")
    r = await client.post("/practice/start", headers=_auth(token))  # no body
    assert r.status_code == 200, r.text
    rounds = r.json()["rounds"]
    assert len(rounds) == 5  # the mixed practice template, unchanged
    assert {rnd["type"] for rnd in rounds} == {"trivia", "rapid_math", "memory_flash"}


async def test_starting_a_session_for_an_empty_category_is_a_clean_400(
    client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_q("s1", category="Science"))
    await db_session.flush()
    token = await _register(client, "cat4@example.com", "cat4")
    r = await client.post("/practice/start", headers=_auth(token), json={"category": "Nonexistent"})
    assert r.status_code == 400  # not a 500 — no questions to draw
