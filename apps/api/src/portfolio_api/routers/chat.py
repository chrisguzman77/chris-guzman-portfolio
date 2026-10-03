import uuid
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Request

from portfolio_api.clients.groq import ModelBusyError, ModelUnavailableError
from portfolio_api.clients.turnstile import TurnstileUnavailableError, TurnstileVerifier
from portfolio_api.errors import ApiError
from portfolio_api.ratelimit import SlidingWindowLimiter, client_ip
from portfolio_api.schemas.chat import (
    MessageRequest,
    MessageResponse,
    SessionCreated,
    SessionRequest,
    SourceOut,
)
from portfolio_api.services.chat import (
    BudgetExhaustedError,
    ChatService,
    ChatSwitch,
    SessionLimitError,
    SessionNotFoundError,
)

router = APIRouter(prefix="/v1/chat", tags=["chat"])


def _limit(limiter: SlidingWindowLimiter, request: Request, message: str) -> None:
    wait = limiter.hit(client_ip(request) or "unknown")
    if wait is not None:
        raise ApiError(429, "rate_limited", message, headers={"Retry-After": str(wait)})


async def limit_sessions(request: Request) -> None:
    _limit(request.app.state.chat_session_limiter, request, "Too many new chats. Try later.")


async def limit_messages(request: Request) -> None:
    _limit(request.app.state.chat_message_limiter, request, "Too many questions. Try later.")


async def require_chat(request: Request) -> ChatService:
    service: ChatService | None = request.app.state.chat_service
    switch: ChatSwitch | None = request.app.state.chat_switch
    if service is None or switch is None or not await switch.enabled():
        raise ApiError(503, "chat_disabled", "Chat is not available.")
    return service


# Dependencies resolve in order before the body is validated: rate limit, then configuration.
@router.post(
    "/sessions",
    status_code=201,
    response_model=SessionCreated,
    dependencies=[Depends(limit_sessions)],
)
async def open_session(
    request: Request,
    service: Annotated[ChatService, Depends(require_chat)],
    body: SessionRequest,
) -> SessionCreated:
    turnstile: TurnstileVerifier | None = request.app.state.turnstile
    if turnstile is None:
        raise ApiError(503, "chat_disabled", "Chat is not available.")
    try:
        ok = await turnstile.verify(body.turnstile_token, client_ip(request))
    except TurnstileUnavailableError as exc:
        raise ApiError(
            503, "turnstile_unavailable", "Spam check is unavailable. Try again later."
        ) from exc
    if not ok:
        raise ApiError(400, "turnstile_failed", "Spam check failed. Try again.")
    session_id, left = await service.open_session(client_ip(request) or "unknown")
    return SessionCreated(session_id=session_id, questions_left=left)


@router.post(
    "/sessions/{session_id}/messages",
    response_model=MessageResponse,
    dependencies=[Depends(limit_messages)],
)
async def ask(
    request: Request,
    session_id: uuid.UUID,
    service: Annotated[ChatService, Depends(require_chat)],
    body: MessageRequest,
) -> MessageResponse:
    try:
        answer = await service.ask(session_id, client_ip(request) or "unknown", body.question)
    except SessionNotFoundError as exc:
        raise ApiError(404, "session_not_found", "This chat session has ended.") from exc
    except SessionLimitError as exc:
        raise ApiError(409, "session_limit", "This chat session has no questions left.") from exc
    except BudgetExhaustedError as exc:
        raise ApiError(503, "budget_exhausted", "Chat is resting until tomorrow.") from exc
    except ModelBusyError as exc:
        raise ApiError(
            503, "model_busy", "Chat is busy. Try again in a minute.", headers={"Retry-After": "60"}
        ) from exc
    except ModelUnavailableError as exc:
        raise ApiError(503, "chat_unavailable", "Chat is unavailable right now.") from exc
    outcome = cast(Literal["answered", "no_match", "uncited"], answer.outcome.value)
    return MessageResponse(
        answer=answer.answer,
        sources=[SourceOut(n=s.n, title=s.title, url=s.url) for s in answer.sources],
        outcome=outcome,
        questions_left=answer.questions_left,
    )
