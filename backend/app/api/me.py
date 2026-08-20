"""Current-user profile endpoint (PLAN.md §8 GET /me)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete as sqla_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.achievements import BADGES_BY_ID, TITLES_BY_ID
from app.core.constants import (
    AVATAR_PRESETS,
    DUEL_BOT_GEM_CAP_PER_DAY,
    STREAK_MILESTONE_REWARDS,
)
from app.core.db import get_session
from app.core.errors import ApiErrorCode
from app.core.timezone import ET
from app.models import ContestWindow, Entry, Profile, Standing, User
from app.models.user import GUEST_STATUS
from app.schemas.contest import HistoryItem, HistoryResponse
from app.schemas.duel import DuelStatsResponse
from app.schemas.growth import GrowthOut, MasteryOut
from app.schemas.profile import (
    AvatarResponse,
    AvatarUpdate,
    BadgesResponse,
    BadgesUpdate,
    MeResponse,
    RotRatingResponse,
    TitleResponse,
    TitleUpdate,
    UsernameChangeOut,
    UsernameChangeRequest,
    UsernameQuoteOut,
    WalletDuel,
    WalletResponse,
)
from app.schemas.season import SeasonOut
from app.schemas.today import (
    CampaignNextOut,
    ChestRewardOut,
    MissionsBlock,
    NextUnlockOut,
    StreakBlock,
    TodayResponse,
    TodayStatus,
)
from app.services.achievements import earned_map
from app.services.campaign import get_ladder
from app.services.data_export import export_account
from app.services.duel import _bot_gem_duels_today, duel_stats
from app.services.growth import get_growth
from app.services.missions import get_missions_view
from app.services.prompts import in_provisional_cohort
from app.services.rot_rating_store import load_exposure as load_rot_exposure
from app.services.seasons import season_status
from app.services.settlement import grace_available as streak_grace_available
from app.services.today import (
    STREAK_MILESTONE_DAYS,
    campaign_next_from_ladder,
    next_streak_milestone,
    pick_next_unlock,
)
from app.services.username import (
    InsufficientCoinsError,
    InvalidUsernameError,
    SameUsernameError,
    UsernameTakenError,
    change_username,
    quote_username_change,
)
from app.services.vault import get_vault

router = APIRouter(tags=["profile"])


@router.get("/me", response_model=MeResponse)
async def me(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeResponse:
    profile = await session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")

    # Global rank = standard competition ranking by rating desc (#1 = highest). Computed as
    # count(strictly-higher ratings) + 1 — O(rows) on the indexed column, no full sort. Only real
    # users have profiles, so this is inherently real-players-only.
    higher = (
        await session.execute(
            select(func.count()).select_from(Profile).where(Profile.rating > profile.rating)
        )
    ).scalar_one()
    total = (await session.execute(select(func.count()).select_from(Profile))).scalar_one()

    return MeResponse(
        user_id=user.id,
        email=user.email,
        username=profile.username,
        is_guest=user.status == GUEST_STATUS,
        rating=profile.rating,
        rank=higher + 1,
        total_players=total,
        division=profile.division,
        streak_count=profile.streak_count,
        sharpness=profile.sharpness,
        coins_balance=profile.coins_balance,
        gems_balance=profile.gems_balance,
        equipped_theme=profile.equipped_theme,
        avatar_preset=profile.avatar_preset,
        equipped_frame=profile.equipped_frame,
        equipped_badges=profile.equipped_badges,
        equipped_title=profile.equipped_title,
        provisional_push=in_provisional_cohort(user.id),
    )


@router.get("/me/rot-rating", response_model=RotRatingResponse)
async def rot_rating(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RotRatingResponse:
    """The Rot Rating (§5e): headline sharpness number + its three sub-ratings, provisional flag,
    rounds played, and the direction of the last change. Never labeled IQ."""
    return RotRatingResponse.model_validate(await load_rot_exposure(session, user.id))


@router.get("/me/wallet", response_model=WalletResponse)
async def wallet(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WalletResponse:
    """Current balances for both currencies + the per-day bot Gem-duel cap usage."""
    profile = await session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    used = await _bot_gem_duels_today(session, user.id, datetime.now(UTC))
    return WalletResponse(
        coins_balance=profile.coins_balance,
        gems_balance=profile.gems_balance,
        duel=WalletDuel(bot_gem_duels_used=used, bot_gem_duels_cap=DUEL_BOT_GEM_CAP_PER_DAY),
    )


@router.get("/me/today", response_model=TodayResponse)
async def today(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TodayResponse:
    """The Today Command Center aggregate: status strip, daily missions + chest, streak ladder, the
    campaign next step, and the nearest cosmetic unlock — one read powering the home screen."""
    profile = await session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")

    # One notion of "now" for the whole aggregate, so missions and streak-grace can never be
    # computed for two different ET dates if the request straddles midnight ET.
    now = datetime.now(UTC)
    stats = await duel_stats(session, user.id)
    missions_view = await get_missions_view(session, user.id, now=now)
    ladder = await get_ladder(session, user.id)
    items, coins, gems = await get_vault(session, user.id)

    nm = next_streak_milestone(profile.streak_count)
    next_reward = None
    if nm is not None:
        rc, rg = STREAK_MILESTONE_REWARDS[nm]
        next_reward = ChestRewardOut(coins=rc, gems=rg, code=f"streak_{nm}")

    cn = campaign_next_from_ladder(ladder)
    nu = pick_next_unlock(items, coins, gems)

    return TodayResponse(
        status=TodayStatus(
            coins_balance=profile.coins_balance,
            gems_balance=profile.gems_balance,
            streak_count=profile.streak_count,
            duel_tier=stats.duel_tier,
        ),
        missions=MissionsBlock.from_view(missions_view),
        streak=StreakBlock(
            current=profile.streak_count,
            milestones=list(STREAK_MILESTONE_DAYS),
            next_milestone=nm,
            next_reward=next_reward,
            grace_available=streak_grace_available(
                profile.streak_grace_used_date, now.astimezone(ET).date()
            ),
        ),
        campaign_next=(
            CampaignNextOut(
                world=cn.world,
                category=cn.category,
                level_number=cn.level_number,
                title=cn.title,
                arc_name=cn.arc_name,
            )
            if cn is not None
            else None
        ),
        next_unlock=(
            NextUnlockOut(
                id=nu.id,
                kind=nu.kind,
                cost=nu.cost,
                currency=nu.currency,
                balance=nu.balance,
                remaining=nu.remaining,
                progress=nu.progress,
            )
            if nu is not None
            else None
        ),
    )


@router.get("/me/duel-stats", response_model=DuelStatsResponse)
async def me_duel_stats(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DuelStatsResponse:
    """The user's duel performance rollup (get-or-create — a fresh user gets zeros)."""
    stats = await duel_stats(session, user.id)
    return DuelStatsResponse(
        wins=stats.wins,
        losses=stats.losses,
        training_wins=stats.training_wins,
        training_losses=stats.training_losses,
        current_streak=stats.current_streak,
        best_streak=stats.best_streak,
        perfect_wins=stats.perfect_wins,
        comeback_wins=stats.comeback_wins,
        total_gems_won=stats.total_gems_won,
        total_gems_lost=stats.total_gems_lost,
        duel_xp=stats.duel_xp,
        duel_tier=stats.duel_tier,
    )


