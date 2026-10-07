from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}


class ApiError(Exception):
    """An error returned to clients as ``{"error": {"code", "message"}}``."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        headers: dict[str, str] | None = None,
        fields: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers
        self.fields = fields


def error_body(code: str, message: str, fields: dict[str, str] | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if fields is not None:
        error["fields"] = fields
    return {"error": error}


def _field_name(loc: tuple[Any, ...]) -> str:
    # ("body", "email") -> "email"; a body that is not a JSON object -> "body".
    return str(loc[-1]) if len(loc) > 1 else "body"


async def _api_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)  # noqa: S101 - narrows the type; registered only for it
    return JSONResponse(
        error_body(exc.code, exc.message, exc.fields), status_code=exc.status, headers=exc.headers
    )


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)  # noqa: S101 - narrows the type; registered only for it
    fields: dict[str, str] = {}
    for err in exc.errors():
        fields.setdefault(_field_name(tuple(err["loc"])), str(err["msg"]))
    return JSONResponse(
        error_body("invalid_request", "Some fields are invalid.", fields), status_code=400
    )


async def _http_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)  # noqa: S101 - narrows the type; registered only for it
    code = _HTTP_CODES.get(exc.status_code, "http_error")
    return JSONResponse(
        error_body(code, str(exc.detail)), status_code=exc.status_code, headers=exc.headers
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
