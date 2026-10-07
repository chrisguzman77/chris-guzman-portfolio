from typing import Protocol

import httpx
from pydantic import BaseModel, Field, ValidationError

# Per phase (connect, read, write, pool), not one total; the status service bounds the whole.
QUERY_TIMEOUT = httpx.Timeout(2.0, connect=1.0)


class PrometheusError(Exception):
    """Prometheus did not answer (network error, timeout, non-200, error status or odd body)."""


class PrometheusClient(Protocol):
    async def query(self, promql: str, at: float) -> list[float]:
        """Evaluate an instant query at unix time ``at``; one value per series, [] if none."""
        ...


class _Series(BaseModel):
    value: tuple[float, str]  # [unix time, "value"]; the value may be "NaN" or "+Inf"


class _Data(BaseModel):
    result_type: str = Field(alias="resultType")
    result: list[_Series]


class _Reply(BaseModel):
    status: str
    data: _Data | None = None


class HttpPrometheus:
    def __init__(self, http: httpx.AsyncClient, base_url: str) -> None:
        self._http = http
        self._url = base_url.rstrip("/") + "/api/v1/query"

    async def query(self, promql: str, at: float) -> list[float]:
        try:
            res = await self._http.get(
                self._url, params={"query": promql, "time": f"{at:.3f}"}, timeout=QUERY_TIMEOUT
            )
        except httpx.HTTPError as exc:
            raise PrometheusError(type(exc).__name__) from exc
        if res.status_code != 200:
            raise PrometheusError(f"prometheus {res.status_code}")
        try:
            reply = _Reply.model_validate_json(res.content)
        except ValidationError as exc:
            raise PrometheusError("prometheus returned an unexpected body") from exc
        if reply.status != "success" or reply.data is None or reply.data.result_type != "vector":
            raise PrometheusError("prometheus returned no instant vector")
        try:
            return [float(series.value[1]) for series in reply.data.result]
        except (ValueError, TypeError, OverflowError) as exc:
            raise PrometheusError("prometheus returned a non-numeric value") from exc
