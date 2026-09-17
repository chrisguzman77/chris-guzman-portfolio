COMPOSE := docker compose -f infra/compose/compose.dev.yaml

.PHONY: up down logs ps build migrate test lint dev-web dev-api

up:            ## Build and start the full local stack
	$(COMPOSE) up -d --build

down:          ## Stop the stack (keeps volumes)
	$(COMPOSE) down

logs:          ## Tail all service logs
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

build:
	$(COMPOSE) build

migrate:       ## Apply API migrations against the compose database
	$(COMPOSE) run --rm api alembic upgrade head

test:          ## Run web and api test suites
	cd apps/web && pnpm test
	cd apps/api && uv run pytest

lint:          ## Lint, format-check, and type-check both apps
	cd apps/web && pnpm lint && pnpm typecheck && pnpm format
	cd apps/api && uv run ruff check . && uv run ruff format --check . && uv run pyright

dev-web:       ## Next.js dev server with HMR (expects `make up` for backing services)
	cd apps/web && pnpm dev

dev-api:       ## FastAPI dev server with reload
	cd apps/api && uv run uvicorn portfolio_api.main:create_app --factory --reload
