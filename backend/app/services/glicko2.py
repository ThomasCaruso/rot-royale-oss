"""Pure Glicko-2 rating math — the core of Rot Rating (docs/architecture.md §9).

Glicko-2 (Glickman 2013) rates a player from a batch of games in one *rating
period* and returns an updated rating, rating deviation (RD) and volatility.
Rot Rating uses one Royale run as a period (8 games, round-as-opponent, pass/
fail), and floors RD so a daily player's number never converges rigid — the
requirement is that the number visibly MOVES, so we trade precision for
responsiveness (RD floor defaults to 200; see constants). Speed never enters
here — Rot Rating measures sharpness, points reward speed (two separate jobs).

This module is pure (no DB, no clock). It is validated against Glickman's own
worked example in tests/test_glicko2.py. Everything below works in the internal
Glicko-2 scale (mu, phi) and converts at the boundary; callers see the familiar
1500-centred (rating, rd) scale via the Glicko dataclass.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Glicko-2 scale factor: rating = 1500 + SCALE*mu, rd = SCALE*phi.
_SCALE = 173.7178
_CENTER = 1500.0
# Convergence tolerance for the volatility (sigma) root-find — Glickman's recommended 1e-6.
_EPSILON = 1e-6


@dataclass(frozen=True)
class Glicko:
    """A rating on the human-facing scale (1500-centred), as stored/exposed."""

    rating: float
    rd: float
    vol: float


@dataclass(frozen=True)
class Result:
    """One game in a rating period: the opponent's rating and the score (1 win / 0 loss).

    Only the opponent's rating + rd participate in a Glicko-2 update (its volatility does
    not), so a fixed-difficulty opponent needs no volatility of its own.
    """

    opponent: Glicko
    score: float


def _g(phi: float) -> float:
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi * math.pi))


def _expected(mu: float, mu_j: float, phi_j: float) -> float:
    return 1.0 / (1.0 + math.exp(-_g(phi_j) * (mu - mu_j)))


def _new_volatility(phi: float, v: float, delta: float, sigma: float, tau: float) -> float:
    """Illinois-algorithm root-find for the new volatility (Glickman step 5)."""
    a = math.log(sigma * sigma)
    delta_sq = delta * delta
    phi_sq = phi * phi

    def f(x: float) -> float:
        ex = math.exp(x)
        num = ex * (delta_sq - phi_sq - v - ex)
        den = 2.0 * (phi_sq + v + ex) ** 2
        return num / den - (x - a) / (tau * tau)

    upper = a
    if delta_sq > phi_sq + v:
        lower = math.log(delta_sq - phi_sq - v)
    else:
        k = 1
        while f(a - k * tau) < 0:
            k += 1
        lower = a - k * tau

    f_lower, f_upper = f(lower), f(upper)
    while abs(upper - lower) > _EPSILON:
        mid = lower + (lower - upper) * f_lower / (f_upper - f_lower)
        f_mid = f(mid)
        if f_mid * f_upper <= 0:
            lower, f_lower = upper, f_upper
        else:
            f_lower /= 2.0
        upper, f_upper = mid, f_mid
    return math.exp(upper / 2.0)


def update_rating(
    player: Glicko,
    games: list[Result],
    *,
    tau: float,
    rd_floor: float,
) -> Glicko:
    """Return the player's rating after one rating period of ``games``.

    ``tau`` is the Glicko-2 system constant (volatility change rate). ``rd_floor`` clamps
    the post-update RD up to at least this value (the responsiveness guarantee). An empty
    ``games`` list is a valid period: the rating is unchanged and RD only inflates.
    """
    mu = (player.rating - _CENTER) / _SCALE
    phi = player.rd / _SCALE
    sigma = player.vol

    if not games:
        # No observations: RD grows by the volatility (phi* = sqrt(phi^2 + sigma^2)).
        phi_star = math.sqrt(phi * phi + sigma * sigma)
        return _to_glicko(mu, phi_star, sigma, rd_floor)

    # Step 3 & 4: estimated variance v and the score-weighted improvement sum.
    v_inv = 0.0
    delta_sum = 0.0
    for game in games:
        mu_j = (game.opponent.rating - _CENTER) / _SCALE
        phi_j = game.opponent.rd / _SCALE
        gj = _g(phi_j)
        ej = _expected(mu, mu_j, phi_j)
        v_inv += gj * gj * ej * (1.0 - ej)
        delta_sum += gj * (game.score - ej)
    v = 1.0 / v_inv
    delta = v * delta_sum

    # Step 5: new volatility.
    sigma_prime = _new_volatility(phi, v, delta, sigma, tau)

    # Step 6 & 7: pre-rating-period RD, then the new phi/mu.
    phi_star = math.sqrt(phi * phi + sigma_prime * sigma_prime)
    phi_prime = 1.0 / math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / v)
    mu_prime = mu + phi_prime * phi_prime * delta_sum

    return _to_glicko(mu_prime, phi_prime, sigma_prime, rd_floor)


def _to_glicko(mu: float, phi: float, sigma: float, rd_floor: float) -> Glicko:
    rd = phi * _SCALE
    if rd < rd_floor:
        rd = rd_floor
    return Glicko(rating=_CENTER + _SCALE * mu, rd=rd, vol=sigma)
