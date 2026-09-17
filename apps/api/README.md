# portfolio-api

FastAPI service owning site interactions (contact, views, resume downloads, GitHub cache) and the RAG chat. See `docs/architecture.md`.

Run: `uv sync && uv run uvicorn portfolio_api.main:create_app --factory --reload`. Test: `uv run pytest`.
