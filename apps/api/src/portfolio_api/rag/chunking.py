import hashlib
import re

MAX_WORDS = 260  # about 350 tokens for bge-small
OVERLAP_WORDS = 40


def content_hash(model: str, text: str) -> str:
    """Changes when the text or the embedding model changes, so either forces a re-embed."""
    return hashlib.sha256(f"{model}\n{text}".encode()).hexdigest()


def _blocks(body: str) -> list[str]:
    """Paragraphs, with each heading line kept together with the paragraph after it."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    blocks: list[str] = []
    heading: str | None = None
    for p in paragraphs:
        if p.startswith("#") and "\n" not in p:
            heading = p if heading is None else f"{heading}\n\n{p}"
            continue
        blocks.append(p if heading is None else f"{heading}\n\n{p}")
        heading = None
    if heading is not None:
        blocks.append(heading)
    return blocks


def _windows(words: list[str], size: int) -> list[str]:
    if size <= OVERLAP_WORDS:
        raise ValueError(f"window size {size} must be larger than the overlap ({OVERLAP_WORDS})")
    step = size - OVERLAP_WORDS
    out: list[str] = []
    for start in range(0, len(words), step):
        out.append(" ".join(words[start : start + size]))
        if start + size >= len(words):
            break
    return out


def chunk_markdown(title: str, markdown: str) -> list[str]:
    """Split a document into chunks of at most MAX_WORDS words, each starting with the title."""
    body = markdown
    first_line = f"# {title}"
    if body.startswith(first_line):
        body = body[len(first_line) :]
    budget = MAX_WORDS - len(title.split())
    pieces: list[str] = []
    current: list[str] = []
    current_words = 0
    for block in _blocks(body):
        n = len(block.split())
        if n > budget:
            if current:
                pieces.append("\n\n".join(current))
                current, current_words = [], 0
            pieces.extend(_windows(block.split(), budget))
            continue
        if current and current_words + n > budget:
            pieces.append("\n\n".join(current))
            current, current_words = [], 0
        current.append(block)
        current_words += n
    if current:
        pieces.append("\n\n".join(current))
    return [f"{title}\n\n{piece}" for piece in pieces]
