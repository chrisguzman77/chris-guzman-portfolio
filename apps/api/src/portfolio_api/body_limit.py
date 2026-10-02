from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from portfolio_api.errors import error_body

MAX_BODY_BYTES = 32 * 1024


class BodySizeLimit:
    """Reject request bodies over ``max_bytes`` with a JSON 413 before the app reads them.

    A declared Content-Length is checked up front; a body without one (chunked) is
    buffered up to the cap and then replayed to the app.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        length = Headers(scope=scope).get("content-length")
        if length is not None:
            if length.isdigit() and int(length) > self.max_bytes:
                await self._reject(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return

        body = b""
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break  # client disconnected; let the app see it
            body += message.get("body", b"")
            if len(body) > self.max_bytes:
                await self._reject(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            if message["type"] != "http.request":
                return message
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            error_body("payload_too_large", "The request body is too large."), status_code=413
        )
        await response(scope, receive, send)
