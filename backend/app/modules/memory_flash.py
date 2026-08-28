"""Memory-flash round module. Simon-style sequence — generated, no content bank.

The sequence is the stimulus the player watches, so it legitimately appears in client_spec; it is
also stored server-side and the submitted taps are validated against it (the anti-cheat property is
that the SUBMISSION is server-checked, not that the sequence is secret).

THREE WAVES, not one. A single four-step sequence is over in about two seconds and there is nothing
to come back for — played repeatedly it goes flat by the fourth run, which is what testing found.
The round is now a short ladder: 3 items, then 4, then 5, each played faster than the last. Failing
a wave ends the round and banks the waves already cleared, so there is something to lose from the
second wave onward.

client_spec  = {sequence, waves, wave_gap_ms, tiles, category, icon, time_limit_ms}
server_answer = {sequence, waves, difficulty}
submission    = {waves: [{taps, tap_times, elapsed_ms}], elapsed_ms}   (current clients)
              | {taps: [int], tap_times: [ms], elapsed_ms}             (shipped binaries - §7c)

`sequence` REMAINS in client_spec and is wave 1, so a shipped binary that knows nothing about waves
renders and plays exactly the round it always did. Its one-sequence submission is judged by the OLD
rule (see `score`) — widening the game must never turn a round the installed base could win into one
it always loses.
"""

from __future__ import annotations

from random import Random
from typing import Any

from app.modules.base import GenerationContext, RoundJudgement, clamp_elapsed_ms

MEMORY_FLASH_TIME_LIMIT_MS = (
    10000  # per-WAVE input budget (a shipped binary uses it as its only one)
)
SEQUENCE_LENGTH = 4  # legacy: the length of wave 1, kept for the old single-sequence contract

# The ladder. Lengths climb and the tempo tightens, so escalation is something the player FEELS
# rather than a number in a config.
WAVE_LENGTHS: tuple[int, ...] = (3, 4, 5)

# Milliseconds per step, per wave — the gap between one tile lighting and the next.
#
# THE OLD TIMING WAS TOO FAST TO MEMORISE. It ramped 620ms down to 380ms WITHIN a single sequence,
# which was meant to build tension and instead just made the pattern hard to read: by step three the
# flashes were arriving quicker than most people can rehearse them. Wave 1 now starts well slower
# than the old opening step, and the acceleration moved to where it is legible — BETWEEN waves,
# where the player can notice it happening.
WAVE_GAP_MS: tuple[int, ...] = (820, 690, 570)

# How many waves must be cleared for the round to count as CORRECT.
#
# A judgement call, and the one worth arguing with. `correct` drives the run streak and is the
# pass/fail the Rot Rating game sees (§5e), so it has to mean "played this round well". Wave 1 alone
# is three items and nearly everyone clears it — too cheap to be the bar. Demanding all three would
# make the round mostly-failed, which would drag the streak that the points multiplier depends on.
# Two of three is "got past the middle". The third wave is upside, and it still pays through
# sub_scores whether or not it changes the verdict.
PASS_WAVES = 2
# SIX. Nine was tried and pulled: a 3x3 of nine targets is a materially harder round than the same
# four-step sequence over six, and it also demanded nine distinguishable colours — one more than the
# palette can carry while keeping every hue clearly its own. Six is the number where the tiles stay
# big, the colours stay separable, and the difficulty stays where it was.
#
# Safe for the installed base either way (§7c): `tiles` has always been read from client_spec, so a
# shipped binary renders whatever this says without a code change.
TILES = 6

# The Rot Rating difficulty band this type reports. Not one of easy/medium/hard: the round is
# GENERATED, so it has no authored tier, and the point of the value is to keep its difficulty item
# separate from change detection's (see the note in generate()).
ROT_BAND = "memory"


def _int_list(v: Any) -> list[int]:
    """Coerce opaque client input to a list of ints, or [] if it isn't one. Never raises."""
    if not isinstance(v, list):
        return []
    out: list[int] = []
    for x in v:
        # bool is an int subclass but is never a valid tap/timestamp — exclude it explicitly.
        if isinstance(x, int) and not isinstance(x, bool):
            out.append(x)
        else:
            return []
    return out


# Completing a multi-tap sequence faster than this is not humanly possible → reject as a spoof.
MIN_PLAUSIBLE_INPUT_MS = 150


