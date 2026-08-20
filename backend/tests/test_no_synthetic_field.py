"""Where synthetic entrants may and may not appear in the Daily Royale.

Fillers pad the LIVE board of a thin day so it doesn't render as a podium with an empty third step
(`services/field_fillers.py`). That is a deliberate reversal of the earlier "no synthetic entrants
anywhere" rule, and it is narrowly bounded. This file pins the boundary in both directions, because
a rule nobody tests is a rule that drifts:

  ALLOWED   the live field read, while the window is OPEN and the real field is thin.
  FORBIDDEN settlement (placement, Elo, Gems, streak, standings) — nobody is paid for beating one.
  FORBIDDEN public share links — "3rd of 8" outlives the window and must mean eight real people.
  FORBIDDEN `window_field` itself — the honest read stays honest, so a future caller is safe.

Duel rivals are unaffected and covered by tests/test_duel_rival.py — a disclosed 1v1 opponent the
player chose to face, not an invented crowd.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.core.timezone import ET
from app.models import ContestWindow, Entry, RoundResult, Standing
from app.models.contest import CLOSED, OPEN, SUBMITTED
from app.services.bots import MIN_LIVE_FIELD_SIZE, royale_filler_runs
from app.services.challenge import create_challenge
from app.services.contest import window_field
from app.services.field_fillers import _filler_points, pad_live_field
from app.services.registration import register_user
from app.services.scoring import compute_points
from app.services.settlement import settle_window
from sqlalchemy.ext.asyncio import AsyncSession


async def _window(session: AsyncSession, *, state: str = OPEN, day_offset: int = 0):
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=now.astimezone(ET).date() + timedelta(days=day_offset),
        slot="royale",
        open_at=now - timedelta(hours=2),
        close_at=now + (timedelta(hours=2) if state == OPEN else timedelta(hours=-1)),
        state=state,
        template_id="dr_8_trivia",
    )
    session.add(w)
    await session.flush()
    return w


async def _entry(session: AsyncSession, w, email: str, score: int, rounds: int = 2):
    """A submitted entry WITH per-round results — window_field builds the field from RoundResult."""
    user = await register_user(session, email, email.split("@")[0], "super-secret-pw")
    e = Entry(
        window_id=w.id,
        user_id=user.id,
        is_practice=False,
        seed=1,
        round_set=[],
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        total_score=score,
        status=SUBMITTED,
    )
    session.add(e)
    await session.flush()
    for i in range(rounds):
        session.add(
            RoundResult(
                entry_id=e.id,
                idx=i,
                module_type="trivia",
                points=score // rounds,
                correct=True,
                time_frac=0.5,
                valid=True,
                flags=[],
            )
        )
    await session.flush()
    return user, e


@pytest.mark.asyncio
class TestNoSyntheticField:
    async def test_live_field_is_empty_before_anyone_plays(self, db_session: AsyncSession) -> None:
        """The single clearest signal: an untouched window shows nobody, not eight fake names."""
        w = await _window(db_session)
        result = await window_field(db_session, w.id)
        assert result.entries == [] and result.field_size == 0

    async def test_live_field_shows_exactly_the_real_entrants(
        self, db_session: AsyncSession
    ) -> None:
        w = await _window(db_session)
        await _entry(db_session, w, "one@example.com", 500)
        await _entry(db_session, w, "two@example.com", 400)

        result = await window_field(db_session, w.id)
        assert len(result.entries) == 2
        assert result.field_size == 2
        assert {f.username for f in result.entries} == {"one", "two"}

    async def test_settled_field_size_is_the_real_count(self, db_session: AsyncSession) -> None:
        w = await _window(db_session, state=CLOSED, day_offset=-1)
        user, _ = await _entry(db_session, w, "solo@example.com", 500)

        await settle_window(db_session, w.id)
        standing = await db_session.get(Standing, (w.id, user.id))
        assert standing is not None
        assert (standing.place, standing.field_size) == (1, 1)

    async def test_share_link_field_size_is_not_padded(self, db_session: AsyncSession) -> None:
        """The most public surface — a shared "Top X% of N" must not count invented rivals."""
        w = await _window(db_session, day_offset=-2)
        user, entry = await _entry(db_session, w, "sharer@example.com", 700)

        challenge = await create_challenge(db_session, creator=user, entry_id=entry.id)
        assert challenge.field_size == 1
        assert challenge.place == 1

    async def test_window_field_itself_never_pads(self, db_session: AsyncSession) -> None:
        """Padding lives in `pad_live_field`, NOT in the field read.

        This is the structural guarantee behind every other assertion here: settlement, share links
        and any future caller reach `window_field` directly, so as long as it stays honest they
        cannot be fed a filler by accident. Only a caller that names `pad_live_field` gets one.
        """
        w = await _window(db_session)
        await _entry(db_session, w, "solo-real@example.com", 500)

        result = await window_field(db_session, w.id)
        assert result.field_size == 1
        assert [e.username for e in result.entries] == ["solo-real"]

    async def test_duel_rivals_still_exist(self) -> None:
        """The one place a synthetic opponent is still correct, and is disclosed as such."""
        from app.services.bots import make_duel_rival

        rounds = make_duel_rival(seed=1234, tier="solid", num_rounds=7)
        assert len(rounds) == 7
        assert all({"correct", "time_frac"} <= set(r) for r in rounds)


# --- the fillers themselves --------------------------------------------------------------------


def _human_run_points(correct_count: int, time_frac: float, total: int = 8) -> int:
    """A reference human run through the canonical formula: `correct_count` right, then the rest
    wrong. Correct answers first is the BEST arrangement (the streak multiplier compounds), so this
    is the strongest run at that accuracy — the bar fillers are measured against."""
    streak = 0
    points = 0
    for i in range(total):
        correct = i < correct_count
        streak = streak + 1 if correct else 0
        points += compute_points(correct, time_frac, streak)
    return points


class TestLiveBoardFillers:
    """Fillers exist to stop a thin day looking broken; they must not look superhuman doing it."""

    async def test_a_thin_open_board_is_topped_up(self, db_session: AsyncSession) -> None:
        w = await _window(db_session)
        await _entry(db_session, w, "real-one@example.com", 500)
        await _entry(db_session, w, "real-two@example.com", 400)

        padded = pad_live_field(await window_field(db_session, w.id), w)
        assert padded.field_size == MIN_LIVE_FIELD_SIZE
        assert len(padded.entries) == MIN_LIVE_FIELD_SIZE
        # The real players are still there, and the board is ordered by score.
        assert {"real-one", "real-two"} <= {e.username for e in padded.entries}
        totals = [sum(e.points) for e in padded.entries]
        assert totals == sorted(totals, reverse=True)

    async def test_the_same_window_pads_identically_on_every_poll(
        self, db_session: AsyncSession
    ) -> None:
        """Home re-reads the field every 30s. A board that reshuffled each tick would read as
        broken long before anyone wondered whether the names were real."""
        w = await _window(db_session)
        first = pad_live_field(await window_field(db_session, w.id), w)
        second = pad_live_field(await window_field(db_session, w.id), w)
        assert [(e.username, e.points) for e in first.entries] == [
            (e.username, e.points) for e in second.entries
        ]

    async def test_different_windows_get_different_names(self, db_session: AsyncSession) -> None:
        a = await _window(db_session, day_offset=-3)
        b = await _window(db_session, day_offset=-4)
        field_a = pad_live_field(await window_field(db_session, a.id), a)
        field_b = pad_live_field(await window_field(db_session, b.id), b)
        assert {e.username for e in field_a.entries} != {e.username for e in field_b.entries}

    async def test_a_closed_window_is_never_padded(self, db_session: AsyncSession) -> None:
        """Once the window closes the board IS the final standing — the 'final' pill promises it."""
        w = await _window(db_session, state=CLOSED, day_offset=-1)
        await _entry(db_session, w, "closed-real@example.com", 500)

        padded = pad_live_field(await window_field(db_session, w.id), w)
        assert padded.field_size == 1
        assert [e.username for e in padded.entries] == ["closed-real"]

    async def test_a_full_field_is_left_alone(self, db_session: AsyncSession) -> None:
        w = await _window(db_session)
        for i in range(MIN_LIVE_FIELD_SIZE):
            await _entry(db_session, w, f"crowd{i}@example.com", 500 - i)

        padded = pad_live_field(await window_field(db_session, w.id), w)
        assert padded.field_size == MIN_LIVE_FIELD_SIZE
        assert all(e.username.startswith("crowd") for e in padded.entries)

    async def test_a_viewer_who_has_not_played_still_has_no_rank(
        self, db_session: AsyncSession
    ) -> None:
        """A filler must never make someone look like they entered."""
        w = await _window(db_session)
        other = await _window(db_session, day_offset=-9)
        watcher, _ = await _entry(db_session, other, "w@x.com", 1)

        padded = pad_live_field(await window_field(db_session, w.id, viewer_user_id=watcher.id), w)
        assert padded.viewer_rank is None
        assert padded.field_size == MIN_LIVE_FIELD_SIZE

    async def test_the_viewers_rank_counts_the_fillers_above_them(
        self, db_session: AsyncSession
    ) -> None:
        w = await _window(db_session)
        me, _ = await _entry(db_session, w, "ranked@example.com", 400)

        real = await window_field(db_session, w.id, viewer_user_id=me.id)
        padded = pad_live_field(real, w)
        above = sum(
            1
            for e in padded.entries
            if e.username != "ranked" and sum(e.points) > padded.viewer_score
        )
        assert padded.viewer_rank == above + 1
        assert padded.viewer_score == real.viewer_score  # their own score is untouched

    async def test_fillers_wear_no_earned_cosmetics(self, db_session: AsyncSession) -> None:
        """Frames, badges and titles are proof of something a player did."""
        w = await _window(db_session)
        for e in pad_live_field(await window_field(db_session, w.id), w).entries:
            assert e.equipped_frame is None
            assert e.equipped_badges == []
            assert e.equipped_title is None

    async def test_fillers_are_beatable_by_an_ordinary_human_run(self) -> None:
        """The instruction was 'a little worse than too good'. Measured over 300 windows.

        Generation is deterministic in the seed, so this samples the real distribution without being
        flaky — the same 300 windows produce the same numbers on every run.
        """
        runs = [
            rounds
            for seed in range(400)
            for _, rounds in royale_filler_runs(seed, MIN_LIVE_FIELD_SIZE, 8)
        ]
        correct = sorted(sum(1 for r in rounds if r["correct"]) for rounds in runs)
        totals = sorted(sum(_filler_points(rounds)) for rounds in runs)
        n = len(runs)

        # THE TUNED SHAPE. Mean correct is 8 * midpoint(ROYALE_FILLER_SKILL), so this fails loudly
        # if the band is ever nudged without someone re-deciding the difficulty on purpose. A mean
        # of 5.2 was tried and rejected for putting fillers on top of thin boards too often.
        mean_correct = sum(correct) / n
        assert 3.2 <= mean_correct <= 3.6, f"fillers average {mean_correct:.2f}/8, target ~3.4"
        assert correct[n // 2] == 3

        solid = _human_run_points(6, 0.5)  # an ordinary good day: 6/8 at middling speed
        sweep = _human_run_points(8, 0.9)  # a fast clean sweep
        # The overwhelming majority lose to an ordinary good day...
        share_beaten = sum(1 for t in totals if t < solid) / n
        assert share_beaten > 0.95, f"only {share_beaten:.1%} of fillers lose to an ordinary 6/8"
        # ...and none ever out-scores a clean fast run.
        assert totals[-1] < sweep, f"a filler scored {totals[-1]} vs a perfect run's {sweep}"
        # But they are not scenery: the strongest ones do beat a poor day.
        assert totals[-1] > _human_run_points(3, 0.4)

    async def test_fillers_do_not_all_wear_the_same_portrait(
        self, db_session: AsyncSession
    ) -> None:
        """A column of six identical avatars is a louder tell than any username. The preset is not
        earned — every player picks one at signup — so varying it matches how a real board looks."""
        w = await _window(db_session)
        presets = {
            e.avatar_preset for e in pad_live_field(await window_field(db_session, w.id), w).entries
        }
        assert len(presets) > 1
