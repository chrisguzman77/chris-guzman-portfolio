from fastapi import Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError

from portfolio_api.errors import ApiError


async def parse_json_body[T: BaseModel](request: Request, model: type[T]) -> T:
    """Parse the body ourselves, as a dependency: FastAPI decodes a body parameter's JSON
    before any dependency, so malformed JSON would skip the rate limit and config checks."""
    # JSON only: a text/plain or form POST is a CORS "simple request" that skips the preflight.
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type != "application/json":
        raise ApiError(
            400,
            "invalid_request",
            "Some fields are invalid.",
            fields={"body": "Content-Type must be application/json."},
        )
    try:
        return model.model_validate_json(await request.body())
    except ValidationError as exc:
        raise RequestValidationError(
            [{**err, "loc": ("body", *err["loc"])} for err in exc.errors(include_url=False)]
        ) from exc
