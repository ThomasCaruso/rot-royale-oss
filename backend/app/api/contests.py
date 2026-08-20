"""Contest endpoints: current window + enter (PLAN.md §8)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_locale
from app.core.constants import SETTLE_DELAY_MINUTES
from app.core.db import get_session
from app.core.errors import ApiErrorCode
from app.core.timezone import ET
from app.models import ContestWindow, Entry, Profile, Standing, User
from app.models.contest import OPEN
from app.schemas.contest import (
    CurrentContestResponse,
    EnterResponse,
    FieldEntryOut,
    FieldResponse,
    FriendBoardPendingOut,
    FriendBoardRowOut,
    FriendsBoardOut,
    MyEntryResponse,
    RoundSpecOut,
    StandingOut,
    StandingsResponse,
    WindowOut,
)
from app.services.contest import (
    AlreadyEnteredError,
    WindowNotFoundError,
    WindowNotOpenError,
    enter_contest,
    friends_board,
    my_window_entry,
    window_field,
)
from app.services.field_fillers import pad_live_field
from app.services.scheduler import create_windows_for_date, transition_windows

# Upper bound on a standings response. Deliberately far above any realistic Daily Royale field, so
# today's behaviour is byte-identical and this is purely a ceiling rather than a product change.
# Unlike /field this is NOT a "top slice" product decision — standings still means "the
# leaderboard", it simply cannot be unbounded.
STANDINGS_MAX = 500

router = APIRouter(prefix="/contests", tags=["contests"])


@router.get("/current", response_model=CurrentContestResponse)
async def current(session: AsyncSession = Depends(get_session)) -> CurrentContestResponse:
    now = datetime.now(UTC)
    today_et = now.astimezone(ET).date()
    await create_windows_for_date(session, today_et)  # idempotent; lazy daily scheduling
    await transition_windows(session, now)

    schedule = (
        (
            await session.execute(
                select(ContestWindow)
                .where(ContestWindow.contest_date == today_et)
                .order_by(ContestWindow.open_at)
            )
        )
        .scalars()
        .all()
    )

    # Real field counts (entries per window) — the live strip must never invent a number (§7).
    count_rows = (
        await session.execute(
            select(Entry.window_id, func.count())
            .where(Entry.window_id.in_([w.id for w in schedule]))
            .group_by(Entry.window_id)
        )
    ).all()
    counts: dict[uuid.UUID, int] = {row[0]: row[1] for row in count_rows}

    def to_out(w: ContestWindow) -> WindowOut:
        return WindowOut(
            id=w.id,
            slot=w.slot,
            state=w.state,
            open_at=w.open_at,
            close_at=w.close_at,
            settle_at=w.close_at + timedelta(minutes=SETTLE_DELAY_MINUTES),
            entry_count=counts.get(w.id, 0),
        )

    open_window = next((w for w in schedule if w.state == OPEN), None)
    return CurrentContestResponse(
        open_window=to_out(open_window) if open_window else None,
        schedule=[to_out(w) for w in schedule],
    )


@router.get("/{window_id}/field", response_model=FieldResponse)
async def field(
    window_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FieldResponse:
    # Live field snapshot (Phase A): the top slice by score for SUBMITTED real entries, plus the
    # true field size and the caller's own standing (bounded for scale — see window_field). The
    # client sums each entry's points[] for through-N interstitials + the post-play top-5.
    result = await window_field(session, window_id, viewer_user_id=user.id)
    # A thin OPEN royale is topped up with fillers so the board doesn't render as an empty podium.
    # This is the ONLY endpoint that does it — settlement and share links read real entries, so
    # nothing paid out or published is ever inflated (services/field_fillers.py).
    window = await session.get(ContestWindow, window_id)
    if window is not None:
        result = pad_live_field(result, window)
    return FieldResponse(
        window_id=window_id,
        entries=[
            FieldEntryOut(
                username=e.username,
                points=e.points,
                avatar_preset=e.avatar_preset,
                equipped_frame=e.equipped_frame,
                equipped_badges=e.equipped_badges,
                equipped_title=e.equipped_title,
            )
            for e in result.entries
        ],
        field_size=result.field_size,
        my_rank=result.viewer_rank,
        my_score=result.viewer_score,
    )


@router.get("/{window_id}/entry", response_model=MyEntryResponse)
async def my_entry(
    window_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MyEntryResponse:
    # Does the caller have a contest entry for this window? Drives the lobby's post-play state.
    entry = await my_window_entry(session, window_id, user.id)
    if entry is None:
        return MyEntryResponse()
    return MyEntryResponse(entry_id=entry.id, status=entry.status, submitted_at=entry.submitted_at)


@router.get("/{window_id}/standings", response_model=StandingsResponse)
async def standings(
    window_id: uuid.UUID,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> StandingsResponse:
    window = await session.get(ContestWindow, window_id)
    if window is None:
        raise ApiErrorCode("window_not_found")
    rows = (
        await session.execute(
            select(
                Standing,
                Profile.username,
                Profile.avatar_preset,
                Profile.equipped_frame,
                Profile.equipped_badges,
                Profile.equipped_title,
            )
            .join(Profile, Profile.user_id == Standing.user_id)
            .where(Standing.window_id == window_id)
            .order_by(Standing.place)
            # Server-controlled cap: the caller cannot ask for more. This used to return EVERY row,
            # so one authenticated request grew with the whole field — the same memory/egress
            # amplifier `/field` above was already bounded against. Ordering by place first means
            # the cap takes the TOP slice, which is the part of a leaderboard anyone reads, and
            # `field_size` on each row still reports the true total.
            .limit(STANDINGS_MAX)
        )
    ).all()
    return StandingsResponse(
        window_id=window_id,
        state=window.state,
        standings=[
            StandingOut(
                place=s.place,
                field_size=s.field_size,
                username=username,
                total_score=s.total_score,
                coins_awarded=s.coins_awarded,
                gems_awarded=s.gems_awarded,
                # rating_before/rating_after are deliberately NOT passed — Elo is private and this
                # is a cross-user response. The columns still exist and settlement still writes
                # them; they are simply never published to anyone but their owner.
                avatar_preset=avatar_preset,
                equipped_frame=equipped_frame,
                equipped_badges=list(equipped_badges) if equipped_badges else [],
                equipped_title=equipped_title,
            )
            for s, username, avatar_preset, equipped_frame, equipped_badges, equipped_title in rows
        ],
    )


@router.get("/{window_id}/friends", response_model=FriendsBoardOut)
async def friends_board_route(
    window_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendsBoardOut:
    board = await friends_board(session, window_id, user.id)
    return FriendsBoardOut(
        my_rank=board.my_rank,
        friend_field_size=board.friend_field_size,
        played=[FriendBoardRowOut(**vars(r)) for r in board.played],
        yet_to_play=[FriendBoardPendingOut(**vars(p)) for p in board.yet_to_play],
    )


@router.post("/{window_id}/enter", response_model=EnterResponse)
async def enter(
    window_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    locale: str = Depends(get_locale),
) -> EnterResponse:
    try:
        entry = await enter_contest(session, window_id, user.id, locale=locale)
    except WindowNotFoundError as exc:
        raise ApiErrorCode("window_not_found") from exc
    except WindowNotOpenError as exc:
        raise ApiErrorCode("window_not_open") from exc
    except AlreadyEnteredError as exc:
        raise ApiErrorCode("already_entered") from exc

    return EnterResponse(
        entry_id=entry.id,
        window_id=entry.window_id,
        rounds=[RoundSpecOut(**r) for r in entry.round_set],
    )
