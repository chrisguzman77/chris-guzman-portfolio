from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Message = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=5000)]
Token = Annotated[str, StringConstraints(min_length=1, max_length=2048)]


class ContactRequest(BaseModel):
    name: Name
    email: EmailStr  # email-validator also rejects addresses over 254 characters
    message: Message
    turnstile_token: Token
    website: str = ""  # honeypot: humans never see it, so any value means a bot


class ContactAccepted(BaseModel):
    status: Literal["received"] = "received"
