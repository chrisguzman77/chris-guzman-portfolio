# Phase 1 — Foundation, Skeleton, CI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monorepo where the Next.js web app and FastAPI service each build, test, and run in Docker, with PR CI enforcing quality and a release pipeline that publishes scanned images to GHCR (deploy stubbed until Phase 2).

**Architecture:** `apps/web` (Next.js, App Router) and `apps/api` (FastAPI) are independent deployables that share nothing but a Compose file. `infra/compose/compose.dev.yaml` runs Postgres (pgvector) + Directus + both apps locally. GitHub Actions runs path-filtered jobs on PRs and a build → Trivy → push → (deploy) pipeline on `main`. Secrets are SOPS+age encrypted files in the repo.

**Tech Stack:** Next.js 16.3 / React 19 / TypeScript / Tailwind 4 / shadcn / next-themes / Vitest 5 · Python 3.12 / uv / FastAPI 0.141 / SQLAlchemy 2 / Alembic 1.20 / structlog / pytest 9 / ruff / pyright · Docker Compose v5 · pgvector/pgvector:0.8.6-pg17 · directus/directus:12.3.1 · SOPS 3.13 / age 1.3 · GitHub Actions.

Spec: `docs/superpowers/specs/2026-09-16-portfolio-design.md` (Phase 1 section).

## Global Constraints

- Monorepo, this repo. Work on branch `feat/phase-1-foundation`; commit after every task.
- Node 24, pnpm 11 (`packageManager` pinned in `apps/web/package.json`). Python 3.12 via uv; never `pip` or bare `python`.
- Containers run as non-root; multi-stage builds; Next.js uses `output: "standalone"`.
- Postgres image is `pgvector/pgvector:0.8.6-pg17` (spec said 16; 17 is current and Directus 12 supports it). Directus image `directus/directus:12.3.1`.
- Env var prefix for the API is `API_` (e.g. `API_DATABASE_URL`).
- Placeholder domain `example.com` everywhere a domain is needed.
- No CMS fetch at build time. Phase 1 has no CMS reads at all.
- Every workflow declares minimal `permissions:`; the deploy job is `if: false` until Phase 2.
- Plaintext env files are never committed; only `*.example` and `*.enc.env` (sops).
- All GitHub-hosted CI is free here (public repo); the deploy job targets a self-hosted runner label `portfolio-deploy` that does not exist yet.

## File structure

| Path | Responsibility |
|---|---|
| `.editorconfig`, `.gitignore`, `.pre-commit-config.yaml`, `.sops.yaml`, `Makefile`, `README.md` | Repo-wide conventions and entry points |
| `.github/dependabot.yml`, `CODEOWNERS`, `pull_request_template.md` | Repo hygiene |
| `.github/workflows/ci.yml` | One PR workflow, three path-filtered jobs: `web`, `api`, `infra` |
| `.github/workflows/release.yml` | main: build → Trivy → push GHCR → deploy (stubbed) |
| `apps/web/` | Next.js app; `src/app/api/healthz/route.ts` liveness; `src/components/theme-provider.tsx`, `layout/site-header.tsx`, `layout/site-footer.tsx`; hero on `src/app/page.tsx` |
| `apps/api/` | FastAPI package `portfolio_api`: `config.py` (settings), `db.py` (engine + ping), `observability.py` (structlog), `schemas/health.py`, `routers/health.py`, `main.py` (app factory); `alembic/` migrations |
| `infra/compose/compose.dev.yaml`, `env.example`, `prod.enc.env` | Local stack; documented vars; encrypted prod placeholder |
| `infra/postgres/init/01-init.sh` | Creates `directus`, `portfolio`, `umami` roles + DBs; pgvector only in `portfolio` |
| `scripts/check-no-plaintext-env.sh` | pre-commit guard |
| `docs/architecture.md`, `docs/setup.md`, `docs/adr/000{1..5}-*.md` | Architecture, setup order, decisions |

---

### Task 1: Repo conventions and root ignore rules

**Files:**
- Create: `.editorconfig`, `.gitignore`

**Interfaces:**
- Produces: root `.gitignore` that later tasks rely on to keep `.env`, `node_modules`, `.venv` out of git while allowing `*.example` and `*.enc.env`.

- [ ] **Step 1: Write `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4

[Makefile]
indent_style = tab

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
# OS / editors
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json

# Node
node_modules/
.next/
out/
coverage/
*.tsbuildinfo
next-env.d.ts

# Python
.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.mypy_cache/

# Env: only examples and sops-encrypted files are committed
.env
.env.*
*.env
!*.example
!*.enc.env

# Logs
*.log
```

- [ ] **Step 3: Verify ignore rules**

Run:
```bash
touch /tmp/x; for f in .env apps/web/.env.local infra/compose/prod.env infra/compose/env.example infra/compose/prod.enc.env; do printf '%-32s ' "$f"; git check-ignore -q "$f" && echo ignored || echo tracked; done
```
Expected: the first three print `ignored`; `env.example` and `prod.enc.env` print `tracked`.

- [ ] **Step 4: Commit**

```bash
git add .editorconfig .gitignore
git commit -m "chore: add editorconfig and root gitignore"
```

---

### Task 2: Scaffold the Next.js app with a tested health route

**Files:**
- Create: `apps/web/**` (via create-next-app), then `apps/web/vitest.config.mts`, `apps/web/src/app/api/healthz/route.ts`, `apps/web/src/app/api/healthz/route.test.ts`
- Modify: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`

**Interfaces:**
- Produces: `GET /api/healthz` → `200 {"status":"ok","version":"<NEXT_PUBLIC_APP_VERSION|dev>"}` (used by Docker HEALTHCHECK in Task 5 and smoke tests in Phase 2). Scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (used by CI in Task 8).

- [ ] **Step 1: Scaffold**

Run from the repo root:
```bash
pnpm create next-app@16.3.5 apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --turbopack --yes
```
If it prompts for anything, accept defaults (React Compiler: No). It will not init git because we're inside a repo.

- [ ] **Step 2: Pin the package manager and add scripts**

Edit `apps/web/package.json`: add a top-level `"packageManager": "pnpm@11.24.0"` and make `scripts` exactly:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "format": "prettier --check .",
  "format:write": "prettier --write ."
}
```

- [ ] **Step 3: Install test and formatting deps**

```bash
cd apps/web && pnpm add -D vitest@5 @vitejs/plugin-react@6 jsdom@30 @testing-library/react@16 prettier@3 @types/node@24
```

- [ ] **Step 4: Write `apps/web/vitest.config.mts` (the `.mts` extension avoids a vitest config-loader warning; Vite 8 resolves tsconfig `paths` natively, so no plugin is needed)**

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Route handlers run in node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

Add `"vitest.config.mts"` to the `include` array in `apps/web/tsconfig.json` so typecheck covers it, and add `.prettierrc` at `apps/web/.prettierrc`:

```json
{ "semi": true, "singleQuote": false, "trailingComma": "all", "printWidth": 100 }
```

and `apps/web/.prettierignore`:

```
.next
node_modules
pnpm-lock.yaml
```

- [ ] **Step 5: Write the failing test `apps/web/src/app/api/healthz/route.test.ts`**

