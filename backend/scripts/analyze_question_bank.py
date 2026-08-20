"""READ-ONLY question-bank analyzer — the measurement pass behind the perfect-trivia audit.

Produces a precise diagnostic of the Rot Royale trivia bank so the content-cleanup and
content-generation work (docs/content/rot-royale-perfect-trivia-audit.md) can be driven by numbers
instead of vibes. It:

  - reads the LIVE questions table (SELECT only) when the DB is reachable,
  - reads the committed source banks (content/bank/*.json, ingest format) as a fallback,
  - compares the two when both are available (the DB is usually a superset of the files),

and writes two report artifacts:

  - docs/content/question-bank-analysis.md    (human report, 12 sections)
  - docs/content/question-bank-analysis.json  (machine-readable, same numbers)

STRICTLY READ-ONLY. It issues no INSERT / UPDATE / DELETE, runs no migrations, and touches no
gameplay logic. The only writes are the two report files above.

Important framing (see rot-royale-perfect-trivia-audit.md and app/modules/trivia.py):
the source banks skew their correct answer toward position A, but the live serve path SHUFFLES the
four options server-side (deterministic per (shuffle_seed, question_id)) and remaps correctIndex —
so answer-position skew is NOT a live cheat vector. Section 4 measures the *source* position purely
as an authoring / review-hygiene signal.

Run (from backend/):
    uv run python scripts/analyze_question_bank.py
    uv run python scripts/analyze_question_bank.py --source files   # force source-file analysis
    uv run python scripts/analyze_question_bank.py --source db       # force DB analysis

Everything here is deterministic: no timestamps, all collections sorted by stable keys, so a re-run
on an unchanged bank yields a byte-identical report.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from statistics import mean
from typing import Any

# scripts/ -> backend/ -> repo root. Derived from this file so it works from any CWD.
_SCRIPTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPTS_DIR.parent
_REPO_ROOT = _BACKEND_DIR.parent
_BANK_DIR = _BACKEND_DIR / "content" / "bank"
_DOCS_DIR = _REPO_ROOT / "docs" / "content"
_REPORT_MD = _DOCS_DIR / "question-bank-analysis.md"
_REPORT_JSON = _DOCS_DIR / "question-bank-analysis.json"

# ── Canonical categories + content targets ──────────────────────────────────────────────────────
# The eight-category locked set (mirrors content/categories.py; hard-coded so file-only mode needs
# no app import). Order = the display / report order.
CATEGORIES: tuple[str, ...] = (
    "Science & Nature",
    "History",
    "Geography",
    "Arts & Literature",
    "Sports",
    "Pop Culture & Entertainment",
    "Money & Business",
    "Street Smarts",
)

# The two categories that are the product's differentiator — judged harder throughout.
FLAGSHIP_CATEGORIES = ("Money & Business", "Street Smarts")

# Target bank depth per category (from the audit). The six general categories are ~deep enough; the
# two flagships are badly underbuilt and are the priority.
TARGET_COUNTS: dict[str, int] = {
    "Science & Nature": 120,
    "History": 120,
    "Geography": 120,
    "Arts & Literature": 120,
    "Sports": 120,
    "Pop Culture & Entertainment": 120,
    "Money & Business": 250,
    "Street Smarts": 200,
}

# Ideal easy/medium/hard split. General = 40/40/20; flagships lean medium (35/45/20).
DEFAULT_DIFFICULTY_TARGET = (0.40, 0.40, 0.20)
DIFFICULTY_TARGETS: dict[str, tuple[float, float, float]] = {
    "Money & Business": (0.35, 0.45, 0.20),
    "Street Smarts": (0.35, 0.45, 0.20),
}
DIFFICULTIES = ("easy", "medium", "hard")

# ── Explanation standard (from the audit §8) ────────────────────────────────────────────────────
EXPL_MIN_CHARS = 40
EXPL_MIN_WORDS = 8
EXPL_TARGET_WORDS = (12, 28)  # sweet spot
EXPL_MAX_WORDS = 45

# ── Stem standard ───────────────────────────────────────────────────────────────────────────────
STEM_MAX_WORDS = 22
STEM_MIN_WORDS = 4

# Generic recall openers — a stem that begins with one of these and isn't a scenario reads like
# school trivia. Longest phrases first so matching is greedy-correct.
GENERIC_OPENERS = (
    "what is the",
    "what was the",
    "what are the",
    "which of the following",
    "who is the",
    "who was the",
    "where is the",
    "where was the",
    "in what year",
    "what year",
    "what does the",
    "how many",
    "when did",
    "when was",
    "what is",
    "what was",
    "who is",
    "who was",
    "which",
    "where is",
    "name the",
)

# Second-person / setup markers → the stem frames a real situation (fun, practical).
SCENARIO_MARKERS = (
    "you ",
    "your ",
    "you're",
    "youre",
    "imagine",
    "suppose",
    "a friend",
    "a stranger",
    "a salesperson",
    "a caller",
    "a text",
    "a store",
)

# Connectives / cue words that signal an explanation carries a *why* or a *takeaway* rather than
# just restating the fact.
TAKEAWAY_CUES = (
    "because",
    "so ",
    "since",
    "which means",
    "means that",
    "that's why",
    "thats why",
    "so that",
    "rule",
    "tip:",
    "remember",
    "avoid",
    "always",
    "never",
    "the trick",
    "the tell",
    "the catch",
    "counter",
    "in short",
    "makes",
    "leads to",
    "results in",
)

# Practical-usefulness keyword field (rough): does the content touch a real decision/life skill.
PRACTICAL_KEYWORDS = (
    "money",
    "price",
    "cost",
    "pay",
    "interest",
    "loan",
    "debt",
    "credit",
    "invest",
    "scam",
    "fraud",
    "negotiat",
    "discount",
    "budget",
    "save",
    "tax",
    "contract",
    "refund",
    "warranty",
    "subscription",
    "risk",
    "safe",
    "password",
    "phishing",
    "review",
    "manipulat",
    "pressure",
    "decision",
)

JUNK_OPTION_PATTERNS = ("all of the above", "none of the above", "both a and b", "all of these")

# Fuzzy-duplicate thresholds (stdlib difflib + token Jaccard — no external dependency).
NEARDUP_SEQ_RATIO = 0.82  # difflib character-sequence similarity on the normalized stem
NEARDUP_JACCARD = 0.55  # token-set overlap; both must hold to call it a near-duplicate

_BAR = "=" * 64
WARNING_BANNER = f"{_BAR}\n  READ-ONLY QUESTION BANK ANALYSIS - no data is modified\n{_BAR}"


# ── Record model ────────────────────────────────────────────────────────────────────────────────
@dataclass
class Record:
    """One normalized question, from either the DB or a source file, plus derived quality flags."""

    origin: str  # "db" | "file"
    ident: str  # db uuid, or "<file>#<index>"
    category: str
    difficulty: str
    status: str  # db status; files are implicitly "approved"
    stem: str
    options: list[str]
    correct_index: int  # SOURCE position (pre-shuffle)
    explanation: str
    source_file: str = ""

    # Derived (filled by annotate()).
    norm_stem: str = ""
    stem_tokens: frozenset[str] = frozenset()
    stem_words: int = 0
    expl_chars: int = 0
    expl_words: int = 0
    correct_letter: str = ""
    correct_option: str = ""
    is_scenario: bool = False
    is_generic_opener: bool = False
    is_pure_recall: bool = False
    is_practical: bool = False
    expl_missing: bool = False
    expl_too_short_chars: bool = False
    expl_too_short_words: bool = False
    expl_too_long_words: bool = False
    expl_restates: bool = False
    expl_no_takeaway: bool = False
    dup_options: bool = False
    correct_much_longer: bool = False
    junk_option: bool = False
    empty_option: bool = False
    flags: list[str] = field(default_factory=list)


# ── Text helpers ────────────────────────────────────────────────────────────────────────────────
def _normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace (the dedupe normalization)."""
    lowered = re.sub(r"[^\w\s]", " ", text.lower())
    return re.sub(r"\s+", " ", lowered).strip()


