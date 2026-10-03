from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel, ValidationError

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MAX_COMPLETION_TOKENS = 700  # includes gpt-oss's hidden reasoning tokens


@dataclass(frozen=True)
class ChatTurn:
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class ModelReply:
    text: str
    input_tokens: int
    output_tokens: int


class ModelBusyError(Exception):
    """The provider rate-limited us (free-tier quota); try again in a minute."""


class ModelUnavailableError(Exception):
    """The provider failed, timed out, or answered in an unexpected shape. Never holds the key."""


class ChatModel(Protocol):
    async def complete(self, messages: Sequence[ChatTurn]) -> ModelReply: ...


class _Message(BaseModel):
    content: str | None = None


class _Choice(BaseModel):
    message: _Message


class _Usage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0


class _Completion(BaseModel):
    choices: list[_Choice]
    usage: _Usage = _Usage()


class GroqChatModel:
    """Groq's OpenAI-compatible chat completions endpoint, called with plain httpx."""

    def __init__(
        self, http: httpx.AsyncClient, api_key: str, model: str, *, timeout: float = 20.0
    ) -> None:
        self._http = http
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def complete(self, messages: Sequence[ChatTurn]) -> ModelReply:
        body = {
            "model": self._model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": 0.2,
            "max_completion_tokens": MAX_COMPLETION_TOKENS,
            "reasoning_effort": "low",
            "include_reasoning": False,
        }
        try:
            res = await self._http.post(
                GROQ_URL,
                json=body,
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise ModelUnavailableError(f"groq request failed: {type(exc).__name__}") from exc
        if res.status_code == 429:
            raise ModelBusyError("groq 429")
        if res.status_code != 200:
            raise ModelUnavailableError(f"groq {res.status_code}")
        try:
            parsed = _Completion.model_validate_json(res.content)
        except ValidationError as exc:
            raise ModelUnavailableError("groq returned an unexpected body") from exc
        if not parsed.choices:
            raise ModelUnavailableError("groq returned no choices")
        return ModelReply(
            text=(parsed.choices[0].message.content or "").strip(),
            input_tokens=parsed.usage.prompt_tokens,
            output_tokens=parsed.usage.completion_tokens,
        )