```ts
import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/healthz", () => {
  it("reports ok with the app version", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", version: "dev" });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd apps/web && pnpm test`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 7: Write `apps/web/src/app/api/healthz/route.ts`**

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
  });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd apps/web && pnpm test`
Expected: `1 passed`.

- [ ] **Step 9: Configure Next for standalone output and image formats**

Replace `apps/web/next.config.ts` with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: { formats: ["image/avif", "image/webp"] },
};

export default nextConfig;
```

- [ ] **Step 10: Verify lint, typecheck, build**

Run: `cd apps/web && pnpm lint && pnpm typecheck && pnpm build`
Expected: no lint errors, no type errors, build prints the route table including `ƒ /api/healthz`.

- [ ] **Step 11: Commit**

```bash
git add apps/web
git commit -m "feat(web): scaffold Next.js app with healthz route and vitest"
```

---

### Task 3: Editorial base layout, theme toggle, and hero with photo

**Files:**
- Create: `apps/web/src/components/theme-provider.tsx`, `apps/web/src/components/layout/site-header.tsx`, `apps/web/src/components/layout/site-footer.tsx`, `apps/web/src/components/layout/theme-toggle.tsx`, `apps/web/src/components/layout/site-header.test.tsx`, `apps/web/public/images/chris.jpg`, `apps/web/src/lib/site.ts`
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`

**Interfaces:**
- Produces: `siteConfig` in `src/lib/site.ts` (`name`, `headline`, `links.github`, `links.linkedin`) reused by every later page; `<SiteHeader/>`, `<SiteFooter/>`, `<ThemeProvider/>`.

- [ ] **Step 1: Initialize shadcn and add the Button**

```bash
cd apps/web && pnpm dlx shadcn@4 init --yes --preset nova --base radix && pnpm dlx shadcn@4 add button
pnpm add next-themes@0.4.6 lucide-react
```
Expected: `components.json`, `src/components/ui/button.tsx`, and `src/lib/utils.ts` exist; `globals.css` now contains shadcn CSS variables.

- [ ] **Step 2: Copy and crop the hero photo (4:5, removes the top-right artifact)**

```bash
mkdir -p apps/web/public/images
sips -c 985 788 "$HOME/Downloads/IMG_7832.JPG" --out apps/web/public/images/chris.jpg
sips -g pixelWidth -g pixelHeight apps/web/public/images/chris.jpg
```
Expected: `pixelWidth: 788`, `pixelHeight: 985`.

- [ ] **Step 3: Write `apps/web/src/lib/site.ts`**

```ts
export const siteConfig = {
  name: "Christopher Guzman",
  headline: "Software engineer building secure, data-driven systems.",
  description:
    "Portfolio of Christopher Guzman: full-stack, backend, and ML engineering, with a security background.",
  links: {
    github: "https://github.com/chrisguzman77",
    linkedin: "https://www.linkedin.com/in/christopher-emmanuel-guzman/",
  },
} as const;
```

- [ ] **Step 4: Write the failing header test `apps/web/src/components/layout/site-header.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("links the site name to the home page and exposes the theme toggle", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Christopher Guzman" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeTruthy();
  });
});
```

Run: `cd apps/web && pnpm test`
Expected: FAIL — cannot resolve `./site-header`.

- [ ] **Step 5: Write `apps/web/src/components/theme-provider.tsx`**

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem {...props} />
  );
}
```

- [ ] **Step 6: Write `apps/web/src/components/layout/theme-toggle.tsx`**

```tsx
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-5 dark:hidden" />
      <Moon className="hidden size-5 dark:block" />
    </Button>
  );
}
```

- [ ] **Step 7: Write `apps/web/src/components/layout/site-header.tsx`**

```tsx
import Link from "next/link";

import { siteConfig } from "@/lib/site";

import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-border/60">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="font-display text-lg tracking-tight">
          {siteConfig.name}
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
```

- [ ] **Step 8: Write `apps/web/src/components/layout/site-footer.tsx`**

```tsx
import { siteConfig } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
        <p>
          © {new Date().getFullYear()} {siteConfig.name}
        </p>
        <nav aria-label="Social links" className="flex gap-6">
          <a href={siteConfig.links.github} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href={siteConfig.links.linkedin} target="_blank" rel="noopener noreferrer">
            LinkedIn
          </a>
        </nav>
      </div>
    </footer>
  );
}
```

- [ ] **Step 9: Run the header test to verify it passes**

Run: `cd apps/web && pnpm test`
Expected: `2 passed` (healthz + header).

- [ ] **Step 10: Replace `apps/web/src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { siteConfig } from "@/lib/site";

import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s · ${siteConfig.name}` },
  description: siteConfig.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body className="flex min-h-screen flex-col bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 11: Add font tokens to `apps/web/src/app/globals.css`**

Inside the existing `@theme inline { ... }` block that shadcn generated, add:

```css
  --font-sans: var(--font-sans), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-display), ui-serif, Georgia, serif;
```

(If the block is named `@theme` rather than `@theme inline`, add the two lines there.) Delete the generated `--font-mono: var(--font-geist-mono);` line, since no font sets that variable any more. Then set the one accent hue (deep blue) by replacing these three tokens in both the `:root` and `.dark` blocks:

```css
/* :root */
--primary: oklch(0.42 0.16 262);
--primary-foreground: oklch(0.985 0 0);
--ring: oklch(0.42 0.16 262);
/* .dark */
--primary: oklch(0.72 0.14 262);
--primary-foreground: oklch(0.15 0.03 262);
--ring: oklch(0.72 0.14 262);
```

Vitest note: if `@/*` imports fail to resolve in tests, add `resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } }` to `vitest.config.mts`.

- [ ] **Step 12: Replace `apps/web/src/app/page.tsx` with the hero**

```tsx
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

export default function HomePage() {
  return (
    <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 py-20 md:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">Portfolio</p>
        <h1 className="font-display text-5xl leading-tight tracking-tight md:text-6xl">
          {siteConfig.name}
        </h1>
        <p className="max-w-prose text-lg text-muted-foreground">{siteConfig.headline}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href={siteConfig.links.github} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={siteConfig.links.linkedin} target="_blank" rel="noopener noreferrer">
              LinkedIn
            </a>
          </Button>
        </div>
      </div>
      <Image
        src="/images/chris.jpg"
        alt="Portrait of Christopher Guzman"
        width={788}
        height={985}
        preload
        sizes="(min-width: 768px) 320px, 256px"
        className="mx-auto w-64 rounded-2xl border border-border/60 shadow-sm md:w-80"
      />
    </section>
  );
}
```

- [ ] **Step 13: Verify in the browser**

Run: `cd apps/web && pnpm dev`
Check `http://localhost:3000`: hero with photo, theme toggle switches light/dark, footer links open GitHub and LinkedIn in new tabs. Stop the server.

- [ ] **Step 14: Lint, typecheck, test, build, format**

Run: `cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:write && pnpm build`
Expected: all green.

- [ ] **Step 15: Commit**

```bash
git add apps/web
git commit -m "feat(web): editorial base layout, theme toggle, and hero"
```

---

### Task 4: Scaffold the FastAPI service with a tested health endpoint

**Files:**
- Create: `apps/api/pyproject.toml`, `apps/api/.python-version`, `apps/api/env.example`, `apps/api/src/portfolio_api/__init__.py`, `config.py`, `db.py`, `observability.py`, `schemas/__init__.py`, `schemas/health.py`, `routers/__init__.py`, `routers/health.py`, `main.py`, `apps/api/tests/conftest.py`, `apps/api/tests/test_health.py`

