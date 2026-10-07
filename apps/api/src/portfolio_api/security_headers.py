"""Security headers on every API response. JSON-only API, so the CSP denies everything."""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
    (b"referrer-policy", b"no-referrer"),
    (b"cross-origin-resource-policy", b"same-site"),
)
STRICT_CSP = b"default-src 'none'; frame-ancestors 'none'"

# Swagger UI and ReDoc load scripts/styles from jsDelivr and run an inline init script.
DOCS_PATHS = frozenset({"/docs", "/docs/oauth2-redirect", "/redoc"})
DOCS_CSP = (
    b"default-src 'none'; "
    b"script-src https://cdn.jsdelivr.net 'unsafe-inline'; "
    b"style-src https://cdn.jsdelivr.net https://fonts.googleapis.com 'unsafe-inline'; "
    b"img-src 'self' data: https://fastapi.tiangolo.com https://cdn.redoc.ly; "
    b"font-src https://fonts.gstatic.com; "
    b"connect-src 'self'; worker-src blob:; frame-ancestors 'none'"
)


class SecurityHeaders:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        csp = DOCS_CSP if scope["path"] in DOCS_PATHS else STRICT_CSP
        headers = [*SECURITY_HEADERS, (b"content-security-policy", csp)]

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), *headers]
            await send(message)

        await self.app(scope, receive, send_with_headers)
