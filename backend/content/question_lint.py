"""Question-content linter (content-standard gate).

The read-only analyzer (`scripts/analyze_question_bank.py`) *measures* the bank; this module
*enforces* the content standard (docs/content/question-content-standard.md) so bad content can't
enter it. It is pure and side-effect-free: it validates already-loaded question objects and returns
findings — it never touches the DB, files, or gameplay logic. The serve-time option shuffle in
`app/modules/trivia.py` is unrelated and untouched; source answer-position balance (Q029) is an
authoring-hygiene signal only, never a live exploit.

Design (the core principle):
  - EXISTING bank content predates the standard, so it runs in **report** mode (collect everything,
    never fail the process).
  - NEW imports run in **strict**/**ci** mode (fail on errors) and are held to a higher bar — the
    two flagship categories (Money & Business, Street Smarts) additionally require practical
    metadata (subtopic / cognitive_type / practical_value).

Every check has a stable, searchable rule id (Q001…Q046). Callers build `LintQuestion` objects via
the adapters (`from_bank_row`, `from_db_payload`, `from_csv_record`) and call `lint_questions`.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

from content.categories import CANONICAL_CATEGORIES

# ── Vocabulary ──────────────────────────────────────────────────────────────────────────────────
FLAGSHIP_CATEGORIES: tuple[str, ...] = ("Money & Business", "Street Smarts")
DIFFICULTIES: tuple[str, ...] = ("easy", "medium", "hard")
COGNITIVE_TYPES: tuple[str, ...] = (
    "recall",
    "scenario",
    "application",
    "trick",
    "calculation",
    "judgment",
)
PRACTICAL_VALUES: tuple[str, ...] = ("low", "medium", "high")

# Optional (future) metadata fields the linter understands. None are globally required yet.
METADATA_FIELDS: tuple[str, ...] = (
    "subtopic",
    "format_type",
    "cognitive_type",
    "practical_value",
    "evergreen",
    "locale_specific",
    "source",
    "author",
    "reviewed_by",
    "approved_at",
)

# Severity levels.
ERROR = "error"
WARNING = "warning"
INFO = "info"

# Lint modes.
MODE_REPORT = "report"  # collect all findings, never fail the process
MODE_STRICT = "strict"  # fail if any error-severity finding exists
MODE_CI = "ci"  # like strict, concise output (handled by the CLI)
MODES = (MODE_REPORT, MODE_STRICT, MODE_CI)

# Heuristic word/phrase banks (kept small + explicit; shared shapes with the analyzer).
GENERIC_OPENERS = (
    "what is the",
    "what was the",
    "what are the",
    "which of the following",
    "who is the",
    "who was the",
    "where is the",
    "in what year",
    "what year",
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
    "define",
)
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
    "a seller",
)
TAKEAWAY_CUES = (
    # Explicit content-standard cue used in generated explanations.
    "takeaway:",
    "takeaway -",
    "takeaway —",
    "the takeaway",
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
    "deal",
)
JUNK_OPTION_PATTERNS = ("all of the above", "none of the above", "both a and b", "all of these")
PLACEHOLDER_PATTERNS = (
    "lorem ipsum",
    "placeholder",
    "test question",
    "sample question",
    "todo",
    "tbd",
    "asdf",
    "qwerty",
    "xxxx",
    "foo bar",
    "example option",
    "option a",
    "option b",
    "option c",
    "option d",
)


# ── Config ──────────────────────────────────────────────────────────────────────────────────────
@dataclass
class LintConfig:
    """Thresholds + per-rule severity overrides. Defaults match the audit's content standard."""

    explanation_min_chars: int = 40
    explanation_target_words_min: int = 12
    explanation_target_words_max: int = 28
    stem_min_words: int = 4
    stem_max_words_default: int = 22
    stem_max_words_scenario: int = 32
    stem_max_chars_default: int = 140
    stem_max_chars_scenario: int = 200
    option_max_chars: int = 60
    source_answer_position_max_share: float = 0.40
    near_duplicate_similarity: float = 0.88
    correct_option_length_ratio_threshold: float = 1.8
    # Position balance (Q029) only fires on a category with at least this many rows in the batch.
    min_batch_for_position_check: int = 12
    # When True, subtopic + cognitive_type are required on EVERY new-import row (Q030), not just the
    # flagship categories. Off by default — flagship metadata (Q040-Q042) is enforced separately.
    require_metadata_all: bool = False
    # rule_id -> severity, to promote/demote any rule without editing the registry.
    severity_overrides: dict[str, str] = field(default_factory=dict)


