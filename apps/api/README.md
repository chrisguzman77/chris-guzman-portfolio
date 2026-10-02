# portfolio-api

FastAPI service owning site interactions (contact, views, resume downloads, GitHub cache) and the RAG chat. See `docs/architecture.md`.

Run: `uv sync && uv run uvicorn portfolio_api.main:create_app --factory --reload`. Test: `uv run pytest`.

## Running API tests locally

Host port 5432 may be taken (it is on Chris's Mac), so start the dev Postgres on 55432:

```bash
POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres
cd apps/api
export API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio
uv run alembic upgrade head
uv run pytest
```

DB tests truncate the Phase 4 tables and fail (not skip) without `API_DATABASE_URL`, so run the suite against a throwaway database, from one checkout at a time.
