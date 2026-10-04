import math
from typing import Any

import httpx
import pytest

from portfolio_api.clients.prometheus import HttpPrometheus, PrometheusError


def vector(*values: str) -> dict[str, Any]:
    return {
        "status": "success",
        "data": {
            "resultType": "vector",
            "result": [{"metric": {}, "value": [1791043200.0, v]} for v in values],
        },
    }


def prometheus(handler: httpx.MockTransport) -> HttpPrometheus:
    return HttpPrometheus(httpx.AsyncClient(transport=handler), "http://prometheus:9090/")


async def test_query_sends_promql_and_time_and_parses_values() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=vector("1", "0.25"))

    values = await prometheus(httpx.MockTransport(handle)).query("up", 1791043200.5)
    assert values == [1.0, 0.25]
    [request] = seen
    assert request.url.path == "/api/v1/query"
    assert request.url.params["query"] == "up"
    assert request.url.params["time"] == "1791043200.500"
    assert request.extensions["timeout"]["read"] == 2.0


async def test_empty_result_and_nan_values() -> None:
    empty = httpx.MockTransport(lambda _: httpx.Response(200, json=vector()))
    assert await prometheus(empty).query("up", 0.0) == []
    nan = httpx.MockTransport(lambda _: httpx.Response(200, json=vector("NaN")))
    [value] = await prometheus(nan).query("up", 0.0)
    assert math.isnan(value)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503, text="unavailable"),
        httpx.Response(400, json={"status": "error", "errorType": "bad_data", "error": "x"}),
        httpx.Response(200, json={"status": "error", "errorType": "timeout", "error": "x"}),
        httpx.Response(200, text="not json"),
        httpx.Response(
            200, json={"status": "success", "data": {"resultType": "matrix", "result": []}}
        ),
    ],
)
async def test_bad_replies_raise(response: httpx.Response) -> None:
    with pytest.raises(PrometheusError):
        await prometheus(httpx.MockTransport(lambda _: response)).query("up", 0.0)


@pytest.mark.parametrize("error", [httpx.ConnectError, httpx.ReadTimeout])
async def test_network_errors_raise(error: type[httpx.TransportError]) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise error("down", request=request)

    with pytest.raises(PrometheusError):
        await prometheus(httpx.MockTransport(boom)).query("up", 0.0)
