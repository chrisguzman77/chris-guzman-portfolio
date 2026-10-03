import hashlib
import math
import re
from collections.abc import Sequence

from portfolio_api.clients.email import EmailSendError, OutgoingEmail
from portfolio_api.rag.embedder import EMBEDDING_DIM


class FakeTurnstile:
    def __init__(self, result: bool | Exception = True) -> None:
        self.result = result
        self.calls: list[tuple[str, str | None]] = []

    async def verify(self, token: str, remote_ip: str | None) -> bool:
        self.calls.append((token, remote_ip))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeSender:
    def __init__(self, fail_times: int = 0) -> None:
        self.fail_times = fail_times
        self.sent: list[OutgoingEmail] = []
        self.attempts = 0

    async def send(self, email: OutgoingEmail) -> None:
        self.attempts += 1
        if self.fail_times > 0:
            self.fail_times -= 1
            raise EmailSendError("resend 500: boom")
        self.sent.append(email)


class FakeEmbedder:
    """Deterministic bag-of-words vectors: texts sharing words point the same way."""

    model_name = "fake-embedder"

    def __init__(self) -> None:
        self.embedded: list[str] = []

    @staticmethod
    def vector(text: str) -> list[float]:
        v = [0.0] * EMBEDDING_DIM
        for word in re.findall(r"[a-z0-9]+", text.lower()):
            v[int(hashlib.sha256(word.encode()).hexdigest(), 16) % EMBEDDING_DIM] += 1.0
        if not any(v):
            v[0] = 1.0  # a zero vector has no cosine distance
        norm = math.sqrt(sum(x * x for x in v))
        return [x / norm for x in v]

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        self.embedded.extend(texts)
        return [self.vector(t) for t in texts]

    async def embed_query(self, text: str) -> list[float]:
        return self.vector(text)
