COMPOSE := docker compose -f infra/compose/compose.dev.yaml

.PHONY: help up down logs ps build migrate test lint dev-web dev-api prod-config secrets-edit secrets-check

help:          ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-12s %s\n", $$1, $$2}'

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

SOPS_KEY ?= $(HOME)/.config/sops/age/keys.txt

prod-config:   ## Validate the production compose file
	docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q

secrets-edit:  ## Edit the encrypted production secrets (opens $$EDITOR)
	SOPS_AGE_KEY_FILE=$(SOPS_KEY) sops edit infra/compose/prod.enc.env

secrets-check: ## Confirm prod secrets decrypt and count placeholder values (never prints secrets)
	@SOPS_AGE_KEY_FILE=$(SOPS_KEY) bash -o pipefail -c 'sops decrypt infra/compose/prod.enc.env | awk -F= '"'"'/^[A-Z_]+=/{n++} /change-me/{p++} END{printf "%d keys, %d still change-me\n", n, p+0}'"'"''
