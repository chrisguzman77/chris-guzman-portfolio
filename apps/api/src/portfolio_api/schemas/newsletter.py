import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator

from portfolio_api.schemas.contact import Token

LinkToken = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class SubscribeRequest(BaseModel):
    email: EmailStr
    turnstile_token: Token
    website: str = ""  # honeypot: humans never see it, so any value means a bot


class SubscribeAccepted(BaseModel):
    status: Literal["check_inbox"] = "check_inbox"


class TokenRequest(BaseModel):
    token: LinkToken


class Confirmed(BaseModel):
    status: Literal["confirmed"] = "confirmed"


class Unsubscribed(BaseModel):
    status: Literal["unsubscribed"] = "unsubscribed"


class SendRequest(BaseModel):
    # Directus renders Flow templates as strings ("12", "true", "false", or "" when the
    # checkbox was left alone), so both fields accept their string forms.
    post_id: int = Field(gt=0)
    test: bool = False

    @field_validator("test", mode="before")
    @classmethod
    def _strict_bool(cls, value: object) -> bool:
        # An unreadable flag must not silently become a real send to every subscriber.
        if value is True or value == "true":
            return True
        # "undefined" is how Directus renders an untouched checkbox.
        if value is False or value is None or value in ("false", "", "undefined", "null"):
            return False
        raise ValueError("test must be true or false")


class SendResponse(BaseModel):
    status: Literal["complete", "partial", "test"]
    sent: int
    remaining: int
    sent_at: datetime | None
    recipients: int | None


class SubscriberOut(BaseModel):
    id: uuid.UUID
    email: str
    status: Literal["pending", "confirmed"]
    created_at: datetime
    confirmed_at: datetime | None


class SubscriberTotals(BaseModel):
    confirmed: int
    pending: int


class SubscriberList(BaseModel):
    subscribers: list[SubscriberOut]
    totals: SubscriberTotals
