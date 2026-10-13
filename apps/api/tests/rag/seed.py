import json
import warnings
from pathlib import Path
from typing import Any

import yaml

from portfolio_api.rag.documents import SiteContent

SEED_DIR = Path(__file__).resolve().parents[4] / "infra" / "directus" / "seed"
POSTS_DIR = SEED_DIR.parents[2] / "content" / "posts"  # infra/directus/seed -> repo root


def _items(name: str) -> list[dict[str, Any]]:
    path = SEED_DIR / f"{name}.json"
    if not path.exists():
        warnings.warn(f"seed file missing: {path}", stacklevel=2)
        return []
    items: list[dict[str, Any]] = json.loads(path.read_text())
    # Seed rows have no ids (Directus assigns them); number them like Directus would.
    return [{"id": i, **item} for i, item in enumerate(items, start=1)]


def _posts() -> list[dict[str, Any]]:
    """The published posts' text: front matter plus body of each content/posts/*.md."""
    posts: list[dict[str, Any]] = []
    for i, path in enumerate(sorted(POSTS_DIR.glob("*.md")), start=1):
        _, front_matter, body = path.read_text().split("---\n", 2)
        fields: dict[str, Any] = yaml.safe_load(front_matter)
        posts.append({"id": i, **fields, "body": body.strip()})
    return posts


def load_seed_content() -> SiteContent:
    profile: dict[str, Any] = json.loads((SEED_DIR / "profile.json").read_text())
    return SiteContent(
        profile=profile,
        experience=_items("experience"),
        education=_items("education"),
        involvement=_items("involvement"),
        # infra/directus/bootstrap.mjs SEED_ORDER has no certifications or posts; posts are
        # written in Directus, so the golden questions about a post read its content/ text.
        certifications=[],
        faq=_items("faq"),
        projects=_items("projects"),
        posts=_posts(),
        resume_text=None,
    )
