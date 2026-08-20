"""Stable, environment-independent identity for a trivia question.

`Question.id` is a random `uuid4` assigned at insert time, so it differs between every database
(local vs prod) and CANNOT be referenced from a committed campaign manifest. The campaign instead
references questions by a deterministic `question_key` derived from the question's natural identity
— `(category, prompt)` — the SAME pair the ingest dedupes on.

The key is computed identically in two places that must agree:
  - the manifest builder, from the bank files (`category`, `question`);
  - the runtime loader, from the live DB rows (`category`, `payload["prompt"]`).
Ingest stores `payload["prompt"]` verbatim from the bank's `question`, so the two inputs are equal;
the normalization below only adds resilience against incidental whitespace/case drift.
"""

from __future__ import annotations

import hashlib

_SEP = "\x1f"  # unit separator — won't appear in question text


def _normalize(text: str) -> str:
    """Collapse runs of whitespace and casefold, so trivial textual drift keeps the same key."""
    return " ".join(text.split()).casefold()


def question_key(category: str, prompt: str) -> str:
    """A 16-hex-char stable id for a question, from its (category, prompt) natural identity."""
    payload = f"{_normalize(category)}{_SEP}{_normalize(prompt)}".encode()
    return hashlib.sha1(payload).hexdigest()[:16]
