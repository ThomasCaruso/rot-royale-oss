"""CHANGE DETECTION round: image-pair A/B comparison, server-validated tap, time-scaled points.

The bounding box lives ONLY on the server, in normalized 0–1 image coordinates; tap tolerance is a
fraction of image dimension, so screen size never changes difficulty. Content arrives as an asset
manifest (stub URLs until real image pairs land) validated by content/change_manifest.py.
"""

from __future__ import annotations

import uuid as _uuid
from random import Random

import pytest
from app.models import (
    CognitionAttempt,
    CognitionChangeItem,
    CognitionRoundInstance,
    Profile,
    User,
)
from app.modules.base import GenerationContext
from app.modules.change_detection import (
    CHANGE_FLICKER_ALTERED_MS,
    CHANGE_FLICKER_BASE_MS,
    CHANGE_FLICKER_BLANK_MS,
    CHANGE_MAX_POINTS,
    CHANGE_MIN_POINTS,
    CHANGE_TIME_LIMIT_MS,
    ChangeDetectionModule,
    hit_test,
)
from content.change_manifest import (
    MANIFEST_VERSION,
    ingest_change_manifest,
    validate_manifest,
)
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


def _manifest_item(key: str = "kitchen_01", **overrides) -> dict:
    item = {
        "key": key,
        "base_asset": f"{key}_base.png",
        "altered_asset": f"{key}_altered.png",
        "width": 1024,
        "height": 768,
        "bbox": {"x": 0.40, "y": 0.30, "w": 0.10, "h": 0.10},
    }
    item.update(overrides)
    return item


def _manifest(*items: dict) -> dict:
    return {"version": MANIFEST_VERSION, "items": list(items) or [_manifest_item()]}


async def _seed_item(session: AsyncSession, **overrides) -> CognitionChangeItem:
    report = await ingest_change_manifest(session, _manifest(_manifest_item(**overrides)))
    assert not report.rejected, report.rejected
    return (
        (
            await session.execute(
                select(CognitionChangeItem).order_by(CognitionChangeItem.key.desc())
            )
        )
        .scalars()
        .first()
    )


# ---------------------------------------------------------------- manifest contract


@pytest.mark.asyncio
async def test_manifest_ingest_and_upsert(db_session: AsyncSession):
    report = await ingest_change_manifest(
        db_session, _manifest(_manifest_item("a"), _manifest_item("b"))
    )
    assert report.added == 2 and not report.rejected

    # Re-ingest: unchanged rows skip; an edited bbox updates in place under the same key.
    edited = _manifest_item("b", bbox={"x": 0.5, "y": 0.5, "w": 0.05, "h": 0.05})
    report2 = await ingest_change_manifest(db_session, _manifest(_manifest_item("a"), edited))
    assert report2.added == 0
    assert report2.updated == 1
    assert report2.skipped == 1

    b = (
        await db_session.execute(select(CognitionChangeItem).where(CognitionChangeItem.key == "b"))
    ).scalar_one()
    assert float(b.bbox_x) == 0.5


def test_manifest_validation_rejects_bad_items():
    # bbox overflowing the image, missing urls, non-positive dims, dup keys — all loud.
    bad_bbox = _manifest_item("x", bbox={"x": 0.95, "y": 0.1, "w": 0.10, "h": 0.05})
    errs = validate_manifest(_manifest(bad_bbox))
    assert any("bbox" in e for _, e in errs)

    no_asset = _manifest_item("y", altered_asset="")
    assert any("altered_asset" in e for _, e in validate_manifest(_manifest(no_asset)))

    # An asset id that could escape the package is a manifest error, not something the serving
    # layer is left to catch on its own.
    for evil in ("../../../../etc/passwd", "/etc/passwd", "a/b.png", "..", "x.svg", "x.webp"):
        bad = _manifest_item("t", base_asset=evil)
        assert any("base_asset" in e for _, e in validate_manifest(_manifest(bad))), evil

    bad_dim = _manifest_item("z", width=0)
    assert any("width" in e for _, e in validate_manifest(_manifest(bad_dim)))

    dup = _manifest(_manifest_item("k"), _manifest_item("k"))
    assert any("duplicate" in e for _, e in validate_manifest(dup))

    # An unknown version is an error. Expressed relative to MANIFEST_VERSION, because this was
    # written as a literal 2 back when the current version was 1 — so bumping the schema silently
    # turned the "reject an unknown version" case into "accept the current one".
    assert validate_manifest({"version": MANIFEST_VERSION + 1, "items": []})
    assert validate_manifest({"version": MANIFEST_VERSION - 1, "items": []})
    assert validate_manifest(_manifest()) == []  # the stub item itself is valid


# ---------------------------------------------------------------- module purity


