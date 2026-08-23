"""Server-decided one-time prompts (notifications opt-in, rating ask, outage apology).

The SERVER picks which prompt to show. That is the point: timing rules change without an App Store
release, which is the whole lesson of the §5f outage. The client renders what it is told.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.models import ContestWindow, Entry, Profile, PushSubscription
from app.models.contest import IN_PROGRESS, OPEN, SUBMITTED
from app.models.prompt import (
    ACCEPTED,
    PROMPT_GOODWILL,
    PROMPT_NOTIFICATIONS,
    PROMPT_PICK_USERNAME,
    PROMPT_RATE,
)
from app.services.prompts import ack_prompt, next_prompt, royales_completed
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(session: AsyncSession) -> uuid.UUID:
    from app.services.registration import register_guest

    return (await register_guest(session)).id


async def _play_royales(session: AsyncSession, user_id: uuid.UUID, n: int) -> None:
    """n COMPLETED Daily Royale runs (distinct days — one window per contest_date)."""
    base = datetime.now(UTC)
    for i in range(n):
        day = (base - timedelta(days=i + 1)).date()
        w = ContestWindow(
            contest_date=day,
            slot="royale",
            open_at=base - timedelta(days=i + 2),
            close_at=base - timedelta(days=i + 1),
            state=OPEN,
            template_id="dr_8_trivia",
        )
        session.add(w)
        await session.flush()
        session.add(
            Entry(
                window_id=w.id,
                user_id=user_id,
                seed=1,
                round_set=[],
                started_at=base,
                submitted_at=base,
                status=SUBMITTED,
            )
        )
    await session.flush()


async def test_nothing_is_asked_before_the_first_run(client, db_session: AsyncSession):
    """The explicit instruction: do NOT prompt on first open. A player who has not finished a run
    has been given no reason to say yes, and a denied permission is permanent."""
    user_id = await _user(db_session)
    assert await next_prompt(db_session, user_id) is None


async def test_notifications_are_asked_after_the_first_completed_run(
    client, db_session: AsyncSession
):
    user_id = await _user(db_session)
    await _play_royales(db_session, user_id, 1)
    assert (await next_prompt(db_session, user_id)) == PROMPT_NOTIFICATIONS


async def test_an_unfinished_run_does_not_count(client, db_session: AsyncSession):
    user_id = await _user(db_session)
    w = ContestWindow(
        contest_date=datetime.now(UTC).date(),
        slot="royale",
        open_at=datetime.now(UTC) - timedelta(hours=1),
        close_at=datetime.now(UTC) + timedelta(hours=1),
        state=OPEN,
        template_id="dr_8_trivia",
    )
    db_session.add(w)
    await db_session.flush()
    db_session.add(
        Entry(
            window_id=w.id,
            user_id=user_id,
            seed=1,
            round_set=[],
            started_at=datetime.now(UTC),
            status=IN_PROGRESS,
        )
    )
    await db_session.flush()

    assert await royales_completed(db_session, user_id) == 0
    assert await next_prompt(db_session, user_id) is None


async def test_answering_a_prompt_retires_it(client, db_session: AsyncSession):
    user_id = await _user(db_session)
    await _play_royales(db_session, user_id, 1)

    await ack_prompt(db_session, user_id, PROMPT_NOTIFICATIONS, outcome=ACCEPTED)

    assert await next_prompt(db_session, user_id) is None


async def test_rating_is_asked_after_the_third_run(client, db_session: AsyncSession):
    user_id = await _user(db_session)
    await _play_royales(db_session, user_id, 3)
    await ack_prompt(db_session, user_id, PROMPT_NOTIFICATIONS, outcome=ACCEPTED)

    assert (await next_prompt(db_session, user_id)) == PROMPT_RATE


async def test_only_one_prompt_at_a_time(client, db_session: AsyncSession):
    """Three runs in, both prompts are due. Asking twice in one sitting is how an app gets muted —
    the notifications ask comes first and the rating ask waits for the next run."""
    user_id = await _user(db_session)
    await _play_royales(db_session, user_id, 3)

    first = await next_prompt(db_session, user_id)
    assert first == PROMPT_NOTIFICATIONS

    await ack_prompt(db_session, user_id, first, outcome=ACCEPTED)
    assert (await next_prompt(db_session, user_id)) == PROMPT_RATE


async def test_a_subscribed_device_is_never_asked_to_subscribe(client, db_session: AsyncSession):
    """Push is already on for this account, so the ask would be nonsense — skip straight past it."""
    user_id = await _user(db_session)
    await _play_royales(db_session, user_id, 3)
    db_session.add(
        PushSubscription(user_id=user_id, platform="ios", device_token="tok-" + uuid.uuid4().hex)
    )
    await db_session.flush()

    assert (await next_prompt(db_session, user_id)) == PROMPT_RATE


async def test_the_apology_outranks_everything(client, db_session: AsyncSession):
    """A player owed an explanation gets it before being asked for anything."""
    from app.services.goodwill import grant_goodwill

    user_id = await _user(db_session)
    await _play_royales(db_session, user_id, 3)
    await grant_goodwill(db_session, key="aug14")

    assert (await next_prompt(db_session, user_id)) == PROMPT_GOODWILL


async def test_the_apology_is_not_shown_to_someone_who_was_not_paid(
    client, db_session: AsyncSession
):
    user_id = await _user(db_session)
    await _play_royales(db_session, user_id, 1)
    assert (await next_prompt(db_session, user_id)) == PROMPT_NOTIFICATIONS


# ---------------- API ----------------


async def _register(client, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def test_endpoint_reports_nothing_for_a_new_player(client, db_session: AsyncSession):
    token = await _register(client, "p1@example.com", "promptuser1")
    r = await client.get("/me/prompt", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"prompt": None, "runs": 0}


async def test_ack_through_the_api_retires_the_prompt(client, db_session: AsyncSession):
    from app.models import User
    from sqlalchemy import select

    token = await _register(client, "p2@example.com", "promptuser2")
    headers = {"Authorization": f"Bearer {token}"}
    user_id = (
        await db_session.execute(select(User.id).where(User.email == "p2@example.com"))
    ).scalar_one()
    await _play_royales(db_session, user_id, 1)
    await db_session.commit()

    assert (await client.get("/me/prompt", headers=headers)).json()["prompt"] == (
        PROMPT_NOTIFICATIONS
    )

    r = await client.post(
        "/me/prompt/ack", headers=headers, json={"prompt": PROMPT_NOTIFICATIONS, "accepted": True}
    )
    assert r.status_code == 204
    # Asked and answered — the server must never raise it again.
    assert (await client.get("/me/prompt", headers=headers)).json()["prompt"] is None


# ---------------- provisional push ----------------


async def test_a_quiet_provisional_token_does_not_retire_the_ask(client, db_session: AsyncSession):
    """The whole point of provisional: reach WITHOUT consent. The player never saw a prompt, so
    they must still be asked to upgrade to prominent delivery. Counting it as consent would leave
    them permanently on quiet notifications nobody notices."""
    user_id = await _user(db_session)
    await _play_royales(db_session, user_id, 1)
    db_session.add(
        PushSubscription(
            user_id=user_id,
            platform="ios",
            device_token="quiet-" + uuid.uuid4().hex,
            provisional=True,
        )
    )
    await db_session.flush()

    assert (await next_prompt(db_session, user_id)) == PROMPT_NOTIFICATIONS


async def test_upgrading_the_same_token_clears_the_provisional_flag(
    client, db_session: AsyncSession
):
    """Accepting the real prompt re-registers the SAME device token. If the flag stuck, the player
    would be asked again forever."""
    from app.services.push import subscribe_native
    from sqlalchemy import select

    user_id = await _user(db_session)
    token = "tok-" + uuid.uuid4().hex
    await subscribe_native(db_session, user_id, token, "ios", provisional=True)
    await subscribe_native(db_session, user_id, token, "ios", provisional=False)

    rows = (
        (
            await db_session.execute(
                select(PushSubscription).where(PushSubscription.device_token == token)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1 and rows[0].provisional is False
    await _play_royales(db_session, user_id, 1)
    assert await next_prompt(db_session, user_id) is None  # now it IS consent


def test_the_rollout_cohort_is_stable_and_only_ever_grows():
    from app.services.prompts import in_provisional_cohort

    ids = [uuid.uuid4() for _ in range(400)]
    assert not any(in_provisional_cohort(i, 0) for i in ids)  # ships off
    assert all(in_provisional_cohort(i, 100) for i in ids)
    # Raising the percentage must only ADD players: a device that already registered a quiet token
    # must never be told it's out of the cohort, leaving a token nobody sends to.
    small = {i for i in ids if in_provisional_cohort(i, 10)}
    bigger = {i for i in ids if in_provisional_cohort(i, 50)}
    assert small <= bigger


# ── Pick a handle ──────────────────────────────────────────────────────────────────────────────
#
# Every account starts on a machine-made `rot_xxxxxx`: guests get one so they can play without a
# form, and third-party sign-in gets one because Apple and Google supply a name we have no right to
# put on a leaderboard. Neither is a choice, and the handle is the one thing about a player that
# everyone else sees.


async def _social_account(session: AsyncSession):
    """An account created by "Continue with Google" — saved, no password, generated handle."""
    from app.core.socialid import SocialIdentity
    from app.services.social_auth import sign_in_with_identity

    res = await sign_in_with_identity(
        session,
        SocialIdentity(
            provider="google",
            subject=f"sub-{uuid.uuid4().hex[:10]}",
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            email_verified=True,
        ),
    )
    return res.user


async def test_a_guest_is_never_asked_to_pick_a_handle(client, db_session: AsyncSession):
    """A guest is not on the permanent leaderboard, so their handle is not public yet. Asking would
    spend the one prompt slot on a decision that does not matter, ahead of one that does."""
    user_id = await _user(db_session)
    await _play_royales(db_session, user_id, 1)
    assert (await next_prompt(db_session, user_id)) == PROMPT_NOTIFICATIONS


async def test_a_social_account_is_asked_after_its_first_run(client, db_session: AsyncSession):
    user = await _social_account(db_session)
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.username.startswith("rot_")
    await _play_royales(db_session, user.id, 1)
    assert (await next_prompt(db_session, user.id)) == PROMPT_PICK_USERNAME


async def test_it_comes_before_the_notification_ask(client, db_session: AsyncSession):
    """Deliberate ordering: the handle is about THEM, notifications are a favour to us."""
    user = await _social_account(db_session)
    await _play_royales(db_session, user.id, 1)
    assert (await next_prompt(db_session, user.id)) == PROMPT_PICK_USERNAME
    await ack_prompt(db_session, user.id, PROMPT_PICK_USERNAME)
    assert (await next_prompt(db_session, user.id)) == PROMPT_NOTIFICATIONS


async def test_nothing_is_asked_before_a_run_even_with_a_generated_handle(
    client, db_session: AsyncSession
):
    user = await _social_account(db_session)
    assert await next_prompt(db_session, user.id) is None


async def test_a_player_who_chose_their_handle_is_never_asked(client, db_session: AsyncSession):
    """Changing the handle is the answer. Asking afterwards would be asking a settled question."""
    from app.services.username import change_username

    user = await _social_account(db_session)
    await change_username(db_session, user.id, "brainrot_king")
    await _play_royales(db_session, user.id, 1)
    assert (await next_prompt(db_session, user.id)) == PROMPT_NOTIFICATIONS


async def test_declining_retires_it(client, db_session: AsyncSession):
    """Dismissing is an answer. Re-asking every session is how a prompt becomes nagging."""
    user = await _social_account(db_session)
    await _play_royales(db_session, user.id, 1)
    await ack_prompt(db_session, user.id, PROMPT_PICK_USERNAME)
    assert (await next_prompt(db_session, user.id)) != PROMPT_PICK_USERNAME
