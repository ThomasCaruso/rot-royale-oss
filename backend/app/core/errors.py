"""Stable, machine-readable API error codes — the single source of truth.

WHY CODES, NOT PROSE: the client renders errors to a player in their own language. A server that
sends `"Window is not open"` forces the UI to either display English or guess, and the app ships in
four languages. So `detail` carries a stable snake_case CODE and the client maps it to a translated
string (`frontend/src/i18n/errors.ts`).

This follows the convention the identity/achievements endpoints already used (`unknown_badge`,
`too_many_badges`); it standardises the rest of the API on it rather than inventing a third shape.
`detail` stays a plain STRING — not an object — so existing clients, tests and curl output keep
working unchanged.

Scale properties, which are the point of a registry rather than scattered literals:

- **Adding a code forces a translation.** `test_error_codes.py` asserts every code here has an entry
  in every locale dictionary, so a new error cannot ship English-only.
- **Codes are an API contract.** Renaming one is a breaking change; the English text beside it is
  just documentation and can be reworded freely.
- **Unknown codes degrade safely.** The client falls back to a generic *translated* message, so even
  an unmigrated endpoint never renders raw English prose at a player.
"""

from __future__ import annotations

from fastapi import HTTPException, status

# code -> (HTTP status, English description).
#
# The description is for API consumers, logs and docs — it is NEVER what a player sees. Keep codes
# specific enough that the UI can say something useful; a single `bad_request` for everything would
# push the vagueness onto the player.
ERROR_CODES: dict[str, tuple[int, str]] = {
    # --- contest / entry ---
    "window_not_found": (status.HTTP_404_NOT_FOUND, "No such contest window"),
    "window_not_open": (status.HTTP_409_CONFLICT, "That window is not open for entry"),
    "already_entered": (status.HTTP_409_CONFLICT, "You have already entered this window"),
    "entry_not_found": (status.HTTP_404_NOT_FOUND, "No such entry"),
    "entry_already_submitted": (status.HTTP_409_CONFLICT, "This entry was already submitted"),
    "round_out_of_order": (status.HTTP_400_BAD_REQUEST, "Round answered out of order"),
    "round_not_resolved": (status.HTTP_409_CONFLICT, "Finish this round before moving on"),
    # --- practice ---
    "practice_not_found": (status.HTTP_404_NOT_FOUND, "No such practice session"),
    "practice_already_submitted": (
        status.HTTP_409_CONFLICT,
        "This practice session was already submitted",
    ),
    "category_unavailable": (
        status.HTTP_409_CONFLICT,
        "That category has no servable questions right now",
    ),
    # --- campaign ---
    "campaign_level_not_found": (status.HTTP_404_NOT_FOUND, "No such campaign level"),
    "campaign_level_locked": (status.HTTP_409_CONFLICT, "Clear the previous level first"),
    "campaign_session_not_found": (status.HTTP_404_NOT_FOUND, "No such campaign session"),
    "campaign_level_unfinished": (status.HTTP_409_CONFLICT, "That level is not finished yet"),
    "campaign_content_unavailable": (
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "Level content is unavailable",
    ),
    # --- cognition rounds ---
    "cognition_round_not_found": (status.HTTP_404_NOT_FOUND, "No such cognition round"),
    "cognition_round_completed": (status.HTTP_409_CONFLICT, "This round is already finished"),
    "estimate_unavailable": (
        status.HTTP_409_CONFLICT,
        "No estimation questions are available right now",
    ),
    "estimate_unresolved": (
        status.HTTP_409_CONFLICT,
        "This round has not resolved yet",
    ),
    "change_unavailable": (
        status.HTTP_409_CONFLICT,
        "No change-detection puzzles are available right now",
    ),
    # --- offline sync ---
    "offline_result_invalid": (status.HTTP_400_BAD_REQUEST, "Offline result is invalid"),
    # --- auth / account ---
    "email_taken": (status.HTTP_409_CONFLICT, "That email is already registered"),
    "username_taken": (status.HTTP_409_CONFLICT, "That username is taken"),
    "invalid_credentials": (status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect"),
    "rate_limited": (status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts — try again later"),
    # --- duel / social ---
    "duel_not_found": (status.HTTP_404_NOT_FOUND, "No such duel"),
    "insufficient_gems": (status.HTTP_402_PAYMENT_REQUIRED, "Not enough Gems for this tier"),
    "duel_tier_locked": (status.HTTP_409_CONFLICT, "Win more duels to unlock this tier"),
    "user_not_found": (status.HTTP_404_NOT_FOUND, "No account with that username"),
    "cannot_duel_self": (status.HTTP_400_BAD_REQUEST, "You cannot duel yourself"),
    "not_friends": (status.HTTP_409_CONFLICT, "Add them as a friend first"),
    "duel_already_exists": (status.HTTP_409_CONFLICT, "A duel with them is already open"),
    # --- username changes ---
    "username_invalid": (
        status.HTTP_400_BAD_REQUEST,
        "Usernames are 3-32 letters, numbers or underscores",
    ),
    "username_unchanged": (status.HTTP_400_BAD_REQUEST, "That is already your username"),
    "insufficient_coins": (status.HTTP_402_PAYMENT_REQUIRED, "Not enough coins"),
    # --- vault (codes raised as literals in api/vault.py, registered here for translations) ---
    "requirement_not_met": (status.HTTP_403_FORBIDDEN, "Unlock requirement not met"),
    "not_owned": (status.HTTP_403_FORBIDDEN, "Item not owned"),
    "already_owned": (status.HTTP_409_CONFLICT, "Item already owned"),
    # --- generic ---
    "server_error": (status.HTTP_500_INTERNAL_SERVER_ERROR, "Something went wrong"),
}


class ApiErrorCode(HTTPException):
    """HTTPException whose `detail` is a stable error CODE, not prose.

    Raise with a code from ERROR_CODES; the status comes from the registry so one failure mode
    cannot drift between endpoints. `status_override` exists for the rare endpoint that must return
    a different status for the same semantic failure.
    """

    def __init__(self, code: str, *, status_override: int | None = None) -> None:
        if code not in ERROR_CODES:
            raise KeyError(
                f"unknown error code {code!r} — add it to ERROR_CODES so it gets a translation"
            )
        http_status, _english = ERROR_CODES[code]
        super().__init__(status_code=status_override or http_status, detail=code)
        self.code = code


def english_message(code: str) -> str:
    """The English description for a code — for logs and API docs, never for a player."""
    return ERROR_CODES.get(code, (0, "Unknown error"))[1]


__all__ = ["ERROR_CODES", "ApiErrorCode", "english_message"]
