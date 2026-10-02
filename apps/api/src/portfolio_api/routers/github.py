from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from portfolio_api.errors import ApiError
from portfolio_api.schemas.github import ActivityResponse
from portfolio_api.services.github import GitHubActivityService

router = APIRouter(prefix="/v1", tags=["github"])


def get_github_activity(request: Request) -> GitHubActivityService:
    return request.app.state.github_activity


@router.get("/github/activity", response_model=ActivityResponse)
async def github_activity(
    response: Response,
    service: Annotated[GitHubActivityService, Depends(get_github_activity)],
) -> ActivityResponse:
    activity = await service.get()
    if activity is None:
        raise ApiError(
            503,
            "activity_unavailable",
            "GitHub activity has not been fetched yet.",
            headers={"Cache-Control": "no-store"},
        )
    response.headers["Cache-Control"] = "public, max-age=300"
    return activity