def _tokens(text: str) -> frozenset[str]:
    return frozenset(re.findall(r"[a-z0-9]+", text.lower()))


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text.strip()))


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


# ── Loaders ─────────────────────────────────────────────────────────────────────────────────────
def load_file_records() -> tuple[list[Record], list[str]]:
    """Read every content/bank/*.json (ingest format). Returns (records, warnings)."""
    records: list[Record] = []
    warnings: list[str] = []
    if not _BANK_DIR.is_dir():
        warnings.append(f"bank directory not found: {_BANK_DIR}")
        return records, warnings
    for path in sorted(_BANK_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            warnings.append(f"could not read {path.name}: {exc}")
            continue
        if not isinstance(data, list):
            warnings.append(f"{path.name}: not a JSON array — skipped")
            continue
        for i, row in enumerate(data):
            if not isinstance(row, dict):
                warnings.append(f"{path.name}#{i}: row is not an object — skipped")
                continue
            try:
                options = [str(o) for o in row.get("options", [])]
                records.append(
                    Record(
                        origin="file",
                        ident=f"{path.name}#{i}",
                        category=str(row.get("category", "")).strip(),
                        difficulty=str(row.get("difficulty", "")).strip().lower(),
                        status="approved",  # files are pre-reviewed before ingest
                        stem=str(row.get("question", "")).strip(),
                        options=options,
                        correct_index=int(row.get("correct_index", -1)),
                        explanation=str(row.get("explanation") or "").strip(),
                        source_file=path.name,
                    )
                )
            except (TypeError, ValueError) as exc:
                warnings.append(f"{path.name}#{i}: malformed row ({exc}) — skipped")
    return records, warnings


async def load_db_records() -> tuple[list[Record], list[str]]:
    """SELECT every trivia question from the live DB. Returns (records, warnings).

    Read-only: a single SELECT via the ORM. Any connection/import failure degrades to an empty
    result with a warning so the caller can fall back to the source files.
    """
    records: list[Record] = []
    warnings: list[str] = []
    try:
        from app.core.db import SessionLocal, engine
        from app.models import Question
        from sqlalchemy import select
    except Exception as exc:  # pragma: no cover - env-dependent
        warnings.append(f"DB layer unavailable ({type(exc).__name__}: {exc})")
        return records, warnings

    try:
        async with SessionLocal() as session:
            rows = (
                await session.execute(
                    select(
                        Question.id,
                        Question.category,
                        Question.difficulty,
                        Question.status,
                        Question.payload,
                        Question.explanation,
                    )
                    .where(Question.module_type == "trivia")
                    .order_by(Question.id)  # stable order → deterministic report
                )
            ).all()
        for qid, category, difficulty, status, payload, explanation in rows:
            payload = payload or {}
            try:
                options = [str(o) for o in payload.get("options", [])]
                records.append(
                    Record(
                        origin="db",
                        ident=str(qid),
                        category=str(category or "").strip(),
                        difficulty=str(difficulty or "").strip().lower(),
                        status=str(status or "").strip(),
                        stem=str(payload.get("prompt", "")).strip(),
                        options=options,
                        correct_index=int(payload.get("correctIndex", -1)),
                        explanation=str(explanation or "").strip(),
                    )
                )
            except (TypeError, ValueError) as exc:
                warnings.append(f"db row {qid}: malformed payload ({exc}) — skipped")
    except Exception as exc:  # pragma: no cover - env-dependent
        warnings.append(f"DB not reachable ({type(exc).__name__}: {str(exc)[:160]})")
    finally:
        try:
            await engine.dispose()
        except Exception:  # pragma: no cover
            pass
    return records, warnings


# ── Per-record annotation ───────────────────────────────────────────────────────────────────────
def annotate(records: list[Record]) -> None:
    """Fill every derived field / quality flag on each record. Pure per-record heuristics."""
    for r in records:
        r.norm_stem = _normalize(r.stem)
        r.stem_tokens = _tokens(r.stem)
        r.stem_words = _word_count(r.stem)
        r.expl_chars = len(r.explanation)
        r.expl_words = _word_count(r.explanation)

        n_opts = len(r.options)
        if 0 <= r.correct_index < n_opts:
            r.correct_letter = "ABCD"[r.correct_index] if r.correct_index < 4 else "?"
            r.correct_option = r.options[r.correct_index]
        else:
            r.correct_letter = "?"
            r.correct_option = ""

        low_stem = r.norm_stem
        r.is_scenario = any(m in (" " + low_stem + " ") for m in SCENARIO_MARKERS)
        r.is_generic_opener = any(low_stem.startswith(op) for op in GENERIC_OPENERS)
        r.is_pure_recall = r.is_generic_opener and not r.is_scenario
        haystack = (r.stem + " " + r.explanation).lower()
        r.is_practical = any(kw in haystack for kw in PRACTICAL_KEYWORDS)

        # Explanation quality flags.
        r.expl_missing = r.expl_chars == 0
        r.expl_too_short_chars = 0 < r.expl_chars < EXPL_MIN_CHARS
        r.expl_too_short_words = 0 < r.expl_words < EXPL_MIN_WORDS
        r.expl_too_long_words = r.expl_words > EXPL_MAX_WORDS
        r.expl_restates = _restates_answer(r)
        r.expl_no_takeaway = _lacks_takeaway(r)

        # Option / distractor flags.
        norm_opts = [_normalize(o) for o in r.options]
        r.empty_option = any(not o for o in norm_opts)
        r.dup_options = len(norm_opts) != len(set(norm_opts))
        r.junk_option = any(any(pat in o for pat in JUNK_OPTION_PATTERNS) for o in norm_opts)
        r.correct_much_longer = _correct_much_longer(r)

        r.flags = _collect_flags(r)


def _restates_answer(r: Record) -> bool:
    """Explanation just parrots the correct option (no added 'why')."""
    if not r.explanation or not r.correct_option:
        return False
    if SequenceMatcher(None, _normalize(r.explanation), _normalize(r.correct_option)).ratio() > 0.6:
        return True
    # Short explanation whose content is almost entirely the answer's own tokens.
    opt_tokens = _tokens(r.correct_option)
    expl_tokens = _tokens(r.explanation)
    if opt_tokens and r.expl_words <= 12:
        extra = expl_tokens - opt_tokens
        # Fewer than 4 genuinely new content words beyond the answer → a restatement.
        if len(extra) < 4:
            return True
    return False


def _lacks_takeaway(r: Record) -> bool:
    """A present-but-thin explanation with no why/takeaway cue."""
    if r.expl_missing or r.expl_too_short_chars:
        return False  # already covered by the harsher flags
    if r.expl_words > 18:
        return False  # long enough to almost certainly carry a why
    low = r.explanation.lower()
    return not any(cue in low for cue in TAKEAWAY_CUES)


def _correct_much_longer(r: Record) -> bool:
    """Distractor tell: the correct option is conspicuously longer than the wrong ones."""
    if not r.correct_option or len(r.options) < 2:
        return False
    others = [o for i, o in enumerate(r.options) if i != r.correct_index and o]
    if not others:
        return False
    avg_other = mean(len(o) for o in others)
    longest_other = max(len(o) for o in others)
    return len(r.correct_option) >= 1.6 * avg_other and len(r.correct_option) > longest_other + 8


def _collect_flags(r: Record) -> list[str]:
    flags: list[str] = []
    if r.category not in CATEGORIES:
        flags.append("noncanonical_category")
    if r.difficulty not in DIFFICULTIES:
        flags.append("bad_difficulty")
    if not (0 <= r.correct_index < len(r.options)):
        flags.append("bad_correct_index")
    if len(r.options) != 4:
        flags.append("not_four_options")
    if r.empty_option:
        flags.append("empty_option")
    if r.dup_options:
        flags.append("duplicate_options")
    if r.junk_option:
        flags.append("junk_option")
    if r.correct_much_longer:
        flags.append("correct_much_longer")
    if r.expl_missing:
        flags.append("explanation_missing")
    if r.expl_too_short_chars:
        flags.append("explanation_short_chars")
    if r.expl_too_short_words:
        flags.append("explanation_short_words")
    if r.expl_too_long_words:
        flags.append("explanation_too_long")
    if r.expl_restates:
        flags.append("explanation_restates_answer")
    if r.expl_no_takeaway:
        flags.append("explanation_no_takeaway")
    if r.stem_words > STEM_MAX_WORDS:
        flags.append("stem_too_long")
    if r.stem_words < STEM_MIN_WORDS:
        flags.append("stem_too_short")
    if r.is_pure_recall:
        flags.append("pure_recall")
    return flags


def _explanation_badness(r: Record) -> int:
    score = 0
    if r.expl_missing:
        score += 100
    if r.expl_too_short_chars:
        score += 40
    if r.expl_restates:
        score += 30
    if r.expl_too_short_words:
        score += 20
    if r.expl_no_takeaway:
        score += 15
    if r.expl_too_long_words:
        score += 10
    return score


def _homework_smell(r: Record) -> int:
    """Higher = reads more like generic school trivia / quiz filler."""
    score = 0
    if r.is_generic_opener:
        score += 2
    if r.is_pure_recall:
        score += 2
    if not r.is_scenario:
        score += 1
    if not r.is_practical:
        score += 1
    if r.expl_missing or r.expl_too_short_chars or r.expl_restates or r.expl_no_takeaway:
        score += 2
    return score


# ── Duplicate detection (union-find over exact + fuzzy pairs) ────────────────────────────────────
class _DisjointSet:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def find_duplicates(records: list[Record]) -> dict[str, Any]:
    """Cluster exact + near-duplicate stems. O(n^2) with cheap pre-rejects — fine for ~1k rows."""
    n = len(records)
    ds = _DisjointSet(n)
    exact_pairs = 0
    near_pairs = 0

    # Exact duplicates by normalized stem (bucket → union all in the bucket).
    by_norm: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(records):
        if r.norm_stem:
            by_norm[r.norm_stem].append(i)
    for idxs in by_norm.values():
        for j in idxs[1:]:
            ds.union(idxs[0], j)
            exact_pairs += 1

    # Near-duplicates: compare every pair with quick rejects, then difflib + Jaccard.
    for i in range(n):
        ri = records[i]
        if not ri.norm_stem:
            continue
        li = len(ri.norm_stem)
        for j in range(i + 1, n):
            rj = records[j]
            if not rj.norm_stem or ri.norm_stem == rj.norm_stem:
                continue
            lj = len(rj.norm_stem)
            if min(li, lj) / max(li, lj) < 0.6:  # length-ratio pre-reject
                continue
            jac = _jaccard(ri.stem_tokens, rj.stem_tokens)
            if jac < 0.4:  # token pre-reject (cheap) before the costlier ratio
                continue
            if jac >= NEARDUP_JACCARD:
                ratio = SequenceMatcher(None, ri.norm_stem, rj.norm_stem).ratio()
                if ratio >= NEARDUP_SEQ_RATIO:
                    ds.union(i, j)
                    near_pairs += 1

    # Assemble clusters of size >= 2.
    clusters: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        clusters[ds.find(i)].append(i)

    groups: list[dict[str, Any]] = []
    cross_category = 0
    for members in clusters.values():
        if len(members) < 2:
            continue
        recs = [records[m] for m in members]
        cats = sorted({r.category for r in recs})
        diffs = sorted({r.difficulty for r in recs})
        is_exact = len({r.norm_stem for r in recs}) == 1
        if len(cats) > 1:
            cross_category += 1
        groups.append(
            {
                "kind": "exact" if is_exact else "near",
                "size": len(recs),
                "categories": cats,
                "difficulties": diffs,
                "cross_category": len(cats) > 1,
                "recommendation": _dup_recommendation(is_exact, len(cats) > 1),
                "stems": sorted(r.stem for r in recs),
                "idents": sorted(r.ident for r in recs),
            }
        )
    # Deterministic order: exact first, then largest, then alphabetical by first stem.
    groups.sort(key=lambda g: (g["kind"] != "exact", -g["size"], g["stems"][0]))
    return {
        "exact_pairs": exact_pairs,
        "near_pairs": near_pairs,
        "cross_category_groups": cross_category,
        "group_count": len(groups),
        "questions_in_groups": sum(g["size"] for g in groups),
        "groups": groups,
    }


def _dup_recommendation(is_exact: bool, cross_cat: bool) -> str:
    if is_exact and cross_cat:
        return "delete — same question served in two categories"
    if is_exact:
        return "delete duplicate — keep one"
    if cross_cat:
        return "rewrite or delete — near-identical concept across categories"
    return "merge/rewrite — near-identical wording"


# ── Aggregate analyses ──────────────────────────────────────────────────────────────────────────
def _pct(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 1) if whole else 0.0


def analyze_categories(records: list[Record]) -> list[dict[str, Any]]:
    total = len(records)
    by_cat: dict[str, list[Record]] = {c: [] for c in CATEGORIES}
    for r in records:
        by_cat.setdefault(r.category, []).append(r)
    out: list[dict[str, Any]] = []

    def _cat_order(c: str) -> tuple[int, int, str]:
        return (c not in CATEGORIES, CATEGORIES.index(c) if c in CATEGORIES else 0, c)

    for cat in sorted(by_cat, key=_cat_order):
        recs = by_cat[cat]
        count = len(recs)
        diff_counts = Counter(r.difficulty for r in recs)
        target = TARGET_COUNTS.get(cat, 120)
        if count < 0.4 * target:
            state = "CRITICALLY UNDERBUILT"
        elif count < 0.7 * target:
            state = "underbuilt"
        elif count > 1.4 * target:
            state = "overbuilt"
        else:
            state = "healthy"
        out.append(
            {
                "category": cat,
                "count": count,
                "pct_of_bank": _pct(count, total),
                "easy": diff_counts.get("easy", 0),
                "medium": diff_counts.get("medium", 0),
                "hard": diff_counts.get("hard", 0),
                "other_difficulty": sum(v for k, v in diff_counts.items() if k not in DIFFICULTIES),
                "target": target,
                "deficit": max(0, target - count),
                "state": state,
                "is_flagship": cat in FLAGSHIP_CATEGORIES,
            }
        )
    return out


def analyze_difficulty(records: list[Record]) -> list[dict[str, Any]]:
    by_cat: dict[str, list[Record]] = defaultdict(list)
    for r in records:
        by_cat[r.category].append(r)
    out: list[dict[str, Any]] = []
    for cat in [c for c in CATEGORIES if c in by_cat] + sorted(
        c for c in by_cat if c not in CATEGORIES
    ):
        recs = by_cat[cat]
        count = len(recs)
        e = sum(1 for r in recs if r.difficulty == "easy")
        m = sum(1 for r in recs if r.difficulty == "medium")
        h = sum(1 for r in recs if r.difficulty == "hard")
        te, tm, th = DIFFICULTY_TARGETS.get(cat, DEFAULT_DIFFICULTY_TARGET)
        hard_pct = _pct(h, count)
        supports_progression = e > 0 and m > 0 and h > 0 and hard_pct >= 12
        out.append(
            {
                "category": cat,
                "count": count,
                "easy_pct": _pct(e, count),
                "medium_pct": _pct(m, count),
                "hard_pct": hard_pct,
                "target": f"{int(te * 100)}/{int(tm * 100)}/{int(th * 100)}",
                "hard_too_thin": hard_pct < 12,
                "supports_progression": supports_progression,
            }
        )
    return out


def analyze_positions(records: list[Record]) -> dict[str, Any]:
    letters = ["A", "B", "C", "D"]
    overall = Counter(r.correct_letter for r in records if r.correct_letter in letters)
    per_cat: dict[str, Counter[str]] = defaultdict(Counter)
    per_diff: dict[str, Counter[str]] = defaultdict(Counter)
    for r in records:
        if r.correct_letter in letters:
            per_cat[r.category][r.correct_letter] += 1
            per_diff[r.difficulty][r.correct_letter] += 1

    def _dist(counter: Counter[str]) -> dict[str, Any]:
        tot = sum(counter.values())
        counts = {ltr: counter.get(ltr, 0) for ltr in letters}
        pcts = {ltr: _pct(counts[ltr], tot) for ltr in letters}
        skew = [ltr for ltr in letters if pcts[ltr] > 40.0]
        unused = [ltr for ltr in letters if counts[ltr] == 0]
        return {"total": tot, "counts": counts, "pcts": pcts, "over_40": skew, "unused": unused}

    cat_rows = {cat: _dist(per_cat[cat]) for cat in CATEGORIES if cat in per_cat}
    for cat in sorted(c for c in per_cat if c not in CATEGORIES):
        cat_rows[cat] = _dist(per_cat[cat])
    diff_rows = {d: _dist(per_diff[d]) for d in DIFFICULTIES if d in per_diff}

    flagged = {cat: dist for cat, dist in cat_rows.items() if dist["over_40"] or dist["unused"]}
    return {
        "overall": _dist(overall),
        "per_category": cat_rows,
        "per_difficulty": diff_rows,
        "flagged_categories": sorted(flagged),
    }


def analyze_explanations(records: list[Record]) -> dict[str, Any]:
    total = len(records)
    with_expl = [r for r in records if not r.expl_missing]
    by_cat: dict[str, list[Record]] = defaultdict(list)
    for r in records:
        by_cat[r.category].append(r)

    per_cat: list[dict[str, Any]] = []
    for cat in [c for c in CATEGORIES if c in by_cat] + sorted(
        c for c in by_cat if c not in CATEGORIES
    ):
        recs = by_cat[cat]
        present = [r for r in recs if not r.expl_missing]
        short = sum(1 for r in recs if r.expl_too_short_chars or r.expl_too_short_words)
        avg_words = round(mean(r.expl_words for r in present), 1) if present else 0.0
        problems = sum(
            1
            for r in recs
            if r.expl_missing
            or r.expl_too_short_chars
            or r.expl_too_short_words
            or r.expl_restates
            or r.expl_no_takeaway
            or r.expl_too_long_words
        )
        per_cat.append(
            {
                "category": cat,
                "count": len(recs),
                "avg_words": avg_words,
                "missing": sum(1 for r in recs if r.expl_missing),
                "short": short,
                "restates": sum(1 for r in recs if r.expl_restates),
                "no_takeaway": sum(1 for r in recs if r.expl_no_takeaway),
                "too_long": sum(1 for r in recs if r.expl_too_long_words),
                "problem_rate": _pct(problems, len(recs)),
            }
        )
    # Rewrite priority = highest problem rate first (flagships break ties toward the top).
    priority = sorted(
        per_cat,
        key=lambda c: (-c["problem_rate"], c["category"] not in FLAGSHIP_CATEGORIES, c["category"]),
    )

    worst = sorted(
        records,
        key=lambda r: (-_explanation_badness(r), r.category, r.norm_stem),
    )
    worst = [r for r in worst if _explanation_badness(r) > 0][:25]
    return {
        "coverage_pct": _pct(len(with_expl), total),
        "overall_avg_words": round(mean(r.expl_words for r in with_expl), 1) if with_expl else 0.0,
        "counts": {
            "missing": sum(1 for r in records if r.expl_missing),
            "short_chars": sum(1 for r in records if r.expl_too_short_chars),
            "short_words": sum(1 for r in records if r.expl_too_short_words),
            "too_long": sum(1 for r in records if r.expl_too_long_words),
            "restates": sum(1 for r in records if r.expl_restates),
            "no_takeaway": sum(1 for r in records if r.expl_no_takeaway),
        },
        "per_category": per_cat,
        "rewrite_priority": [c["category"] for c in priority],
        "worst": [
            {
                "ident": r.ident,
                "category": r.category,
                "badness": _explanation_badness(r),
                "flags": [f for f in r.flags if f.startswith("explanation")],
                "stem": r.stem,
                "explanation": r.explanation,
            }
            for r in worst
        ],
    }


def analyze_stems(records: list[Record]) -> dict[str, Any]:
    by_cat: dict[str, list[Record]] = defaultdict(list)
    for r in records:
        by_cat[r.category].append(r)
    per_cat: list[dict[str, Any]] = []
    for cat in [c for c in CATEGORIES if c in by_cat] + sorted(
        c for c in by_cat if c not in CATEGORIES
    ):
        recs = by_cat[cat]
        count = len(recs)
        per_cat.append(
            {
                "category": cat,
                "count": count,
                "avg_words": round(mean(r.stem_words for r in recs), 1) if recs else 0.0,
                "scenario_pct": _pct(sum(1 for r in recs if r.is_scenario), count),
                "pure_recall_pct": _pct(sum(1 for r in recs if r.is_pure_recall), count),
                "over_22": sum(1 for r in recs if r.stem_words > STEM_MAX_WORDS),
                "under_4": sum(1 for r in recs if r.stem_words < STEM_MIN_WORDS),
            }
        )
    longest = sorted(records, key=lambda r: (-r.stem_words, r.norm_stem))[:25]
    generic = sorted(
        (r for r in records if r.is_pure_recall),
        key=lambda r: (r.stem_words, r.category, r.norm_stem),
    )[:25]
    return {
        "overall": {
            "avg_words": round(mean(r.stem_words for r in records), 1) if records else 0.0,
            "scenario_pct": _pct(sum(1 for r in records if r.is_scenario), len(records)),
            "pure_recall_pct": _pct(sum(1 for r in records if r.is_pure_recall), len(records)),
            "over_22": sum(1 for r in records if r.stem_words > STEM_MAX_WORDS),
            "under_4": sum(1 for r in records if r.stem_words < STEM_MIN_WORDS),
        },
        "per_category": per_cat,
        "longest": [
            {"ident": r.ident, "category": r.category, "words": r.stem_words, "stem": r.stem}
            for r in longest
        ],
        "generic": [
            {"ident": r.ident, "category": r.category, "words": r.stem_words, "stem": r.stem}
            for r in generic
        ],
    }


def analyze_options(records: list[Record]) -> dict[str, Any]:
    broken = [
        r
        for r in records
        if r.empty_option
        or r.dup_options
        or not (0 <= r.correct_index < len(r.options))
        or len(r.options) != 4
    ]
    suspicious = [r for r in records if r.junk_option or r.correct_much_longer]
    by_cat: dict[str, Counter[str]] = defaultdict(Counter)
    for r in records:
        if r.junk_option:
            by_cat[r.category]["junk_option"] += 1
        if r.correct_much_longer:
            by_cat[r.category]["correct_much_longer"] += 1
        if r.dup_options:
            by_cat[r.category]["duplicate_options"] += 1
        if r.empty_option:
            by_cat[r.category]["empty_option"] += 1

    def _fmt(r: Record) -> dict[str, Any]:
        return {
            "ident": r.ident,
            "category": r.category,
            "issues": [
                f
                for f in r.flags
                if f
                in {
                    "empty_option",
                    "duplicate_options",
                    "junk_option",
                    "correct_much_longer",
                    "not_four_options",
                    "bad_correct_index",
                }
            ],
            "stem": r.stem,
            "options": r.options,
            "correct_index": r.correct_index,
        }

    return {
        "counts": {
            "broken_sets": len(broken),
            "duplicate_options": sum(1 for r in records if r.dup_options),
            "empty_options": sum(1 for r in records if r.empty_option),
            "junk_options": sum(1 for r in records if r.junk_option),
            "correct_much_longer": sum(1 for r in records if r.correct_much_longer),
        },
        "per_category": {cat: dict(sorted(by_cat[cat].items())) for cat in sorted(by_cat)},
        "broken": [_fmt(r) for r in sorted(broken, key=lambda r: (r.category, r.norm_stem))[:25]],
        "suspicious": [
            _fmt(r) for r in sorted(suspicious, key=lambda r: (r.category, r.norm_stem))[:25]
        ],
    }


def analyze_practical(records: list[Record]) -> list[dict[str, Any]]:
    """Rough 1–10 heuristic score per category. Flagships judged against a higher bar."""
    by_cat: dict[str, list[Record]] = defaultdict(list)
    for r in records:
        by_cat[r.category].append(r)
    out: list[dict[str, Any]] = []
    for cat in [c for c in CATEGORIES if c in by_cat] + sorted(
        c for c in by_cat if c not in CATEGORIES
    ):
        recs = by_cat[cat]
        n = len(recs)
        scenario_rate = sum(1 for r in recs if r.is_scenario) / n if n else 0.0
        practical_rate = sum(1 for r in recs if r.is_practical) / n if n else 0.0
        good_expl_rate = (
            sum(
                1
                for r in recs
                if not (r.expl_missing or r.expl_too_short_chars or r.expl_restates)
                and EXPL_MIN_WORDS <= r.expl_words <= EXPL_MAX_WORDS
            )
            / n
            if n
            else 0.0
        )
        depth_score = min(1.0, n / TARGET_COUNTS.get(cat, 120))
        diff_spread = len({r.difficulty for r in recs if r.difficulty in DIFFICULTIES}) / 3

        is_flagship = cat in FLAGSHIP_CATEGORIES
        # Flagships are supposed to be scenario/practical-heavy; hold them to a higher expectation
        # by dividing their observed rate by a stricter denominator (0.7 target vs 0.4).
        bar = 0.7 if is_flagship else 0.4
        usefulness = min(10.0, 10.0 * practical_rate / bar)
        scenario = min(10.0, 10.0 * scenario_rate / bar)
        expl_use = round(10.0 * good_expl_rate, 1)
        replay = round(10.0 * (0.6 * depth_score + 0.4 * diff_spread), 1)
        brand_fit = 10.0 if is_flagship else 6.0
        # Brand fit for flagships is *potential*; discount by how underbuilt/under-practical it is.
        if is_flagship:
            brand_fit = round(10.0 * (0.5 * depth_score + 0.5 * min(1.0, practical_rate / 0.7)), 1)
        overall = round(
            mean([min(10.0, usefulness), min(10.0, scenario), expl_use, replay, brand_fit]), 1
        )
        out.append(
            {
                "category": cat,
                "count": n,
                "practical_usefulness": round(min(10.0, usefulness), 1),
                "scenario_rate": round(min(10.0, scenario), 1),
                "explanation_usefulness": expl_use,
                "replay_value": replay,
                "brand_fit": brand_fit,
                "overall": overall,
                "is_flagship": is_flagship,
            }
        )
    return out


def analyze_homework(records: list[Record]) -> dict[str, Any]:
    by_cat: dict[str, list[int]] = defaultdict(list)
    scored: list[tuple[int, Record]] = []
    for r in records:
        s = _homework_smell(r)
        scored.append((s, r))
        by_cat[r.category].append(s)
    per_cat = sorted(
        (
            {
                "category": cat,
                "count": len(scores),
                "avg_smell": round(mean(scores), 2) if scores else 0.0,
                "flagged_pct": _pct(sum(1 for s in scores if s >= 5), len(scores)),
            }
            for cat, scores in by_cat.items()
        ),
        key=lambda c: (-c["avg_smell"], c["category"]),
    )
    candidates = [
        {
            "ident": r.ident,
            "category": r.category,
            "smell": s,
            "stem": r.stem,
        }
        for s, r in sorted(scored, key=lambda t: (-t[0], t[1].category, t[1].norm_stem))
        if s >= 5
    ][:50]
    return {"per_category": per_cat, "candidates": candidates}


# ── Report assembly ─────────────────────────────────────────────────────────────────────────────
def build_analysis(
    primary: list[Record],
    primary_source: str,
    db_count: int | None,
    file_count: int | None,
    warnings: list[str],
) -> dict[str, Any]:
    categories = analyze_categories(primary)
    difficulty = analyze_difficulty(primary)
    positions = analyze_positions(primary)
    explanations = analyze_explanations(primary)
    stems = analyze_stems(primary)
    options = analyze_options(primary)
    practical = analyze_practical(primary)
    homework = analyze_homework(primary)
    duplicates = find_duplicates(primary)

    approved = sum(1 for r in primary if r.status in ("approved", "live"))
    biggest_gaps = sorted(
        (c for c in categories if c["deficit"] > 0),
        key=lambda c: -c["deficit"],
    )[:3]

    return {
        "meta": {
            "primary_source": primary_source,
            "primary_count": len(primary),
            "db_count": db_count,
            "file_count": file_count,
            "servable_count": approved,
            "warnings": warnings,
        },
        "categories": categories,
        "difficulty": difficulty,
        "positions": positions,
        "explanations": explanations,
        "stems": stems,
        "options": options,
        "practical": practical,
        "homework": homework,
        "duplicates": duplicates,
        "biggest_gaps": biggest_gaps,
    }


def _table(headers: list[str], rows: list[list[Any]]) -> str:
    line1 = "| " + " | ".join(headers) + " |"
    line2 = "| " + " | ".join("---" for _ in headers) + " |"
    body = "\n".join("| " + " | ".join(str(c) for c in row) + " |" for row in rows)
    return "\n".join([line1, line2, body]) if rows else line1 + "\n" + line2


def render_markdown(a: dict[str, Any]) -> str:  # noqa: C901 - one long deterministic renderer
    m = a["meta"]
    out: list[str] = []
    p = out.append

    p("# Rot Royale — Question Bank Analysis")
    p("")
    p(
        "> Generated by `backend/scripts/analyze_question_bank.py` (READ-ONLY). "
        "Companion to `rot-royale-perfect-trivia-audit.md`. Deterministic — re-running on an "
        "unchanged bank reproduces this file byte-for-byte."
    )
    p("")
    src = m["primary_source"]
    p(
        f"**Primary data source:** `{src}` · analyzed **{m['primary_count']}** questions"
        + (f" · DB total **{m['db_count']}**" if m["db_count"] is not None else "")
        + (f" · source files **{m['file_count']}**" if m["file_count"] is not None else "")
    )
    if m["warnings"]:
        p("")
        p("**Runtime notes:**")
        for w in m["warnings"]:
            p(f"- {w}")
    p("")

    # 1. Executive summary
    p("## 1. Executive summary")
    p("")
    p(f"- **Total questions analyzed:** {m['primary_count']} (source: `{src}`)")
    p(f"- **Servable (approved/live):** {m['servable_count']}")
    if m["db_count"] is not None and m["file_count"] is not None:
        diff = m["db_count"] - m["file_count"]
        p(
            f"- **DB vs source files:** DB has {m['db_count']}, files have {m['file_count']} "
            f"→ **{diff:+d}** in the DB not represented by committed banks "
            f"({'drift — recover into repo banks' if diff > 0 else 'in sync'})."
        )
    p("- **Biggest content gaps:**")
    for g in a["biggest_gaps"]:
        p(
            f"  - **{g['category']}** — {g['count']}/{g['target']} "
            f"(deficit {g['deficit']}, {g['state']})"
        )
    ex = a["explanations"]
    op = a["options"]
    dup = a["duplicates"]
    p("- **Highest-risk quality issues:**")
    p(
        f"  - Explanations: {ex['counts']['missing']} missing, "
        f"{ex['counts']['short_chars']} under {EXPL_MIN_CHARS} chars, "
        f"{ex['counts']['restates']} restate the answer, "
        f"{ex['counts']['no_takeaway']} lack a takeaway."
    )
    p(
        f"  - Duplicates: {dup['group_count']} clusters covering {dup['questions_in_groups']} "
        f"questions ({dup['cross_category_groups']} cross-category)."
    )
    p(
        f"  - Options: {op['counts']['broken_sets']} broken sets, "
        f"{op['counts']['junk_options']} 'all/none of the above', "
        f"{op['counts']['correct_much_longer']} where the correct option is a length-tell."
    )
    p(
        f"  - Stems: {a['stems']['overall']['pure_recall_pct']}% pure recall, "
        f"only {a['stems']['overall']['scenario_pct']}% scenario-framed."
    )
    p("")
    p("### Top 10 recommended fixes")
    for i, fix in enumerate(_top_fixes(a), 1):
        p(f"{i}. {fix}")
    p("")

    # 2. Category balance
    p("## 2. Category balance")
    p("")
    p(
        "Targets from the audit: general categories ~120; **Money & Business 250**, "
        "**Street Smarts 200** (the differentiators)."
    )
    p("")
    rows = [
        [
            ("**" + c["category"] + "**") if c["is_flagship"] else c["category"],
            c["count"],
            c["easy"],
            c["medium"],
            c["hard"],
            f"{c['pct_of_bank']}%",
            c["target"],
            c["deficit"],
            c["state"],
        ]
        for c in a["categories"]
    ]
    p(
        _table(
            ["Category", "Total", "Easy", "Med", "Hard", "% Bank", "Target", "Deficit", "State"],
            rows,
        )
    )
    p("")
    for c in a["categories"]:
        if c["is_flagship"]:
            p(
                f"- ⚑ **{c['category']}** — {c['count']} questions ({c['state']}). "
                f"Deficit to target: **{c['deficit']}**. This is a flagship differentiator and the "
                f"single highest-ROI place to add content."
            )
    p("")

    # 3. Difficulty balance
    p("## 3. Difficulty balance")
    p("")
    rows = [
        [
            d["category"],
            d["count"],
            f"{d['easy_pct']}%",
            f"{d['medium_pct']}%",
            f"{d['hard_pct']}%",
            d["target"],
            "⚠ thin" if d["hard_too_thin"] else "ok",
            "yes" if d["supports_progression"] else "**no**",
        ]
        for d in a["difficulty"]
    ]
    p(
        _table(
            ["Category", "N", "Easy%", "Med%", "Hard%", "Target", "Hard", "Progression?"],
            rows,
        )
    )
    p("")
    p(
        "_Target splits: general 40/40/20; Money & Business and Street Smarts 35/45/20 "
        "(lean medium/scenario). 'Progression?' = has all three tiers with hard ≥ 12%._"
    )
    p("")

    # 4. Source answer-position distribution
    pos = a["positions"]
    p("## 4. Source answer-position distribution (authoring hygiene only)")
    p("")
    p(
        "> **Not a live exploit.** `app/modules/trivia.py` shuffles the four options server-side, "
        "deterministic per `(shuffle_seed, question_id)`, and remaps `correctIndex` pre-serve. "
        "Players never see the source position, so 'always pick A' cannot work in-game. This "
        "section measures the *stored* position purely as a review-quality signal."
    )
    p("")
    ov = pos["overall"]
    p(
        f"**Overall:** A={ov['counts']['A']} ({ov['pcts']['A']}%), "
        f"B={ov['counts']['B']} ({ov['pcts']['B']}%), "
        f"C={ov['counts']['C']} ({ov['pcts']['C']}%), "
        f"D={ov['counts']['D']} ({ov['pcts']['D']}%)."
    )
    p("")
    rows = [
        [
            cat,
            d["counts"]["A"],
            d["counts"]["B"],
            d["counts"]["C"],
            d["counts"]["D"],
            ", ".join(d["over_40"]) or "—",
            ", ".join(d["unused"]) or "—",
        ]
        for cat, d in pos["per_category"].items()
    ]
    p(_table(["Category", "A", "B", "C", "D", ">40%", "Unused"], rows))
    p("")
    rows = [
        [
            d,
            pos["per_difficulty"][d]["counts"]["A"],
            pos["per_difficulty"][d]["counts"]["B"],
            pos["per_difficulty"][d]["counts"]["C"],
            pos["per_difficulty"][d]["counts"]["D"],
        ]
        for d in pos["per_difficulty"]
    ]
    p("**By difficulty:**")
    p("")
    p(_table(["Difficulty", "A", "B", "C", "D"], rows))
    p("")
    if pos["flagged_categories"]:
        p(
            "**Flagged** (a source position exceeds 40% or is unused): "
            + ", ".join(f"`{c}`" for c in pos["flagged_categories"])
            + ". Rebalance the *source banks* when authoring/reseeding — the app already shuffles."
        )
    else:
        p("No category exceeds the 40% source-skew threshold.")
    p("")

    # 5. Duplicate detection
    p("## 5. Duplicate detection")
    p("")
    p(f"- Exact-duplicate stem pairs (normalized): **{dup['exact_pairs']}**")
    p(
        f"- Near-duplicate pairs (difflib ≥ {NEARDUP_SEQ_RATIO} + Jaccard ≥ {NEARDUP_JACCARD}): "
        f"**{dup['near_pairs']}**"
    )
    p(
        f"- Clusters: **{dup['group_count']}** covering **{dup['questions_in_groups']}** questions "
        f"({dup['cross_category_groups']} cross-category)."
    )
    p("")
    if dup["groups"]:
        p("_Normalization: lowercase, strip punctuation, collapse whitespace, trim._")
        p("")
        for g in dup["groups"][:30]:
            cats = ", ".join(g["categories"])
            diffs = ", ".join(g["difficulties"])
            p(
                f"- **[{g['kind']}, ×{g['size']}]** categories: {cats} · difficulties: {diffs} "
                f"· _rec: {g['recommendation']}_"
            )
            for stem in g["stems"][:4]:
                p(f"    - {stem}")
        if len(dup["groups"]) > 30:
            p(f"- …and {len(dup['groups']) - 30} more clusters (see JSON).")
    else:
        p("No exact or near-duplicate clusters detected.")
    p("")

    # 6. Explanation quality
    p("## 6. Explanation quality")
    p("")
    p(
        f"**Coverage:** {ex['coverage_pct']}% have an explanation · "
        f"**overall avg length:** {ex['overall_avg_words']} words "
        f"(target {EXPL_TARGET_WORDS[0]}–{EXPL_TARGET_WORDS[1]})."
    )
    p("")
    p(
        f"Standard (audit §8): _correct answer + why + one useful takeaway_; "
        f"{EXPL_TARGET_WORDS[0]}–{EXPL_TARGET_WORDS[1]} words; ≥ {EXPL_MIN_CHARS} chars minimum."
    )
    p("")
    rows = [
        [
            c["category"],
            c["count"],
            c["avg_words"],
            c["missing"],
            c["short"],
            c["restates"],
            c["no_takeaway"],
            c["too_long"],
            f"{c['problem_rate']}%",
        ]
        for c in ex["per_category"]
    ]
    p(
        _table(
            [
                "Category",
                "N",
                "AvgWords",
                "Missing",
                "Short",
                "Restates",
                "NoTake",
                "TooLong",
                "Prob%",
            ],
            rows,
        )
    )
    p("")
    p("**Rewrite priority (worst first):** " + " → ".join(ex["rewrite_priority"]))
    p("")
    p("**Worst 25 explanations:**")
    p("")
    for w in ex["worst"]:
        stem = w["stem"][:90] + ("…" if len(w["stem"]) > 90 else "")
        expl = w["explanation"] or "_(missing)_"
        p(f"- `{w['ident']}` [{w['category']}] (badness {w['badness']}) — **{stem}**")
        p(f"    - expl: {expl}")
    p("")

    # 7. Stem quality
    st = a["stems"]
    p("## 7. Stem quality")
    p("")
    p(
        f"**Overall:** avg {st['overall']['avg_words']} words · "
        f"{st['overall']['scenario_pct']}% scenario · "
        f"{st['overall']['pure_recall_pct']}% pure recall · "
        f"{st['overall']['over_22']} over 22 words · {st['overall']['under_4']} under 4 words."
    )
    p("")
    rows = [
        [
            c["category"],
            c["count"],
            c["avg_words"],
            f"{c['scenario_pct']}%",
            f"{c['pure_recall_pct']}%",
            c["over_22"],
            c["under_4"],
        ]
        for c in st["per_category"]
    ]
    p(
        _table(
            ["Category", "N", "AvgWords", "Scenario%", "Recall%", ">22w", "<4w"],
            rows,
        )
    )
    p("")
    p("**Longest 25 stems:**")
    p("")
    for w in st["longest"]:
        stem = w["stem"][:110] + ("…" if len(w["stem"]) > 110 else "")
        p(f"- `{w['ident']}` [{w['category']}] ({w['words']}w) — {stem}")
    p("")
    p("**Weakest / most generic-looking 25 stems (pure recall, shortest first):**")
    p("")
    for w in st["generic"]:
        p(f"- `{w['ident']}` [{w['category']}] ({w['words']}w) — {w['stem']}")
    p("")

    # 8. Option / distractor quality
    p("## 8. Option / distractor quality")
    p("")
    p(
        f"- Broken sets (empty/dup option, wrong option count, bad index): "
        f"**{op['counts']['broken_sets']}**"
    )
    p(f"- Duplicate options within a question: **{op['counts']['duplicate_options']}**")
    p(f"- Empty/null options: **{op['counts']['empty_options']}**")
    p(f"- 'All/none of the above'-style options: **{op['counts']['junk_options']}**")
    p(
        f"- Correct option is a length-tell (much longer than distractors): "
        f"**{op['counts']['correct_much_longer']}**"
    )
    p("")
    if op["per_category"]:
        p("**By category:**")
        p("")
        rows = [
            [cat, ", ".join(f"{k}={v}" for k, v in issues.items())]
            for cat, issues in op["per_category"].items()
        ]
        p(_table(["Category", "Issues"], rows))
        p("")
    if op["broken"]:
        p("**Broken option sets:**")
        for w in op["broken"]:
            p(f"- `{w['ident']}` [{w['category']}] {w['issues']} — {w['stem'][:80]}")
        p("")
    if op["suspicious"]:
        p("**Top suspicious option sets:**")
        for w in op["suspicious"]:
            p(f"- `{w['ident']}` [{w['category']}] {w['issues']} — {w['stem'][:80]}")
        p("")

    # 9. Practical intelligence score
    pr = a["practical"]
    p("## 9. Practical intelligence score (heuristic, 1–10)")
    p("")
    p(
        "_Money & Business and Street Smarts are judged against a **higher bar** (they should be "
        "scenario/practical-heavy), so weak flagship content scores lower here than the same "
        "numbers would in a general category._"
    )
    p("")
    rows = [
        [
            ("**" + c["category"] + "**") if c["is_flagship"] else c["category"],
            c["count"],
            c["practical_usefulness"],
            c["scenario_rate"],
            c["explanation_usefulness"],
            c["replay_value"],
            c["brand_fit"],
            f"**{c['overall']}**",
        ]
        for c in pr
    ]
    p(
        _table(
            ["Category", "N", "Useful", "Scenario", "ExplUse", "Replay", "BrandFit", "Overall"],
            rows,
        )
    )
    p("")

    # 10. Homework smell
    hw = a["homework"]
    p('## 10. "Homework smell" detection')
    p("")
    p(
        "_Smell = generic opener + pure recall + no scenario + no practical payoff + weak "
        "explanation. Higher = reads more like school-trivia filler._"
    )
    p("")
    rows = [
        [c["category"], c["count"], c["avg_smell"], f"{c['flagged_pct']}%"]
        for c in hw["per_category"]
    ]
    p(_table(["Category", "N", "AvgSmell", "Flagged%"], rows))
    p("")
    p(f"**{len(hw['candidates'])} rewrite-first candidates** (worst 50, highest smell first):")
    p("")
    for w in hw["candidates"]:
        p(f"- `{w['ident']}` [{w['category']}] (smell {w['smell']}) — {w['stem'][:90]}")
    p("")

    # 11. Import / pipeline recommendations
    p("## 11. Import / content-pipeline recommendations")
    p("")
    p("Turn the measured issues above into enforced gates before any new content lands.")
    p("")
    p("**Required ingest lint rules (fail the import if violated):**")
    p(
        f"- Explanation present, ≥ {EXPL_MIN_CHARS} chars **and** ≥ {EXPL_MIN_WORDS} words, "
        f"≤ {EXPL_MAX_WORDS} words."
    )
    p("- Explanation must not merely restate the correct option (difflib ratio < 0.6).")
    p("- Exactly 4 non-empty, non-duplicate options; `correct_index` in 0..3.")
    p("- No 'all/none of the above'-style options.")
    p("- Reject near-duplicate stems vs. the existing bank (difflib ≥ 0.82 + Jaccard ≥ 0.55).")
    p("- Warn when a source answer position exceeds 40% within a category being ingested.")
    p(f"- Stem within {STEM_MIN_WORDS}–{STEM_MAX_WORDS} words.")
    p("")
    p("**Category / difficulty targets to enforce over time:**")
    p("- Money & Business → 250; Street Smarts → 200; general categories ~120.")
    p("- Difficulty split: general 40/40/20; flagships 35/45/20 (hard ≥ 12%).")
    p("")
    p("**Future tag fields to add to the schema/ingest format (for personalization + review):**")
    p(
        "`category`, `difficulty`, `subtopic`, `format_type`, "
        "`cognitive_type` (recall/scenario/application/trick/calculation/judgment), "
        "`practical_value` (low/medium/high), `evergreen` (bool), `locale_specific` (bool), "
        "`explanation_quality_score`, `source`, `author`, `reviewed_by`, `approved_at`."
    )
    p("")

    # 12. Next action list
    p("## 12. Next action list")
    p("")
    p("**Before generating any new content:**")
    p("1. Land the ingest explanation lint (§11) so nothing new lands below standard.")
    p("2. De-dupe: resolve the clusters in §5 (delete exact dupes, rewrite near-dupes).")
    p("3. Rewrite the worst-25 explanations (§6) and the Street Smarts explanations to standard.")
    p("4. Rebalance source answer positions for any flagged category (§4) on the next reseed.")
    p("")
    money = next((c for c in a["categories"] if c["category"] == "Money & Business"), None)
    street = next((c for c in a["categories"] if c["category"] == "Street Smarts"), None)
    p("**Generate first (highest ROI):**")
    if money:
        p(
            f"- **Money & Business: {money['count']} → {money['target']}** "
            f"(add ~{money['deficit']}), scenario-first, 35/45/20."
        )
    if street:
        p(
            f"- **Street Smarts: {street['count']} → {street['target']}** "
            f"(add ~{street['deficit']}), tactic-named explanations, 35/45/20."
        )
    p("")
    p("**Existing content — keep / rewrite / delete:**")
    p("- **Delete:** exact-duplicate clusters (§5); broken option sets that can't be repaired.")
    p(
        "- **Rewrite:** worst-25 explanations (§6), the 50 homework-smell candidates (§10), and "
        "pure-recall stems in general categories where a scenario framing is cheap."
    )
    p(
        "- **Preserve:** everything else — the six general categories are deep enough; do not "
        "over-invest there."
    )
    p("")
    p("**CI gate before imports:**")
    p(
        "- Run the ingest lint + a near-duplicate check in CI on any `content/bank/*.json` change; "
        "fail the build on a lint violation or a new near-duplicate. Re-run this analyzer after "
        "each content batch to watch the numbers move."
    )
    p("")
    return "\n".join(out) + "\n"


def _top_fixes(a: dict[str, Any]) -> list[str]:
    """Deterministic top-10 fixes derived from the measured numbers."""
    ex = a["explanations"]
    dup = a["duplicates"]
    op = a["options"]
    money = next((c for c in a["categories"] if c["category"] == "Money & Business"), None)
    street = next((c for c in a["categories"] if c["category"] == "Street Smarts"), None)
    fixes = []
    if money:
        fixes.append(
            f"**Grow Money & Business {money['count']} → {money['target']}** "
            f"(add ~{money['deficit']}) — the emptiest flagship; highest ROI in the product."
        )
    if street:
        fixes.append(
            f"**Grow Street Smarts {street['count']} → {street['target']}** "
            f"(add ~{street['deficit']}) and rewrite its explanations to name-the-tactic standard."
        )
    fixes.append(
        f"**Fix explanations:** {ex['counts']['missing']} missing + "
        f"{ex['counts']['short_chars']} too-short + {ex['counts']['restates']} restating the "
        f"answer — enforce the §8 standard as an ingest lint."
    )
    if dup["group_count"]:
        fixes.append(
            f"**Resolve {dup['group_count']} duplicate clusters** "
            f"({dup['questions_in_groups']} questions, {dup['cross_category_groups']} "
            f"cross-category)."
        )
    fixes.append(
        f"**Rebalance source answer positions** for flagged categories "
        f"({', '.join(a['positions']['flagged_categories']) or 'none'}) — authoring hygiene, "
        f"the app already shuffles at serve time."
    )
    fixes.append(
        f"**Convert pure-recall stems to scenarios** — only "
        f"{a['stems']['overall']['scenario_pct']}% of the bank is scenario-framed."
    )
    if op["counts"]["broken_sets"] or op["counts"]["junk_options"]:
        fixes.append(
            f"**Repair {op['counts']['broken_sets']} broken option sets** and remove "
            f"{op['counts']['junk_options']} 'all/none of the above' options."
        )
    fixes.append(
        "**Add personalization tags** (subtopic, cognitive_type, practical_value, evergreen) "
        "to the ingest format for future resurfacing/mastery."
    )
    fixes.append(
        "**Stand up a CI content-lint** so new banks can't regress explanation/duplicate quality."
    )
    fixes.append(
        "**Re-run this analyzer after each content batch** to watch the numbers move toward target."
    )
    return fixes[:10]


# ── Entry point ─────────────────────────────────────────────────────────────────────────────────
async def _gather(source: str) -> tuple[list[Record], str, int | None, int | None, list[str]]:
    """Resolve the primary dataset per --source, loading DB and/or files as needed."""
    warnings: list[str] = []
    db_records: list[Record] = []
    file_records: list[Record] = []
    file_count: int | None = None

    if source in ("auto", "db"):
        db_records, db_warn = await load_db_records()
        warnings.extend(db_warn)
    if source in ("auto", "files") or (source == "auto" and not db_records):
        file_records, file_warn = load_file_records()
        warnings.extend(file_warn)
        file_count = len(file_records)

    if source == "db":
        if not db_records:
            raise SystemExit("--source db requested but the DB returned no rows (see warnings)")
        return db_records, "db", len(db_records), None, warnings
    if source == "files":
        if not file_records:
            raise SystemExit("--source files requested but no source-file questions were loaded")
        return file_records, "files", None, len(file_records), warnings

    # auto: prefer the DB (usually the superset) but always report both counts when available.
    if db_records:
        return db_records, "db", len(db_records), file_count, warnings
    if file_records:
        warnings.append("DB unavailable — fell back to committed source banks.")
        return file_records, "files", None, len(file_records), warnings
    raise SystemExit("no questions available from either the DB or the source files")


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Rot Royale question-bank analyzer.")
    parser.add_argument(
        "--source",
        choices=("auto", "db", "files"),
        default="auto",
        help="which dataset to analyze (default: auto — DB if reachable, else source files)",
    )
    args = parser.parse_args()

    print(WARNING_BANNER)

    records, primary_source, db_count, file_count, warnings = asyncio.run(_gather(args.source))
    annotate(records)
    analysis = build_analysis(records, primary_source, db_count, file_count, warnings)

    _DOCS_DIR.mkdir(parents=True, exist_ok=True)
    _REPORT_MD.write_text(render_markdown(analysis), encoding="utf-8")
    _REPORT_JSON.write_text(
        json.dumps(analysis, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Analyzed {len(records)} questions from `{primary_source}`.")
    if warnings:
        for w in warnings:
            print(f"  note: {w}")
    print(f"Wrote report:  {_REPORT_MD}")
    print(f"Wrote json:    {_REPORT_JSON}")
    print("READ-ONLY: no INSERT/UPDATE/DELETE issued; only the two report files were written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
