"""The difficulty vocabulary, owned by content rather than by the ORM.

It lived in `app/models/question.py`, which meant that validating a question bank imported the
model, which imported the database layer, which imported `app.core.config` — and importing that
CONSTRUCTS `Settings`. In production `Settings` refuses to construct until ROT_CONTENT_DIR exists,
so the content fetcher deadlocked: its whole job is to create that directory, and it could not
validate a package without one already being there. It failed the first real staging build.

Difficulty is a property of a question, not of a table, so content owns it and the model imports it.
"""

from __future__ import annotations

QUESTION_DIFFICULTIES: tuple[str, ...] = ("easy", "medium", "hard")
