import json
import warnings
from pathlib import Path
from typing import Any

from portfolio_api.rag.documents import SiteContent

SEED_DIR = Path(__file__).resolve().parents[4] / "infra" / "directus" / "seed"


def _items(name: str) -> list[dict[str, Any]]:
    path = SEED_DIR / f"{name}.json"
    if not path.exists():
        warnings.warn(f"seed file missing: {path}", stacklevel=2)
        return []
    items: list[dict[str, Any]] = json.loads(path.read_text())
    # Seed rows have no ids (Directus assigns them); number them like Directus would.
    return [{"id": i, **item} for i, item in enumerate(items, start=1)]


def load_seed_content() -> SiteContent:
    profile: dict[str, Any] = json.loads((SEED_DIR / "profile.json").read_text())
    return SiteContent(
        profile=profile,
        experience=_items("experience"),
        education=_items("education"),
        involvement=_items("involvement"),
        certifications=_items("certifications"),
        projects=_items("projects"),
        posts=_items("posts"),
        resume_text=None,
    )
