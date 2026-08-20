"""Data portability export — everything we hold about one account, as JSON.

The privacy policy promises access and portability (GDPR Art. 15 and Art. 20; CCPA "right to know").
Promising that with no endpoint behind it means every request becomes a hand-written database
query, which does not scale past a handful of users and is exactly the kind of manual step that
gets skipped under time pressure.

Design rules:

- **Mirror the deletion cascade.** Every table `DELETE FROM users` reaches should appear here.
  Anything we delete on request is by definition something we hold about the person, so the two
  lists should not drift. Where they do drift, this file is the one that is wrong.
- **Never export another person's data.** A friendship or duel involves two people; we export the
  fact and the counterpart's public username, never the counterpart's account data.
- **Never export answer keys.** Round answers are the player's own submissions; the correct answers
  are the anti-cheat boundary (PLAN §5) and are not part of a subject access request.
- **Self-serve.** The player triggers it themselves and gets the file immediately.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Challenge,
    CoinLedger,
    ContestWindow,
    Entry,
    Friendship,
    GemLedger,
    Profile,
    PushSubscription,
    RoundResult,
    Standing,
    User,
    UserCosmetic,
    UserTheme,
)

EXPORT_VERSION = "1"


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    return value


async def export_account(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    """Everything we hold about `user_id`, shaped for a human to read and a machine to re-import."""
    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("no such user")
    profile = await session.get(Profile, user_id)

    entries = list(
        (
            await session.execute(
                select(Entry, ContestWindow)
                .outerjoin(ContestWindow, ContestWindow.id == Entry.window_id)
                .where(Entry.user_id == user_id)
                .order_by(Entry.started_at)
            )
        ).all()
    )
    entry_ids = [e.id for e, _ in entries]

    # Per-round points for the player's own runs. Deliberately NOT round_answers: the stored answer
    # key is the anti-cheat boundary and is not personal data about the player.
    results: dict[uuid.UUID, list[dict[str, Any]]] = {}
    if entry_ids:
        for r in (
            await session.execute(
                select(RoundResult)
                .where(RoundResult.entry_id.in_(entry_ids))
                .order_by(RoundResult.idx)
            )
        ).scalars():
            results.setdefault(r.entry_id, []).append(
                {"round": r.idx, "points": r.points, "correct": r.correct}
            )

    async def rows(model: Any, *where: Any) -> list[Any]:
        return list((await session.execute(select(model).where(*where))).scalars())

    standings = await rows(Standing, Standing.user_id == user_id)
    coins = await rows(CoinLedger, CoinLedger.user_id == user_id)
    gems = await rows(GemLedger, GemLedger.user_id == user_id)
    themes = await rows(UserTheme, UserTheme.user_id == user_id)
    cosmetics = await rows(UserCosmetic, UserCosmetic.user_id == user_id)
    pushes = await rows(PushSubscription, PushSubscription.user_id == user_id)
    shares = await rows(Challenge, Challenge.creator_user_id == user_id)
    friendships = await rows(
        Friendship,
        (Friendship.requester_id == user_id) | (Friendship.addressee_id == user_id),
    )

    return {
        "export_version": EXPORT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "about": (
            "Everything Rot Royale holds about your account. Other people's account data is not "
            "included; where a record involves someone else (a friendship, a duel) only their "
            "public username appears."
        ),
        "account": {
            "user_id": str(user.id),
            "email": user.email,
            "created_at": _iso(user.created_at),
            "is_guest": getattr(user, "status", None),
        },
        "profile": None
        if profile is None
        else {
            "username": profile.username,
            "avatar_preset": profile.avatar_preset,
            "equipped_theme": profile.equipped_theme,
            "equipped_frame": profile.equipped_frame,
            "equipped_badges": list(profile.equipped_badges or []),
            "equipped_title": profile.equipped_title,
            "rating": profile.rating,
            "division": profile.division,
            "coins_balance": profile.coins_balance,
            "gems_balance": getattr(profile, "gems_balance", None),
            "streak": getattr(profile, "streak", None),
        },
        "games_played": [
            {
                "entry_id": str(e.id),
                "contest_date": _iso(w.contest_date) if w else None,
                "slot": w.slot if w else None,
                "practice": e.is_practice,
                "score": e.total_score,
                "started_at": _iso(e.started_at),
                "submitted_at": _iso(e.submitted_at),
                "rounds": results.get(e.id, []),
            }
            for e, w in entries
        ],
        "standings": [
            {"window_id": str(s.window_id), "place": s.place, "field_size": s.field_size}
            for s in standings
        ],
        "coin_history": [
            {"amount": c.amount, "reason": c.reason, "at": _iso(c.created_at)} for c in coins
        ],
        "gem_history": [
            {"amount": g.amount, "reason": g.reason, "at": _iso(g.created_at)} for g in gems
        ],
        "unlocked_themes": [t.theme_id for t in themes],
        "unlocked_cosmetics": [getattr(c, "cosmetic_id", None) for c in cosmetics],
        "notification_devices": [
            # The token itself is a device credential; exporting it would be a security risk with no
            # benefit to the player, so we report only that a device is registered.
            {"platform": getattr(p, "platform", None), "registered_at": _iso(p.created_at)}
            for p in pushes
        ],
        "share_links": [
            {
                "id": s.id,
                "contest_no": s.contest_no,
                "score": s.score,
                "created_at": _iso(s.created_at),
            }
            for s in shares
        ],
        "friendships": [
            {
                "status": f.status,
                "direction": "sent" if f.requester_id == user_id else "received",
                "at": _iso(f.created_at),
            }
            for f in friendships
        ],
    }
