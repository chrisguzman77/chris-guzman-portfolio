from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any, cast

Item = dict[str, Any]


@dataclass(frozen=True)
class SiteContent:
    """Everything published, as Directus returns it (published filter already applied)."""

    profile: Item | None
    experience: list[Item]
    education: list[Item]
    involvement: list[Item]
    certifications: list[Item]
    projects: list[Item]
    posts: list[Item]
    resume_text: str | None


@dataclass(frozen=True)
class SourceDocument:
    source_type: str
    source_id: str
    title: str
    url: str
    markdown: str


def _text(item: Item, key: str) -> str:
    value = item.get(key)
    return value.strip() if isinstance(value, str) else ""


def _list(item: Item, key: str) -> list[Any]:
    value = item.get(key)
    return cast(list[Any], value) if isinstance(value, list) else []


def _month(value: object) -> str:
    """'2026-03-01' (or a datetime string) -> 'Mar 2026'; anything unparsable -> ''."""
    if not isinstance(value, str) or len(value) < 10:
        return ""
    try:
        return date.fromisoformat(value[:10]).strftime("%b %Y")
    except ValueError:
        return ""


def _doc(
    source_type: str, source_id: str, title: str, url: str, parts: list[str]
) -> SourceDocument:
    body = "\n\n".join(p for p in parts if p)
    return SourceDocument(source_type, source_id, title, url, f"# {title}\n\n{body}".rstrip())


def _profile(item: Item) -> SourceDocument:
    title = f"About {_text(item, 'name')}"
    location = _text(item, "location")
    return _doc(
        "profile",
        "profile",
        title,
        "/",
        [_text(item, "intro"), f"Location: {location}." if location else ""],
    )


def _experience(item: Item) -> SourceDocument:
    role, company = _text(item, "role"), _text(item, "company")
    title = f"{role} at {company}"
    where = ", ".join(p for p in [title, _text(item, "location")] if p)
    start, end = _month(item.get("start_date")), _month(item.get("end_date")) or "present"
    highlights = "\n".join(f"- {h}" for h in _list(item, "highlights") if isinstance(h, str))
    tech = ", ".join(str(t) for t in _list(item, "tech"))
    return _doc(
        "experience",
        str(item["id"]),
        title,
        "/experience",
        [
            f"{where}. {start} to {end}." if start else f"{where}.",
            highlights,
            f"Technologies: {tech}." if tech else "",
        ],
    )


def _education(item: Item) -> SourceDocument:
    school = _text(item, "school")
    degrees: list[Item] = [d for d in _list(item, "degrees") if isinstance(d, dict)]
    majors = [_text(d, "name") for d in degrees if d.get("kind") == "degree"]
    minors = [_text(d, "name") for d in degrees if d.get("kind") == "minor"]
    title = f"{majors[0]} at {school}" if majors else school
    location = _text(item, "location")
    graduation = _month(item.get("end_date"))
    coursework = ", ".join(str(c) for c in _list(item, "coursework"))
    return _doc(
        "education",
        str(item["id"]),
        title,
        "/education",
        [
            f"Studies at {school}, {location}." if location else f"Studies at {school}.",
            "\n".join([f"Degree: {m}." for m in majors] + [f"Minor: {m}." for m in minors]),
            f"Graduation: {graduation}." if graduation else "",
            f"Coursework: {coursework}." if coursework else "",
        ],
    )


def _involvement(item: Item) -> SourceDocument:
    role, org = _text(item, "role"), _text(item, "organization")
    year = _text(item, "year")
    lead = f"{role} at {org} ({year})." if year else f"{role} at {org}."
    return _doc(
        "involvement",
        str(item["id"]),
        f"{role}, {org}",
        "/education",
        [lead, _text(item, "summary")],
    )


def _certification(item: Item) -> SourceDocument:
    name, issuer = _text(item, "name"), _text(item, "issuer")
    issued = _month(item.get("date"))
    line = f"{name}, issued by {issuer}" + (f", {issued}" if issued else "") + "."
    return _doc("certifications", str(item["id"]), name, "/education", [line])


def _project(item: Item) -> SourceDocument:
    title = _text(item, "title")
    award, when = _text(item, "award"), _month(item.get("date"))
    tech = ", ".join(str(t) for t in _list(item, "tech"))
    return _doc(
        "projects",
        str(item["id"]),
        title,
        f"/projects/{_text(item, 'slug')}",
        [
            _text(item, "summary"),
            f"Award: {award}." if award else "",
            f"Date: {when}." if when else "",
            _text(item, "body"),
            f"Technologies: {tech}." if tech else "",
        ],
    )


def _post(item: Item) -> SourceDocument:
    title = _text(item, "title")
    tags = ", ".join(str(t) for t in _list(item, "tags"))
    published = _month(item.get("published_at"))
    meta = " ".join(
        p
        for p in [f"Published {published}." if published else "", f"Tags: {tags}." if tags else ""]
        if p
    )
    return _doc(
        "posts",
        str(item["id"]),
        title,
        f"/blog/{_text(item, 'slug')}",
        [meta, _text(item, "excerpt"), _text(item, "body")],
    )


_BUILDERS: list[tuple[str, Callable[[Item], SourceDocument]]] = [
    ("experience", _experience),
    ("education", _education),
    ("involvement", _involvement),
    ("certifications", _certification),
    ("projects", _project),
    ("posts", _post),
]


def build_documents(content: SiteContent) -> list[SourceDocument]:
    """One canonical markdown document per published item, plus the profile and resume."""
    docs: list[SourceDocument] = []
    if content.profile:
        docs.append(_profile(content.profile))
    for attr, build in _BUILDERS:
        docs.extend(build(item) for item in getattr(content, attr))
    if content.resume_text is not None:
        docs.append(_doc("resume", "resume", "Resume", "/resume", [content.resume_text.strip()]))
    return docs