def test_hit_test_normalized_with_tolerance():
    bbox = {"x": 0.40, "y": 0.30, "w": 0.10, "h": 0.10}
    assert hit_test(bbox, 0.45, 0.35, 0.05) is True  # dead centre
    assert hit_test(bbox, 0.36, 0.35, 0.05) is True  # outside box, inside tolerance
    assert hit_test(bbox, 0.30, 0.35, 0.05) is False  # beyond tolerance on x
    assert hit_test(bbox, 0.45, 0.46, 0.05) is False  # beyond tolerance on y
    assert hit_test(bbox, 0.55, 0.45, 0.05) is True  # far corner edge, inside tolerance


def test_change_module_spec_leaks_no_bbox():
    module = ChangeDetectionModule()
    bank = [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "key": "kitchen_01",
            "base_url": "/b.png",
            "altered_url": "/a.png",
            "width": 1024,
            "height": 768,
            "bbox": {"x": 0.4, "y": 0.3, "w": 0.1, "h": 0.1},
        }
    ]
    spec, answer = module.generate(Random(1), None, GenerationContext(bank=bank, seed=3))
    assert spec["base_url"] == "/b.png"
    assert spec["altered_url"] == "/a.png"
    # A/B comparison, not the classic flicker: the base is studied for 5s and the ALTERED frame is
    # held longer at 8s, because that is the one being searched. The two frames used to share one
    # duration, so the altered timing is its own field.
    assert spec["flicker_base_ms"] == CHANGE_FLICKER_BASE_MS == 5000
    assert spec["flicker_altered_ms"] == CHANGE_FLICKER_ALTERED_MS == 7000
    assert spec["flicker_blank_ms"] == CHANGE_FLICKER_BLANK_MS == 80
    # One full cycle is 13.16s, so the limit must allow more than a single look at each image.
    assert spec["time_limit_ms"] > CHANGE_FLICKER_BASE_MS + CHANGE_FLICKER_ALTERED_MS
    assert "bbox" not in spec
    assert answer["bbox"]["x"] == 0.4


