"""app/api/core/errors.py — structured refusals.

Two rules this module exists to enforce:

1. **An absent answer is an answer.** When the inputs for a decision are not
   there, Crucible AI says which inputs and what it would need — it does not return a
   zero, a median, or a plausible-looking default. A fabricated number in an
   operational context is worse than a blank, because a blank prompts a question
   and a number ends one.

2. **A refusal is machine-readable.** `detail` carries a code and structured
   fields so the frontend can render "cannot estimate, haulage telemetry is
   unavailable" rather than "Error 422".
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status


class CrucibleError(HTTPException):
    """Base for errors that carry an operational explanation.

    The FastAPI `detail` is always a dict with at least ``code`` and ``message``,
    so clients can branch on the code and still have prose to show if they do not
    recognise it.
    """

    code = "CRUCIBLE_ERROR"
    http_status = status.HTTP_400_BAD_REQUEST

    def __init__(self, message: str, **fields: Any) -> None:
        detail: dict[str, Any] = {"code": self.code, "message": message}
        detail.update({k: v for k, v in fields.items() if v is not None})
        super().__init__(status_code=self.http_status, detail=detail)
        self.message = message


class InsufficientData(CrucibleError):
    """The computation was possible in principle but the inputs are missing.

    Deliberately **200-adjacent in meaning, 422 in transport**: nothing is broken
    and the request was valid, there simply is not enough to answer with. Callers
    that can degrade gracefully should catch this rather than surfacing it.
    """

    code = "INSUFFICIENT_DATA"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY

    def __init__(
        self,
        message: str,
        *,
        missing: list[str] | None = None,
        required_for: str | None = None,
        remedy: str | None = None,
    ) -> None:
        super().__init__(
            message,
            missing=missing,
            required_for=required_for,
            remedy=remedy,
        )


class MineContextRequired(CrucibleError):
    """No mine was specified and none could be inferred for this user.

    Answering for an arbitrary mine is the failure mode this prevents.
    """

    code = "MINE_CONTEXT_REQUIRED"
    http_status = status.HTTP_400_BAD_REQUEST

    def __init__(
        self,
        message: str = "A mine must be specified for this request.",
        *,
        available_mines: list[str] | None = None,
    ) -> None:
        super().__init__(message, available_mines=available_mines)


class ConstraintViolation(CrucibleError):
    """A hard operational or safety constraint forbids the requested action."""

    code = "CONSTRAINT_VIOLATION"
    http_status = status.HTTP_409_CONFLICT

    def __init__(
        self,
        message: str,
        *,
        constraint: str | None = None,
        evidence: str | None = None,
    ) -> None:
        super().__init__(message, constraint=constraint, evidence=evidence)


class IllegalStateTransition(CrucibleError):
    """A decision or plan cannot move between the requested lifecycle states."""

    code = "ILLEGAL_STATE_TRANSITION"
    http_status = status.HTTP_409_CONFLICT

    def __init__(self, entity: str, from_state: str, to_state: str, *, allowed: list[str] | None = None) -> None:
        super().__init__(
            f"{entity} cannot move from {from_state} to {to_state}.",
            from_state=from_state,
            to_state=to_state,
            allowed=allowed,
        )


class ModelUnavailable(CrucibleError):
    """No serving model exists for a task that requires one.

    Distinct from :class:`InsufficientData`: the data may be perfect, but the
    thing that would interpret it is missing.
    """

    code = "MODEL_UNAVAILABLE"
    http_status = status.HTTP_503_SERVICE_UNAVAILABLE

    def __init__(self, task: str, *, serving_status: str | None = None) -> None:
        super().__init__(
            f"No model is currently serving '{task}'.",
            task=task,
            serving_status=serving_status,
        )


__all__ = [
    "ConstraintViolation",
    "IllegalStateTransition",
    "InsufficientData",
    "MineContextRequired",
    "CrucibleError",
    "ModelUnavailable",
]
