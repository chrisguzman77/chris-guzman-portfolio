from datetime import datetime

from pydantic import BaseModel, Field


class ActivityDay(BaseModel):
    date: str
    count: int
    level: int = Field(ge=0, le=4)


class ActivityWeek(BaseModel):
    days: list[ActivityDay]


class Activity(BaseModel):
    total: int
    weeks: list[ActivityWeek]


class ActivityResponse(Activity):
    fetched_at: datetime