def test_change_points_scale_down_with_time_to_floor():
    module = ChangeDetectionModule()
    answer = {"bbox": {"x": 0.4, "y": 0.3, "w": 0.1, "h": 0.1}, "tolerance_frac": 0.05}
    hit = {"tap": {"x": 0.45, "y": 0.35}}
    assert module.points(answer, {**hit, "elapsed_ms": 0}) == CHANGE_MAX_POINTS
    assert module.points(answer, {**hit, "elapsed_ms": CHANGE_TIME_LIMIT_MS}) == CHANGE_MIN_POINTS
    mid = module.points(answer, {**hit, "elapsed_ms": CHANGE_TIME_LIMIT_MS // 2})
    assert CHANGE_MIN_POINTS < mid < CHANGE_MAX_POINTS
    # Garbage elapsed clamps to the full limit → floor, never a bonus.
    assert module.points(answer, {**hit, "elapsed_ms": 1e999}) == CHANGE_MIN_POINTS
    # A miss scores nothing regardless of speed.
    assert module.points(answer, {"tap": {"x": 0.9, "y": 0.9}, "elapsed_ms": 0}) == 0

    j = module.score(answer, {**hit, "elapsed_ms": 1000})
    assert j.correct is True and j.valid is True
    j2 = module.score(answer, {"tap": {"x": 5.0, "y": 0.5}, "elapsed_ms": 0})
    assert j2.valid is False and "tap_out_of_range" in j2.flags


# ---------------------------------------------------------------- API flow


async def test_change_full_flow_hit(client: AsyncClient, db_session: AsyncSession):
    await _seed_item(db_session)
    token = await _register(client, "cd1@example.com", "cduser1")

    r = await client.post("/cognition/change/start", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    instance_id = body["instance_id"]
    spec = body["spec"]
    assert spec["base_url"].endswith("_base.png")
    assert spec["altered_url"].endswith("_altered.png")
    assert spec["width"] == 1024 and spec["height"] == 768
    assert spec["flicker_base_ms"] == 5000 and spec["flicker_altered_ms"] == 7000
    assert spec["flicker_blank_ms"] == 80
    assert "bbox" not in spec and "seed" not in spec

    r = await client.post(
        f"/cognition/change/{instance_id}/submit",
        headers=_auth(token),
        json={"x": 0.45, "y": 0.35, "elapsed_ms": 3000},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["hit"] is True
    assert CHANGE_MIN_POINTS <= out["points"] <= CHANGE_MAX_POINTS
    assert out["done"] is True
    assert out["bbox"] == {"x": 0.40, "y": 0.30, "w": 0.10, "h": 0.10}  # revealed post-resolution

    inst = await db_session.get(CognitionRoundInstance, instance_id)
    assert inst is not None
    assert inst.completed_at is not None
    assert inst.final_score == out["points"]
    assert inst.scoring_version == 2

    # One tap per round: a second submit is refused.
    r = await client.post(
        f"/cognition/change/{instance_id}/submit",
        headers=_auth(token),
        json={"x": 0.45, "y": 0.35, "elapsed_ms": 100},
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "cognition_round_completed"


async def test_change_miss_scores_zero(client: AsyncClient, db_session: AsyncSession):
    await _seed_item(db_session)
    token = await _register(client, "cd2@example.com", "cduser2")
    instance_id = (await client.post("/cognition/change/start", headers=_auth(token))).json()[
        "instance_id"
    ]
    r = await client.post(
        f"/cognition/change/{instance_id}/submit",
        headers=_auth(token),
        json={"x": 0.9, "y": 0.9, "elapsed_ms": 1000},
    )
    out = r.json()
    assert out["hit"] is False and out["points"] == 0 and out["done"] is True

    inst = await db_session.get(CognitionRoundInstance, instance_id)
    assert inst is not None and inst.final_score == 0


async def test_change_tap_must_be_normalized(client: AsyncClient, db_session: AsyncSession):
    await _seed_item(db_session)
    token = await _register(client, "cd3@example.com", "cduser3")
    instance_id = (await client.post("/cognition/change/start", headers=_auth(token))).json()[
        "instance_id"
    ]
    r = await client.post(
        f"/cognition/change/{instance_id}/submit",
        headers=_auth(token),
        json={"x": 1.5, "y": 0.5, "elapsed_ms": 0},
    )
    assert r.status_code == 422  # normalized 0-1 coordinates only — pixels are a client concern


async def test_change_timeout_resolves_the_round(client: AsyncClient, db_session: AsyncSession):
    """A timed-out round must RESOLVE — as a legitimate miss, not as an error.

    The client used to signal "no tap" as (-1, -1), which this endpoint rejected with a 422 (taps
    are constrained to 0..1). The instance was therefore never completed, and the Royale bridge then
    409'd on /answer, stranding the player on "finish this round before moving on" with no way to
    finish it. Every single timeout bricked the run; it was never caught because the mode has no
    content and had never been played to expiry.
    """
    await _seed_item(db_session)
    token = await _register(client, "cd6@example.com", "cduser6")
    instance_id = (await client.post("/cognition/change/start", headers=_auth(token))).json()[
        "instance_id"
    ]
    r = await client.post(
        f"/cognition/change/{instance_id}/submit",
        headers=_auth(token),
        json={"x": None, "y": None, "elapsed_ms": CHANGE_TIME_LIMIT_MS},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["hit"] is False and out["points"] == 0
    assert out["done"] is True  # the round is FINISHED, so the Royale bridge can finalize it

    inst = await db_session.get(CognitionRoundInstance, instance_id)
    assert inst is not None and inst.completed_at is not None and inst.final_score == 0


async def test_change_timeout_is_not_flagged_as_tampering(db_session: AsyncSession):
    """Running out of time is a legitimate outcome; only a malformed tap is a validity signal."""
    module = ChangeDetectionModule()
    answer = {"bbox": {"x": 0.4, "y": 0.4, "w": 0.1, "h": 0.1}, "tolerance_frac": 0.05}

    timed_out = module.score(answer, {"tap": None, "timed_out": True, "elapsed_ms": 15000})
    assert timed_out.correct is False
    assert timed_out.valid is True and timed_out.flags == []

    garbage = module.score(answer, {"tap": {"x": 9.0, "y": 9.0}, "elapsed_ms": 10})
    assert garbage.valid is False and "tap_out_of_range" in garbage.flags


async def test_legacy_app_timeout_sentinel_still_resolves(
    client: AsyncClient, db_session: AsyncSession
):
    """BACKWARD COMPATIBILITY. Every installed iOS/Android binary signals "timed out, no tap" as
    (-1, -1), and an app bundle cannot be changed on Apple's timetable.

    Tightening the schema to 0..1 rejected that with a 422, so on the shipped app EVERY change-round
    timeout left the cognition instance unresolved and the Royale bridge 409ing behind it — the
    player stranded mid-run, unable to finish or score. This is the regression test for that: the
    server must keep accepting the old sentinel for as long as old binaries exist in the wild.
    """
    await _seed_item(db_session)
    token = await _register(client, "legacy@example.com", "legacyuser")
    instance_id = (await client.post("/cognition/change/start", headers=_auth(token))).json()[
        "instance_id"
    ]
    r = await client.post(
        f"/cognition/change/{instance_id}/submit",
        headers=_auth(token),
        json={"x": -1, "y": -1, "elapsed_ms": CHANGE_TIME_LIMIT_MS},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["hit"] is False and out["points"] == 0
    assert out["done"] is True  # the round FINISHES, so the Royale bridge can finalize it

    inst = await db_session.get(CognitionRoundInstance, instance_id)
    assert inst is not None and inst.completed_at is not None


async def test_a_tap_beyond_the_image_is_still_rejected(
    client: AsyncClient, db_session: AsyncSession
):
    """Accepting the legacy sentinel must not become "accept anything" — a coordinate above 1 is
    not a timeout, it is garbage, and it stays a 422."""
    await _seed_item(db_session)
    token = await _register(client, "garbage@example.com", "garbageuser")
    instance_id = (await client.post("/cognition/change/start", headers=_auth(token))).json()[
        "instance_id"
    ]
    r = await client.post(
        f"/cognition/change/{instance_id}/submit",
        headers=_auth(token),
        json={"x": 9.0, "y": 9.0, "elapsed_ms": 100},
    )
    assert r.status_code == 422


async def test_asset_urls_are_absolute_for_the_native_app(
    client: AsyncClient, db_session: AsyncSession
):
    """The native app loads its web build from the BUNDLE (no capacitor server.url), so a relative
    /assets/... path resolves against that bundle rather than the server. Content added after a
    binary shipped would 404 there — a blank box and a guaranteed miss — and an App Store release
    is not a thing we can do on demand. The server therefore hands out absolute URLs.
    """
    await _seed_item(db_session)
    token = await _register(client, "abs@example.com", "absuser")
    spec = (await client.post("/cognition/change/start", headers=_auth(token))).json()["spec"]

    for url in (spec["base_url"], spec["altered_url"]):
        assert url.startswith("http://") or url.startswith("https://"), url
        # Served BY THIS API out of the private content package now, not by the web host out of
        # frontend/public — the client contract (these two keys, absolute values) is unchanged.
        assert "/content/change/" in url, url


async def test_change_unavailable_without_items(client: AsyncClient, db_session: AsyncSession):
    token = await _register(client, "cd4@example.com", "cduser4")
    r = await client.post("/cognition/change/start", headers=_auth(token))
    assert r.status_code == 409
    assert r.json()["detail"] == "change_unavailable"


async def test_change_owner_scoped(client: AsyncClient, db_session: AsyncSession):
    await _seed_item(db_session)
    token_a = await _register(client, "cd5@example.com", "cduser5")
    token_b = await _register(client, "cd6@example.com", "cduser6")
    instance_id = (await client.post("/cognition/change/start", headers=_auth(token_a))).json()[
        "instance_id"
    ]
    r = await client.post(
        f"/cognition/change/{instance_id}/submit",
        headers=_auth(token_b),
        json={"x": 0.5, "y": 0.5, "elapsed_ms": 0},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_change_draw_is_pinned(db_session: AsyncSession):
    """The drawn image pair is pinned at start (attempt-0 marker), same as estimate."""
    from app.services import cognition as cog

    await ingest_change_manifest(db_session, _manifest(_manifest_item("p1"), _manifest_item("p2")))
    user = User(email=f"{_uuid.uuid4().hex}@t.test", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        Profile(user_id=user.id, username=f"u{_uuid.uuid4().hex[:10]}", division="Bronze")
    )
    await db_session.flush()

    s1 = await cog.change_start(db_session, user.id, seed=99)
    s2 = await cog.change_start(db_session, user.id, seed=99)
    assert s1.spec["key"] == s2.spec["key"]

    marker = (
        await db_session.execute(
            select(CognitionAttempt).where(
                CognitionAttempt.round_instance_id == s1.instance.id,
                CognitionAttempt.attempt_index == 0,
            )
        )
    ).scalar_one()
    assert "item_id" in marker.payload


def test_two_full_cycles_fit_the_round_limit():
    """The phase budget is load-bearing, so it gets an assertion rather than a comment.

    A cycle is beat + base + beat + altered. Two COMPLETE cycles must fit inside the time limit: a
    frame that vanishes mid-search reads as the game taking it away, and one clean look plus a
    truncated one is worse than two clean looks. Any future change to a phase duration (or to the
    limit) has to keep this true — and the limit can't simply be raised to compensate, because
    points slide from MAX to MIN across it, so stretching it quietly re-prices every round.
    """
    from app.modules.change_detection import (
        CHANGE_FLICKER_ALTERED_MS,
        CHANGE_FLICKER_BASE_MS,
        CHANGE_FLICKER_LABEL_MS,
        CHANGE_TIME_LIMIT_MS,
    )

    cycle = (
        CHANGE_FLICKER_LABEL_MS
        + CHANGE_FLICKER_BASE_MS
        + CHANGE_FLICKER_LABEL_MS
        + (CHANGE_FLICKER_ALTERED_MS)
    )
    assert cycle * 2 <= CHANGE_TIME_LIMIT_MS, (
        f"two cycles = {cycle * 2}ms exceeds the {CHANGE_TIME_LIMIT_MS}ms limit — the second look "
        f"at the altered frame would be cut short"
    )
