import hashlib

from portfolio_api.rag.chunking import MAX_WORDS, OVERLAP_WORDS, chunk_markdown, content_hash


def words(n: int, prefix: str = "w") -> str:
    return " ".join(f"{prefix}{i}" for i in range(n))


def test_content_hash_includes_the_model() -> None:
    assert content_hash("m", "text") == hashlib.sha256(b"m\ntext").hexdigest()
    assert content_hash("m1", "text") != content_hash("m2", "text")


def test_short_document_is_one_chunk_prefixed_with_title() -> None:
    chunks = chunk_markdown("Title", "# Title\n\nFirst paragraph.\n\nSecond paragraph.")
    assert chunks == ["Title\n\nFirst paragraph.\n\nSecond paragraph."]


def test_empty_body_has_no_chunks() -> None:
    assert chunk_markdown("Title", "# Title\n\n") == []


def test_heading_stays_with_its_paragraph_and_blocks_pack_greedily() -> None:
    body = f"## One\n\n{words(150, 'a')}\n\n## Two\n\n{words(150, 'b')}"
    chunks = chunk_markdown("T", f"# T\n\n{body}")
    assert len(chunks) == 2
    assert chunks[0].startswith("T\n\n## One\n\na0 ")
    assert chunks[1].startswith("T\n\n## Two\n\nb0 ")


def test_every_chunk_fits_the_word_budget() -> None:
    body = "\n\n".join(words(100, f"p{i}x") for i in range(6))
    for chunk in chunk_markdown("Title here", body):
        assert len(chunk.split()) <= MAX_WORDS


def test_long_paragraph_splits_into_overlapping_windows() -> None:
    chunks = chunk_markdown("T", words(600))
    assert len(chunks) >= 3
    first, second = chunks[0].split()[1:], chunks[1].split()[1:]  # drop the title word
    assert first[-OVERLAP_WORDS:] == second[:OVERLAP_WORDS]
    assert all(len(c.split()) <= MAX_WORDS for c in chunks)
    assert chunks[-1].split()[-1] == "w599"
