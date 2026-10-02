import re
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import FastAPI, Request, Response

_VALID = re.compile(r"[A-Za-z0-9._-]{1,128}")


def install_request_id(app: FastAPI) -> None:
    """Echo a well-formed incoming X-Request-ID, or mint one, and bind it to every log line."""

    @app.middleware("http")
    async def request_id(  # pyright: ignore[reportUnusedFunction]
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if _VALID.fullmatch(incoming) else uuid.uuid4().hex
        structlog.contextvars.bind_contextvars(request_id=rid)
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.unbind_contextvars("request_id")
        response.headers["X-Request-ID"] = rid
        return response
