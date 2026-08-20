"""The public tree must contain no production challenge material (Audit 1, B-1).

Two layers, because a path check alone is trivially defeated by moving a file.

1. PATHS — the known production corpus locations must not exist.
2. SEMANTIC ALLOWLIST — every question-shaped record found anywhere in the tracked tree must
   fingerprint to one of the SAMPLE questions.

The allowlist direction matters. A denylist needs fingerprints OF THE PRODUCTION QUESTIONS
committed here, which is both a (small) reconstruction risk and blind to any production item not in
the list. Fingerprinting the SAMPLE corpus instead commits nothing sensitive and fails on ANY
unrecognised question, whether it came from the old bank, a fixture someone pasted, or a doc.

The fingerprint is `content.campaign.keys.question_key` — sha1(category + prompt)[:16], already the
repo's stable question identity, so this introduces no new scheme.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from content.campaign.keys import question_key

REPO = Path(__file__).resolve().parents[2]
SAMPLE = REPO / "backend" / "content" / "sample"

FORBIDDEN_PATHS = [
    "all_questions.md",
    "backend/content/bank",
    "backend/content/generated",
    "backend/content/proposals",
    "backend/content/translate_export",
    "backend/content/trivia.json",
    "backend/content/sample_bank.json",
    "backend/content/estimate/fermi.json",
    "backend/content/change/manifest.json",
    # Change-detection imagery. It is the only gameplay content that is FILES, and it was the last
    # thing still living in the application repo after the JSON corpus moved behind ROT_CONTENT_DIR
    # — which would have broken Change mode in production the moment a public release replaced the
    # artwork, while the backend content package remained perfectly correct.
    "frontend/public/assets/change",
]


def _tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, cwd=REPO)
    return out.stdout.split()


@pytest.mark.parametrize("rel", FORBIDDEN_PATHS)
def test_production_corpus_path_is_absent(rel: str) -> None:
    assert not (REPO / rel).exists(), f"production content present at {rel}"


def test_production_corpus_path_is_untracked() -> None:
    tracked = _tracked()
    offenders = [
        f for f in tracked if any(f == p or f.startswith(p + "/") for p in FORBIDDEN_PATHS)
    ]
    assert not offenders, f"git still tracks production content: {offenders[:10]}"


def _sample_keys() -> set[str]:
    keys = set()
    for f in (SAMPLE / "bank").glob("*.json"):
        for q in json.loads(f.read_text(encoding="utf-8")):
            keys.add(question_key(q["category"], q["question"]))
    for r in json.loads((SAMPLE / "trivia.json").read_text(encoding="utf-8")):
        keys.add(question_key(r["category"], r["prompt"]))
    # Fermi items are question-shaped too (category + prompt), so they need approving or the scan
    # below reports the sample corpus as unknown content. Found exactly that way: the guard only
    # reads TRACKED files, so these went unnoticed until they were committed.
    for r in json.loads((SAMPLE / "estimate" / "fermi.json").read_text(encoding="utf-8")):
        keys.add(question_key(r.get("category", "misc"), r["prompt"]))
    return keys


def _question_records(path: Path):
    """Yield (category, prompt) for anything question-shaped in a JSON file."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return
    stack = [data]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, dict):
            prompt = node.get("question") or node.get("prompt")
            cat = node.get("category")
            if isinstance(prompt, str) and isinstance(cat, str) and len(prompt) > 15:
                yield cat, prompt
            stack.extend(v for v in node.values() if isinstance(v, (list, dict)))


def test_every_question_in_the_tree_is_a_sample_question() -> None:
    """Semantic guard: an unrecognised question anywhere is treated as production content."""
    allow = _sample_keys()
    assert allow, "sample fingerprints could not be computed"
    unknown: list[tuple[str, str]] = []
    for rel in _tracked():
        if not rel.endswith(".json"):
            continue
        p = REPO / rel
        if not p.is_file():
            continue
        for cat, prompt in _question_records(p):
            if question_key(cat, prompt) not in allow:
                unknown.append((rel, prompt[:60]))
    assert not unknown, (
        "question-shaped records that are not part of the synthetic sample corpus "
        f"({len(unknown)} found): {unknown[:8]}"
    )


def test_the_guard_would_actually_catch_a_production_question() -> None:
    """A guard that has never rejected anything is not evidence. This proves the allowlist rejects
    a question it does not know, without committing any real production text."""
    allow = _sample_keys()
    assert question_key("Geography", "What is the capital of Australia?") not in allow