@router.get("/me/growth", response_model=GrowthOut)
async def growth(
    days: int = 30,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GrowthOut:
    today = datetime.now(ET).date()
    data = await get_growth(session, user.id, days=days, today=today)
    return GrowthOut(**data)


@router.get("/me/mastery", response_model=MasteryOut)
async def me_mastery(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MasteryOut:
    from content.categories import CANONICAL_CATEGORIES

    from app.models import UserSkillState
    from app.services.mastery import mastery_from_state

    state = await session.get(UserSkillState, user.id)
    return MasteryOut(categories=mastery_from_state(state, tuple(CANONICAL_CATEGORIES)))


@router.get("/me/season", response_model=SeasonOut)
async def my_season(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SeasonOut:
    st = await season_status(session, user.id)
    return SeasonOut(
        season=st.season,
        label=st.label,
        ends_at=st.ends_at,
        rating=st.rating,
        division=st.division,
        duel_tier=st.duel_tier,
    )


@router.patch("/me/avatar", response_model=AvatarResponse)
async def update_avatar(
    body: AvatarUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AvatarResponse:
    """Set the player's avatar preset. Unknown preset_id → 422 with machine-readable detail.

    NOTE: detail strings here are machine-readable codes ("unknown_preset") the frontend switches
    on — a deliberate contract, not prose; don't "fix" them to sentences.
    """
    if body.preset_id not in AVATAR_PRESETS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown_preset")

    profile = await session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")

    profile.avatar_preset = body.preset_id
    return AvatarResponse(avatar_preset=profile.avatar_preset)


@router.patch("/me/badges", response_model=BadgesResponse)
async def update_badges(
    body: BadgesUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BadgesResponse:
    """Set the player's equipped badges (the FULL pick, ≤3 ids, order = display order; [] clears).

    Badges are earned, never bought — every id must be earned (services/achievements.py).
    Equipping never touches anything competitive. Detail strings are machine-readable codes
    ("unknown_badge", "too_many_badges", "duplicate_badge", "not_earned") the frontend switches
    on — a deliberate contract, not prose; don't "fix" them to sentences.
    """
    if any(badge_id not in BADGES_BY_ID for badge_id in body.badge_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown_badge")
    if len(body.badge_ids) > 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "too_many_badges")
    if len(set(body.badge_ids)) != len(body.badge_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "duplicate_badge")
    earned = await earned_map(session, user.id)
    if any(not earned[badge_id] for badge_id in body.badge_ids):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_earned")

    profile = await session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")

    profile.equipped_badges = list(body.badge_ids)  # reassign, never mutate (JSONB change tracking)
    return BadgesResponse(equipped_badges=profile.equipped_badges)


@router.patch("/me/title", response_model=TitleResponse)
async def update_title(
    body: TitleUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TitleResponse:
    """Set the player's equipped title; null clears it. Titles are earned, never bought.

    Detail strings are machine-readable codes ("unknown_title", "not_earned") the frontend
    switches on — a deliberate contract, not prose; don't "fix" them to sentences.
    """
    if body.title_id is not None:
        if body.title_id not in TITLES_BY_ID:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown_title")
        earned = await earned_map(session, user.id)
        if not earned[body.title_id]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not_earned")

    profile = await session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")

    profile.equipped_title = body.title_id
    return TitleResponse(equipped_title=profile.equipped_title)


@router.delete("/me")
async def delete_me(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    """Permanently delete the current user and all associated data.

    Every table that references users.id has ondelete=CASCADE at the DB level, so a single
    DELETE FROM users cascades to profiles, entries, ledger rows, standings, cosmetics,
    social rows, campaign progress, push subscriptions — everything. No second query needed.
    """
    await session.execute(sqla_delete(User).where(User.id == user.id))
    return {"ok": True}


@router.get("/me/export")
async def export_my_data(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    """Everything we hold about the caller, as JSON (GDPR Art. 15/20, CCPA right to know).

    Self-serve so a portability request is one tap rather than a hand-written query. Scoped to the
    authenticated user, and never includes another person's account data or any stored answer key.
    """
    return await export_account(session, user.id)


@router.get("/me/username/quote", response_model=UsernameQuoteOut)
async def username_quote(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UsernameQuoteOut:
    """What changing the handle costs right now, so the UI can price it before asking to confirm."""
    q = await quote_username_change(session, user.id)
    return UsernameQuoteOut(
        cost=q.cost,
        free_changes_remaining=q.free_changes_remaining,
        changes_made=q.changes_made,
        balance=q.balance,
        affordable=q.affordable,
    )


@router.post("/me/username", response_model=UsernameChangeOut)
async def set_username(
    body: UsernameChangeRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UsernameChangeOut:
    """Change the public handle. First change free, then USERNAME_CHANGE_COST coins.

    The debit and the rename share one transaction, so a handle claimed concurrently rolls the
    charge back with it — a player is never charged for a name they did not get.
    """
    try:
        res = await change_username(session, user.id, body.username)
    except InvalidUsernameError as exc:
        raise ApiErrorCode("username_invalid") from exc
    except SameUsernameError as exc:
        raise ApiErrorCode("username_unchanged") from exc
    except UsernameTakenError as exc:
        raise ApiErrorCode("username_taken") from exc
    except InsufficientCoinsError as exc:
        raise ApiErrorCode("insufficient_coins") from exc
    return UsernameChangeOut(
        username=res.username, cost=res.cost, balance=res.balance, changes_made=res.changes_made
    )


@router.get("/me/history", response_model=HistoryResponse)
async def history(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> HistoryResponse:
    """Recent entries with their settled placement (for the results-on-next-open surface)."""
    rows = (
        await session.execute(
            select(Entry, ContestWindow, Standing)
            .join(ContestWindow, ContestWindow.id == Entry.window_id)
            .outerjoin(
                Standing,
                (Standing.window_id == Entry.window_id) & (Standing.user_id == Entry.user_id),
            )
            .where(Entry.user_id == user.id)
            .order_by(ContestWindow.close_at.desc())
            .limit(20)
        )
    ).all()
    return HistoryResponse(
        items=[
            HistoryItem(
                window_id=w.id,
                contest_date=w.contest_date,
                slot=w.slot,
                state=w.state,
                total_score=e.total_score,
                place=s.place if s else None,
                field_size=s.field_size if s else None,
                coins_awarded=s.coins_awarded if s else None,
                gems_awarded=s.gems_awarded if s else None,
                rating_before=s.rating_before if s else None,
                rating_after=s.rating_after if s else None,
            )
            for e, w, s in rows
        ]
    )


class PromptResponse(BaseModel):
    """The one prompt to show now, or none. `runs` is context the client renders in the copy."""

    prompt: str | None = None
    runs: int = 0


class PromptAckRequest(BaseModel):
    prompt: str
    accepted: bool = False


@router.get("/me/prompt", response_model=PromptResponse)
async def me_prompt(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PromptResponse:
    """What to ask this player next — decided here so the rules change without an app release."""
    from app.services.prompts import next_prompt, royales_completed

    return PromptResponse(
        prompt=await next_prompt(session, user.id),
        runs=await royales_completed(session, user.id),
    )


@router.post("/me/prompt/ack", status_code=status.HTTP_204_NO_CONTENT)
async def me_prompt_ack(
    body: PromptAckRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Record the answer so it is never asked again. Idempotent — a retry is harmless."""
    from app.models.prompt import ACCEPTED, DISMISSED
    from app.services.prompts import ack_prompt

    await ack_prompt(
        session, user.id, body.prompt, outcome=ACCEPTED if body.accepted else DISMISSED
    )
    await session.commit()


class TimezoneRequest(BaseModel):
    timezone: str


@router.post("/me/timezone", status_code=status.HTTP_204_NO_CONTENT)
async def me_timezone(
    body: TimezoneRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Record the device's IANA zone so evening pushes land in the player's own evening.

    Validated rather than trusted: a junk string would store fine and then silently degrade every
    future send to the ET fallback, which is the kind of failure nobody notices for months.
    """
    from app.services.localtime import is_valid_zone

    if not is_valid_zone(body.timezone):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown timezone")
    profile = await session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    if profile.timezone != body.timezone:
        profile.timezone = body.timezone
        await session.commit()
