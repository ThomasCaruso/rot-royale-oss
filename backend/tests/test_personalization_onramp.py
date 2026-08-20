"""_maybe_weak_onramp: rare, easy-only, out-of-wheelhouse on-ramp."""

from __future__ import annotations

from app.services.personalization import _maybe_weak_onramp


class _Meta:
    def __init__(self, category):
        self.category = category


class _Rng:
    """Deterministic stand-in: fixed .random() value, .choice() picks a chosen index."""

    def __init__(self, r: float, choice_idx: int = 0):
        self._r = r
        self._choice_idx = choice_idx

    def random(self) -> float:
        return self._r

    def choice(self, seq):
        return seq[self._choice_idx]


def _bank():
    # pool holds q1,q2 (Sports, the wheelhouse); bank adds easy+hard Geography (out of wheelhouse).
    return {
        "pool": [{"id": "q1", "difficulty": "medium"}, {"id": "q2", "difficulty": "easy"}],
        "bank": [
            {"id": "q1", "difficulty": "medium"},
            {"id": "q2", "difficulty": "easy"},
            {"id": "g_easy", "difficulty": "easy"},
            {"id": "g_hard", "difficulty": "hard"},
        ],
        "meta": {
            "q1": _Meta("Sports"),
            "q2": _Meta("Sports"),
            "g_easy": _Meta("Geography"),
            "g_hard": _Meta("Geography"),
        },
    }


LIKED = frozenset({"Sports"})


def test_onramp_injects_easy_out_of_wheelhouse_when_triggered():
    b = _bank()
    out = _maybe_weak_onramp(b["pool"], b["bank"], b["meta"], LIKED, _Rng(0.0))
    ids = [q["id"] for q in out]
    assert "g_easy" in ids  # the easy Geography (out of wheelhouse) was pulled in
    assert len(out) == len(b["pool"])  # pool size preserved


def test_onramp_noop_when_not_triggered():
    b = _bank()
    out = _maybe_weak_onramp(b["pool"], b["bank"], b["meta"], LIKED, _Rng(0.99))
    assert out == b["pool"]  # most sessions: unchanged


def test_onramp_never_injects_hard_or_wheelhouse_question():
    # Only g_hard (hard) and q1/q2 (wheelhouse) remain as non-pool options besides g_easy; the
    # candidate filter must exclude hard + wheelhouse, so only g_easy is eligible.
    b = _bank()
    out = _maybe_weak_onramp(b["pool"], b["bank"], b["meta"], LIKED, _Rng(0.0))
    ids = [q["id"] for q in out]
    assert "g_hard" not in ids


def test_onramp_noop_when_no_easy_out_of_wheelhouse_exists():
    # bank has only wheelhouse + a hard out-of-wheelhouse → no eligible candidate → unchanged.
    pool = [{"id": "q1", "difficulty": "medium"}]
    bank = [{"id": "q1", "difficulty": "medium"}, {"id": "g_hard", "difficulty": "hard"}]
    meta = {"q1": _Meta("Sports"), "g_hard": _Meta("Geography")}
    out = _maybe_weak_onramp(pool, bank, meta, LIKED, _Rng(0.0))
    assert out == pool
