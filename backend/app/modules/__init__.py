"""Round modules. Importing this package activates the server-side registry: each module type
registers itself here so the contest engine can look it up by type (docs/architecture.md).

REMOVED — do not reintroduce without a product reason (docs/architecture.md §4):
  - `crowd` (crowd prediction): it cannot score honestly below a few hundred responses per prompt,
    so at launch scale every round would have been graded against a seeded distribution rather than
    a real crowd. That is the one thing Invariant 6 forbids.
  - `span` (digit span): reads as clinical brain-training, not as this game. It was never in the
    Royale pool and, once the pre-launch playtest harness stops being a player-facing route, had no
    way to be reached at all.
"""

from app.modules.change_detection import ChangeDetectionModule
from app.modules.estimate import EstimateModule
from app.modules.memory_flash import MemoryFlashModule
from app.modules.rapid_math import RapidMathModule
from app.modules.registry import register
from app.modules.trivia import TriviaModule

register(TriviaModule())
register(RapidMathModule())
register(MemoryFlashModule())
register(EstimateModule())
register(ChangeDetectionModule())
