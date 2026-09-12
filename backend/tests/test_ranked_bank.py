"""The §5c weighting of the ranked trivia draw.

The properties worth pinning are the ones that make this safe to leave running unattended: it must
be DETERMINISTIC (the shared window seed means every player builds the same pool from it, §9), it
must RETIRE ITSELF as the banks are rewritten, and it must never bias so hard that the Royale turns
repetitive — which §5d treats as its own distinct failure, not a milder kind of boring.
"""

from app.services.ranked_bank import (
    MAX_REPLICATION,
    THINKING_TARGET,
    is_thinking_shaped,
    replication_factor,
    weight_ranked_bank,
)


def q(prompt: str, qid: str = "x") -> dict:
    return {"id": qid, "payload": {"prompt": prompt, "options": ["a", "b", "c", "d"]}}


class TestShape:
    def test_why_shape(self) -> None:
        assert is_thinking_shaped(q("Why do gyms price a year cheaper per month?"))

    def test_second_person_scenario(self) -> None:
        assert is_thinking_shaped(
            q("A raise pushes your income into a higher bracket. What is taxed?")
        )

    def test_setup_sentence_without_you(self) -> None:
        # The Scenario shape does not require "you" — a setup then a question is enough.
        assert is_thinking_shaped(
            q("A free app sells user attention to advertisers. Who is the customer?")
        )

    def test_bare_recall_is_not_thinking(self) -> None:
        assert not is_thinking_shaped(
            q("Which Renaissance artist painted the Sistine Chapel ceiling?")
        )
        assert not is_thinking_shaped(q("Which Greek playwright wrote Oedipus Rex?"))

    def test_youth_is_not_second_person(self) -> None:
        # Word-boundary matching: a substring test would read "young" as second person and quietly
        # promote a pile of recall questions into the favoured pool.
        assert not is_thinking_shaped(q("Which young composer wrote the Jupiter Symphony?"))

    def test_missing_or_malformed_prompt_is_not_thinking(self) -> None:
        assert not is_thinking_shaped({})
        assert not is_thinking_shaped({"payload": {}})
        assert not is_thinking_shaped({"payload": {"prompt": None}})
        assert not is_thinking_shaped({"payload": {"prompt": 42}})


class TestReplicationFactor:
    def test_lifts_a_recall_heavy_bank_to_target(self) -> None:
        # A bank roughly 30/70 against the target: k=5 lands ~68%, just over it.
        k = replication_factor(300, 700)
        assert k == 5
        share = k * 300 / (k * 300 + 700)
        assert THINKING_TARGET <= share < THINKING_TARGET + 0.1

    def test_retires_itself_once_the_bank_is_rewritten(self) -> None:
        # THE POINT OF THE WHOLE DESIGN: as the six weak banks are rewritten into §5c shapes, the
        # derived factor falls to 1 on its own and the weighting stops applying. Nobody has to
        # remember to remove it.
        assert replication_factor(700, 286) == 1  # ~71% thinking, already past target

    def test_weakens_as_the_bank_improves(self) -> None:
        assert replication_factor(300, 700) > replication_factor(450, 550) >= 1

    def test_capped_so_a_thin_bank_cannot_become_repetitive(self) -> None:
        # 5 thinking questions against 900 recall would otherwise replicate ~334x, making the Royale
        # serve the same handful every day.
        assert replication_factor(5, 900) == MAX_REPLICATION

    def test_degenerate_inputs_are_no_ops(self) -> None:
        assert replication_factor(0, 100) == 1
        assert replication_factor(100, 0) == 1


class TestWeighting:
    def test_favours_thinking_without_dropping_recall(self) -> None:
        bank = [q("Why do streaks work?", "t1")] + [
            q(f"Which artist painted {i}?", f"r{i}") for i in range(9)
        ]
        out = weight_ranked_bank(bank)
        ids = [x["id"] for x in out]
        assert ids.count("t1") > 1
        # Recall is BIASED AGAINST, never removed: a Royale of nothing but one shape is its own
        # kind of monotony, and the recall shape is still part of the §5c mix.
        assert all(f"r{i}" in ids for i in range(9))

    def test_is_deterministic(self) -> None:
        # Every player that day must build the identical pool from the identical bank, or the
        # shared-seed guarantee (§9) breaks and the leaderboard stops being comparable.
        bank = [q("Why x?", "t1"), q("Which y?", "r1"), q("Why z?", "t2")]
        assert weight_ranked_bank(bank) == weight_ranked_bank(bank)

    def test_preserves_order(self) -> None:
        # The bank arrives ordered by id for reproducible generation; repeats go in place so the
        # pool stays a stable function of it.
        bank = [q("Which a?", "r1"), q("Why b?", "t1"), q("Which c?", "r2")]
        ids = [x["id"] for x in weight_ranked_bank(bank)]
        assert ids.index("r1") < ids.index("t1") < ids.index("r2")

    def test_no_op_when_nothing_to_favour(self) -> None:
        assert weight_ranked_bank([]) == []
        all_recall = [q("Which a?", "r1"), q("Which b?", "r2")]
        assert weight_ranked_bank(all_recall) == all_recall
        all_thinking = [q("Why a?", "t1"), q("Why b?", "t2")]
        assert weight_ranked_bank(all_thinking) == all_thinking

    def test_reaches_roughly_the_target_share(self) -> None:
        bank = [q(f"Why {i}?", f"t{i}") for i in range(300)] + [
            q(f"Which {i}?", f"r{i}") for i in range(700)
        ]
        out = weight_ranked_bank(bank)
        share = sum(1 for x in out if is_thinking_shaped(x)) / len(out)
        assert THINKING_TARGET <= share < THINKING_TARGET + 0.1