# ── Rule registry ───────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Rule:
    id: str
    severity: str  # default severity; overridable via LintConfig.severity_overrides
    summary: str


def _r(rule_id: str, severity: str, summary: str) -> tuple[str, Rule]:
    return rule_id, Rule(rule_id, severity, summary)


RULES: dict[str, Rule] = dict(
    [
        # STRUCTURE — objective, always hard errors.
        _r("Q001", ERROR, "stem is missing or empty"),
        _r("Q002", ERROR, "category is missing or not canonical"),
        _r("Q003", ERROR, "difficulty is not one of easy/medium/hard"),
        _r("Q004", ERROR, "does not have exactly 4 answer options"),
        _r("Q005", ERROR, "one or more answer options are empty/null"),
        _r("Q006", ERROR, "duplicate options within the same question after normalization"),
        _r("Q007", ERROR, "correct answer/index missing or invalid"),
        _r("Q008", ERROR, "explanation missing"),
        _r("Q009", ERROR, "explanation under the minimum character length"),
        _r("Q010", ERROR, "stem over the character limit (non-scenario)"),
        _r("Q011", ERROR, "an option over the character limit"),
        _r("Q012", ERROR, "generated import row uses 'correctIndex' instead of 'correct_index'"),
        # QUALITY — a mix of hard errors and heuristic warnings.
        _r("Q020", ERROR, "explanation merely restates the answer"),
        _r("Q021", WARNING, "explanation has no useful takeaway signal"),
        _r("Q022", ERROR, "stem under the minimum word count"),
        _r("Q023", WARNING, "stem over the word limit (non-scenario)"),
        _r("Q024", WARNING, "correct option is conspicuously longer than the others"),
        _r("Q025", ERROR, "options include 'all of the above' / 'none of the above'"),
        _r("Q026", ERROR, "obvious placeholder / test content"),
        _r("Q027", ERROR, "exact duplicate stem after normalization"),
        _r("Q028", WARNING, "near-duplicate stem within the same category"),
        _r("Q029", WARNING, "source answer-position imbalance within the import batch"),
        _r("Q030", ERROR, "missing required target metadata (subtopic/cognitive_type)"),
        # PRACTICAL — flagship-only, evaluated for new imports.
        _r("Q040", ERROR, "flagship item missing subtopic"),
        _r("Q041", ERROR, "flagship item missing cognitive_type"),
        _r("Q042", ERROR, "flagship item missing practical_value"),
        _r("Q043", ERROR, "flagship practical_value is 'low'"),
        _r("Q044", WARNING, "flagship explanation lacks a real-world takeaway"),
        _r("Q045", WARNING, "flagship pure-recall question without a practical payoff"),
        _r("Q046", WARNING, "flagship item is too textbook / definition-only"),
    ]
)


# ── Normalized question + adapters ──────────────────────────────────────────────────────────────
@dataclass
class LintQuestion:
    ident: str
    category: str
    difficulty: str
    stem: str
    options: list[str]
    correct_index: int | None
    explanation: str
    metadata: dict[str, Any] = field(default_factory=dict)
    # Which correct-index key(s) the RAW import row used, e.g. {"correct_index": 0} or
    # {"correctIndex": 0}. Populated ONLY by the import adapters (from_bank_row / from_csv_record);
    # left None for DB / internal payloads. Powers Q012 (generated imports must use snake_case
    # `correct_index`, the ingest input key — NOT the internal payload key `correctIndex`).
    import_index_keys: dict[str, Any] | None = None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):  # bools are ints in Python; a boolean index is invalid
        return None
    if isinstance(value, int):
        return value
    return None


def _extract_metadata(row: dict[str, Any]) -> dict[str, Any]:
    return {k: row[k] for k in METADATA_FIELDS if k in row and row[k] not in (None, "")}