**Interfaces:**
- Produces: `create_app(settings: Settings | None = None) -> FastAPI` in `portfolio_api.main`; `Settings` in `portfolio_api.config` with `database_url`, `app_version`, `log_level`, `cors_origins`; `GET /health` → `{"status": "ok"|"degraded", "version": str, "db": "ok"|"unavailable"}` (200 either way; liveness). `app.state.db_ping: Callable[[], Awaitable[bool]]` is the seam tests override.

- [ ] **Step 1: Write `apps/api/pyproject.toml`**

```toml
[project]
name = "portfolio-api"
version = "0.1.0"
description = "Interactions and intelligence API for the portfolio site"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.141",
  "uvicorn[standard]>=0.53",
  "pydantic>=2.13",
  "pydantic-settings>=2.15",
  "sqlalchemy[asyncio]>=2.0.54",
  "asyncpg>=0.31",
  "alembic>=1.20",
  "structlog>=26.1",
]

[dependency-groups]
dev = [
  "pytest>=9.1",
  "pytest-asyncio>=1.4",
  "httpx>=0.28",
  "ruff>=0.16",
  "pyright>=1.1.414",
]

[build-system]
requires = ["uv_build>=0.11,<0.12"]
build-backend = "uv_build"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "ASYNC", "RUF"]

[tool.pyright]
pythonVersion = "3.12"
typeCheckingMode = "strict"
venvPath = "."
venv = ".venv"
include = ["src", "tests", "alembic"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

Also write `apps/api/.python-version` containing `3.12`, and `apps/api/README.md`:

```markdown
# portfolio-api

FastAPI service owning site interactions (contact, views, resume downloads, GitHub cache) and the RAG chat. See `docs/architecture.md`.

Run: `uv sync && uv run uvicorn portfolio_api.main:create_app --factory --reload`. Test: `uv run pytest`.
```

- [ ] **Step 2: Sync the environment**

Run: `cd apps/api && mkdir -p src/portfolio_api && touch src/portfolio_api/__init__.py && uv sync`
Expected: `.venv` created, `uv.lock` written.

- [ ] **Step 3: Write `apps/api/src/portfolio_api/config.py`**

```python
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every field is overridable via an ``API_``-prefixed env var."""

    model_config = SettingsConfigDict(env_prefix="API_", env_file=".env", extra="ignore")

    app_version: str = "dev"
    database_url: str = "postgresql+asyncpg://portfolio:portfolio@localhost:5432/portfolio"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    cors_origins: list[str] = ["http://localhost:3000"]
```

- [ ] **Step 4: Write `apps/api/src/portfolio_api/db.py`**

```python
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True)


async def ping(engine: AsyncEngine) -> bool:
    """True if the database answers ``SELECT 1``; False on any connection or query error."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 - any driver error means "unavailable"
        return False
    return True
```

- [ ] **Step 5: Write `apps/api/src/portfolio_api/observability.py`**

```python
import logging

import structlog


def configure_logging(level: str) -> None:
    """JSON logs to stdout so Alloy/Loki can parse them without a pipeline stage."""
    numeric = logging.getLevelNamesMapping()[level.upper()]
    logging.basicConfig(level=numeric, format="%(message)s", force=True)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(numeric),
        cache_logger_on_first_use=True,
    )
```

- [ ] **Step 6: Write `apps/api/src/portfolio_api/schemas/__init__.py` (empty) and `schemas/health.py`**

```python
from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    db: Literal["ok", "unavailable"]
```

- [ ] **Step 7: Write the failing tests**

`apps/api/tests/conftest.py`:

```python
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from portfolio_api.config import Settings
from portfolio_api.main import create_app


@pytest.fixture
def settings() -> Settings:
    # Port 1 refuses connections immediately, so "db unavailable" paths are fast.
    return Settings(
        database_url="postgresql+asyncpg://nobody:nobody@127.0.0.1:1/portfolio",
        app_version="test",
    )


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(settings)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
```

`apps/api/tests/test_health.py`:

```python
from httpx import ASGITransport, AsyncClient

from portfolio_api.config import Settings
from portfolio_api.main import create_app


async def test_health_is_degraded_when_db_unreachable(client: AsyncClient) -> None:
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "degraded", "version": "test", "db": "unavailable"}


async def test_health_is_ok_when_db_reachable(settings: Settings) -> None:
    app = create_app(settings)

    async def fake_ping() -> bool:
        return True

    app.state.db_ping = fake_ping
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.get("/health")
    assert res.json() == {"status": "ok", "version": "test", "db": "ok"}
```

Run: `cd apps/api && uv run pytest`
Expected: FAIL — `ModuleNotFoundError: No module named 'portfolio_api.main'`.

- [ ] **Step 8: Write `apps/api/src/portfolio_api/routers/__init__.py` (empty) and `routers/health.py`**

```python
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from portfolio_api.schemas.health import HealthResponse

DbPing = Callable[[], Awaitable[bool]]


def get_db_ping(request: Request) -> DbPing:
    return request.app.state.db_ping


def get_version(request: Request) -> str:
    return request.app.state.settings.app_version


router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(
    ping: Annotated[DbPing, Depends(get_db_ping)],
    version: Annotated[str, Depends(get_version)],
) -> HealthResponse:
    db_ok = await ping()
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        version=version,
        db="ok" if db_ok else "unavailable",
    )
