"""Pure Glicko-2 core (services/glicko2.py) — no DB, just the math.

The canonical proof is Glickman's own worked example ("Example of the Glicko-2
system", 2013): a player at rating 1500 / RD 200 / vol 0.06, system constant
tau=0.5, plays one rating period of three games against 1400/30, 1550/100 and
1700/300, scoring W / L / L. The published result is 1464.06 / 151.52 / 0.05999.
If our implementation reproduces that to 2 dp, the algorithm is correct.

Rot Rating floors RD (default 200) so 8 games/day never converge the number
rigid — the paper example must therefore run with the floor OFF to match.
"""

from __future__ import annotations

from app.services.glicko2 import Glicko, Result, update_rating


def _g(rating: float, rd: float, vol: float = 0.06) -> Glicko:
    return Glicko(rating=rating, rd=rd, vol=vol)


def test_glickman_paper_vector() -> None:
    player = _g(1500, 200)
    games = [
        Result(_g(1400, 30), 1.0),
        Result(_g(1550, 100), 0.0),
        Result(_g(1700, 300), 0.0),
    ]
    updated = update_rating(player, games, tau=0.5, rd_floor=0.0)
    assert updated.rating == round_close(1464.06)
    assert updated.rd == round_close(151.52)
    assert abs(updated.vol - 0.05999) < 1e-5


def round_close(expected: float):
    class _Close:
        def __eq__(self, other: object) -> bool:
            return isinstance(other, (int, float)) and abs(other - expected) < 0.02

        def __repr__(self) -> str:  # pragma: no cover - debug aid
            return f"~{expected}"

    return _Close()


def test_rd_floor_clamps_below_floor() -> None:
    # The paper vector's post-update RD is ~151.5; with a 200 floor it must clamp UP to 200,
    # and never below — this is the "stay responsive" guarantee.
    player = _g(1500, 200)
    games = [
        Result(_g(1400, 30), 1.0),
        Result(_g(1550, 100), 0.0),
        Result(_g(1700, 300), 0.0),
    ]
    updated = update_rating(player, games, tau=0.5, rd_floor=200.0)
    assert updated.rd == 200.0
    # Flooring RD must not move the rating itself — only its deviation.
    unfloored = update_rating(player, games, tau=0.5, rd_floor=0.0)
    assert abs(updated.rating - unfloored.rating) < 1e-9


def test_many_periods_never_drop_below_floor() -> None:
    # Repeatedly winning should drive RD down toward its minimum; with a 200 floor it must
    # asymptote AT 200, never past it — otherwise a daily player's number would freeze.
    player = _g(1500, 350)
    for _ in range(50):
        games = [Result(_g(1500, 200), 1.0) for _ in range(8)]
        player = update_rating(player, games, tau=0.5, rd_floor=200.0)
    assert player.rd >= 200.0 - 1e-9
    assert player.rd == round_close(200.0)


def test_no_games_inflates_rd_only() -> None:
    # An empty period leaves the rating untouched and only grows RD (phi* = sqrt(phi^2 + sigma^2)).
    player = _g(1500, 200)
    updated = update_rating(player, [], tau=0.5, rd_floor=0.0)
    assert updated.rating == player.rating
    assert updated.rd > player.rd


def test_no_games_respects_floor() -> None:
    player = _g(1500, 40)  # below the floor already (e.g. a legacy value)
    updated = update_rating(player, [], tau=0.5, rd_floor=200.0)
    assert updated.rd >= 200.0


def test_win_raises_loss_lowers() -> None:
    player = _g(1500, 200)
    won = update_rating(player, [Result(_g(1500, 50), 1.0)], tau=0.5, rd_floor=0.0)
    lost = update_rating(player, [Result(_g(1500, 50), 0.0)], tau=0.5, rd_floor=0.0)
    assert won.rating > 1500 > lost.rating