class MemoryFlashModule:
    type = "memory_flash"
    time_limit_ms = MEMORY_FLASH_TIME_LIMIT_MS

    def generate(
        self, rng: Random, difficulty: str | None, ctx: GenerationContext
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        waves = [[rng.randint(0, TILES - 1) for _ in range(n)] for n in WAVE_LENGTHS]
        client_spec = {
            # Wave 1 under its old name, so a shipped binary plays the round it already knows.
            "sequence": waves[0],
            "waves": waves,
            "wave_gap_ms": list(WAVE_GAP_MS),
            "tiles": TILES,
            "category": "Memory Flash",
            "icon": "🧩",
            "time_limit_ms": self.time_limit_ms,
        }
        server_answer = {
            "sequence": waves[0],
            "waves": waves,
            # Rot Rating reads the difficulty BAND from server_answer (rot_rating_store), and an
            # absent one defaults to "medium". This type's verb is `notice`, so defaulting would
            # file every memory round under `notice:medium` — the SAME floating difficulty item as
            # a medium change-detection round. Those are different tasks with different pass rates,
            # and the daily convergence would let each drag the other's rating around. Its own band
            # gives it its own item; the seed table falls back to 1500 for a band it doesn't list.
            "difficulty": ROT_BAND,
        }
        return client_spec, server_answer

    def score(self, server_answer: dict[str, Any], submission: dict[str, Any]) -> RoundJudgement:
        waves = server_answer.get("waves") or [server_answer["sequence"]]
        submitted = submission.get("waves")

        # LEGACY SHAPE — a binary that predates the ladder sends one flat tap list. Judge it the way
        # it has always been judged: wave 1, one verdict, no sub-scores. Anything else would make a
        # round the installed base can win into one it always loses (§7c).
        if not isinstance(submitted, list):
            return self._judge_one(list(waves[0]), submission, sole=True)

        results = [
            self._judge_one(list(seq), sub if isinstance(sub, dict) else {})
            for seq, sub in zip(waves, submitted, strict=False)
        ]
        # The ladder stops at the first miss, so only a leading run of clears counts. Anything after
        # a failed wave cannot have been played and is ignored rather than credited.
        cleared: list[RoundJudgement] = []
        for r in results:
            if not r.correct:
                break
            cleared.append(r)

        valid = all(r.valid for r in results)
        flags = [f for r in results for f in r.flags]
        return RoundJudgement(
            correct=len(cleared) >= PASS_WAVES,
            # The headline time_frac is wave 1's: it is the one every player attempts, so it keeps
            # the speed term comparable across runs that ended at different waves.
            time_frac=results[0].time_frac if results else 0.0,
            valid=valid,
            flags=flags,
            # Waves 2+ pay through the SAME compute_points as everything else
            # (contest.answer_round) — the seam the video round already established: one Royale
            # slot, several scored answers, no second economy.
            sub_scores=[(True, r.time_frac) for r in cleared[1:]] or None,
        )

    def _judge_one(
        self, sequence: list[int], part: dict[str, Any], *, sole: bool = False
    ) -> RoundJudgement:
        """Judge ONE wave (or, for a legacy submission, the whole round)."""
        # `part` is opaque client JSON — `taps` / `tap_times` can be any type. Keep only lists of
        # ints; anything else (e.g. `taps: 5`, `tap_times: ["a"]`) becomes empty rather than raising
        # deep in the checks below and 500-ing the submit. Malformed input simply cannot match.
        taps = _int_list(part.get("taps"))
        tap_times = _int_list(part.get("tap_times"))

        elapsed = clamp_elapsed_ms(part.get("elapsed_ms", self.time_limit_ms), self.time_limit_ms)
        time_frac = (self.time_limit_ms - elapsed) / self.time_limit_ms
        correct = taps == list(sequence)

        # Plausibility of the per-tap timestamps (anti-spoof; this is payout-affecting after
        # settlement). Bias to false-negatives: reject only the clearly-impossible. A real player
        # taps a few tiles over ~1s; only superhuman/forged inputs trip these.
        valid = True
        flags: list[str] = []
        if taps:
            if len(tap_times) != len(taps):
                valid, flags = False, ["tap_time_count_mismatch"]
            elif any(t < 0 or t > self.time_limit_ms for t in tap_times):
                valid, flags = False, ["tap_time_out_of_range"]
            elif any(tap_times[i] > tap_times[i + 1] for i in range(len(tap_times) - 1)):
                valid, flags = False, ["tap_times_nonmonotonic"]
            elif len(taps) > 1 and max(tap_times) < MIN_PLAUSIBLE_INPUT_MS:
                valid, flags = False, ["superhuman_input_speed"]

        _ = sole  # the legacy path differs only in that the caller returns this directly
        return RoundJudgement(correct=correct, time_frac=time_frac, valid=valid, flags=flags)