```

- [ ] **Step 9: Write `apps/api/src/portfolio_api/main.py`**

```python
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import partial

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from portfolio_api.config import Settings
from portfolio_api.db import make_engine, ping
from portfolio_api.observability import configure_logging
from portfolio_api.routers import health


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    engine = make_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await engine.dispose()

    app = FastAPI(title="Portfolio API", version=settings.app_version, lifespan=lifespan)
    app.state.settings = settings
    app.state.db_ping = partial(ping, engine)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router)
    return app
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd apps/api && uv run pytest -v`
Expected: `2 passed`.

- [ ] **Step 11: Lint and type-check**

Run: `cd apps/api && uv run ruff check . && uv run ruff format . && uv run pyright`
Expected: ruff clean; pyright `0 errors`. If pyright flags `request.app.state.*` as `Any`-typed access, that is allowed under strict for attribute access on `State`; fix any other errors.

- [ ] **Step 12: Write `apps/api/env.example`**

```dotenv
# Copy to .env for local runs outside Docker. All keys are prefixed API_.
API_APP_VERSION=dev
API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:5432/portfolio
API_LOG_LEVEL=INFO
API_CORS_ORIGINS=["http://localhost:3000"]
```

- [ ] **Step 13: Commit**

```bash
git add apps/api
git commit -m "feat(api): scaffold FastAPI service with health endpoint and tests"
```

---

### Task 5: Alembic migrations wired to settings

**Files:**
- Create: `apps/api/alembic.ini`, `apps/api/alembic/env.py`, `apps/api/alembic/script.py.mako`, `apps/api/alembic/versions/<rev>_init.py`, `apps/api/src/portfolio_api/models/__init__.py`

**Interfaces:**
- Produces: `portfolio_api.models.Base` (SQLAlchemy `DeclarativeBase`) that all later tables subclass; `uv run alembic upgrade head` and `uv run alembic check` used by CI (Task 8) and the deploy job (Phase 2).

- [ ] **Step 1: Write `apps/api/src/portfolio_api/models/__init__.py`**

```python
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for every table in the ``portfolio`` database."""
```

- [ ] **Step 2: Initialize Alembic with the async template**

Run: `cd apps/api && uv run alembic init -t async alembic`
Expected: `alembic.ini`, `alembic/env.py`, `alembic/script.py.mako`, `alembic/versions/` created.

- [ ] **Step 3: Point `alembic/env.py` at settings and metadata**

In `apps/api/alembic/env.py`, directly after `config = context.config`, add:

```python
from portfolio_api.config import Settings
from portfolio_api.models import Base

config.set_main_option("sqlalchemy.url", Settings().database_url.replace("%", "%%"))
```

and change `target_metadata = None` to `target_metadata = Base.metadata`. In `alembic.ini`, delete the `sqlalchemy.url = ...` line (the URL now comes from `API_DATABASE_URL`).

- [ ] **Step 4: Create the empty initial revision**

Run: `cd apps/api && uv run alembic revision -m "init"`
Expected: a file `alembic/versions/<hash>_init.py` with empty `upgrade()`/`downgrade()`.

- [ ] **Step 5: Verify against a throwaway Postgres**

```bash
docker run -d --name pg-tmp -e POSTGRES_USER=portfolio -e POSTGRES_PASSWORD=portfolio -e POSTGRES_DB=portfolio -p 5433:5432 pgvector/pgvector:0.8.6-pg17
sleep 5
cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:5433/portfolio uv run alembic upgrade head && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:5433/portfolio uv run alembic check
docker rm -f pg-tmp
```
Expected: `Running upgrade  -> <hash>, init` then `No new upgrade operations detected.`

- [ ] **Step 6: Lint and commit**

Run: `cd apps/api && uv run ruff check . && uv run ruff format . && uv run pyright`
```bash
git add apps/api
git commit -m "feat(api): add alembic with settings-driven URL and empty init revision"
```

---

### Task 6: Dockerfiles for web and api

**Files:**
- Create: `apps/web/Dockerfile`, `apps/web/.dockerignore`, `apps/api/Dockerfile`, `apps/api/.dockerignore`

**Interfaces:**
- Produces: images that listen on `3000` (web) and `8000` (api), run as non-root, and have HEALTHCHECKs hitting `/api/healthz` and `/health`. Build arg `NEXT_PUBLIC_APP_VERSION` on web. Used by Compose (Task 7) and release (Task 8).

- [ ] **Step 1: Write `apps/web/.dockerignore`**

```
node_modules
.next
coverage
.env*
!env.example
Dockerfile
```

- [ ] **Step 2: Write `apps/web/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
RUN npm install -g pnpm@11.24.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM base AS build
ARG NEXT_PUBLIC_APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 -G nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["wget", "-qO-", "http://127.0.0.1:3000/api/healthz"]
CMD ["node", "server.js"]
```

- [ ] **Step 3: Build and smoke-test the web image**

```bash
docker build -t portfolio-web:dev apps/web && docker run -d --rm --name web-tmp -p 3000:3000 portfolio-web:dev && sleep 3 && curl -s localhost:3000/api/healthz && docker exec web-tmp id -u && docker rm -f web-tmp
```
Expected: `{"status":"ok","version":"dev"}` and uid `1001`.

- [ ] **Step 4: Write `apps/api/.dockerignore`**

```
.venv
.pytest_cache
.ruff_cache
__pycache__
tests
.env*
!env.example
Dockerfile
```

- [ ] **Step 5: Write `apps/api/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev
COPY src ./src
COPY alembic ./alembic
COPY alembic.ini ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

FROM python:3.12-slim-bookworm AS runner
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --home-dir /app --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
USER 1000:1000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["python", "-c", "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"]
CMD ["uvicorn", "portfolio_api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 6: Build and smoke-test the api image**

```bash
docker build -t portfolio-api:dev apps/api && docker run -d --rm --name api-tmp -p 8000:8000 portfolio-api:dev && sleep 3 && curl -s localhost:8000/health && docker exec api-tmp id -un && docker rm -f api-tmp
```
Expected: `{"status":"degraded","version":"dev","db":"unavailable"}` (no DB yet) and user `app`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/Dockerfile apps/web/.dockerignore apps/api/Dockerfile apps/api/.dockerignore
git commit -m "build: multi-stage non-root Dockerfiles for web and api"
```

---

### Task 7: Local Compose stack, Postgres init, and Makefile

**Files:**
- Create: `infra/compose/compose.dev.yaml`, `infra/compose/env.example`, `infra/postgres/init/01-init.sh`, `Makefile`

**Interfaces:**
- Produces: `make up` brings up postgres, directus, api, web on ports 5432/8055/8000/3000; `make down`, `make logs`, `make ps`, `make test`, `make lint`, `make migrate`, `make dev-web`, `make dev-api`. Postgres roles `directus`, `portfolio`, `umami` each own a same-named DB; `vector` extension only in `portfolio`.

- [ ] **Step 1: Write `infra/postgres/init/01-init.sh`**

```bash
#!/usr/bin/env bash
# Runs once when the Postgres data directory is first initialized.
# One role + one database per application; app containers never get the superuser.
set -euo pipefail

create_app_db() {
  local name="$1" password="$2"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --set=pw="$password" <<SQL
CREATE ROLE ${name} LOGIN PASSWORD :'pw';
CREATE DATABASE ${name} OWNER ${name};
SQL
}

create_app_db directus "$DIRECTUS_DB_PASSWORD"
create_app_db portfolio "$PORTFOLIO_DB_PASSWORD"
create_app_db umami "$UMAMI_DB_PASSWORD"

# pgvector lives only where the API needs it.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname portfolio \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Run: `chmod +x infra/postgres/init/01-init.sh`

- [ ] **Step 2: Write `infra/compose/env.example`**

```dotenv
# Copy to infra/compose/.env for local development. Never commit .env.
POSTGRES_PASSWORD=postgres
DIRECTUS_DB_PASSWORD=directus
PORTFOLIO_DB_PASSWORD=portfolio
UMAMI_DB_PASSWORD=umami

DIRECTUS_SECRET=dev-only-secret-change-me-0123456789
DIRECTUS_ADMIN_EMAIL=admin@example.com
DIRECTUS_ADMIN_PASSWORD=admin

# Host ports (override if something else already listens on the default)
POSTGRES_PORT=5432
DIRECTUS_PORT=8055
API_PORT=8000
WEB_PORT=3000
```

- [ ] **Step 3: Write `infra/compose/compose.dev.yaml`**

```yaml
name: portfolio-dev

services:
  postgres:
    image: pgvector/pgvector:0.8.6-pg17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      DIRECTUS_DB_PASSWORD: ${DIRECTUS_DB_PASSWORD:-directus}
      PORTFOLIO_DB_PASSWORD: ${PORTFOLIO_DB_PASSWORD:-portfolio}
      UMAMI_DB_PASSWORD: ${UMAMI_DB_PASSWORD:-umami}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ../postgres/init:/docker-entrypoint-initdb.d:ro
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10

  directus:
    image: directus/directus:12.3.1
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SECRET: ${DIRECTUS_SECRET:-dev-only-secret-change-me-0123456789}
      ADMIN_EMAIL: ${DIRECTUS_ADMIN_EMAIL:-admin@example.com}
      ADMIN_PASSWORD: ${DIRECTUS_ADMIN_PASSWORD:-admin}
      DB_CLIENT: pg
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_DATABASE: directus
      DB_USER: directus
      DB_PASSWORD: ${DIRECTUS_DB_PASSWORD:-directus}
      PUBLIC_URL: http://localhost:8055
      WEBSOCKETS_ENABLED: "false"
    volumes:
      - directus-uploads:/directus/uploads
    ports:
      - "127.0.0.1:${DIRECTUS_PORT:-8055}:8055"

  api:
    build: ../../apps/api
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      API_DATABASE_URL: postgresql+asyncpg://portfolio:${PORTFOLIO_DB_PASSWORD:-portfolio}@postgres:5432/portfolio
      API_CORS_ORIGINS: '["http://localhost:3000"]'
    ports:
      - "127.0.0.1:${API_PORT:-8000}:8000"

  web:
    build: ../../apps/web
    ports:
      - "127.0.0.1:${WEB_PORT:-3000}:3000"

volumes:
  postgres-data:
  directus-uploads:
```

- [ ] **Step 4: Write `Makefile` (recipes must be indented with a TAB)**

```make
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
```

- [ ] **Step 5: Validate and bring the stack up**

```bash
docker compose -f infra/compose/compose.dev.yaml config -q && make up && sleep 20 && make ps
curl -s localhost:3000/api/healthz; echo; curl -s localhost:8000/health; echo; curl -s localhost:8055/server/ping
```
Expected: four services running; web `{"status":"ok",...}`; api `{"status":"ok","version":"dev","db":"ok"}`; Directus `pong` (its `/server/health` requires admin auth in v12). Open `http://localhost:8055` and log in with `admin@example.com` / `admin`.

- [ ] **Step 6: Verify the init script created the right databases**

```bash
docker compose -f infra/compose/compose.dev.yaml exec postgres psql -U postgres -c "\l" | grep -E 'directus|portfolio|umami'
docker compose -f infra/compose/compose.dev.yaml exec postgres psql -U postgres -d portfolio -c "\dx vector"
```
Expected: three databases owned by their same-named roles; `vector` extension listed in `portfolio`.

- [ ] **Step 7: Run migrations through Compose, then stop**

Run: `make migrate && make down`
Expected: `Running upgrade  -> <hash>, init`.

- [ ] **Step 8: Commit**

```bash
git add infra/compose/compose.dev.yaml infra/compose/env.example infra/postgres/init/01-init.sh Makefile
git commit -m "infra: local compose stack with postgres init, directus, api, web"
```

---

### Task 8: PR CI workflow (path-filtered web / api / infra jobs)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: check runs named `web`, `api`, `infra` (job names) used as required status checks in Task 11. Jobs skip cleanly (which satisfies branch protection) when their paths are untouched.

Note: the spec lists three workflow files; a single workflow with a `changes` gate is used instead so that path-filtered jobs still report a (skipped) status on every PR. Otherwise a docs-only PR would wait forever on a required check that never runs.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  changes:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: read  # dorny/paths-filter needs this on pull_request events
    outputs:
      web: ${{ steps.filter.outputs.web }}
      api: ${{ steps.filter.outputs.api }}
      infra: ${{ steps.filter.outputs.infra }}
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: dorny/paths-filter@v4.0.3
        id: filter
        with:
          filters: |
            web:
              - 'apps/web/**'
              - '.github/workflows/ci.yml'
            api:
              - 'apps/api/**'
              - '.github/workflows/ci.yml'
            infra:
              - 'infra/**'
              - 'scripts/**'
              - 'apps/*/Dockerfile'
              - 'Makefile'
              - '.pre-commit-config.yaml'
              - '.sops.yaml'
              - '.github/workflows/ci.yml'

  web:
    needs: changes
    if: needs.changes.outputs.web == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: apps/web
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: pnpm/action-setup@v6.1.0
        with:
          package_json_file: apps/web/package.json  # no root package.json in this monorepo
      - uses: actions/setup-node@v7.0.0
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: apps/web/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm format
      - run: pnpm test
      - run: pnpm build
        env:
          NEXT_TELEMETRY_DISABLED: 1

  api:
    needs: changes
    if: needs.changes.outputs.api == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: apps/api
    services:
      postgres:
        image: pgvector/pgvector:0.8.6-pg17
        env:
          POSTGRES_USER: portfolio
          POSTGRES_PASSWORD: portfolio
          POSTGRES_DB: portfolio
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U portfolio"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      API_DATABASE_URL: postgresql+asyncpg://portfolio:portfolio@localhost:5432/portfolio
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: astral-sh/setup-uv@v10.1.0
        with:
          enable-cache: true
          cache-dependency-glob: apps/api/uv.lock
      - run: uv sync --frozen
      - run: uv run ruff check .
      - run: uv run ruff format --check .
      - run: uv run pyright
      - run: uv run alembic upgrade head
      - run: uv run alembic check
      - run: uv run pytest

  infra:
    needs: changes
    if: needs.changes.outputs.infra == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7.0.1
      - name: Validate compose files
        run: docker compose -f infra/compose/compose.dev.yaml config -q
      - name: No plaintext env files committed
        run: git ls-files -z '*.env' '.env*' '**/.env*' | xargs -0 -r scripts/check-no-plaintext-env.sh
      - uses: hadolint/hadolint-action@v3.5.0
        with:
          recursive: true
          dockerfile: "**/Dockerfile"
      - uses: ludeeus/action-shellcheck@2.0.0
        with:
          scandir: .
          ignore_paths: node_modules .venv
```

- [ ] **Step 2: Validate locally what can be validated**

```bash
docker run --rm -i hadolint/hadolint < apps/web/Dockerfile
docker run --rm -i hadolint/hadolint < apps/api/Dockerfile
docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable infra/postgres/init/01-init.sh
```
Expected: no output from any (clean). If hadolint warns `DL3018` (unpinned apk) or similar on lines we control, fix the Dockerfile rather than ignoring the rule.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: path-filtered web, api, and infra checks on pull requests"
```

---

### Task 9: Release workflow — build, scan, push to GHCR, deploy stub

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Produces: images `ghcr.io/chrisguzman77/chris-guzman-portfolio/web:<sha>` and `.../api:<sha>` (plus `latest`) on every push to `main`. Deploy job with `runs-on: [self-hosted, portfolio-deploy]` is `if: false` until Phase 2 enables it.

- [ ] **Step 1: Write `.github/workflows/release.yml`**

```yaml
name: release

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

concurrency:
  group: release
  cancel-in-progress: false

env:
  REGISTRY: ghcr.io
  IMAGE_BASE: ghcr.io/${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        app: [web, api]
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: docker/setup-buildx-action@v4.4.1
      - uses: docker/login-action@v4.6.0
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/metadata-action@v6.2.0
        id: meta
        with:
          images: ${{ env.IMAGE_BASE }}/${{ matrix.app }}
          tags: |
            type=sha,prefix=,format=long
            type=raw,value=latest
      - name: Build (load locally so the scanned image is the pushed image)
        uses: docker/build-push-action@v7.4.0
        with:
          context: apps/${{ matrix.app }}
          load: true
          push: false
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            NEXT_PUBLIC_APP_VERSION=${{ github.sha }}
          cache-from: type=gha,scope=${{ matrix.app }}
          cache-to: type=gha,scope=${{ matrix.app }},mode=max
      - name: Scan for critical vulnerabilities
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ${{ env.IMAGE_BASE }}/${{ matrix.app }}:${{ github.sha }}
          severity: CRITICAL
          ignore-unfixed: true
          exit-code: "1"
      - name: Push
        run: docker push --all-tags ${{ env.IMAGE_BASE }}/${{ matrix.app }}

  deploy:
    needs: build
    # Enabled in Phase 2 once the self-hosted runner exists inside the VM.
    if: false
    runs-on: [self-hosted, portfolio-deploy]
    timeout-minutes: 15
    steps:
      - run: echo "deploy placeholder (Phase 2)"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: release workflow builds, scans, and pushes images to GHCR"
```

---

### Task 10: Repo hygiene — pre-commit, Dependabot, CODEOWNERS, PR template

**Files:**
- Create: `.pre-commit-config.yaml`, `scripts/check-no-plaintext-env.sh`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.github/pull_request_template.md`

**Interfaces:**
- Produces: `scripts/check-no-plaintext-env.sh <files...>` exits 1 for any env file that is not `*.example` or a sops-encrypted `*.enc.env`. Task 11 relies on the `.enc.env` rule.

- [ ] **Step 1: Write the failing guard test as a shell check**

Write `scripts/check-no-plaintext-env.sh`:

```bash
#!/usr/bin/env bash
# pre-commit guard: env files may be committed only as *.example (documentation)
# or *.enc.env (sops-encrypted). Anything else is a leaked secret.
set -euo pipefail

status=0
for file in "$@"; do
  case "$file" in
    *.example) ;;
    *.enc.env)
      if ! grep -q '^sops_' "$file"; then
        echo "ERROR: $file is not sops-encrypted (no sops_ metadata)" >&2
        status=1
      fi
      ;;
    *)
      echo "ERROR: refusing to commit plaintext env file: $file" >&2
      status=1
      ;;
  esac
done
exit "$status"
```

Run:
```bash
chmod +x scripts/check-no-plaintext-env.sh
printf 'A=1\n' > /tmp/plain.env; printf 'A=1\n' > /tmp/bad.enc.env; printf 'A=ENC[x]\nsops_version=3.13\n' > /tmp/good.enc.env
scripts/check-no-plaintext-env.sh /tmp/plain.env; echo "exit=$?"
scripts/check-no-plaintext-env.sh /tmp/bad.enc.env; echo "exit=$?"
scripts/check-no-plaintext-env.sh /tmp/good.enc.env infra/compose/env.example; echo "exit=$?"
```
Expected: `exit=1`, `exit=1`, `exit=0`.

- [ ] **Step 2: Write `.pre-commit-config.yaml`**

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v6.0.0
    hooks:
      - id: check-yaml
      - id: check-added-large-files
        args: ["--maxkb=1024"]
      - id: detect-private-key
      - id: end-of-file-fixer
      - id: trailing-whitespace
        args: ["--markdown-linebreak-ext=md"]

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.16.8
    hooks:
      - id: ruff-check
        args: ["--fix"]
        files: ^apps/api/
      - id: ruff-format
        files: ^apps/api/

  - repo: local
    hooks:
      - id: prettier-web
        name: prettier (apps/web)
        entry: apps/web/node_modules/.bin/prettier --write --ignore-path apps/web/.prettierignore
        language: system
        files: ^apps/web/.*\.(ts|tsx|css|json|md)$
      - id: no-plaintext-env
        name: block plaintext env files
        entry: scripts/check-no-plaintext-env.sh
        language: script
        files: (^|/)[^/]*\.env(\.[^/]+)?$
```

- [ ] **Step 3: Install and run pre-commit on everything**

```bash
uv tool install pre-commit && pre-commit install && pre-commit run --all-files
```
Expected: all hooks `Passed` (or files auto-fixed; re-run until clean). If `ruff-check` is reported as an unknown hook id, change it to `ruff`.

- [ ] **Step 4: Write `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /apps/web
    schedule: { interval: weekly }
    groups:
      web-minor: { update-types: [minor, patch] }
  - package-ecosystem: uv
    directory: /apps/api
    schedule: { interval: weekly }
    groups:
      api-minor: { update-types: [minor, patch] }
  - package-ecosystem: docker
    directory: /apps/web
    schedule: { interval: weekly }
  - package-ecosystem: docker
    directory: /apps/api
    schedule: { interval: weekly }
  - package-ecosystem: docker-compose
    directory: /infra/compose
    schedule: { interval: weekly }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

- [ ] **Step 5: Write `.github/CODEOWNERS` and `.github/pull_request_template.md`**

`.github/CODEOWNERS`:
```
* @chrisguzman77
```

`.github/pull_request_template.md`:
```markdown
## What

## Why

## How to verify

- [ ] CI green
- [ ] Ran it locally (`make up` / `make test`)
- [ ] Docs or ADR updated if a decision changed
```

- [ ] **Step 6: Commit**

```bash
git add .pre-commit-config.yaml scripts/check-no-plaintext-env.sh .github/dependabot.yml .github/CODEOWNERS .github/pull_request_template.md
git commit -m "chore: pre-commit hooks, plaintext-env guard, dependabot, codeowners"
```

---

### Task 11: SOPS + age secrets scaffold

**Files:**
- Create: `.sops.yaml`, `infra/compose/prod.enc.env`

**Interfaces:**
- Produces: `infra/compose/prod.enc.env` decryptable with `sops decrypt` by the laptop key; Phase 2 adds the VM key to `.sops.yaml` and runs `sops updatekeys`.

- [ ] **Step 1: Install sops and generate the laptop key**

```bash
brew install sops
mkdir -p ~/.config/sops/age && [ -f ~/.config/sops/age/keys.txt ] || age-keygen -o ~/.config/sops/age/keys.txt
grep 'public key' ~/.config/sops/age/keys.txt
```
Expected: a line `# public key: age1...`. Copy that value; it is `LAPTOP_PUBKEY` below. The private key never leaves `~/.config/sops/age/keys.txt`.

- [ ] **Step 2: Write `.sops.yaml`**

```yaml
# Encrypt every *.enc.env for the listed age recipients.
# Phase 2 appends the VM's public key and runs: sops updatekeys infra/compose/prod.enc.env
creation_rules:
  - path_regex: \.enc\.env$
    age: LAPTOP_PUBKEY
```
Replace `LAPTOP_PUBKEY` with the real `age1...` value.

- [ ] **Step 3: Create and encrypt the production env placeholder**

```bash
cat > infra/compose/prod.enc.env <<'EOF'
# Production secrets. Values are placeholders until Phase 2.
POSTGRES_PASSWORD=change-me
DIRECTUS_DB_PASSWORD=change-me
PORTFOLIO_DB_PASSWORD=change-me
UMAMI_DB_PASSWORD=change-me
DIRECTUS_SECRET=change-me
DIRECTUS_ADMIN_EMAIL=admin@example.com
DIRECTUS_ADMIN_PASSWORD=change-me
CLOUDFLARE_TUNNEL_TOKEN=change-me
EOF
sops encrypt --in-place infra/compose/prod.enc.env
head -3 infra/compose/prod.enc.env
sops decrypt infra/compose/prod.enc.env | head -2
```
Expected: the file now shows `POSTGRES_PASSWORD=ENC[AES256_GCM,...]` lines plus `sops_*` metadata; decrypt prints the plaintext.

- [ ] **Step 4: Prove the guard blocks plaintext**

```bash
printf 'X=1\n' > /tmp/plain.env; scripts/check-no-plaintext-env.sh /tmp/plain.env; echo "exit=$?"; rm /tmp/plain.env
pre-commit run no-plaintext-env --files infra/compose/prod.enc.env; echo "exit=$?"
```
Expected: first `exit=1` with the refusal message; second `exit=0`. (The plaintext probe lives in `/tmp` on purpose: never create a `.env` file inside the repo, even temporarily.)

- [ ] **Step 5: Commit**

```bash
git add .sops.yaml infra/compose/prod.enc.env
git commit -m "infra: sops+age scaffold with encrypted production env placeholder"
```

---

### Task 12: Docs — architecture, ADRs, setup order, README

**Files:**
- Create: `docs/architecture.md`, `docs/setup.md`, `docs/adr/README.md`, `docs/adr/0001-monorepo.md`, `docs/adr/0002-directus-as-cms.md`, `docs/adr/0003-cloudflare-tunnel-direct-ingress.md`, `docs/adr/0004-sops-age-secrets.md`, `docs/adr/0005-self-hosted-runner-deploys.md`
- Modify: `README.md`

- [ ] **Step 1: Write `docs/architecture.md`**

````markdown
# Architecture

Three deployables behind one Cloudflare Tunnel, all on a single Docker Compose host.

```mermaid
flowchart LR
  U[Visitor] --> CF[Cloudflare: DNS, WAF, cache, Access, Turnstile]
  CF -- tunnel --> T[cloudflared]
  subgraph VM [Proxmox VM · Docker Compose]
    T --> W[web · Next.js]
    T --> A[api · FastAPI]
    T -. Access-gated .-> D[directus admin]
    W -- read token --> D
    A -- read token --> D
    A --> P[(postgres + pgvector)]
    D --> P
  end
```

| Component | Responsibility | Talks to |
|---|---|---|
| web | Presentation. Server components read Directus; browser calls the API for interactions. ISR + tag revalidation. | directus (internal), api (public hostname) |
| api | Interactions and intelligence: contact, views/reactions, resume download, GitHub cache, RAG chat. Owns the `portfolio` DB. | postgres, directus (internal), external APIs |
| directus | Content system of record. Schema, roles, and flows are committed and applied on deploy. | postgres |

Boundaries that matter:
- Directus is never publicly reachable except its admin UI behind Cloudflare Access. Assets are proxied through `web`.
- `web` never fetches the CMS at build time; CI has no route to it.
- Only `api` and `directus` hold Postgres credentials, each for its own database.

Decisions are recorded in [`adr/`](adr/README.md). Phase-by-phase delivery is in the [design spec](superpowers/specs/2026-09-16-portfolio-design.md).
````

- [ ] **Step 2: Write `docs/adr/README.md` and the five ADRs**

`docs/adr/README.md`:
```markdown
# Architecture Decision Records

One file per decision, numbered, never edited after acceptance (superseded instead).

| # | Decision |
|---|---|
| [0001](0001-monorepo.md) | Single repository for web, api, and infra |
| [0002](0002-directus-as-cms.md) | Directus as the self-hosted content system of record |
| [0003](0003-cloudflare-tunnel-direct-ingress.md) | Cloudflare Tunnel with direct ingress; no reverse proxy container |
| [0004](0004-sops-age-secrets.md) | Secrets as SOPS+age encrypted files in the repo |
| [0005](0005-self-hosted-runner-deploys.md) | Deploy via an ephemeral self-hosted GitHub Actions runner inside the VM |
```

`docs/adr/0001-monorepo.md`:
```markdown
# 0001 — Single repository for web, api, and infra

Status: accepted · 2026-09-16

## Context
The site is three deployables (Next.js, FastAPI, Directus config) plus Compose/CI that change together. It is maintained by one person and reviewed by recruiters who will open exactly one repo.

## Decision
One repository: `apps/web`, `apps/api`, `infra/`, `docs/`. Each app keeps its own toolchain (pnpm, uv) and Dockerfile; there is no cross-app build orchestration (no Turborepo/Nx).

## Consequences
- One PR can change an API contract and its consumer atomically.
- CI uses path filters so an API change does not rebuild the web app.
- Versioning is by git SHA; images are tagged with the commit that built them.
```

`docs/adr/0002-directus-as-cms.md`:
```markdown
# 0002 — Directus as the self-hosted content system of record

Status: accepted · 2026-09-16

## Context
Posts, projects, experience, and the resume file need an editing UI. Options: MDX in the repo, a hosted CMS (Sanity), or a self-hosted CMS (Directus, Payload, Strapi).

## Decision
Directus, self-hosted in the same Compose stack, on its own database inside the shared Postgres instance. Content is read by `web` and `api` over the Docker network using read-only static tokens. Schema snapshot, roles/policies, and flows are committed under `infra/directus/` and applied idempotently on deploy.

## Consequences
- No vendor account; content lives with the rest of the system and is covered by the same backups.
- Directus is never publicly exposed except its admin UI behind Cloudflare Access; asset URLs are rewritten to a `web` proxy route.
- A schema change is a PR (snapshot diff), not a click in production.
```

`docs/adr/0003-cloudflare-tunnel-direct-ingress.md`:
```markdown
# 0003 — Cloudflare Tunnel with direct ingress; no reverse proxy container

Status: accepted · 2026-09-16

## Context
The VM sits on a home network. Port forwarding exposes the home IP and requires TLS management on the box.

## Decision
`cloudflared` runs as a container and its ingress rules route each hostname straight to a service (`web:3000`, `api:8000`, `directus:8055`, ...). No Caddy/Traefik. TLS terminates at Cloudflare; admin hostnames are gated by Cloudflare Access.

## Consequences
- Zero inbound ports on the router; the home IP is never published.
- One fewer container and config format; routing is one YAML file.
- The origin trusts `CF-Connecting-IP` because the only path in is the tunnel.
- Loss of the tunnel or ISP means loss of the site; a Cloudflare Worker serves a fallback page and an external monitor alerts.
```

`docs/adr/0004-sops-age-secrets.md`:
```markdown
# 0004 — Secrets as SOPS+age encrypted files in the repo

Status: accepted · 2026-09-16

## Context
Around twenty secrets (DB passwords, tunnel token, API keys) must reach the VM at deploy time. GitHub Environment secrets are write-only and awkward for whole env files.

## Decision
`infra/compose/*.enc.env` are encrypted with SOPS using age recipients listed in `.sops.yaml` (laptop key + VM key). The deploy job decrypts with the VM's key at `/etc/portfolio/age.key`. A pre-commit hook rejects any plaintext env file.

## Consequences
- Secrets are versioned, diffable (keys, not values), and rotated with `sops updatekeys`.
- The only unencrypted secret anywhere is the age private key on the VM and on the laptop.
- Anyone with repo read access sees the ciphertext; that is acceptable for age-encrypted data.
```

`docs/adr/0005-self-hosted-runner-deploys.md`:
```markdown
# 0005 — Deploy via an ephemeral self-hosted GitHub Actions runner inside the VM

Status: accepted · 2026-09-16

## Context
The VM has no inbound ports, so CI cannot SSH in. Options: a pull-based agent (Watchtower), a webhook receiver, or a self-hosted runner.

## Decision
An ephemeral, repo-scoped runner container (label `portfolio-deploy`) runs inside the VM. The `deploy` job in `release.yml` executes only on `push` to `main` after images are built and scanned on GitHub-hosted runners. PR jobs never run on the self-hosted runner. The repository setting "require approval for all outside collaborators" is enabled.

## Consequences
- Deploy logs and status live in GitHub next to the build.
- The runner never sees long-lived secrets; it decrypts with the VM-local age key.
- Fork PRs cannot reach the runner: they are approval-gated and no PR job targets its label.
- GitHub-hosted minutes are free on this public repo; the self-hosted runner is never billed.
```

- [ ] **Step 3: Write `docs/setup.md` (skeleton; Phase 2 fills each section)**

```markdown
# Setup

Ordered checklist of every external account and machine this project needs. Each section will be expanded in the phase that uses it.

## Local development (Phase 1)
1. Install: Node 24, pnpm 11, uv, Docker Desktop, age, sops (`brew install sops age`), pre-commit (`uv tool install pre-commit`).
2. `cp infra/compose/env.example infra/compose/.env`
3. `make up` then open http://localhost:3000, http://localhost:8000/docs, http://localhost:8055 (admin@example.com / admin).
4. `pre-commit install`
5. Secrets: generate an age key (`age-keygen -o ~/.config/sops/age/keys.txt`) and have its public key added to `.sops.yaml`. On macOS, sops looks for the key under `~/Library/Application Support/sops/age/keys.txt`, so add `export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"` to your shell profile (the Linux VM sets the same variable to `/etc/portfolio/age.key`). Test with `sops decrypt infra/compose/prod.enc.env | head -2`.

## Domain and Cloudflare (Phase 2)
- Buy a domain on Cloudflare Registrar; zone on Cloudflare DNS; enable Always Use HTTPS.
- Zero Trust: create a tunnel; create Access applications for `cms.`, `grafana.`, `status.`, `analytics.`.

## Proxmox VM (Phase 2)
- Ubuntu 24.04 cloud-init VM: 4 vCPU, 8 GB RAM, 60 GB disk, static LAN IP.
- Run `infra/vm/bootstrap.sh`; generate the VM age key at `/etc/portfolio/age.key`.

## GitHub (Phase 2)
- Register the self-hosted runner (label `portfolio-deploy`).
- Settings → Actions: require approval for all outside collaborators.

## Email, Turnstile, GitHub PAT (Phase 4)
- Resend account + domain DKIM/SPF records; Turnstile site key; GitHub PAT with `read:user`.

## Anthropic (Phase 5)
- API key for Claude Sonnet 5; set a monthly spend limit in the console.

## Cloudflare R2 (Phase 6)
- Bucket for encrypted backups with a 30-day lifecycle rule; scoped API token.
```

- [ ] **Step 4: Replace `README.md`**

```markdown
# chris-guzman-portfolio

Personal site of Christopher Guzman: experience, projects, blog, resume, and an AI chat grounded in the site's content. Self-hosted on a Proxmox VM behind a Cloudflare Tunnel.

[![ci](https://github.com/chrisguzman77/chris-guzman-portfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/chrisguzman77/chris-guzman-portfolio/actions/workflows/ci.yml)
[![release](https://github.com/chrisguzman77/chris-guzman-portfolio/actions/workflows/release.yml/badge.svg)](https://github.com/chrisguzman77/chris-guzman-portfolio/actions/workflows/release.yml)

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js (App Router, TypeScript, Tailwind, shadcn) |
| `apps/api` | FastAPI service: interactions, GitHub cache, RAG chat |
| `infra/` | Compose stacks, Postgres init, Directus schema, Cloudflare, observability |
| `docs/` | [Architecture](docs/architecture.md), [ADRs](docs/adr/README.md), [setup](docs/setup.md), design spec |

## Quick start

```bash
cp infra/compose/env.example infra/compose/.env
make up        # postgres + directus + api + web
make test      # web (vitest) + api (pytest)
make lint      # eslint, tsc, prettier, ruff, pyright
```

Web: http://localhost:3000 · API docs: http://localhost:8000/docs · CMS: http://localhost:8055

## How it is built

Read the [design spec](docs/superpowers/specs/2026-09-16-portfolio-design.md) for the system design and the seven delivery phases, and the [ADRs](docs/adr/README.md) for the reasoning behind each infrastructure choice.
```

- [ ] **Step 5: Run pre-commit and commit**

```bash
pre-commit run --all-files
git add README.md docs
git commit -m "docs: architecture overview, ADRs 0001-0005, setup checklist, README"
```

---

### Task 13: Open the PR, verify CI, merge, verify images, protect main

**Files:** none new.

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/phase-1-foundation
gh pr create --title "Phase 1: foundation, skeleton, CI" --body "$(cat <<'EOF'
## What
Monorepo scaffold: Next.js app, FastAPI service, Dockerfiles, local Compose stack, PR CI, release pipeline (deploy stubbed), SOPS+age scaffold, docs and ADRs.

## Why
Phase 1 of docs/superpowers/specs/2026-09-16-portfolio-design.md.

## How to verify
- [ ] CI green (web, api, infra all ran because all paths changed)
- [ ] `make up` locally: /api/healthz, /health, Directus login
- [ ] After merge: release workflow pushes web and api images to GHCR

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Watch CI**

Run: `gh pr checks --watch`
Expected: `web`, `api`, `infra` all pass. Fix and push if not.

- [ ] **Step 3: Verify path filtering with a docs-only follow-up commit**

```bash
printf '\n' >> docs/setup.md && git commit -am "docs: touch" && git push
gh pr checks
```
Expected: `web`, `api`, `infra` show `skipping`/`skipped`; `changes` passes. Then revert: `git revert --no-edit HEAD && git push`.

- [ ] **Step 4: Merge and verify the release**

```bash
gh pr merge --squash --delete-branch
gh run watch --exit-status $(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh api /user/packages?package_type=container --jq '.[].name'
```
Expected: release run succeeds with `deploy` skipped; packages `chris-guzman-portfolio/web` and `chris-guzman-portfolio/api` listed.

- [ ] **Step 5: Protect `main` with the real check names**

```bash
gh api repos/chrisguzman77/chris-guzman-portfolio/commits/$(git rev-parse origin/main)/check-runs --jq '.check_runs[].name' | sort -u
```
Use the names printed (expected `web`, `api`, `infra`) in:

```bash
gh api -X PUT repos/chrisguzman77/chris-guzman-portfolio/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["web", "api", "infra"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```
Expected: JSON response echoing the protection. Confirm with `gh api repos/chrisguzman77/chris-guzman-portfolio/branches/main/protection --jq .required_status_checks.contexts`.

- [ ] **Step 6: Make the images public (so `docker compose pull` on the VM needs no token)**

In GitHub → Packages → each of `web`, `api` → Package settings → Change visibility → Public. Verify: `docker pull ghcr.io/chrisguzman77/chris-guzman-portfolio/api:latest` succeeds while logged out.

---

## Phase 1 exit criteria (from the spec)

- `make up` → `/api/healthz` and `/health` return 200 with `db: ok`.
- A PR touching only `apps/api` runs only the `api` job (others skipped).
- Merge to `main` pushes `web:<sha>` and `api:<sha>` to GHCR with Trivy green.
- Committing a plaintext `.env` is blocked by pre-commit.
- ADRs 0001–0005, `docs/architecture.md`, `docs/setup.md` exist; `main` is protected.
