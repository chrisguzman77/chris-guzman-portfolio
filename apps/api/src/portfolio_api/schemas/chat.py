import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints

Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Token = Annotated[str, StringConstraints(min_length=1, max_length=2048)]


class SessionRequest(BaseModel):
    turnstile_token: Token


class SessionCreated(BaseModel):
    session_id: uuid.UUID
    questions_left: int


class MessageRequest(BaseModel):
    question: Question


class SourceOut(BaseModel):
    n: int
    title: str
    url: str


class MessageResponse(BaseModel):
    answer: str
    sources: list[SourceOut]
    outcome: Literal["answered", "no_match", "uncited"]
    questions_left: int
