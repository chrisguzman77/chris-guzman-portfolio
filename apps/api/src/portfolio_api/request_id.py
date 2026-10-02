import re
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from portfolio_api.errors import error_body

_VALID = re.compile(r"[A-Za-z0-9._-]{1,128}")
log = structlog.get_logger()


def install_request_id(app: FastAPI) -> None:
    """Echo a well-formed incoming X-Request-ID, or mint one, and bind it to every log line.

    Unhandled exceptions become a JSON 500 here, inside CORS, so the response keeps the
    error shape, the request ID and the CORS headers.
    """

    @app.middleware("http")
    async def request_id(  # pyright: ignore[reportUnusedFunction]
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if _VALID.fullmatch(incoming) else uuid.uuid4().hex
        structlog.contextvars.bind_contextvars(request_id=rid)
        try:
            response = await call_next(request)
        except Exception:
            log.exception("unhandled error", method=request.method, path=request.url.path)
            response = JSONResponse(
                error_body("internal_error", "Something went wrong."), status_code=500
            )
        finally:
            structlog.contextvars.unbind_contextvars("request_id")
        response.headers["X-Request-ID"] = rid
        return response
