import asyncio
import threading
from collections.abc import Sequence
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from fastembed import TextEmbedding

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIM = 384


class Embedder(Protocol):
    model_name: str

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...


class FastEmbedEmbedder:
    """bge-small on CPU. Loaded on first use (~130 MB); every call runs in a worker thread."""

    model_name = EMBEDDING_MODEL

    def __init__(self, cache_dir: str | None = None) -> None:
        self._cache_dir = cache_dir
        self._model: TextEmbedding | None = None
        self._lock = threading.Lock()

    def _load(self) -> "TextEmbedding":
        with self._lock:
            if self._model is None:
                from fastembed import TextEmbedding

                self._model = TextEmbedding(model_name=EMBEDDING_MODEL, cache_dir=self._cache_dir)
            return self._model

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []

        def run() -> list[list[float]]:
            return [vector.tolist() for vector in self._load().embed(list(texts))]

        return await asyncio.to_thread(run)

    async def embed_query(self, text: str) -> list[float]:
        def run() -> list[float]:
            return next(iter(self._load().query_embed(text))).tolist()

        return await asyncio.to_thread(run)
