"""Padding the LIVE Daily Royale board so a thin day doesn't look broken (docs/architecture.md §7).

A two-person day renders as a podium with an empty third step and no rows beneath it, which reads as
a broken screen rather than a quiet one. This module tops the live board up to `MIN_LIVE_FIELD_SIZE`
with deterministic fillers from `services/bots.py`.

**The boundary is the design.** This function is called from the field ENDPOINT only. It is not
inside `window_field`, so the honest field read stays honest and every other caller — present or
future — gets real entries unless it opts in by calling this explicitly:

  - `settle_window` ranks entries straight from the DB, so placement, Elo, Gems, streak and
    `standings` are human-only. Nobody is paid for beating a filler.
  - `create_challenge` computes its own count, so a public share link that says "3rd of 8" still
    means eight people played. That link outlives the window; the live board does not.
  - Fillers appear only while the window is OPEN. Once it closes, the board is the real field, which
    is what the "final standings" pill has always promised.

`tests/test_no_synthetic_field.py` pins each of those boundaries; this module is the one place that
is allowed to cross into synthetic, and only for the provisional view.
"""

from __future__ import annotations

from app.core.constants import AVATAR_PRESETS
from app.models import ContestWindow
from app.models.contest import OPEN
from app.services.bots import MIN_LIVE_FIELD_SIZE, royale_filler_runs, window_seed
from app.services.contest import FieldEntry, WindowField
from app.services.scoring import compute_points

#: Fillers carry NO earned cosmetics — frames, badges and titles are proof of something a player
#: actually did, so hanging one on an invented entrant would be a second and worse fiction.
#:
#: The avatar PRESET is different: it isn't earned, every player just picks one at signup. Leaving
#: them all on the default made a padded board show six identical portraits in a column, which is a
#: far louder tell than any name. Varying it is the honest match to how a real board looks.
_PRESET_COUNT = len(AVATAR_PRESETS)


def _filler_points(rounds: list[dict[str, object]]) -> list[int]:
    """Per-round points for a filler run, through the CANONICAL scoring formula.

    Reusing `compute_points` (rather than inventing a plausible-looking total) means a filler's
    score is reachable by a real run and moves with the real streak multiplier — so the board keeps
    one scoring model, and a filler can never post a number a human could not.
    """
    points: list[int] = []
    streak = 0
    for r in rounds:
        correct = bool(r["correct"])
        streak = streak + 1 if correct else 0
        points.append(compute_points(correct, float(r["time_frac"]), streak))  # type: ignore[arg-type]
    return points


def pad_live_field(
    field: WindowField, window: ContestWindow, *, num_rounds: int = 8
) -> WindowField:
    """Top the live board up to `MIN_LIVE_FIELD_SIZE`, or return it untouched.

    Untouched when the window is not an OPEN royale, or the real field is already big enough. The
    viewer's rank is recomputed over the padded board so their position is consistent with what they
    can see; their SETTLED placement is computed elsewhere, from real entries only.
    """
    if window.slot != "royale" or window.state != OPEN:
        return field
    missing = MIN_LIVE_FIELD_SIZE - field.field_size
    if missing <= 0:
        return field

    # Preset picked from the name so it is stable for that filler without another RNG stream.
    fillers = [
        FieldEntry(
            username=name,
            points=_filler_points(rounds),
            avatar_preset=AVATAR_PRESETS[sum(map(ord, name)) % _PRESET_COUNT],
        )
        for name, rounds in royale_filler_runs(window_seed(window), missing, num_rounds)
    ]
    if not fillers:
        return field

    merged = sorted([*field.entries, *fillers], key=lambda e: (-sum(e.points), e.username))

    # The viewer keeps their real score; only the count of entrants above them changes. A viewer who
    # hasn't played still has no rank — a filler must never make someone look like they entered.
    viewer_rank = field.viewer_rank
    if viewer_rank is not None:
        viewer_rank += sum(1 for f in fillers if sum(f.points) > field.viewer_score)

    return WindowField(
        entries=merged,
        field_size=field.field_size + len(fillers),
        viewer_rank=viewer_rank,
        viewer_score=field.viewer_score,
    )
