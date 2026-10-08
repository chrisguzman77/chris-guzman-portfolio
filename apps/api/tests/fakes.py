import hashlib
import math
import re
from collections.abc import Sequence

from portfolio_api.clients.directus import ChatSettings
from portfolio_api.clients.email import EmailSendError, OutgoingEmail
from portfolio_api.clients.groq import ChatTurn, ModelReply
from portfolio_api.metrics import REGISTRY
from portfolio_api.rag.embedder import EMBEDDING_DIM
from portfolio_api.rag.retrieval import Retrieved
from portfolio_api.repositories.rag import ChunkHit


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


class FakeBatchSender(FakeSender):
    """FakeSender plus send_batch; batch numbers in ``fail_batches`` (0-based) raise."""

    def __init__(self, fail_times: int = 0, fail_batches: set[int] | None = None) -> None:
        super().__init__(fail_times)
        self.fail_batches = fail_batches or set()
        self.batches: list[tuple[str, list[OutgoingEmail]]] = []
        self.batch_attempts = 0

    async def send_batch(self, emails: Sequence[OutgoingEmail], idempotency_key: str) -> None:
        attempt = self.batch_attempts
        self.batch_attempts += 1
        if attempt in self.fail_batches:
            raise EmailSendError("resend 429: daily_quota_exceeded")
        self.batches.append((idempotency_key, list(emails)))
        self.sent.extend(emails)


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


HIT = ChunkHit(1, 1, "ACM@AU platform", "/projects/acm", "Built with FastAPI.", 0.9)


class FakeChatModel:
    """Returns replies in order (the last one repeats); an Exception entry is raised."""

    def __init__(self, *replies: ModelReply | Exception) -> None:
        self.replies: list[ModelReply | Exception] = list(replies) or [
            ModelReply("He built it with FastAPI [1].", 1000, 50)
        ]
        self.calls: list[list[ChatTurn]] = []

    async def complete(self, messages: Sequence[ChatTurn]) -> ModelReply:
        self.calls.append(list(messages))
        reply = self.replies[min(len(self.calls), len(self.replies)) - 1]
        if isinstance(reply, Exception):
            raise reply
        return reply


class FakeRetriever:
    def __init__(self, hits: list[ChunkHit] | None = None, best: float = 0.9) -> None:
        self.hits = [HIT] if hits is None else hits
        self.best = best
        self.questions: list[str] = []

    async def search(self, question: str) -> Retrieved:
        self.questions.append(question)
        return Retrieved(self.hits, self.best)


class FakeChatSettingsSource:
    def __init__(self, result: ChatSettings | Exception | None = None) -> None:
        self.result = result or ChatSettings(enabled=True, suggested_questions=[])
        self.calls = 0

    async def fetch_chat_settings(self) -> ChatSettings:
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def metric(name: str, **labels: str) -> float:
    """Current value of one sample in the API's metrics registry (0 if it has none yet)."""
    return REGISTRY.get_sample_value(name, labels) or 0.0
