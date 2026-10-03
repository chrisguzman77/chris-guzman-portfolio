from dataclasses import replace

from portfolio_api.rag.documents import SiteContent, SourceDocument, build_documents
from tests.rag.seed import load_seed_content

EMPTY = SiteContent(
    profile=None,
    experience=[],
    education=[],
    involvement=[],
    certifications=[],
    projects=[],
    posts=[],
    resume_text=None,
)


def by_type(docs: list[SourceDocument], source_type: str) -> list[SourceDocument]:
    return [d for d in docs if d.source_type == source_type]


def test_empty_content_builds_nothing() -> None:
    assert build_documents(EMPTY) == []


def test_profile_document() -> None:
    content = replace(
        EMPTY,
        **{
            "profile": {
                "name": "Christopher Guzman",
                "intro": "CS student.",
                "location": "Augusta, GA",
            },
        },
    )
    [doc] = build_documents(content)
    assert doc == SourceDocument(
        source_type="profile",
        source_id="profile",
        title="About Christopher Guzman",
        url="/",
        markdown="# About Christopher Guzman\n\nCS student.\n\nLocation: Augusta, GA.",
    )


def test_experience_document_has_dates_highlights_and_tech() -> None:
    content = replace(
        EMPTY,
        **{
            "experience": [
                {
                    "id": 7,
                    "company": "Jubilee Farms",
                    "role": "Full Stack Engineer",
                    "location": "Remote",
                    "start_date": "2026-03-01",
                    "end_date": None,
                    "highlights": ["Cut render time 79%."],
                    "tech": ["asp.net", "jquery"],
                }
            ],
        },
    )
    [doc] = build_documents(content)
    assert doc.source_type == "experience" and doc.source_id == "7"
    assert doc.title == "Full Stack Engineer at Jubilee Farms"
    assert doc.url == "/experience"
    assert doc.markdown == (
        "# Full Stack Engineer at Jubilee Farms\n\n"
        "Full Stack Engineer at Jubilee Farms, Remote. Mar 2026 to present.\n\n"
        "- Cut render time 79%.\n\n"
        "Technologies: asp.net, jquery."
    )


def test_education_document_lists_degrees_and_minor() -> None:
    content = replace(
        EMPTY,
        **{
            "education": [
                {
                    "id": 1,
                    "school": "Augusta University",
                    "location": "Augusta, GA",
                    "end_date": "2027-05-01",
                    "degrees": [
                        {"kind": "degree", "name": "B.S. in Computer Science"},
                        {"kind": "minor", "name": "Mathematics"},
                    ],
                    "coursework": None,
                }
            ],
        },
    )
    [doc] = build_documents(content)
    assert doc.title == "B.S. in Computer Science at Augusta University"
    assert doc.url == "/education"
    assert "Degree: B.S. in Computer Science." in doc.markdown
    assert "Minor: Mathematics." in doc.markdown
    assert "Graduation: May 2027." in doc.markdown
    assert "Coursework" not in doc.markdown


def test_project_post_involvement_certification_and_resume_urls() -> None:
    content = SiteContent(
        profile=None,
        experience=[],
        education=[],
        involvement=[
            {
                "id": 2,
                "organization": "ACM@AU",
                "role": "Lead Developer",
                "year": "2026",
                "summary": None,
            }
        ],
        certifications=[
            {"id": 3, "name": "Security+", "issuer": "CompTIA", "date": None, "url": None}
        ],
        projects=[
            {
                "id": 4,
                "slug": "acm",
                "title": "ACM platform",
                "summary": "Chapter site.",
                "body": "## Auth\n\nRotating refresh tokens.",
                "award": None,
                "tech": None,
                "date": "2026-01-01",
            }
        ],
        posts=[
            {
                "id": 5,
                "slug": "hello",
                "title": "Hello",
                "published_at": "2026-09-01T00:00:00",
                "excerpt": "First post.",
                "body": "Body text.",
                "tags": ["meta"],
            }
        ],
        resume_text="Christopher Guzman\nSkills: Python",
    )
    docs = {(d.source_type, d.source_id): d for d in build_documents(content)}
    assert docs[("involvement", "2")].title == "Lead Developer, ACM@AU"
    assert docs[("involvement", "2")].url == "/education"
    assert docs[("certifications", "3")].markdown == "# Security+\n\nSecurity+, issued by CompTIA."
    assert docs[("projects", "4")].url == "/projects/acm"
    assert "## Auth\n\nRotating refresh tokens." in docs[("projects", "4")].markdown
    assert "Date: Jan 2026." in docs[("projects", "4")].markdown
    assert docs[("posts", "5")].url == "/blog/hello"
    assert "Published Sep 2026. Tags: meta." in docs[("posts", "5")].markdown
    assert docs[("resume", "resume")].title == "Resume"
    assert docs[("resume", "resume")].url == "/resume"


def test_post_without_a_publish_date_omits_the_published_sentence() -> None:
    post = {"id": 5, "slug": "hi", "title": "Hi", "published_at": None, "tags": ["meta"]}
    docs = build_documents(replace(EMPTY, posts=[post]))
    assert "Published" not in docs[0].markdown
    assert "Tags: meta." in docs[0].markdown


def test_seed_content_builds_one_document_per_item() -> None:
    docs = build_documents(load_seed_content())
    assert len(by_type(docs, "profile")) == 1
    assert len(by_type(docs, "experience")) == 5
    assert len(by_type(docs, "projects")) == 4
    assert all(d.markdown.startswith(f"# {d.title}\n\n") for d in docs)
