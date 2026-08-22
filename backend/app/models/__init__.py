"""SQLAlchemy ORM models (docs/architecture.md).

Every model module must be imported here so its table registers on Base.metadata — Alembic
autogenerate and create-all rely on this. Add new models to __all__ as they land per milestone.
"""

from app.models.analytics import FunnelEvent
from app.models.campaign import CampaignSession, UserCampaignProgress
from app.models.challenge import Challenge
from app.models.cognition import (
    CognitionAttempt,
    CognitionChangeItem,
    CognitionEstimateItem,
    CognitionRoundInstance,
    CognitionRoundType,
)
from app.models.contest import ContestWindow, Entry, RoundAnswer, RoundResult
from app.models.cosmetic import UserCosmetic
from app.models.daily_chest import DailyChestClaim
from app.models.duel import DuelMatch, DuelRound, DuelUserStats
from app.models.gem_ledger import GemLedger
from app.models.ledger import CoinLedger
from app.models.personalization import (
    QuestionAIMetadata,
    QuestionInteractionEvent,
    UserDailyStats,
    UserTasteProfile,
)
from app.models.profile import Profile
from app.models.prompt import UserPromptAck
from app.models.push import PushSubscription, UserNotification, WindowNotification
from app.models.question import Question
from app.models.question_translation import QuestionTranslation
from app.models.rot_rating import (
    RotDifficultyBatch,
    RotDifficultyRating,
    RotRating,
    RotSubRating,
)
from app.models.season import SeasonReset
from app.models.skill import UserSkillState
from app.models.social import (
    FriendDuel,
    FriendDuelRound,
    FriendDuelSubmission,
    Friendship,
)
from app.models.standing import Standing
from app.models.theme import UserTheme
from app.models.unlock_ack import UserUnlockAck
from app.models.user import User

__all__ = [
    "FunnelEvent",
    "User",
    "Profile",
    "UserTheme",
    "UserCosmetic",
    "UserPromptAck",
    "UserUnlockAck",
    "CoinLedger",
    "GemLedger",
    "ContestWindow",
    "Challenge",
    "CognitionRoundType",
    "CognitionRoundInstance",
    "CognitionAttempt",
    "CognitionEstimateItem",
    "CognitionChangeItem",
    "Entry",
    "RoundAnswer",
    "RoundResult",
    "Question",
    "QuestionTranslation",
    "QuestionAIMetadata",
    "QuestionInteractionEvent",
    "UserDailyStats",
    "UserTasteProfile",
    "Standing",
    "PushSubscription",
    "UserNotification",
    "WindowNotification",
    "SeasonReset",
    "CampaignSession",
    "UserCampaignProgress",
    "DuelMatch",
    "DuelRound",
    "DuelUserStats",
    "DailyChestClaim",
    "Friendship",
    "FriendDuel",
    "FriendDuelRound",
    "FriendDuelSubmission",
    "UserSkillState",
    "RotSubRating",
    "RotRating",
    "RotDifficultyRating",
    "RotDifficultyBatch",
]
