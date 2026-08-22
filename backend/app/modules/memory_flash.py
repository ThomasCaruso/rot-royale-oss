"""Memory-flash round module. Simon-style sequence — generated, no content bank.

The sequence is the stimulus the player watches, so it legitimately appears in client_spec; it is
also stored server-side and the submitted taps are validated against it (the anti-cheat property is
that the SUBMISSION is server-checked, not that the sequence is secret).

client_spec  = {sequence, tiles, category, icon, time_limit_ms}
server_answer = {sequence}
submission    = {taps: [int], tap_times: [ms], elapsed_ms}
"""

from __future__ import annotations

from random import Random
from typing import Any

from app.modules.base import GenerationContext, RoundJudgement, clamp_elapsed_ms

MEMORY_FLASH_TIME_LIMIT_MS = 10000  # input phase budget — every question gets a flat 10s timer
SEQUENCE_LENGTH = 4
TILES = 6


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
        sequence = [rng.randint(0, TILES - 1) for _ in range(SEQUENCE_LENGTH)]
        client_spec = {
            "sequence": sequence,
            "tiles": TILES,
            "category": "Memory Flash",
            "icon": "🧩",
            "time_limit_ms": self.time_limit_ms,
        }
        server_answer = {"sequence": sequence}
        return client_spec, server_answer

    def score(self, server_answer: dict[str, Any], submission: dict[str, Any]) -> RoundJudgement:
        # `submission` is opaque client JSON — `taps` / `tap_times` can be any type. Keep only lists
        # of ints; anything else (e.g. `taps: 5`, `tap_times: ["a"]`) becomes empty rather than
        # raising `TypeError` deep in the checks below and 500-ing the submit. A malformed input
        # then simply can't match the sequence and earns nothing — the safe reading.
        taps = _int_list(submission.get("taps"))
        tap_times = _int_list(submission.get("tap_times"))
        sequence = server_answer["sequence"]

        elapsed = clamp_elapsed_ms(
            submission.get("elapsed_ms", self.time_limit_ms), self.time_limit_ms
        )
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

        return RoundJudgement(correct=correct, time_frac=time_frac, valid=valid, flags=flags)
