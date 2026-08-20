"""Server-side verification of a round's answer time (anti-cheat for the speed bonus).

THE PROBLEM. Points are `round((100 + time_frac*60) * streak_mult)`, where
`time_frac = (limit - elapsed_ms) / limit` and `elapsed_ms` is the player's SELF-REPORTED think
time. A client that simply sends `elapsed_ms: 0` on every round claims `time_frac = 1.0` — a flat
+60% on every answer and a perfect average time-fraction that wins every settlement tiebreak. The
value is clamped to `[0, limit]` so it can't exceed 1.0, but nothing tied it to reality.

WHAT THE SERVER CAN PROVE. The ranked Daily Royale is played round-by-round through `/answer`
(never the batch path — see submit_entry). Between two consecutive answers the REAL client must play
its unskippable reveal (3s) then splash (1s) animation before the next round is even interactive, so
the wall-clock GAP the server measures between answers is:

    gap ≈ REVEAL + SPLASH + think + network        (round 0: SPLASH + think + network — no reveal)

Two things fall out, and a cheater can forge neither because both come from the server's own clock:

  1. A gap SHORTER than the animations is impossible for the real client — the UI was bypassed
     (a script firing requests). Such a round gets NO speed credit.
  2. Otherwise `gap - overhead` is how long the player actually had to think. A claim far below that
     (e.g. `elapsed_ms: 0` when the measured think-time was 6s) is floored up to the truth.

A generous grace (network RTT + render + slop) sits between "plausible" and "floored", so a genuine
player is never penalized: for a real run `elapsed_ms ≈ measured think`, and the floor is a no-op.

The overhead constants mirror the frontend (Contest.tsx REVEAL_MS / SPLASH_MS). If those drift, the
grace absorbs it — this is an anti-abuse heuristic, not an exact stopwatch, so a small mismatch only
changes how aggressively an egregious lie is corrected, never a correct player's score.
"""

from __future__ import annotations

# Fixed UI animation between two consecutive answers in the real client. Unskippable (driven by
# setTimeout in Contest.tsx), so the measured inter-answer gap can never legitimately be smaller.
ROUND_REVEAL_MS = 3000
ROUND_SPLASH_MS = 1000

# A gap this small could not have played even the opening splash — it is a scripted/instant answer
# regardless of round, so it earns no speed bonus.
MIN_LEGIT_GAP_MS = 500

# How far below the expected overhead a gap may fall (fast network making the animation appear a
# touch shorter to the server) before the round is judged scripted rather than merely fast.
GAP_TOLERANCE_MS = 1500

# Grace subtracted from the server-measured think-time before flooring a claim: absorbs network RTT,
# client render time and measurement slop, so a real player's honest `elapsed_ms` is never floored.
# Deliberately generous — protecting legitimate players outranks perfectly pricing a patient cheat.
ANSWER_TIME_GRACE_MS = 3000

# Nobody answers in truly zero time. Caps the maximum credited speed a hair below the round limit.
MIN_HUMAN_ANSWER_MS = 250


def ui_overhead_ms(is_first_round: bool) -> int:
    """The unskippable animation time the real client plays before a round can be answered.

    Round 0 follows only the opening splash; every later round follows the previous round's reveal
    and then the splash.
    """
    return ROUND_SPLASH_MS if is_first_round else (ROUND_REVEAL_MS + ROUND_SPLASH_MS)


def verified_elapsed_ms(
    client_elapsed_ms: int,
    gap_ms: float,
    is_first_round: bool,
    limit_ms: int,
) -> int:
    """The server-verified elapsed_ms for a round: the value actually used to score it.

    `client_elapsed_ms` is the already-parsed/clamped self-report; `gap_ms` is the wall-clock since
    the previous answer (or since entry start, for round 0). Returns a value in [0, limit_ms].

    - A gap too small for the real client's animations → `limit_ms` (time_frac 0, no speed bonus).
    - Otherwise the claim is floored up to the server-measured think-time (minus grace), and never
      below a human minimum. For an honest run the floor is a no-op and the claim passes through.
    """
    overhead = ui_overhead_ms(is_first_round)
    # Impossible-for-the-real-client fast: scripted / UI bypassed → no speed credit.
    if gap_ms < MIN_LEGIT_GAP_MS or gap_ms + GAP_TOLERANCE_MS < overhead:
        return limit_ms

    server_think = gap_ms - overhead  # wall-clock the player actually had to think
    floored = max(client_elapsed_ms, server_think - ANSWER_TIME_GRACE_MS, MIN_HUMAN_ANSWER_MS)
    return max(0, min(int(floored), limit_ms))