def from_bank_row(row: dict[str, Any], ident: str) -> LintQuestion:
    """Adapt an ingest-format bank row ({category, question, options, correct_index, ...})."""
    # Record which index key(s) the raw row carried, for Q012. Prefer the snake_case ingest key for
    # the normalized value, but fall back to the camelCase one so the OTHER rules still evaluate.
    index_keys = {k: row[k] for k in ("correct_index", "correctIndex") if k in row}
    ci = row.get("correct_index")
    if ci is None:
        ci = row.get("correctIndex")
    return LintQuestion(
        ident=ident,
        category=str(row.get("category") or "").strip(),
        difficulty=str(row.get("difficulty") or "").strip().lower(),
        stem=str(row.get("question") or row.get("prompt") or "").strip(),
        options=[str(o) for o in (row.get("options") or [])],
        correct_index=_as_int(ci),
        explanation=str(row.get("explanation") or "").strip(),
        metadata=_extract_metadata(row),
        import_index_keys=index_keys,
    )


def from_db_payload(
    ident: str,
    category: str,
    difficulty: str | None,
    explanation: str | None,
    payload: dict[str, Any] | None,
) -> LintQuestion:
    """Adapt a DB Question row (payload = {prompt, options, correctIndex})."""
    payload = payload or {}
    return LintQuestion(
        ident=ident,
        category=str(category or "").strip(),
        difficulty=str(difficulty or "").strip().lower(),
        stem=str(payload.get("prompt") or "").strip(),
        options=[str(o) for o in (payload.get("options") or [])],
        correct_index=_as_int(payload.get("correctIndex")),
        explanation=str(explanation or "").strip(),
        metadata={},
    )


def from_csv_record(record: dict[str, Any], ident: str) -> LintQuestion:
    """Adapt a CSV row. Options come from an `options` JSON column OR option_a..option_d columns."""
    import json

    raw_options = record.get("options")
    options: list[str]
    if raw_options:
        try:
            parsed = json.loads(raw_options)
            options = [str(o) for o in parsed] if isinstance(parsed, list) else [str(raw_options)]
        except (ValueError, TypeError):
            options = [str(raw_options)]
    else:
        options = [
            str(record[key])
            for key in ("option_a", "option_b", "option_c", "option_d")
            if record.get(key) not in (None, "")
        ]
    metadata = {k: record[k] for k in METADATA_FIELDS if record.get(k) not in (None, "")}
    index_keys = {
        k: _maybe_int(record[k])
        for k in ("correct_index", "correctIndex")
        if record.get(k) not in (None, "")
    }
    return LintQuestion(
        ident=ident,
        category=str(record.get("category") or "").strip(),
        difficulty=str(record.get("difficulty") or "").strip().lower(),
        stem=str(record.get("question") or record.get("prompt") or "").strip(),
        options=options,
        correct_index=_as_int(_maybe_int(record.get("correct_index"))),
        explanation=str(record.get("explanation") or "").strip(),
        metadata=metadata,
        import_index_keys=index_keys,
    )


def _maybe_int(value: Any) -> Any:
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return value


# ── Findings + result ───────────────────────────────────────────────────────────────────────────
@dataclass
class LintFinding:
    rule_id: str
    severity: str
    message: str
    ident: str
    category: str
    stem: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "severity": self.severity,
            "message": self.message,
            "ident": self.ident,
            "category": self.category,
            "stem": self.stem[:120],
        }


@dataclass
class LintResult:
    findings: list[LintFinding]
    total_questions: int
    mode: str
    is_new_import: bool
    duplicate_clusters: list[dict[str, Any]] = field(default_factory=list)
    position_balance: dict[str, Any] = field(default_factory=dict)

    def by_severity(self, severity: str) -> list[LintFinding]:
        return [f for f in self.findings if f.severity == severity]

    @property
    def error_count(self) -> int:
        return len(self.by_severity(ERROR))

    @property
    def warning_count(self) -> int:
        return len(self.by_severity(WARNING))

    @property
    def info_count(self) -> int:
        return len(self.by_severity(INFO))

    def failed(self) -> bool:
        """Whether this run should fail the process (strict/ci with any error-severity finding)."""
        return self.mode in (MODE_STRICT, MODE_CI) and self.error_count > 0

    def counts_by_rule(self) -> dict[str, int]:
        return dict(sorted(Counter(f.rule_id for f in self.findings).items()))

    def counts_by_category(self) -> dict[str, int]:
        return dict(sorted(Counter(f.category or "(none)" for f in self.findings).items()))

    def counts_by_severity(self) -> dict[str, int]:
        return {
            ERROR: self.error_count,
            WARNING: self.warning_count,
            INFO: self.info_count,
        }


