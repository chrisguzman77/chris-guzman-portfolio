from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, StringConstraints

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
