"""Push service — web-push (M9) + native iOS APNs + native Android FCM, plus the re-engagement
notifiers.

Three transports share one dispatcher: web rows deliver via pywebpush (VAPID); native iOS rows via
APNs (token-based JWT auth over HTTP/2); native Android rows via FCM HTTP v1 (a self-signed
service-account JWT exchanged for an OAuth2 token). `build_sender` composes whichever transports are
configured and routes each subscription by `platform`; an unconfigured transport is skipped cleanly
(the subscription is NOT pruned — it's a config gap, not a dead device).

Notifiers run on the existing transition heartbeat (never a new daemon) and are exactly-once:
  - `notify_open_windows` — once per newly-OPEN window (window_notifications gate).
  - `notify_daily_reminder` — the evening "play before midnight / your streak ends tonight" nudge,
    once per user per ET day (user_notifications gate), to subscribers who haven't played today.
  - `notify_streak_saved` — a reassuring ping when the free weekly grace saved a streak.
A push is an unrollbackable side effect, so every notifier CLAIMS its gate row and COMMITS before
sending — biasing to at-most-once (a missed nudge beats a duplicate).
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import httpx
import jwt
from py_vapid import Vapid01
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings
from app.core.timezone import ET
from app.models import (
    ContestWindow,
    Entry,
    Profile,
    PushSubscription,
    UserNotification,
    WindowNotification,
)
from app.models.contest import OPEN, SUBMITTED
from app.services.localtime import local_hour
from app.services.notify_governor import can_send

# A subscription snapshot (heterogeneous: uuid id + str transport fields) passed to a Sender.
Sub = dict[str, object]
# A sender takes a subscription snapshot + a payload and delivers it. Raises PushExpired when the
# device is gone (prune it). Injectable so tests mock transport.
Sender = Callable[[Sub, dict[str, str]], Awaitable[None]]


class PushExpired(Exception):
    """The device/endpoint is gone (web 404/410, APNs Unregistered/BadDeviceToken) — prune it."""


# ---------------- subscribe / unsubscribe ----------------
async def subscribe_web(
    session: AsyncSession, user_id: uuid.UUID, endpoint: str, p256dh: str, auth: str
) -> None:
    """Register (or no-op re-register) a web-push endpoint. Idempotent on the endpoint."""
    stmt = (
        pg_insert(PushSubscription)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            platform="web",
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
        )
        .on_conflict_do_nothing(index_elements=["endpoint"])
    )
    await session.execute(stmt)
    await session.flush()


async def subscribe_native(
    session: AsyncSession,
    user_id: uuid.UUID,
    device_token: str,
    platform: str,
    provisional: bool = False,
) -> None:
    """Register a native APNs/FCM device token. Idempotent on the token (rebinds it to the user).

    An upgrade from quiet to prominent re-registers the SAME token with provisional=False, which is
    why the conflict path writes the flag too — otherwise a player who accepted the real prompt
    would stay marked provisional forever and keep being asked.
    """
    stmt = (
        pg_insert(PushSubscription)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            platform=platform,
            device_token=device_token,
            provisional=provisional,
        )
        .on_conflict_do_update(
            index_elements=["device_token"],
            set_={"user_id": user_id, "platform": platform, "provisional": provisional},
            index_where=PushSubscription.device_token.isnot(None),
        )
    )
    await session.execute(stmt)
    await session.flush()


async def unsubscribe(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    endpoint: str | None = None,
    device_token: str | None = None,
) -> None:
    q = delete(PushSubscription).where(PushSubscription.user_id == user_id)
    if endpoint is not None:
        q = q.where(PushSubscription.endpoint == endpoint)
    elif device_token is not None:
        q = q.where(PushSubscription.device_token == device_token)
    else:
        return
    await session.execute(q)
    await session.flush()


# ---------------- snapshots ----------------
def _snapshot(s: PushSubscription) -> Sub:
    return {
        "id": s.id,
        "platform": s.platform,
        "endpoint": s.endpoint,
        "p256dh": s.p256dh,
        "auth": s.auth,
        "device_token": s.device_token,
    }


async def _all_subs(session: AsyncSession) -> list[Sub]:
    return [_snapshot(s) for s in (await session.execute(select(PushSubscription))).scalars().all()]


async def _subs_for_users(
    session: AsyncSession, user_ids: set[uuid.UUID]
) -> dict[uuid.UUID, list[Sub]]:
    if not user_ids:
        return {}
    rows = (
        (
            await session.execute(
                select(PushSubscription).where(PushSubscription.user_id.in_(user_ids))
            )
        )
        .scalars()
        .all()
    )
    out: dict[uuid.UUID, list[Sub]] = {}
    for s in rows:
        out.setdefault(s.user_id, []).append(_snapshot(s))
    return out


# ---------------- payloads ----------------
def _fmt_et_time(dt: datetime) -> str:
    et = dt.astimezone(ET)
    hour12 = et.hour % 12 or 12
    ampm = "AM" if et.hour < 12 else "PM"
    return f"{hour12}:{et.minute:02d} {ampm} ET"


def _open_payload(window: ContestWindow) -> dict[str, str]:
    slot = window.slot.capitalize()
    return {
        "title": "Rot Royale",
        "body": f"{slot} game is open — play before {_fmt_et_time(window.close_at)}",
        "url": "/",
    }


def _reminder_payload(streak: int) -> dict[str, str]:
    # The daily Rot Check drop (Wordle-style). No streak = anticipatory; streak = late-day urgency.
    if streak >= 1:
        return {
            "title": "Your streak's on the line 🔥",
            "body": f"Today's Rot Check closes at midnight — keep your {streak}-day streak alive.",
            "url": "/",
        }
    return {
        "title": "Today's Rot Check is live 🧠",
        "body": "A fresh one just dropped — how bad is your brainrot today?",
        "url": "/",
    }


def _streak_saved_payload(streak: int) -> dict[str, str]:
    return {
        "title": "Streak saved 🛡️",
        "body": f"Your {streak}-day streak survived — that was your free save this week.",
        "url": "/",
    }


# ---------------- notifiers ----------------
async def _fan_out(
    session: AsyncSession, send: Sender, targets: list[tuple[Sub, dict[str, str]]]
) -> int:
    """Deliver (sub, payload) pairs off-transaction; prune devices reported gone. Returns count."""
    dead: list[object] = []
    attempted = 0
    for sub, payload in targets:
        attempted += 1
        try:
            await send(sub, payload)
        except PushExpired:
            dead.append(sub["id"])
        except Exception:
            pass  # transient — keep the device, a later nudge retries
    if dead:
        await session.execute(delete(PushSubscription).where(PushSubscription.id.in_(set(dead))))
        await session.commit()
    return attempted


async def notify_open_windows(session: AsyncSession, send: Sender) -> int:
    """Notify all subscribers once per newly-open window (window_notifications gate)."""
    open_windows = (
        (await session.execute(select(ContestWindow).where(ContestWindow.state == OPEN)))
        .scalars()
        .all()
    )
    payloads: list[dict[str, str]] = []
    for window in open_windows:
        claim = (
            pg_insert(WindowNotification)
            .values(window_id=window.id)
            .on_conflict_do_nothing(index_elements=["window_id"])
            .returning(WindowNotification.window_id)
        )
        if (await session.scalars(claim)).one_or_none() is not None:
            payloads.append(_open_payload(window))

    if not payloads:
        await session.commit()
        return 0

    subs = await _all_subs(session)
    await session.commit()  # gate durable; no locks held across network I/O
    targets = [(sub, payload) for payload in payloads for sub in subs]
    return await _fan_out(session, send, targets)


async def notify_daily_reminder(
    session: AsyncSession, send: Sender, now: datetime | None = None
) -> int:
    """Evening nudge to subscribers who haven't played today's Daily Royale — streak-aware copy.

    Fires from `push_reminder_hour_local` onward IN EACH PLAYER'S OWN ZONE, once per user per ET
    day (user_notifications kind='daily_reminder'). The hour gate moved from ET to per-user local
    time because a single ET hour is the wrong evening for most of the map — 8 PM ET is 5 PM in
    California and 1 AM in London. The ET DAY is still the gate key: that is the day the contest is
    scored on.
    """
    now = now or datetime.now(UTC)
    today = now.astimezone(ET).date()

    window = (
        await session.execute(
            select(ContestWindow).where(
                ContestWindow.contest_date == today, ContestWindow.slot == "royale"
            )
        )
    ).scalar_one_or_none()
    if window is None or window.state != OPEN:
        return 0  # nothing open to nudge toward

    played = set(
        (
            await session.execute(
                select(Entry.user_id).where(Entry.window_id == window.id, Entry.status == SUBMITTED)
            )
        )
        .scalars()
        .all()
    )
    # Subscribers who haven't played today and haven't already been nudged today.
    already = set(
        (
            await session.execute(
                select(UserNotification.user_id).where(
                    UserNotification.notify_date == today,
                    UserNotification.kind == "daily_reminder",
                )
            )
        )
        .scalars()
        .all()
    )
    sub_user_ids = set(
        (await session.execute(select(PushSubscription.user_id).distinct())).scalars().all()
    )
    candidates = sub_user_ids - played - already
    if not candidates:
        await session.commit()
        return 0

    # Claim the once-per-day gate for each candidate BEFORE sending.
    streak_rows = (
        await session.execute(
            select(Profile.user_id, Profile.streak_count, Profile.timezone).where(
                Profile.user_id.in_(candidates)
            )
        )
    ).all()
    streaks: dict[uuid.UUID, int] = {uid: sc for uid, sc, _ in streak_rows}
    zones: dict[uuid.UUID, str | None] = {uid: tz for uid, _, tz in streak_rows}
    claimed: set[uuid.UUID] = set()
    for uid in candidates:
        # Each player's own evening, not one global hour.
        if local_hour(zones.get(uid), now) < settings.push_reminder_hour_local:
            continue
        if not await can_send(session, uid, "daily_reminder", now, zones.get(uid)):
            continue  # frequency governor: quiet hours / daily cap / spacing
        claim = (
            pg_insert(UserNotification)
            .values(user_id=uid, notify_date=today, kind="daily_reminder", created_at=now)
            .on_conflict_do_nothing(index_elements=["user_id", "notify_date", "kind"])
            .returning(UserNotification.user_id)
        )
        if (await session.scalars(claim)).one_or_none() is not None:
            claimed.add(uid)

    subs_by_user = await _subs_for_users(session, claimed)
    await session.commit()

    targets: list[tuple[Sub, dict[str, str]]] = []
    for uid in claimed:
        payload = _reminder_payload(streaks.get(uid, 0))
        for sub in subs_by_user.get(uid, []):
            targets.append((sub, payload))
    return await _fan_out(session, send, targets)


async def notify_streak_saved(
    session: AsyncSession, send: Sender, now: datetime | None = None
) -> int:
    """Reassure players whose free weekly grace just saved their streak (grace consumed at settle).

    Once per grace event (user_notifications kind='streak_saved', keyed on the grace date)."""
    now = now or datetime.now(UTC)
    today = now.astimezone(ET).date()

    rows = (
        await session.execute(
            select(Profile.user_id, Profile.streak_count, Profile.streak_grace_used_date).where(
                Profile.streak_grace_used_date.isnot(None)
            )
        )
    ).all()
    sub_user_ids = set(
        (await session.execute(select(PushSubscription.user_id).distinct())).scalars().all()
    )
    claimed: list[tuple[uuid.UUID, int]] = []
    for uid, streak, grace_date in rows:
        if uid not in sub_user_ids or grace_date is None or grace_date > today:
            continue
        if not await can_send(session, uid, "streak_saved", now):
            continue  # frequency governor: quiet hours (retimes 12:15 AM → morning) / daily cap
        claim = (
            pg_insert(UserNotification)
            .values(user_id=uid, notify_date=grace_date, kind="streak_saved")
            .on_conflict_do_nothing(index_elements=["user_id", "notify_date", "kind"])
            .returning(UserNotification.user_id)
        )
        if (await session.scalars(claim)).one_or_none() is not None:
            claimed.append((uid, streak))

    if not claimed:
        await session.commit()
        return 0

    subs_by_user = await _subs_for_users(session, {uid for uid, _ in claimed})
    await session.commit()

    targets: list[tuple[Sub, dict[str, str]]] = []
    for uid, streak in claimed:
        payload = _streak_saved_payload(streak)
        for sub in subs_by_user.get(uid, []):
            targets.append((sub, payload))
    return await _fan_out(session, send, targets)


def _challenge_payload(challenger_username: str) -> dict[str, str]:
    return {
        "title": "Rot Royale",
        "body": f"{challenger_username} challenged you! Beat their score?",
        "url": "/",  # opens today's Daily Royale, same as the other nudges
    }


async def notify_friend_challenge(
    session: AsyncSession,
    send: Sender,
    *,
    recipient_id: uuid.UUID,
    challenger_username: str,
) -> int:
    """Deliver one directed 'X challenged you! Beat their score?' push to a friend's devices. The
    exactly-once gate (user_notifications kind='challenged') is the CALLER's responsibility — this
    just fans the copy out to whatever subscriptions the recipient has (zero → a clean no-op)."""
    subs_by_user = await _subs_for_users(session, {recipient_id})
    payload = _challenge_payload(challenger_username)
    targets = [(sub, payload) for sub in subs_by_user.get(recipient_id, [])]
    return await _fan_out(session, send, targets)


# ---------------- transports ----------------
def _build_web_sender(settings: Settings) -> Sender:
    vapid = Vapid01.from_string(settings.vapid_private_key)
    subject = settings.vapid_subject

    async def send(sub: Sub, payload: dict[str, str]) -> None:
        # Re-checked at SEND time, not only at subscribe time. Rows written before the endpoint
        # validator existed are still in the table, and this is the last point before the server
        # makes an outbound request to a client-supplied URL. A bad row is retired rather than
        # delivered, so it stops being retried forever.
        from app.core.pushurl import InvalidPushEndpoint, validate_push_endpoint

        try:
            validate_push_endpoint(str(sub["endpoint"]))
        except InvalidPushEndpoint as exc:
            raise PushExpired() from exc

        def _deliver() -> None:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub["endpoint"],
                        "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                    },
                    data=json.dumps(payload),
                    vapid_private_key=vapid,
                    vapid_claims={"sub": subject},
                    ttl=600,
                )
            except WebPushException as exc:
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in (404, 410):
                    raise PushExpired() from exc
                raise

        await asyncio.to_thread(_deliver)

    return send


# APNs failure reasons that mean the token is permanently gone → prune the subscription.
_APNS_DEAD_REASONS = {"Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"}


# FCM v1 statuses that mean the device is gone for good: the app was uninstalled or the token was
# rotated. ONLY these prune.
#
# INVALID_ARGUMENT is deliberately NOT here, though it looks like it belongs. FCM returns it for a
# malformed REQUEST as well as a malformed token — so a bug in the payload we send would delete
# every Android subscription in the database, and those users would have to reinstall to
# re-register. The costs are wildly asymmetric: keeping a dead row wastes one no-op send per tick,
# while wrongly pruning a live one silently loses the player. When in doubt, keep the row.
_FCM_DEAD_STATUSES = {"UNREGISTERED", "NOT_FOUND"}

_FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"


async def _fcm_access_token(settings: Settings) -> str:
    """Exchange a self-signed service-account JWT for an OAuth2 access token.

    This is what `google-auth` would do; doing it by hand keeps the dependency list unchanged and
    mirrors how the APNs sender already mints its own provider JWT. The token is good for ~1h and a
    job run lasts seconds, so it's fetched once per sender build — same lifecycle as APNs.
    """
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": settings.fcm_client_email,
            "scope": _FCM_SCOPE,
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        },
        settings.fcm_private_key,
        algorithm="RS256",
    )
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
    resp.raise_for_status()
    return str(resp.json()["access_token"])


def _build_fcm_sender(settings: Settings) -> Sender:
    """Android delivery via FCM HTTP v1.

    Until this existed, `build_sender` routed `platform == "android"` to nothing: the device
    registered happily, the row was kept, and no notification ever arrived — a silent no-op rather
    than an error. Anything that ships an Android build needs this or reminders are dead on that
    platform.

    The OAuth token is fetched LAZILY on first send and cached for the run, so `build_sender` stays
    synchronous (matching APNs) and a run with no Android subscribers never calls Google at all.
    """
    url = f"https://fcm.googleapis.com/v1/projects/{settings.fcm_project_id}/messages:send"
    cached: dict[str, str] = {}

    async def send(sub: Sub, payload: dict[str, str]) -> None:
        if "token" not in cached:
            cached["token"] = await _fcm_access_token(settings)
        access_token = cached["token"]
        message: dict[str, object] = {
            "token": sub["device_token"],
            "notification": {"title": payload["title"], "body": payload["body"]},
            # Android needs an explicit high priority to wake a dozing device; the deep-link URL
            # rides in `data` so the app can route the tap the same way iOS does.
            "android": {"priority": "high"},
        }
        if payload.get("url"):
            message["data"] = {"url": payload["url"]}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
                content=json.dumps({"message": message}),
            )
        if resp.status_code == 200:
            return
        status = ""
        try:
            status = resp.json().get("error", {}).get("status", "")
        except Exception:
            pass
        if resp.status_code == 404 or status in _FCM_DEAD_STATUSES:
            raise PushExpired()
        raise RuntimeError(f"FCM {resp.status_code} {status}")

    return send


def _build_apns_sender(settings: Settings) -> Sender:
    host = "api.sandbox.push.apple.com" if settings.apns_use_sandbox else "api.push.apple.com"
    topic = settings.apns_topic
    # One provider JWT per job run (valid ~1h; a run is seconds). ES256 over the .p8 key.
    token = jwt.encode(
        {"iss": settings.apns_team_id, "iat": int(time.time())},
        settings.apns_key_p8,
        algorithm="ES256",
        headers={"kid": settings.apns_key_id},
    )

    async def send(sub: Sub, payload: dict[str, str]) -> None:
        device = sub["device_token"]
        body: dict[str, object] = {
            "aps": {
                "alert": {"title": payload["title"], "body": payload["body"]},
                "sound": "default",
            }
        }
        if payload.get("url"):
            body["url"] = payload["url"]
        async with httpx.AsyncClient(http2=True, timeout=10.0) as client:
            resp = await client.post(
                f"https://{host}/3/device/{device}",
                headers={
                    "authorization": f"bearer {token}",
                    "apns-topic": topic,
                    "apns-push-type": "alert",
                    "apns-priority": "10",
                },
                content=json.dumps(body),
            )
        if resp.status_code == 200:
            return
        reason = ""
        try:
            reason = resp.json().get("reason", "")
        except Exception:
            pass
        if resp.status_code == 410 or reason in _APNS_DEAD_REASONS:
            raise PushExpired()
        raise RuntimeError(f"APNs {resp.status_code} {reason}")

    return send


def build_sender(settings: Settings) -> Sender | None:
    """Compose configured transports into one platform-routing sender, or None if push is off."""
    web = _build_web_sender(settings) if settings.push_enabled else None
    apns = _build_apns_sender(settings) if settings.apns_enabled else None
    fcm = _build_fcm_sender(settings) if settings.fcm_enabled else None
    if web is None and apns is None and fcm is None:
        return None

    async def send(sub: Sub, payload: dict[str, str]) -> None:
        platform = sub.get("platform", "web")
        if platform == "web" and web is not None:
            await web(sub, payload)
        elif platform == "ios" and apns is not None:
            await apns(sub, payload)
        elif platform == "android" and fcm is not None:
            await fcm(sub, payload)
        # a transport that isn't configured yet → skip (device stays; it's not dead)

    return send


def _goodwill_payload(gems: int, coins: int) -> dict[str, str]:
    return {
        "title": "Sorry about that 🙏",
        "body": f"A bug cut some runs short. {gems} gems and {coins} coins are in your account.",
        "url": "/",
    }


async def notify_goodwill(
    session: AsyncSession, send: Sender, gems: int, coins: int
) -> dict[str, int]:
    """One-off apology push. Returns the per-platform breakdown, not just a total.

    The breakdown is the point: APNs and FCM are configured independently of web push, and
    `build_sender` SKIPS a platform whose transport is missing rather than failing. A bare total of
    "sent 900" would look like success while every iOS device — the ones the outage actually hit —
    was silently dropped. Counting per platform makes that visible instead of assumed.

    Ungated on purpose: this is not a recurring nudge, so there is no per-day notification row to
    claim. Re-running it notifies twice, so run it once.
    """
    subs = await _all_subs(session)
    payload = _goodwill_payload(gems, coins)
    by_platform: dict[str, int] = {}
    for sub in subs:
        platform = str(sub.get("platform", "web"))
        by_platform[platform] = by_platform.get(platform, 0) + 1
    attempted = await _fan_out(session, send, [(sub, payload) for sub in subs])
    return {"attempted": attempted, **by_platform}


def _streak_risk_payload(streak: int) -> dict[str, str]:
    return {
        "title": f"{streak}-day streak at risk 🔥",
        "body": "You haven't played today's Daily Royale yet — a few minutes keeps it alive.",
        "url": "/",
    }


async def notify_streak_risk(
    session: AsyncSession, send: Sender, now: datetime | None = None
) -> int:
    """8 PM LOCAL: a streak worth defending is unplayed and the day is running out.

    Distinct from `notify_streak_saved`, which reports a streak that ALREADY survived via a free
    save. This one is the warning that comes first.

    Deliberately narrow, because a second push in one evening has to earn itself:
      * a streak of `push_streak_risk_min_streak` or more — below that there is little to mourn and
        the urgency is manufactured;
      * they have not played the currently-open window;
      * it is at least the streak hour in THEIR zone;
      * and the governor still has final say, so quiet hours and the 30-minute spacing rule keep it
        from landing on the heels of the 7 PM reminder.
    """
    now = now or datetime.now(UTC)
    today = now.astimezone(ET).date()

    window = (
        await session.execute(
            select(ContestWindow).where(
                ContestWindow.contest_date == today, ContestWindow.slot == "royale"
            )
        )
    ).scalar_one_or_none()
    if window is None or window.state != OPEN:
        return 0  # nothing left to save today

    played = set(
        (
            await session.execute(
                select(Entry.user_id).where(Entry.window_id == window.id, Entry.status == SUBMITTED)
            )
        )
        .scalars()
        .all()
    )
    already = set(
        (
            await session.execute(
                select(UserNotification.user_id).where(
                    UserNotification.notify_date == today,
                    UserNotification.kind == "streak_risk",
                )
            )
        )
        .scalars()
        .all()
    )
    sub_user_ids = set(
        (await session.execute(select(PushSubscription.user_id).distinct())).scalars().all()
    )
    candidates = sub_user_ids - played - already
    if not candidates:
        await session.commit()
        return 0

    rows = (
        await session.execute(
            select(Profile.user_id, Profile.streak_count, Profile.timezone).where(
                Profile.user_id.in_(candidates),
                Profile.streak_count >= settings.push_streak_risk_min_streak,
            )
        )
    ).all()

    claimed: dict[uuid.UUID, int] = {}
    for uid, streak, tz_name in rows:
        if local_hour(tz_name, now) < settings.push_streak_risk_hour_local:
            continue
        if not await can_send(session, uid, "streak_risk", now, tz_name):
            continue
        claim = (
            pg_insert(UserNotification)
            .values(user_id=uid, notify_date=today, kind="streak_risk", created_at=now)
            .on_conflict_do_nothing(index_elements=["user_id", "notify_date", "kind"])
            .returning(UserNotification.user_id)
        )
        if (await session.scalars(claim)).one_or_none() is not None:
            claimed[uid] = int(streak)

    subs_by_user = await _subs_for_users(session, set(claimed))
    await session.commit()

    targets: list[tuple[Sub, dict[str, str]]] = []
    for uid, streak in claimed.items():
        payload = _streak_risk_payload(streak)
        for sub in subs_by_user.get(uid, []):
            targets.append((sub, payload))
    return await _fan_out(session, send, targets)