# ── Text helpers ────────────────────────────────────────────────────────────────────────────────
def normalize_stem(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace (the dedupe normalization)."""
    lowered = re.sub(r"[^\w\s]", " ", text.lower())
    return re.sub(r"\s+", " ", lowered).strip()


def _tokens(text: str) -> frozenset[str]:
    return frozenset(re.findall(r"[a-z0-9]+", text.lower()))


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text.strip()))


def _is_scenario(question: LintQuestion) -> bool:
    padded = " " + normalize_stem(question.stem) + " "
    if any(marker in padded for marker in SCENARIO_MARKERS):
        return True
    return str(question.metadata.get("format_type", "")).lower() == "scenario"


def _is_generic_opener(stem_norm: str) -> bool:
    return any(stem_norm.startswith(op) for op in GENERIC_OPENERS)


def _is_practical(question: LintQuestion) -> bool:
    practical_value = str(question.metadata.get("practical_value", "")).lower()
    if practical_value in {"medium", "high"}:
        return True

    haystack = (question.stem + " " + question.explanation).lower()
    return any(kw in haystack for kw in PRACTICAL_KEYWORDS)


def _restates_answer(question: LintQuestion) -> bool:
    if not question.explanation or question.correct_index is None:
        return False
    if not (0 <= question.correct_index < len(question.options)):
        return False
    correct = question.options[question.correct_index]
    if not correct:
        return False
    expl_norm = normalize_stem(question.explanation)
    if SequenceMatcher(None, expl_norm, normalize_stem(correct)).ratio() > 0.6:
        return True
    opt_tokens = _tokens(correct)
    if opt_tokens and _word_count(question.explanation) <= 12:
        extra = _tokens(question.explanation) - opt_tokens
        if len(extra) < 4:
            return True
    return False


def _lacks_takeaway(question: LintQuestion) -> bool:
    words = _word_count(question.explanation)
    if words == 0 or words > 18:
        return False
    low = question.explanation.lower()
    return not any(cue in low for cue in TAKEAWAY_CUES)


def _correct_much_longer(question: LintQuestion, ratio: float) -> bool:
    ci = question.correct_index
    if ci is None or not (0 <= ci < len(question.options)):
        return False
    correct = question.options[ci]
    others = [o for i, o in enumerate(question.options) if i != ci and o]
    if not correct or not others:
        return False
    avg_other = sum(len(o) for o in others) / len(others)
    longest_other = max(len(o) for o in others)
    return len(correct) >= ratio * avg_other and len(correct) > longest_other + 8


def _has_placeholder(question: LintQuestion) -> bool:
    haystack = " ".join([question.stem, question.explanation, *question.options]).lower()
    return any(pat in haystack for pat in PLACEHOLDER_PATTERNS)


def _is_definition_only(question: LintQuestion) -> bool:
    stem_norm = normalize_stem(question.stem)
    definitional = stem_norm.startswith(("what is", "what are", "define", "what does"))
    return definitional and not _is_scenario(question)


# A per-question finding: (rule_id, message) uses the registry's default severity; the optional 3rd
# element pins an explicit severity (used by Q012's redundant-but-matching case → warning).
Finding = tuple[str, str] | tuple[str, str, str]


def _check_index_key_format(q: LintQuestion) -> list[Finding]:
    """Q012 — a NEW import row must use the ingest input key `correct_index`, not `correctIndex`.

    `correctIndex` is the INTERNAL payload/server-answer key; ingest's validator reads
    `correct_index`. A generated row that only carries `correctIndex` passes every other lint rule
    but is rejected 100% by ingest — this rule catches that format slip. Behavior:
      - only `correct_index`            → pass (correct format)
      - only `correctIndex`             → error (ingest would reject it)
      - both, values match              → warning (redundant; drop `correctIndex`)
      - both, values conflict           → error (ambiguous)
      - neither (or DB/internal payload)→ no Q012 (a missing index is Q007's job)
    """
    keys = q.import_index_keys
    if not keys:  # None (DB/internal) or {} (neither key present) → not this rule's concern
        return []
    has_snake = "correct_index" in keys
    has_camel = "correctIndex" in keys
    if has_snake and has_camel:
        if keys["correct_index"] != keys["correctIndex"]:
            return [
                (
                    "Q012",
                    f"'correct_index'={keys['correct_index']!r} conflicts with "
                    f"'correctIndex'={keys['correctIndex']!r}",
                )
            ]
        return [("Q012", "redundant 'correctIndex' alongside 'correct_index' — drop it", WARNING)]
    if has_camel and not has_snake:
        return [("Q012", "row uses 'correctIndex'; ingest requires snake_case 'correct_index'")]
    return []  # snake_case only → correct


# ── Per-question rules ──────────────────────────────────────────────────────────────────────────
def check_question(
    question: LintQuestion, config: LintConfig, *, is_new_import: bool
) -> list[Finding]:
    """Return [(rule_id, message[, severity])] for one question. Pure — no cross-question context.

    A finding may carry an explicit severity as a 3rd element (used by Q012's both-present case);
    otherwise the registry default applies.
    """
    out: list[Finding] = []
    q = question
    stem_norm = normalize_stem(q.stem)
    scenario = _is_scenario(q)

    # STRUCTURE
    if not q.stem:
        out.append(("Q001", "stem is empty"))
    if not q.category:
        out.append(("Q002", "category is missing"))
    elif q.category not in CANONICAL_CATEGORIES:
        out.append(("Q002", f"category {q.category!r} is not canonical"))
    if q.difficulty not in DIFFICULTIES:
        out.append(("Q003", f"difficulty {q.difficulty!r} not in {DIFFICULTIES}"))
    if len(q.options) != 4:
        out.append(("Q004", f"has {len(q.options)} options, expected 4"))
    if any(not str(o).strip() for o in q.options):
        out.append(("Q005", "an option is empty"))
    norm_opts = [normalize_stem(o) for o in q.options]
    if len(norm_opts) != len(set(norm_opts)):
        out.append(("Q006", "options are not all distinct"))
    if q.correct_index is None or not (0 <= q.correct_index < len(q.options)):
        out.append(("Q007", f"correct_index {q.correct_index!r} is out of range"))
    if not q.explanation:
        out.append(("Q008", "explanation is missing"))
    elif len(q.explanation) < config.explanation_min_chars:
        out.append(
            ("Q009", f"explanation {len(q.explanation)} chars (< {config.explanation_min_chars})")
        )
    stem_char_limit = config.stem_max_chars_scenario if scenario else config.stem_max_chars_default
    if len(q.stem) > stem_char_limit and not q.metadata.get("allow_long_stem"):
        out.append(("Q010", f"stem is {len(q.stem)} chars (> {stem_char_limit})"))
    for i, o in enumerate(q.options):
        if len(o) > config.option_max_chars and not q.metadata.get("allow_long_option"):
            out.append(("Q011", f"option {i} is {len(o)} chars (> {config.option_max_chars})"))
            break

    # Q012 — ingest-format key check. NEW IMPORTS ONLY: generated rows must use snake_case
    # `correct_index` (the ingest input key). DB/report rows carry no raw-key info → never checked.
    if is_new_import:
        out.extend(_check_index_key_format(q))

    # QUALITY
    if q.explanation and _restates_answer(q):
        out.append(("Q020", "explanation closely restates the correct option"))
    if q.explanation and not _restates_answer(q) and _lacks_takeaway(q):
        out.append(("Q021", "explanation has no why/takeaway cue"))
    words = _word_count(q.stem)
    if 0 < words < config.stem_min_words:
        out.append(("Q022", f"stem is {words} words (< {config.stem_min_words})"))
    stem_word_limit = config.stem_max_words_scenario if scenario else config.stem_max_words_default
    if words > stem_word_limit:
        out.append(("Q023", f"stem is {words} words (> {stem_word_limit})"))
    if _correct_much_longer(q, config.correct_option_length_ratio_threshold):
        out.append(("Q024", "correct option is much longer than the distractors"))
    if any(pat in normalize_stem(o) for o in q.options for pat in JUNK_OPTION_PATTERNS):
        out.append(("Q025", "an option is an 'all/none of the above'-style choice"))
    if _has_placeholder(q):
        out.append(("Q026", "looks like placeholder / test content"))

    # Q030 — generic required metadata for new imports (off unless require_metadata_all).
    if is_new_import and config.require_metadata_all:
        missing = [f for f in ("subtopic", "cognitive_type") if not q.metadata.get(f)]
        if missing:
            out.append(("Q030", f"missing required metadata: {', '.join(missing)}"))

    # PRACTICAL — flagship-only, new imports only.
    if is_new_import and q.category in FLAGSHIP_CATEGORIES:
        out.extend(_check_flagship(q, stem_norm))

    return out


def _check_flagship(q: LintQuestion, stem_norm: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    subtopic = q.metadata.get("subtopic")
    cognitive = str(q.metadata.get("cognitive_type") or "").lower()
    practical = str(q.metadata.get("practical_value") or "").lower()

    if not subtopic:
        out.append(("Q040", "flagship item has no subtopic"))
    if not cognitive:
        out.append(("Q041", "flagship item has no cognitive_type"))
    if not practical:
        out.append(("Q042", "flagship item has no practical_value"))
    elif practical == "low":
        out.append(("Q043", "flagship practical_value is 'low' — raise it or cut the item"))

    if not _is_practical(q) or _lacks_takeaway(q):
        out.append(("Q044", "flagship explanation reads without a real-world takeaway"))
    if _is_generic_opener(stem_norm) and not _is_scenario(q) and not _is_practical(q):
        out.append(("Q045", "flagship pure-recall stem with no practical payoff"))
    if _is_definition_only(q) and cognitive not in ("scenario", "application", "judgment"):
        out.append(("Q046", "flagship item is definition-only / too textbook"))
    return out


# ── Batch (cross-question) rules ────────────────────────────────────────────────────────────────
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


def _duplicate_findings(
    questions: list[LintQuestion], config: LintConfig
) -> tuple[list[tuple[int, str, str]], list[dict[str, Any]]]:
    """Detect exact (Q027, global) + near (Q028, same-category) duplicate stems.

    Returns (per_question_findings, clusters) where per_question_findings is
    [(question_index, rule_id, message)].
    """
    n = len(questions)
    norms = [normalize_stem(q.stem) for q in questions]
    token_sets = [_tokens(q.stem) for q in questions]

    # Exact duplicates by normalized stem (global — catches the same question in two categories).
    exact_of: dict[str, list[int]] = defaultdict(list)
    for i, norm in enumerate(norms):
        if norm:
            exact_of[norm].append(i)
    exact_indices = {i for group in exact_of.values() if len(group) > 1 for i in group}

    # Near duplicates within a single category (union-find so clusters aggregate).
    ds = _DisjointSet(n)
    by_cat: dict[str, list[int]] = defaultdict(list)
    for i, q in enumerate(questions):
        by_cat[q.category].append(i)
    for members in by_cat.values():
        for a_pos in range(len(members)):
            i = members[a_pos]
            if not norms[i]:
                continue
            for b_pos in range(a_pos + 1, len(members)):
                j = members[b_pos]
                if not norms[j] or norms[i] == norms[j]:
                    continue
                li, lj = len(norms[i]), len(norms[j])
                if min(li, lj) / max(li, lj) < 0.6:
                    continue
                jac = _jaccard(token_sets[i], token_sets[j])
                if jac < 0.5:
                    continue
                ratio = SequenceMatcher(None, norms[i], norms[j]).ratio()
                if ratio >= config.near_duplicate_similarity:
                    ds.union(i, j)

    findings: list[tuple[int, str, str]] = []
    for i in sorted(exact_indices):
        findings.append((i, "Q027", "exact duplicate stem shared with another question"))

    # Near clusters (size > 1) excluding pure-exact groups already flagged.
    near_clusters: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        near_clusters[ds.find(i)].append(i)
    for members in near_clusters.values():
        if len(members) < 2:
            continue
        fresh = [i for i in members if i not in exact_indices]
        if len(fresh) < 2:
            continue
        for i in fresh:
            findings.append((i, "Q028", "near-duplicate stem within the same category"))

    # Report clusters (exact + near), deterministic order.
    clusters: list[dict[str, Any]] = []
    for group in exact_of.values():
        if len(group) > 1:
            clusters.append(_cluster_dict(questions, group, "exact"))
    for members in near_clusters.values():
        fresh = [i for i in members if i not in exact_indices]
        if len(fresh) >= 2:
            clusters.append(_cluster_dict(questions, fresh, "near"))
    clusters.sort(key=lambda c: (c["kind"] != "exact", -c["size"], c["stems"][0]))
    return findings, clusters


def _cluster_dict(questions: list[LintQuestion], idxs: list[int], kind: str) -> dict[str, Any]:
    recs = [questions[i] for i in idxs]
    return {
        "kind": kind,
        "rule_id": "Q027" if kind == "exact" else "Q028",
        "size": len(recs),
        "categories": sorted({r.category for r in recs}),
        "difficulties": sorted({r.difficulty for r in recs}),
        "idents": sorted(r.ident for r in recs),
        "stems": sorted(r.stem for r in recs),
    }


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _position_findings(
    questions: list[LintQuestion], config: LintConfig
) -> tuple[list[tuple[str, str, str]], dict[str, Any]]:
    """Q029 — within-batch source answer-position balance, per category.

    Authoring hygiene only (gameplay shuffles at serve time). Returns (batch_findings, balance)
    where batch_findings is [(category, rule_id, message)].
    """
    letters = ["A", "B", "C", "D"]
    per_cat: dict[str, Counter[str]] = defaultdict(Counter)
    for q in questions:
        if q.correct_index is not None and 0 <= q.correct_index < 4:
            per_cat[q.category][letters[q.correct_index]] += 1

    balance: dict[str, Any] = {}
    findings: list[tuple[str, str, str]] = []
    for cat in sorted(per_cat):
        counter = per_cat[cat]
        total = sum(counter.values())
        shares = {ltr: (counter.get(ltr, 0) / total if total else 0.0) for ltr in letters}
        balance[cat] = {
            "total": total,
            "counts": {ltr: counter.get(ltr, 0) for ltr in letters},
            "shares": {ltr: round(shares[ltr], 3) for ltr in letters},
        }
        if total < config.min_batch_for_position_check:
            continue
        over = [ltr for ltr in letters if shares[ltr] > config.source_answer_position_max_share]
        if over:
            worst = max(over, key=lambda ltr: shares[ltr])
            findings.append(
                (
                    cat,
                    "Q029",
                    f"position {worst} is {shares[worst]:.0%} of {total} rows "
                    f"(> {config.source_answer_position_max_share:.0%})",
                )
            )
    return findings, balance


# ── Top-level entry ─────────────────────────────────────────────────────────────────────────────
def _severity_for(rule_id: str, config: LintConfig) -> str:
    if rule_id in config.severity_overrides:
        return config.severity_overrides[rule_id]
    return RULES[rule_id].severity


def lint_questions(
    questions: list[LintQuestion],
    *,
    config: LintConfig | None = None,
    mode: str = MODE_REPORT,
    is_new_import: bool = False,
) -> LintResult:
    """Lint a batch of questions. Pure: returns a LintResult, never raises on content problems."""
    if mode not in MODES:
        raise ValueError(f"unknown mode {mode!r}; use one of {MODES}")
    config = config or LintConfig()
    findings: list[LintFinding] = []

    # Per-question rules. A finding may pin an explicit severity (3rd tuple element); a config
    # override always wins, then the explicit severity, then the registry default.
    for q in questions:
        for item in check_question(q, config, is_new_import=is_new_import):
            rule_id, message = item[0], item[1]
            explicit_severity = item[2] if len(item) > 2 else None
            if rule_id in config.severity_overrides:
                severity = config.severity_overrides[rule_id]
            elif explicit_severity is not None:
                severity = explicit_severity
            else:
                severity = RULES[rule_id].severity
            findings.append(
                LintFinding(
                    rule_id=rule_id,
                    severity=severity,
                    message=message,
                    ident=q.ident,
                    category=q.category,
                    stem=q.stem,
                )
            )

    # Batch rules: duplicates (Q027/Q028).
    dup_findings, clusters = _duplicate_findings(questions, config)
    for idx, rule_id, message in dup_findings:
        q = questions[idx]
        findings.append(
            LintFinding(
                rule_id=rule_id,
                severity=_severity_for(rule_id, config),
                message=message,
                ident=q.ident,
                category=q.category,
                stem=q.stem,
            )
        )

    # Batch rules: source answer-position balance (Q029).
    pos_findings, balance = _position_findings(questions, config)
    for category, rule_id, message in pos_findings:
        findings.append(
            LintFinding(
                rule_id=rule_id,
                severity=_severity_for(rule_id, config),
                message=message,
                ident=f"batch:{category}",
                category=category,
                stem="",
            )
        )

    # Deterministic ordering: severity (error→warning→info), then rule id, then ident.
    sev_rank = {ERROR: 0, WARNING: 1, INFO: 2}
    findings.sort(key=lambda f: (sev_rank.get(f.severity, 3), f.rule_id, f.category, f.ident))

    return LintResult(
        findings=findings,
        total_questions=len(questions),
        mode=mode,
        is_new_import=is_new_import,
        duplicate_clusters=clusters,
        position_balance=balance,
    )
