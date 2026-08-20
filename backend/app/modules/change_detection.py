"""Change-detection round module (cognition).

The client shows base 5s / blank / altered 8s / blank on loop and the player taps where the
change is. client_spec = {key, image urls, dimensions, flicker timing, tolerance,
time_limit_ms} — never the bounding box. server_answer = {item_id, bbox, tolerance_frac,
difficulty}; the tap is validated server-side.

Coordinates are NORMALIZED to the image (0–1 on each axis) and tolerance is a FRACTION of image
dimension — never pixels — so the round is exactly as hard on a phone as on a tablet. Mapping taps
from screen pixels to image fractions is purely a client rendering concern.

Scoring scales down with elapsed time to a floor: a hit is worth CHANGE_MAX_POINTS instantly,
sliding linearly to CHANGE_MIN_POINTS at the time limit; a miss is 0.
"""

from __future__ import annotations

from random import Random
from typing import Any

from app.modules.base import GenerationContext, RoundJudgement, clamp_elapsed_ms

# A DELIBERATE A/B COMPARISON, not the classic flicker paradigm. The original 250ms/80ms cycle
# leans on the blank wiping the motion signal so the change cannot pop out; at 5s and 8s the player
# instead studies one image, then the other. Far more forgiving, and the right call for an audience
# playing on a phone for ninety seconds — but it means the round is now about MEMORY between two
# long looks rather than about catching a flicker.
CHANGE_FLICKER_BASE_MS = 5000  # the original image
CHANGE_FLICKER_ALTERED_MS = 7000  # the changed image, held longer — it is the one being searched
CHANGE_FLICKER_BLANK_MS = 80  # the wipe between them; what stops a direct visual comparison
# The titled beat between frames ("First image" / "Second image"), staged like the trivia category
# splash. It replaces the bare wipe for clients that understand it: the player now knows WHICH frame
# they're about to study instead of inferring it from a picture changing under them. Long enough to
# read at a glance and no longer — this is time not spent looking for the change.
#
# A NEW field rather than a change to flicker_blank_ms (§7c): the shipped binary knows only the
# blank, and lengthening that from 80ms to ~1s would slow its wipe to a crawl. Old clients ignore
# this and keep the wipe they were built for.
CHANGE_FLICKER_LABEL_MS = 1300

# One full cycle is base + altered + two titled beats = 14.6s, so two complete cycles are 29.2s and
# fit inside the 30s limit with ~0.8s spare. That margin is the point of the 7s altered frame rather
# than 8s: at 8s the second look was cut ~1.2s short, and TWO CLEAN LOOKS beat one long look plus a
# truncated one — a frame that vanishes mid-search reads as the game taking it away. It costs 0.8s
# of total viewing (14s vs 14.8s) to never cut a look short.
#
# This budget is load-bearing. Growing any phase pushes the second cycle back over the limit, and
# raising CHANGE_TIME_LIMIT_MS to compensate would stretch the scoring curve too (points slide from
# MAX to MIN across it), quietly making every round worth more. Move them together or not at all.
CHANGE_TIME_LIMIT_MS = 30000
CHANGE_MAX_POINTS = 100
CHANGE_MIN_POINTS = 20  # the floor a slow hit is still worth — finding it always beats not
CHANGE_TAP_TOLERANCE_FRAC = 0.05  # tap slack as a fraction of image dimension, per axis


def hit_test(bbox: dict[str, Any], x: float, y: float, tolerance_frac: float) -> bool:
    """Is a normalized tap inside the bbox expanded by the tolerance fraction on each axis?"""
    return (
        float(bbox["x"]) - tolerance_frac
        <= x
        <= float(bbox["x"]) + float(bbox["w"]) + tolerance_frac
        and float(bbox["y"]) - tolerance_frac
        <= y
        <= float(bbox["y"]) + float(bbox["h"]) + tolerance_frac
    )


class ChangeDetectionModule:
    type = "change_detection"
    time_limit_ms = CHANGE_TIME_LIMIT_MS

    def generate(
        self, rng: Random, difficulty: str | None, ctx: GenerationContext
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        # ctx.bank carries change-item dicts (services/cognition.py builds them from the pinned
        # draw). Difficulty is not a change-detection axis yet; the parameter is protocol surface.
        if not ctx.bank:
            raise ValueError("change bank is empty")
        item = rng.choice(ctx.bank)
        client_spec = {
            "key": item["key"],
            "base_url": item["base_url"],
            "altered_url": item["altered_url"],
            "width": item["width"],
            "height": item["height"],
            "flicker_base_ms": CHANGE_FLICKER_BASE_MS,
            "flicker_altered_ms": CHANGE_FLICKER_ALTERED_MS,
            "flicker_blank_ms": CHANGE_FLICKER_BLANK_MS,
            "flicker_label_ms": CHANGE_FLICKER_LABEL_MS,
            "tolerance_frac": CHANGE_TAP_TOLERANCE_FRAC,
            "time_limit_ms": self.time_limit_ms,
        }
        server_answer = {
            "item_id": str(item["id"]),
            "bbox": dict(item["bbox"]),
            "tolerance_frac": CHANGE_TAP_TOLERANCE_FRAC,
            # Rot Rating reads the band from here (services/rot_rating_store). Deliberately NOT in
            # client_spec: telling the player up front that this one is "hard" changes how long
            # they look, which would make the difficulty self-fulfilling.
            "difficulty": item.get("difficulty") or "medium",
        }
        return client_spec, server_answer

    def points(self, server_answer: dict[str, Any], submission: dict[str, Any]) -> int:
        """Time-scaled points for a hit: MAX at 0 elapsed, sliding linearly to the MIN floor at
        the limit. Garbage elapsed clamps to the full limit (floor), never a bonus. Miss = 0."""
        if submission.get("timed_out"):
            return 0
        tap = submission.get("tap") or {}
        try:
            x, y = float(tap["x"]), float(tap["y"])
        except (KeyError, TypeError, ValueError):
            return 0
        if not hit_test(server_answer["bbox"], x, y, float(server_answer["tolerance_frac"])):
            return 0
        elapsed = clamp_elapsed_ms(submission.get("elapsed_ms"), self.time_limit_ms)
        span = CHANGE_MAX_POINTS - CHANGE_MIN_POINTS
        return round(CHANGE_MAX_POINTS - span * elapsed / self.time_limit_ms)

    def score(self, server_answer: dict[str, Any], submission: dict[str, Any]) -> RoundJudgement:
        # A timed-out round is a legitimate miss: correct=False, but VALID and unflagged. Marking it
        # invalid would treat running out of time as a tampering signal.
        if submission.get("timed_out"):
            return RoundJudgement(correct=False, time_frac=0.0, valid=True, flags=[])
        tap = submission.get("tap") or {}
        flags: list[str] = []
        valid = True
        try:
            x, y = float(tap["x"]), float(tap["y"])
        except (KeyError, TypeError, ValueError):
            x = y = -1.0
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            # Taps are normalized image coordinates; anything else is not a real tap.
            valid = False
            flags.append("tap_out_of_range")
        hit = valid and hit_test(
            server_answer["bbox"], x, y, float(server_answer["tolerance_frac"])
        )
        elapsed = clamp_elapsed_ms(submission.get("elapsed_ms"), self.time_limit_ms)
        time_frac = (self.time_limit_ms - elapsed) / self.time_limit_ms
        return RoundJudgement(correct=hit, time_frac=time_frac, valid=valid, flags=flags)
