"""Apply a single answer to a user's persisted skill state (Phase 1).

Loads the answered question's AI metadata (category, topics, difficulty), runs the pure
knowledge-tracing updates, and reassigns the JSONB maps on the (created-if-absent) UserSkillState
row. Called best-effort from record_answer_signal; a NULL/unclassified question is a no-op.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import BKT_P_L0, KT_THETA_INIT
from app.models import QuestionAIMetadata, UserSkillState
from app.services.skill_model import bkt_update, next_review_hours, update_theta


async def apply_answer_to_skill_state(
    session: AsyncSession,
    user_id: uuid.UUID,
    question_id: uuid.UUID | None,
    correct: bool,
    now: datetime | None = None,
) -> None:
    """Update (user)'s category ability + per-topic knowledge from one answered bank question."""
    if question_id is None:
        return
    meta = await session.scalar(
        select(QuestionAIMetadata).where(QuestionAIMetadata.question_id == question_id)
    )
    if meta is None or not meta.category:
        return  # unclassified -> nothing reliable to learn from

    state = await session.scalar(select(UserSkillState).where(UserSkillState.user_id == user_id))
    if state is None:
        state = UserSkillState(user_id=user_id, category_ability={}, topic_knowledge={})
        session.add(state)

    now = now or datetime.now(UTC)

    # category ability (reassign, never mutate the JSONB in place)
    ability = dict(state.category_ability)
    cur = ability.get(meta.category, {"theta": KT_THETA_INIT, "attempts": 0})
    theta, attempts = update_theta(
        float(cur["theta"]), int(cur["attempts"]), float(meta.difficulty_score or 0.5), correct
    )
    ability[meta.category] = {"theta": theta, "attempts": attempts}
    state.category_ability = ability

    # per-topic knowledge (BKT posterior; prior seeded from BKT_P_L0 for a new topic)
    knowledge = dict(state.topic_knowledge)
    for topic in meta.topic_tags or []:
        t = knowledge.get(topic, {"p_known": BKT_P_L0, "attempts": 0})
        new_p = bkt_update(float(t["p_known"]), correct)
        due = now + timedelta(hours=next_review_hours(new_p, correct))
        knowledge[topic] = {
            "p_known": new_p,
            "attempts": int(t["attempts"]) + 1,
            "last_answered_at": now.isoformat(),
            "review_due_at": due.isoformat(),
        }
    state.topic_knowledge = knowledge

    await session.flush()
