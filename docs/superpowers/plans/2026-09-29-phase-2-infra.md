# Phase 2 — Infra to Production Hello-World — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the Proxmox VM needs to serve `christopherguzman.me` through the Cloudflare Tunnel and deploy itself on every push to `main`: a production Compose stack, an ephemeral self-hosted runner, deploy and smoke scripts, a VM bootstrap script, an outage fallback Worker, and hardened CI.

**Architecture:** `infra/compose/compose.yaml` runs postgres, directus, api, web, cloudflared and a GitHub Actions runner on one Docker network with **no published host ports**; cloudflared is the only way in. `release.yml` builds and scans `web`, `api` and `runner` images, pushes them to GHCR, then (only when the repo variable `DEPLOY_ENABLED` is `true`) runs `scripts/deploy.sh` on the self-hosted runner, which decrypts `prod.enc.env` with the VM's age key, migrates, recreates services, and smoke-tests. The runner container mounts the host Docker socket and `/opt/portfolio` at the same path so relative bind mounts resolve on the host; it is never in the deploy's service list, so a deploy cannot restart the runner mid-job.

**Tech Stack:** Docker Compose v5 · cloudflare/cloudflared 2026.9.3 · ghcr.io/actions/actions-runner 2.337.0 · docker compose plugin v5.5.1 · sops v3.13.3 · age v1.3.2 · Ubuntu 24.04 · ufw · unattended-upgrades · Cloudflare Workers (ES modules) · node:test · GitHub Actions (SHA-pinned).

Spec: `docs/superpowers/specs/2026-09-16-portfolio-design.md` (Phase 2 section). Phase 1 plan: `docs/superpowers/plans/2026-09-16-phase-1-foundation.md`.

## Global Constraints

- Domain `christopherguzman.me`. Tunnel routes (already configured in Cloudflare): apex and `www` → `web:3000`, `api` → `api:8000`, `cms` → `directus:8055`. `cms` is behind Cloudflare Access.
- The VM has **4 GiB RAM total**. Production `mem_limit` values: postgres `768m`, directus `512m`, api `384m`, web `256m`, cloudflared `128m`, runner `768m` (sum ≈ 2.8 GiB).
- Compose project name `portfolio`; production file `infra/compose/compose.yaml`; **no service publishes a host port**.
- Images: `ghcr.io/chrisguzman77/chris-guzman-portfolio/{web,api,runner}`; web and api run `${IMAGE_TAG}`; runner runs `${RUNNER_TAG:-latest}`.
- Pinned versions: `cloudflare/cloudflared:2026.9.3`; `ghcr.io/actions/actions-runner:2.337.0`; compose `v5.5.1` sha256 `db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576`; sops `v3.13.3` sha256 `e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b`; age `v1.3.2` linux-amd64 tarball sha256 `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10`.
- Every downloaded binary is verified with `sha256sum -c`.
- Secrets exist only in sops-encrypted `infra/compose/prod.enc.env`. Scripts decrypt to a `mktemp` file removed by `trap … EXIT` and never print values.
- **Never create, read, or write any file named `.env` or matching `.env.*`.** Test env files live in the session scratchpad with names like `prod-test.vars`.
- Runner: label `portfolio-deploy`, uid `1001`, ephemeral, repo-scoped, registered with a fine-grained PAT held in `GITHUB_RUNNER_TOKEN`.
- Deploy runs only when repo variable `DEPLOY_ENABLED == 'true'`.
- Every `uses:` is pinned to a full commit SHA with a `# vX.Y.Z` comment (SHAs listed in Task 1).
- Shell scripts: `#!/usr/bin/env bash`, `set -euo pipefail`, shellcheck-clean. Dockerfiles hadolint-clean.
- Branch `feat/phase-2-infra` off `main`; commit after every task; commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File structure

| Path | Responsibility |
|---|---|
| `.github/workflows/ci.yml` | SHA-pinned; web/api jobs also build their image; infra job validates prod compose, builds runner image, tests the Worker |
| `.github/workflows/release.yml` | SHA-pinned; builds web/api/runner; deploy job gated on `vars.DEPLOY_ENABLED` |
| `.github/dependabot.yml` | Ignore semver-major Docker base-image bumps; track `infra/runner` |
| `infra/cloudflare/worker-fallback.mjs` | Worker: www→apex redirect, pass-through, branded 503 when origin is down |
| `infra/cloudflare/worker-fallback.test.mjs` | node:test unit tests for the Worker |
| `infra/cloudflare/README.md` | Record of tunnel/Access config; Worker, route, and cache-rule setup |
| `infra/runner/Dockerfile`, `infra/runner/entrypoint.sh` | Ephemeral runner image with compose, sops, age |
| `infra/compose/compose.yaml` | Production stack |
| `infra/compose/prod.env.example` | Documents every production variable (dummy values; used by CI `config` check) |
| `scripts/deploy.sh`, `scripts/smoke.sh` | Deploy/rollback and post-deploy checks |
| `Makefile` | `prod-config`, `secrets-edit`, `secrets-check` |
| `infra/vm/bootstrap.sh`, `infra/vm/README.md` | Idempotent VM setup; record of how VM 400 was built |
| `docs/runbook.md`, `docs/adr/0006-runner-in-compose.md`, `docs/setup.md`, `docs/architecture.md`, `docs/adr/README.md` | Operations and decisions |

---

### Task 1: CI hardening — SHA-pinned actions, image builds in PR CI, Dependabot major-bump guard

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`

**Interfaces:**
- Produces: the job names `web`, `api`, `infra` are unchanged (they are required checks on `main`). Later tasks add steps to these workflows using the pinned SHAs below.

Pinned SHAs (use exactly these):

```
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
astral-sh/setup-uv@c18668ad3cf93ea998bef934396af7bb5c839dc7 # v10.2.0
dorny/paths-filter@ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d # v4.0.3
hadolint/hadolint-action@06be81baf89a55ffd0e24b8f04a4185738dd3387 # v3.5.0
ludeeus/action-shellcheck@00cae500b08a931fb5698e11e79bfbd38e612a38 # 2.0.0
docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0
docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
```

- [ ] **Step 1: Replace every `uses: owner/repo@vX` in both workflows** with the SHA form above, e.g. `- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`. Keep every `with:` block unchanged.

- [ ] **Step 2: Build images in PR CI.** In `ci.yml`, append to the `web` job's steps:

```yaml
      - name: Build image (catches Dockerfile and base-image breakage)
        working-directory: .
        run: docker build --build-arg NEXT_PUBLIC_APP_VERSION=ci -t ci-web apps/web
```

and append to the `api` job's steps:

```yaml
      - name: Build image (catches Dockerfile and base-image breakage)
        working-directory: .
        run: docker build -t ci-api apps/api
```

- [ ] **Step 3: Dependabot major-version guard.** Replace `.github/dependabot.yml` with:

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
  # Base-image majors (Node 24→26, Python 3.12→3.14) are upgraded by hand:
  # they can break a stage Dependabot cannot see (e.g. the uv builder's Python).
  - package-ecosystem: docker
    directory: /apps/web
    schedule: { interval: weekly }
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]
  - package-ecosystem: docker
    directory: /apps/api
    schedule: { interval: weekly }
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]
  - package-ecosystem: docker
    directory: /infra/runner
    schedule: { interval: weekly }
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]
  - package-ecosystem: docker-compose
    directory: /infra/compose
    schedule: { interval: weekly }
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

(`/infra/runner` does not exist until Task 3; Dependabot tolerates that until then.)

- [ ] **Step 4: Verify**

```bash
python3 -c "import yaml;[yaml.safe_load(open(f)) for f in ('.github/workflows/ci.yml','.github/workflows/release.yml','.github/dependabot.yml')];print('yaml ok')"
grep -nE 'uses: [^ ]+@v?[0-9]' .github/workflows/*.yml || echo "no tag-pinned actions left"
grep -cE 'uses: [^ ]+@[0-9a-f]{40} # ' .github/workflows/ci.yml .github/workflows/release.yml
docker build --build-arg NEXT_PUBLIC_APP_VERSION=ci -t ci-web apps/web && docker build -t ci-api apps/api
```

Expected: `yaml ok`; `no tag-pinned actions left`; ci.yml count 10, release.yml count 6; both images build.

- [ ] **Step 5: Commit** — `ci: pin actions by SHA, build images in PR CI, guard base-image majors`

---

### Task 2: Outage fallback Worker with tests

**Files:**
- Create: `infra/cloudflare/worker-fallback.mjs`, `infra/cloudflare/worker-fallback.test.mjs`, `infra/cloudflare/README.md`
- Modify: `.github/workflows/ci.yml` (infra job)

**Interfaces:**
- Produces: a Worker module whose default export has `fetch(request)`; the README section "Deploy the fallback Worker" is linked from the runbook in Task 8.

- [ ] **Step 1: Write the failing tests** `infra/cloudflare/worker-fallback.test.mjs`:

```js
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import worker from "./worker-fallback.mjs";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function originReturns(status) {
  globalThis.fetch = async () => new Response(`origin ${status}`, { status });
}

test("redirects www to the apex, keeping path and query", async () => {
  const res = await worker.fetch(new Request("https://www.christopherguzman.me/blog/x?y=1"));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://christopherguzman.me/blog/x?y=1");
});

test("passes healthy origin responses through untouched", async () => {
  originReturns(200);
  const res = await worker.fetch(new Request("https://christopherguzman.me/"));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "origin 200");
});

test("passes application errors such as 404 through", async () => {
  originReturns(404);
  const res = await worker.fetch(new Request("https://christopherguzman.me/missing"));
  assert.equal(res.status, 404);
});

for (const status of [502, 521, 530]) {
  test(`serves the fallback page when the origin returns ${status}`, async () => {
    originReturns(status);
    const res = await worker.fetch(new Request("https://christopherguzman.me/"));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "300");
    assert.match(await res.text(), /back shortly/i);
  });
}

test("serves the fallback page when the origin fetch throws", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const res = await worker.fetch(new Request("https://christopherguzman.me/"));
  assert.equal(res.status, 503);
});
```

Run: `node --test infra/cloudflare/worker-fallback.test.mjs`
Expected: FAIL — `Cannot find module …/worker-fallback.mjs`.

- [ ] **Step 2: Write `infra/cloudflare/worker-fallback.mjs`**

```js
// Cloudflare Worker routed on christopherguzman.me/* and www.christopherguzman.me/*.
// Redirects www to the apex, passes every other request to the origin (the
// tunnel), and replaces "origin unreachable" responses with a branded page so a
// home-internet or VM outage reads as planned maintenance, not a broken site.
const APEX = "christopherguzman.me";

// 502-504 from cloudflared, 52x from Cloudflare, 530 (error 1033) when no tunnel connector is up.
const ORIGIN_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Back shortly · Christopher Guzman</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f8fa; --ink: #1a2230; --muted: #5b6575; --accent: #2f4fa8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1419; --ink: #e7ebf1; --muted: #9aa3b0; --accent: #8fa8f0; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font: 600 2rem/1.2 Georgia, "Times New Roman", serif; margin: 0 0 .75rem; }
  p { color: var(--muted); margin: 0 0 1rem; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Back shortly</h1>
  <p>This site runs on a server I operate myself, and it is offline for a few minutes. This page retries on its own.</p>
  <p>In the meantime: <a href="https://github.com/chrisguzman77">GitHub</a> ·
     <a href="https://www.linkedin.com/in/christopher-emmanuel-guzman/">LinkedIn</a></p>
</main>
</body>
</html>`;

function fallback() {
  return new Response(PAGE, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": "300",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === `www.${APEX}`) {
      url.hostname = APEX;
      return Response.redirect(url.toString(), 301);
    }
    let response;
    try {
      response = await fetch(request);
    } catch {
      return fallback();
    }
    return ORIGIN_DOWN.has(response.status) ? fallback() : response;
  },
};
```

- [ ] **Step 3: Run tests** — `node --test infra/cloudflare/worker-fallback.test.mjs` → `pass 7`, `fail 0`, no warnings.

- [ ] **Step 4: Add the tests to CI.** In `ci.yml` `infra` job, after the checkout step, add:

```yaml
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - name: Fallback Worker tests
        run: node --test infra/cloudflare/worker-fallback.test.mjs
```

- [ ] **Step 5: Write `infra/cloudflare/README.md`**

````markdown
# Cloudflare configuration

Everything in Cloudflare is configured in the dashboard; this file is the record of it.

## Tunnel `portfolio` (Zero Trust → Networks → Tunnels)

| Public hostname | Service |
|---|---|
| `christopherguzman.me` | `http://web:3000` |
| `www.christopherguzman.me` | `http://web:3000` |
| `api.christopherguzman.me` | `http://api:8000` |
| `cms.christopherguzman.me` | `http://directus:8055` |
| anything else | `http_status:404` |

Service names resolve on the Compose network because `cloudflared` runs in the same stack. The tunnel token lives only in `infra/compose/prod.enc.env` as `CLOUDFLARE_TUNNEL_TOKEN`.

## Access

Application `Directus admin` protects `cms.christopherguzman.me`. Policy `Chris only`: Allow, include Emails = owner's address. Login method: One-time PIN only, instant authentication on.

## Deploy the fallback Worker

1. Workers & Pages → Create → Create Worker → name `portfolio-fallback` → Deploy.
2. Edit code → replace everything with `worker-fallback.mjs` from this directory → Deploy.
3. Worker → Settings → Domains & Routes → Add → Route: `christopherguzman.me/*` (zone christopherguzman.me). Add a second route `www.christopherguzman.me/*`.
4. Check: stop the web container on the VM (`docker compose -f infra/compose/compose.yaml stop web`), load the site, see "Back shortly" with HTTP 503; start it again.

`api.` and `cms.` are deliberately not routed through the Worker: API clients should see real status codes, and the CMS is behind Access.

## Cache rule for static assets

Caching → Cache Rules → Create rule `next static`: URI Path starts with `/_next/static/` → Eligible for cache, Edge TTL override 1 year, Browser TTL respect origin. Check with `curl -sI https://christopherguzman.me/_next/static/<any file> | grep -i cf-cache-status` twice; the second shows `HIT`.
````

- [ ] **Step 6: Commit** — `feat(infra): outage fallback Worker with tests`

---

### Task 3: Ephemeral self-hosted runner image

**Files:**
- Create: `infra/runner/Dockerfile`, `infra/runner/entrypoint.sh`
- Modify: `.github/workflows/ci.yml` (infra job)

**Interfaces:**
- Consumes env `GITHUB_RUNNER_TOKEN` (fine-grained PAT, Administration: read and write), `GITHUB_RUNNER_REPO` (`owner/repo`), optional `RUNNER_NAME` (default `portfolio-vm`), `RUNNER_LABELS` (default `portfolio-deploy`).
- Produces: image with `docker`, `docker compose`, `git`, `jq`, `curl`, `sops`, `age`, running as uid 1001; registers one ephemeral runner, runs one job, exits.

- [ ] **Step 1: Write `infra/runner/entrypoint.sh`**

```bash
#!/usr/bin/env bash
# Registers an ephemeral, repo-scoped GitHub Actions runner, runs exactly one
# job, then exits. Compose restarts the container, which registers a fresh
# runner for the next job, so no state carries over between deploys.
set -euo pipefail

: "${GITHUB_RUNNER_TOKEN:?set GITHUB_RUNNER_TOKEN to a fine-grained PAT (Administration: read and write)}"
: "${GITHUB_RUNNER_REPO:?set GITHUB_RUNNER_REPO to owner/repo}"
RUNNER_NAME="${RUNNER_NAME:-portfolio-vm}"
RUNNER_LABELS="${RUNNER_LABELS:-portfolio-deploy}"

cd /home/runner

# Trade the long-lived PAT for a one-hour registration token.
registration_token="$(
  curl -fsS -X POST \
    -H "Authorization: Bearer ${GITHUB_RUNNER_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GITHUB_RUNNER_REPO}/actions/runners/registration-token" |
    jq -r '.token // empty'
)"
if [[ -z "${registration_token}" ]]; then
  echo "could not obtain a runner registration token for ${GITHUB_RUNNER_REPO}" >&2
  exit 1
fi

./config.sh --unattended --ephemeral --replace --disableupdate \
  --url "https://github.com/${GITHUB_RUNNER_REPO}" \
  --token "${registration_token}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS}"

# Jobs must never see the PAT.
unset GITHUB_RUNNER_TOKEN registration_token
exec ./run.sh
```

- [ ] **Step 2: Write `infra/runner/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM ghcr.io/actions/actions-runner:2.337.0

ARG COMPOSE_VERSION=v5.5.1
ARG COMPOSE_SHA256=db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576
ARG SOPS_VERSION=v3.13.3
ARG SOPS_SHA256=e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b
ARG AGE_VERSION=v1.3.2
ARG AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10

USER 0:0
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN curl -fsSLo /usr/local/lib/docker/cli-plugins/docker-compose \
      "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
 && echo "${COMPOSE_SHA256}  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum -c - \
 && chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose \
 && curl -fsSLo /usr/local/bin/sops \
      "https://github.com/getsops/sops/releases/download/${SOPS_VERSION}/sops-${SOPS_VERSION}.linux.amd64" \
 && echo "${SOPS_SHA256}  /usr/local/bin/sops" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/sops \
 && curl -fsSLo /tmp/age.tgz \
      "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz" \
 && echo "${AGE_SHA256}  /tmp/age.tgz" | sha256sum -c - \
 && tar -xzf /tmp/age.tgz -C /usr/local/bin --strip-components=1 age/age age/age-keygen \
 && rm /tmp/age.tgz

COPY --chmod=0755 entrypoint.sh /usr/local/bin/runner-entrypoint
USER 1001:1001
ENTRYPOINT ["/usr/local/bin/runner-entrypoint"]
```

- [ ] **Step 3: Lint and build**

```bash
docker run --rm -i hadolint/hadolint < infra/runner/Dockerfile; echo "hadolint exit=$?"
docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable infra/runner/entrypoint.sh; echo "shellcheck exit=$?"
docker build --platform linux/amd64 -t ci-runner infra/runner
```

Expected: both exits 0; build succeeds (all three `sha256sum -c` lines print `OK`).

- [ ] **Step 4: Prove the image contents and the guard behavior**

```bash
docker run --rm --platform linux/amd64 --entrypoint bash ci-runner -c 'id -u; docker compose version; sops --version | head -1; age --version; git --version; jq --version'
docker run --rm --platform linux/amd64 ci-runner; echo "exit=$?"
docker run --rm --platform linux/amd64 -e GITHUB_RUNNER_TOKEN=invalid -e GITHUB_RUNNER_REPO=chrisguzman77/chris-guzman-portfolio ci-runner; echo "exit=$?"
```

Expected: first prints `1001`, `Docker Compose version v5.5.1`, `sops 3.13.3`, `v1.3.2`, git and jq versions; second exits non-zero with `set GITHUB_RUNNER_TOKEN …`; third exits non-zero with a curl 401 error followed by nothing registered (never reaches `config.sh`).

- [ ] **Step 5: Build the image in CI.** In `ci.yml` `infra` job, after the hadolint step, add:

```yaml
      - name: Build runner image
        run: docker build -t ci-runner infra/runner
```

- [ ] **Step 6: Commit** — `feat(infra): ephemeral self-hosted runner image`

---

### Task 4: Production Compose stack

**Files:**
- Create: `infra/compose/compose.yaml`, `infra/compose/prod.env.example`
- Modify: `.github/workflows/ci.yml` (infra job)

**Interfaces:**
- Consumes the variables listed in `prod.env.example`. `IMAGE_TAG` and `DOCKER_GID` are supplied by `scripts/deploy.sh`, not stored in secrets.
- Produces: services `postgres`, `directus`, `api`, `web`, `cloudflared`, `runner` in project `portfolio`, all carrying Compose's `com.docker.compose.project` / `.service` labels (used by `scripts/smoke.sh`).

- [ ] **Step 1: Write `infra/compose/prod.env.example`**

```dotenv
# Every variable the production stack reads, with dummy values.
# Real values live only in the sops-encrypted prod.enc.env (edit with `make secrets-edit`).
# CI validates compose.yaml against this file.

# Set by scripts/deploy.sh, not stored in prod.enc.env
IMAGE_TAG=latest
DOCKER_GID=999

# Stored in prod.enc.env
POSTGRES_PASSWORD=change-me
DIRECTUS_DB_PASSWORD=change-me
PORTFOLIO_DB_PASSWORD=change-me
UMAMI_DB_PASSWORD=change-me
DIRECTUS_SECRET=change-me
DIRECTUS_ADMIN_EMAIL=owner@example.com
DIRECTUS_ADMIN_PASSWORD=change-me
CLOUDFLARE_TUNNEL_TOKEN=change-me
GITHUB_RUNNER_TOKEN=change-me
GITHUB_RUNNER_REPO=chrisguzman77/chris-guzman-portfolio
```

- [ ] **Step 2: Write `infra/compose/compose.yaml`**

```yaml
# Production stack on the Proxmox VM (4 GiB RAM). No service publishes a host
# port: the only way in is the Cloudflare Tunnel, which reaches services by name
# on this network. Deployed by scripts/deploy.sh.
name: portfolio

x-service: &service
  restart: unless-stopped
  logging:
    driver: json-file
    options: { max-size: "10m", max-file: "3" }

services:
  postgres:
    <<: *service
    image: pgvector/pgvector:0.8.6-pg17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}
      DIRECTUS_DB_PASSWORD: ${DIRECTUS_DB_PASSWORD:?}
      PORTFOLIO_DB_PASSWORD: ${PORTFOLIO_DB_PASSWORD:?}
      UMAMI_DB_PASSWORD: ${UMAMI_DB_PASSWORD:?}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ../postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 3s
      retries: 10
    mem_limit: 768m

  directus:
    <<: *service
    image: directus/directus:12.3.1
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      SECRET: ${DIRECTUS_SECRET:?}
      ADMIN_EMAIL: ${DIRECTUS_ADMIN_EMAIL:?}
      ADMIN_PASSWORD: ${DIRECTUS_ADMIN_PASSWORD:?}
      DB_CLIENT: pg
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_DATABASE: directus
      DB_USER: directus
      DB_PASSWORD: ${DIRECTUS_DB_PASSWORD:?}
      PUBLIC_URL: https://cms.christopherguzman.me
      WEBSOCKETS_ENABLED: "false"
      TELEMETRY: "false"
    volumes:
      - directus-uploads:/directus/uploads
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8055/server/ping"]
      interval: 15s
      timeout: 3s
      retries: 10
      start_period: 30s
    mem_limit: 512m

  api:
    <<: *service
    image: ghcr.io/chrisguzman77/chris-guzman-portfolio/api:${IMAGE_TAG:?}
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      API_APP_VERSION: ${IMAGE_TAG:?}
      API_DATABASE_URL: postgresql+asyncpg://portfolio:${PORTFOLIO_DB_PASSWORD:?}@postgres:5432/portfolio
      API_CORS_ORIGINS: '["https://christopherguzman.me","https://www.christopherguzman.me"]'
    mem_limit: 384m

  web:
    <<: *service
    image: ghcr.io/chrisguzman77/chris-guzman-portfolio/web:${IMAGE_TAG:?}
    mem_limit: 256m

  cloudflared:
    <<: *service
    image: cloudflare/cloudflared:2026.9.3
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:?}
    depends_on: [web, api, directus]
    mem_limit: 128m

  # Ephemeral deploy runner. Never listed in scripts/deploy.sh's default
  # services, so a deploy cannot restart it mid-job. The Docker socket makes it
  # root-equivalent on this VM (see docs/adr/0006-runner-in-compose.md).
  runner:
    <<: *service
    image: ghcr.io/chrisguzman77/chris-guzman-portfolio/runner:${RUNNER_TAG:-latest}
    environment:
      GITHUB_RUNNER_TOKEN: ${GITHUB_RUNNER_TOKEN:?}
      GITHUB_RUNNER_REPO: ${GITHUB_RUNNER_REPO:?}
    group_add: ["${DOCKER_GID:?}"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      # Same path inside and out, so relative bind mounts in this file resolve on the host.
      - /opt/portfolio:/opt/portfolio
      - /etc/portfolio/age.key:/etc/portfolio/age.key:ro
    mem_limit: 768m

volumes:
  postgres-data:
  directus-uploads:
```

- [ ] **Step 3: Validate**

```bash
docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q && echo "config ok"
docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config | grep -c 'published' || true
```

Expected: `config ok`; published-port count `0`.

- [ ] **Step 4: Add to CI.** In `ci.yml` `infra` job, extend the "Validate compose files" step's `run` to:

```yaml
        run: |
          docker compose -f infra/compose/compose.dev.yaml config -q
          docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q
```

- [ ] **Step 5: Commit** — `feat(infra): production compose stack (no published ports, 4 GiB budget)`

---

### Task 5: Deploy and smoke scripts, Makefile targets

**Files:**
- Create: `scripts/deploy.sh`, `scripts/smoke.sh`
- Modify: `Makefile`

**Interfaces:**
- `scripts/deploy.sh` env: `IMAGE_TAG` (required), `SERVICES` (default `postgres directus api web cloudflared`), `INCLUDE_RUNNER=1` (appends `runner`), `ENV_FILE` (skip decryption; local tests only), `SOPS_AGE_KEY_FILE` (default `/etc/portfolio/age.key`), `DOCKER_GID` (default: group of `/var/run/docker.sock`), `COMPOSE_PROJECT_NAME` (Compose's own override), `SMOKE_PUBLIC_URL` (forwarded to smoke).
- `scripts/smoke.sh` env: `COMPOSE_PROJECT_NAME` (default `portfolio`), `SMOKE_ATTEMPTS` (default 20, 3 s apart), `SMOKE_PUBLIC_URL` (optional). Exit 0 only if every check passes.
- Consumed by Task 6 (`release.yml` deploy job) and Task 8 (runbook).

- [ ] **Step 1: Write `scripts/smoke.sh`**

```bash
#!/usr/bin/env bash
# Post-deploy smoke test. Production publishes no host ports, so each service is
# probed from inside its own container. SMOKE_PUBLIC_URL adds an end-to-end check
# through Cloudflare.
set -euo pipefail

PROJECT="${COMPOSE_PROJECT_NAME:-portfolio}"
ATTEMPTS="${SMOKE_ATTEMPTS:-20}"

# shellcheck disable=SC2329 # invoked indirectly through check "$@"
container() {
  docker ps -q \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=$1" | head -n 1
}

check() {
  local name="$1"
  shift
  for ((i = 1; i <= ATTEMPTS; i++)); do
    if "$@" >/dev/null 2>&1; then
      echo "ok    ${name}"
      return 0
    fi
    sleep 3
  done
  echo "FAIL  ${name}" >&2
  return 1
}

# shellcheck disable=SC2329 # invoked indirectly through check "$@"
in_service() {
  local id
  id="$(container "$1")"
  [[ -n "${id}" ]] || return 1
  shift
  docker exec "${id}" "$@"
}

status=0
check "web /api/healthz" in_service web wget -qO- http://127.0.0.1:3000/api/healthz || status=1
check "api /health reports db ok" in_service api python -c \
  "import json,sys,urllib.request as u; sys.exit(json.load(u.urlopen('http://127.0.0.1:8000/health', timeout=3))['db'] != 'ok')" || status=1
check "directus /server/ping" in_service directus wget -qO- http://127.0.0.1:8055/server/ping || status=1
if [[ -n "${SMOKE_PUBLIC_URL:-}" ]]; then
  check "public ${SMOKE_PUBLIC_URL}/api/healthz" curl -fsS --max-time 10 "${SMOKE_PUBLIC_URL}/api/healthz" || status=1
fi
exit "${status}"
```

- [ ] **Step 2: Write `scripts/deploy.sh`**

```bash
#!/usr/bin/env bash
# Deploy or roll back the production stack to IMAGE_TAG.
#
#   IMAGE_TAG=<git sha> scripts/deploy.sh                    # CI deploy, rollback
#   IMAGE_TAG=latest INCLUDE_RUNNER=1 scripts/deploy.sh      # first deploy on the VM (sudo)
#
# Secrets are decrypted from infra/compose/prod.enc.env into a private temp file
# that is deleted on exit. ENV_FILE=<path> skips decryption (local testing only).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT}/infra/compose/compose.yaml"
: "${IMAGE_TAG:?set IMAGE_TAG to a git SHA or latest}"
SERVICES="${SERVICES:-postgres directus api web cloudflared}"
if [[ "${INCLUDE_RUNNER:-0}" == 1 ]]; then
  SERVICES="${SERVICES} runner"
fi

env_file="${ENV_FILE:-}"
if [[ -z "${env_file}" ]]; then
  export SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-/etc/portfolio/age.key}"
  env_file="$(mktemp)"
  trap 'rm -f "${env_file}"' EXIT
  sops decrypt --output-type dotenv "${ROOT}/infra/compose/prod.enc.env" >"${env_file}"
fi

export IMAGE_TAG
DOCKER_GID="${DOCKER_GID:-$(stat -c %g /var/run/docker.sock)}"
export DOCKER_GID

compose() { docker compose -f "${COMPOSE_FILE}" --env-file "${env_file}" "$@"; }

echo "==> Deploying ${IMAGE_TAG}: ${SERVICES}"
# shellcheck disable=SC2086 # SERVICES is an intentional word list
compose pull ${SERVICES}
compose up -d --wait postgres
echo "==> Migrating"
compose run --rm --no-deps api alembic upgrade head
# shellcheck disable=SC2086
compose up -d --wait --wait-timeout 180 --remove-orphans ${SERVICES}
echo "==> Smoke testing"
"${ROOT}/scripts/smoke.sh"
docker image prune -f >/dev/null
echo "==> Deployed ${IMAGE_TAG}"
```

- [ ] **Step 3: Makefile targets.** Add to `.PHONY`: `prod-config secrets-edit secrets-check`. Append:

```make
SOPS_KEY ?= $(HOME)/.config/sops/age/keys.txt

prod-config:   ## Validate the production compose file
	docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q

secrets-edit:  ## Edit the encrypted production secrets (opens $$EDITOR)
	SOPS_AGE_KEY_FILE=$(SOPS_KEY) sops edit infra/compose/prod.enc.env

secrets-check: ## Confirm prod secrets decrypt and count placeholder values (never prints secrets)
	@SOPS_AGE_KEY_FILE=$(SOPS_KEY) bash -o pipefail -c 'sops decrypt infra/compose/prod.enc.env | awk -F= '"'"'/^[A-Z_]+=/{n++} /change-me/{p++} END{printf "%d keys, %d still change-me\n", n, p+0}'"'"''
```

(Recipes are TAB-indented.)

- [ ] **Step 4: Lint** — `docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable scripts/deploy.sh scripts/smoke.sh` → no output; `make help` lists the three new targets; `make prod-config` exits 0.

- [ ] **Step 5: End-to-end test on the local Docker.** In the session scratchpad create `prod-test.vars` (NOT named `.env*`):

```dotenv
POSTGRES_PASSWORD=pw-postgres-test
DIRECTUS_DB_PASSWORD=pw-directus-test
PORTFOLIO_DB_PASSWORD=pw-portfolio-test
UMAMI_DB_PASSWORD=pw-umami-test
DIRECTUS_SECRET=0123456789abcdef0123456789abcdef
DIRECTUS_ADMIN_EMAIL=owner@example.com
DIRECTUS_ADMIN_PASSWORD=pw-admin-test
CLOUDFLARE_TUNNEL_TOKEN=unused-in-local-test
GITHUB_RUNNER_TOKEN=unused-in-local-test
GITHUB_RUNNER_REPO=chrisguzman77/chris-guzman-portfolio
```

Then (GHCR images are public; `latest` is the current `main`):

```bash
ENV_FILE=<scratchpad>/prod-test.vars IMAGE_TAG=latest DOCKER_GID=0 \
  COMPOSE_PROJECT_NAME=portfolio-prodtest SERVICES="postgres directus api web" \
  scripts/deploy.sh
```

Expected: `==> Migrating` runs `init`, then `ok    web /api/healthz`, `ok    api /health reports db ok`, `ok    directus /server/ping`, `==> Deployed latest`. (On Apple Silicon the amd64 images run under emulation; first start is slow.)

Failure path: `docker stop $(docker ps -q --filter label=com.docker.compose.project=portfolio-prodtest --filter label=com.docker.compose.service=api) && COMPOSE_PROJECT_NAME=portfolio-prodtest SMOKE_ATTEMPTS=2 scripts/smoke.sh; echo "exit=$?"` → `FAIL  api /health reports db ok`, `exit=1`.

Clean up: `COMPOSE_PROJECT_NAME=portfolio-prodtest docker compose -f infra/compose/compose.yaml --env-file <scratchpad>/prod-test.vars down -v` and delete `prod-test.vars`.

- [ ] **Step 6: Commit** — `feat(infra): deploy and smoke scripts, secrets make targets`

---

### Task 6: Release workflow — runner image and gated deploy job

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes `scripts/deploy.sh` (Task 5) at `/opt/portfolio` on the VM; repo variable `DEPLOY_ENABLED`.
- Produces: `ghcr.io/chrisguzman77/chris-guzman-portfolio/runner:{sha,latest}`; a `deploy` job that is skipped unless `vars.DEPLOY_ENABLED == 'true'`.

- [ ] **Step 1: Build three images.** Replace the build job's `strategy` with:

```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
          - { app: web, context: apps/web }
          - { app: api, context: apps/api }
          - { app: runner, context: infra/runner }
```

and in the Build step change `context: apps/${{ matrix.app }}` to `context: ${{ matrix.context }}`.

- [ ] **Step 2: Replace the deploy job** with:

```yaml
  deploy:
    needs: build
    # Off until the VM's runner is registered: set the repository variable
    # DEPLOY_ENABLED=true (Settings → Secrets and variables → Actions → Variables).
    if: vars.DEPLOY_ENABLED == 'true'
    runs-on: [self-hosted, portfolio-deploy]
    timeout-minutes: 15
    steps:
      - name: Check out the released commit on the VM
        run: |
          git -C /opt/portfolio fetch --depth 1 origin "${GITHUB_SHA}"
          git -C /opt/portfolio checkout --detach --force FETCH_HEAD
      - name: Deploy
        run: /opt/portfolio/scripts/deploy.sh
        env:
          IMAGE_TAG: ${{ github.sha }}
          SMOKE_PUBLIC_URL: https://christopherguzman.me
```

- [ ] **Step 3: Verify**

```bash
python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/release.yml'));print([m['app'] for m in d['jobs']['build']['strategy']['matrix']['include']]);print(d['jobs']['deploy']['if'], d['jobs']['deploy']['runs-on'])"
grep -nE 'uses: [^ ]+@v?[0-9]' .github/workflows/release.yml || echo "all SHA-pinned"
```

Expected: `['web', 'api', 'runner']`; `vars.DEPLOY_ENABLED == 'true' ['self-hosted', 'portfolio-deploy']`; `all SHA-pinned`.

- [ ] **Step 4: Commit** — `ci: build runner image; gated deploy job on the self-hosted runner`

---

### Task 7: VM bootstrap script

**Files:**
- Create: `infra/vm/bootstrap.sh`, `infra/vm/README.md`

**Interfaces:**
- Run as `sudo ./infra/vm/bootstrap.sh` from `/opt/portfolio` on Ubuntu 24.04. Env: `LAN_CIDR` (default `192.168.1.0/24`). Idempotent.
- Produces: Docker Engine + compose plugin; ufw deny-inbound (IPv4 and IPv6) except SSH from `LAN_CIDR`; unattended security upgrades with reboot at 04:30; sops and age; `/etc/portfolio/age.key` (root:1001, 0440); `/opt/portfolio` owned by 1001; prints the VM's age public key.

- [ ] **Step 1: Write `infra/vm/bootstrap.sh`**

```bash
#!/usr/bin/env bash
# One-time, re-runnable setup for the portfolio VM (Ubuntu 24.04).
#
#   cd /opt/portfolio && sudo ./infra/vm/bootstrap.sh
#
# Installs Docker, a deny-by-default firewall, automatic security updates, sops
# and age; creates the VM's age key; hands /opt/portfolio to the runner's uid.
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "run with sudo" >&2
  exit 1
fi

LAN_CIDR="${LAN_CIDR:-192.168.1.0/24}"
ADMIN_USER="${SUDO_USER:-chris}"
RUNNER_UID=1001
REPO_DIR=/opt/portfolio
KEY_FILE=/etc/portfolio/age.key
SOPS_VERSION=v3.13.3
SOPS_SHA256=e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b
AGE_VERSION=v1.3.2
AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10

step() { printf '\n==> %s\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

step "Base packages"
apt-get update -q
apt-get install -y -q ca-certificates curl git ufw unattended-upgrades

step "Docker Engine and Compose plugin (Docker's apt repository)"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "${ADMIN_USER}"

step "Docker log rotation"
daemon_json='{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }'
if [[ "$(cat /etc/docker/daemon.json 2>/dev/null || true)" != "${daemon_json}" ]]; then
  echo "${daemon_json}" >/etc/docker/daemon.json
  systemctl restart docker
fi

step "Firewall: deny all inbound (IPv4 and IPv6) except SSH from ${LAN_CIDR}"
# Docker bypasses ufw for published ports; the production stack publishes none.
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow from "${LAN_CIDR}" to any port 22 proto tcp comment 'ssh from LAN'
ufw --force enable

step "Automatic security updates (reboot at 04:30 when required)"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat >/etc/apt/apt.conf.d/52portfolio-reboot <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF

step "sops ${SOPS_VERSION} and age ${AGE_VERSION}"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
curl -fsSLo "${tmp}/sops" "https://github.com/getsops/sops/releases/download/${SOPS_VERSION}/sops-${SOPS_VERSION}.linux.amd64"
echo "${SOPS_SHA256}  ${tmp}/sops" | sha256sum -c -
install -m 0755 "${tmp}/sops" /usr/local/bin/sops
curl -fsSLo "${tmp}/age.tgz" "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz"
echo "${AGE_SHA256}  ${tmp}/age.tgz" | sha256sum -c -
tar -xzf "${tmp}/age.tgz" -C "${tmp}"
install -m 0755 "${tmp}/age/age" "${tmp}/age/age-keygen" /usr/local/bin/

step "VM age key at ${KEY_FILE} (readable by root and the runner uid only)"
install -d -m 0750 -o root -g "${RUNNER_UID}" /etc/portfolio
if [[ ! -f "${KEY_FILE}" ]]; then
  age-keygen -o "${KEY_FILE}" 2>/dev/null
fi
chown "root:${RUNNER_UID}" "${KEY_FILE}"
chmod 0440 "${KEY_FILE}"

step "Repository at ${REPO_DIR}, owned by the runner uid ${RUNNER_UID}"
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  git clone https://github.com/chrisguzman77/chris-guzman-portfolio.git "${REPO_DIR}"
fi
chown -R "${RUNNER_UID}:${RUNNER_UID}" "${REPO_DIR}"
if ! git config --system --get-all safe.directory 2>/dev/null | grep -qx "${REPO_DIR}"; then
  git config --system --add safe.directory "${REPO_DIR}"
fi

step "Done"
echo "VM age public key (send this line to Claude; it is safe to share):"
age-keygen -y "${KEY_FILE}"
echo
echo "Log out and back in so '${ADMIN_USER}' can use docker without sudo."
```

- [ ] **Step 2: Lint** — `docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable infra/vm/bootstrap.sh` → no output; `bash -n infra/vm/bootstrap.sh` → exit 0.

- [ ] **Step 3: Exercise the non-systemd parts in a throwaway container** (proves the download/checksum/key/ownership logic; Docker install, ufw, and systemctl are verified on the real VM in Stage 4):

```bash
docker run --rm --platform linux/amd64 -v "$PWD/infra/vm/bootstrap.sh:/b.sh:ro" ubuntu:24.04 bash -c '
  set -e
  apt-get update -q >/dev/null && apt-get install -y -q curl ca-certificates git >/dev/null
  sed -n "/^step \"sops/,/^step \"Repository/p" /b.sh | sed "\$d" > /part.sh
  { echo "set -euo pipefail"; sed -n "/^SOPS_VERSION=/,/^AGE_SHA256=/p" /b.sh; echo "RUNNER_UID=1001; KEY_FILE=/etc/portfolio/age.key"; echo "step(){ echo \"==> \$*\"; }"; cat /part.sh; } > /run.sh
  bash /run.sh && stat -c "%U:%g %a" /etc/portfolio/age.key && age-keygen -y /etc/portfolio/age.key | cut -c1-8 && sops --version | head -1'
```

Expected: both `sha256sum -c` lines `OK`; `root:1001 440`; `age1…`; `sops 3.13.3`.

- [ ] **Step 4: Write `infra/vm/README.md`**

````markdown
# Portfolio VM

## How VM 400 was built (Proxmox 9.1, 2026-09-29)

- Template **9000** `ubuntu-2404-cloudinit` from `noble-server-cloudimg-amd64.img` on storage `local` (qcow2), `vmbr0`, cloud-init drive, serial console, guest agent enabled.
- Full clone **400** `portfolio`: 4 vCPU, **4 GiB fixed** (`--balloon 0`; the host has 15 GiB shared with lab VMs, which no longer auto-start), 60 GB disk, `ciuser chris` with the owner's SSH key, `192.168.1.50/24` gw `192.168.1.254`, `onboot 1`, `startup order=1`.
- In the VM: `qemu-guest-agent` installed; timezone `America/New_York`.
- Proxmox backup job: daily 03:00, snapshot mode, zstd, keep last 7, VM 400 only, storage `local`.

Remote access: `ssh -J root@<proxmox-tailscale-ip> chris@192.168.1.50`.

## Bootstrap

```bash
sudo git clone https://github.com/chrisguzman77/chris-guzman-portfolio.git /opt/portfolio
cd /opt/portfolio && sudo ./infra/vm/bootstrap.sh
```

Re-running it is safe. It prints the VM's age public key, which must be added to `.sops.yaml` (then `sops updatekeys infra/compose/prod.enc.env`) before the VM can decrypt production secrets.

## Rebuild from scratch

Recreate the VM from template 9000 with the settings above, bootstrap, add the new public key to `.sops.yaml`, run the first deploy (`docs/runbook.md`), and restore data from the latest Proxmox backup or database dump.
````

- [ ] **Step 5: Commit** — `feat(infra): idempotent VM bootstrap script and VM record`

---

### Task 8: Documentation — runbook, ADR 0006, setup and architecture updates

**Files:**
- Create: `docs/runbook.md`, `docs/adr/0006-runner-in-compose.md`
- Modify: `docs/adr/README.md`, `docs/setup.md`, `docs/architecture.md`, `README.md`

**Interfaces:**
- Consumes the commands from Tasks 2–7 verbatim.

- [ ] **Step 1: Write `docs/runbook.md`**

````markdown
# Runbook

Production is VM 400 (`192.168.1.50`) on the Proxmox host, reached from the internet only through the Cloudflare Tunnel. Everything below runs on the VM from `/opt/portfolio` unless marked otherwise.

## First deploy (once, after bootstrap)

1. `.sops.yaml` lists the VM's age public key and `prod.enc.env` has real values (`make secrets-check` on the laptop reports `0 still change-me`).
2. `sudo git -C /opt/portfolio pull`
3. `sudo IMAGE_TAG=latest INCLUDE_RUNNER=1 /opt/portfolio/scripts/deploy.sh`
4. GitHub → Settings → Actions → Runners shows `portfolio-vm` (Idle).
5. GitHub → Settings → Secrets and variables → Actions → Variables → `DEPLOY_ENABLED` = `true`.

## Normal deploys

Merge to `main`. `release.yml` builds, scans and pushes images, then the `deploy` job runs `scripts/deploy.sh` with `IMAGE_TAG=<commit sha>` on the VM's runner and smoke-tests locally and through `https://christopherguzman.me`.

## Roll back

```bash
sudo IMAGE_TAG=<previous good sha> /opt/portfolio/scripts/deploy.sh
```

Image tags are full commit SHAs (Actions → release → a green run). Database migrations are not rolled back automatically; write a down-migration if one is needed.

## Update the runner

Dependabot bumps `infra/runner/Dockerfile`; after the release builds it:

```bash
cd /opt/portfolio && sudo IMAGE_TAG=latest INCLUDE_RUNNER=1 SERVICES=runner scripts/deploy.sh
```

Run this while no deploy is in progress.

## Status and logs

```bash
docker ps --filter label=com.docker.compose.project=portfolio
scripts/smoke.sh
docker logs --tail 100 portfolio-api-1
```

## Rotate secrets

- **A database or Directus password:** `make secrets-edit` on the laptop, commit, merge; the next deploy applies it. Postgres role passwords also need `ALTER ROLE … PASSWORD` inside the database.
- **Tunnel token:** Zero Trust → Tunnels → `portfolio` → Refresh token; update `CLOUDFLARE_TUNNEL_TOKEN`; deploy.
- **Runner PAT (expires yearly):** create a new `portfolio-runner` token, update `GITHUB_RUNNER_TOKEN`, deploy with `INCLUDE_RUNNER=1 SERVICES=runner`.
- **Age keys:** generate a new key, add it to `.sops.yaml`, `sops updatekeys infra/compose/prod.enc.env`, remove the old recipient, `updatekeys` again.

## Outage checklist

1. Site shows "Back shortly": the fallback Worker is covering. Check the VM is up (Proxmox UI) and `docker ps` on it.
2. `Error 1033`: cloudflared is not connected. `docker logs portfolio-cloudflared-1`.
3. After a Proxmox host reboot, VM 400 starts first (`startup order=1`) and every container restarts on its own (`restart: unless-stopped`).
````

- [ ] **Step 2: Write `docs/adr/0006-runner-in-compose.md`**

```markdown
# 0006 — Deploy runner as a Compose service, deploys pinned to commit SHAs

Status: accepted · 2026-09-29

## Context
ADR 0005 chose an ephemeral self-hosted runner inside the VM. It needs Docker access to deploy, and the stack's relative bind mounts (the Postgres init scripts) must resolve on the host, not inside the runner.

## Decision
The runner is the `runner` service in `infra/compose/compose.yaml`, built from `infra/runner/Dockerfile` (official runner image plus compose, sops and age, checksum-verified). It mounts the Docker socket, the VM age key read-only, and `/opt/portfolio` at the same path. It registers with a fine-grained PAT, runs one job, and exits; Compose restarts it for the next job. Deploys check out the exact released commit in `/opt/portfolio` and run `scripts/deploy.sh` with `IMAGE_TAG` set to that SHA. The runner is excluded from the default deploy service list. Deploys stay off until the repository variable `DEPLOY_ENABLED` is `true`.

## Consequences
- Rebuilding the VM restores the runner with the rest of the stack; no hand-installed service.
- The socket mount makes the runner root-equivalent on the VM. Mitigations: repo-scoped, ephemeral, only `push` to `main` targets its label, fork PRs need approval, the PAT is unset before jobs start.
- Every deployed version is an immutable image tag, so rollback is one command.
- The runner itself is updated deliberately (`SERVICES=runner`), never by the deploy it is running.
```

- [ ] **Step 3: Update `docs/adr/README.md`** — add the row `| [0006](0006-runner-in-compose.md) | Deploy runner as a Compose service; deploys pinned to commit SHAs |`.

- [ ] **Step 4: Update `docs/setup.md`** — replace the three Phase 2 sections ("Domain and Cloudflare (Phase 2)", "Proxmox VM (Phase 2)", "GitHub (Phase 2)") with:

```markdown
## Domain and Cloudflare (Phase 2)
- Domain `christopherguzman.me` on Cloudflare Registrar; SSL/TLS Full (strict); Always Use HTTPS.
- Tunnel, Access, fallback Worker and cache rule: see [`infra/cloudflare/README.md`](../infra/cloudflare/README.md).

## Proxmox VM (Phase 2)
- How VM 400 was built and how to bootstrap it: [`infra/vm/README.md`](../infra/vm/README.md).

## GitHub (Phase 2)
- Settings → Actions → General: require approval for all external contributors; default token permissions read-only.
- Fine-grained PAT `portfolio-runner`: this repository only, Administration read and write, 1-year expiry → `GITHUB_RUNNER_TOKEN` in `prod.enc.env`.
- GHCR packages `web`, `api`, `runner` set to public so the VM pulls without credentials.
- First deploy and turning on automatic deploys: [`docs/runbook.md`](runbook.md).
```

- [ ] **Step 5: Update `docs/architecture.md`** — add these two bullets to the "Boundaries that matter" list:

```markdown
- Production (`infra/compose/compose.yaml`) publishes no host ports; cloudflared reaches services by name. The VM firewall denies all inbound traffic except SSH from the LAN, on IPv4 and IPv6.
- Deploys run on an ephemeral runner inside the stack and are pinned to commit SHAs ([ADR 0006](adr/0006-runner-in-compose.md)); operations are in the [runbook](runbook.md).
```

- [ ] **Step 6: Update `README.md`** — in the Layout table's `docs/` row, add `[runbook](docs/runbook.md)` to the list of links.

- [ ] **Step 7: Verify** — `pre-commit run --all-files` clean; every relative link in the changed markdown resolves (`grep -oE '\]\(([^)#]+)' <file>`, check each path relative to the file).

- [ ] **Step 8: Commit** — `docs: runbook, ADR 0006, Phase 2 setup and architecture notes`

---

### Task 9: Ship

**Files:** none new.

- [ ] **Step 1:** Push `feat/phase-2-infra`, open the PR ("Phase 2: production stack, runner, deploy pipeline"), watch CI until `web`, `api`, `infra` pass.
- [ ] **Step 2:** Squash-merge. Watch `release`: `build (web)`, `build (api)`, `build (runner)` succeed; `deploy` is skipped (variable unset).
- [ ] **Step 3:** Confirm `ghcr.io/chrisguzman77/chris-guzman-portfolio/runner:latest` exists. It is a new package and therefore private: the owner must set it public (Packages → runner → Package settings → Change visibility) before the VM can pull it.

## Phase 2 exit criteria (verified with the owner after merge)

- `https://christopherguzman.me` serves the site; `https://api.christopherguzman.me/health` reports `db: ok`; `https://cms.christopherguzman.me` prompts Access, then Directus.
- A push to `main` deploys via the runner and the smoke test passes, including the public check.
- Stopping `web` serves the fallback page; a VM reboot recovers every service unattended.
- The runner re-registers after each job (Settings → Actions → Runners shows `portfolio-vm` Idle again).

## Amendments after the final review (2026-09-29)

1. `infra/runner/entrypoint.sh` removes `.runner`, `.credentials` and `.credentials_rsaparams` before `config.sh`, so a restart that did not follow a completed job no longer crash-loops.
2. New `scripts/sync-repo.sh [ref]` is the single way to move the VM checkout (fetch, detached checkout, `chown 1001` when root); it replaces host `git pull` and the shallow fetch in CI.
3. `release.yml`: workflow permissions are `contents: read` only; `build` gets `packages: write`; `deploy` gets `permissions: {}`, runs only for `refs/heads/main` with `DEPLOY_ENABLED`, and checks out via `sync-repo.sh "${GITHUB_SHA}"`.
4. `scripts/deploy.sh` honours `SKIP_MIGRATIONS=1` for rollbacks across a migration.
5. `GITHUB_RUNNER_REPO` is no longer a secret: defaulted in `compose.yaml` and moved out of the "Stored in prod.enc.env" section of `prod.env.example`.
6. New `scripts/secrets-check.sh` (used by `make secrets-check`) fails on decryption errors, missing required keys or `change-me` values and prints only key names.
7. `infra/vm/bootstrap.sh` removes an empty age key file before `age-keygen`, which refuses to overwrite it.
8. `docs/runbook.md` uses `sync-repo.sh` everywhere, sets `SMOKE_PUBLIC_URL` on the first deploy, documents `SKIP_MIGRATIONS=1` rollbacks and adds a Recovery note.
9. ADR 0006 states the runner's real controls (owner-only write access, fork PR approval, `main`-only deploy job) and that the runner re-registers after restarts.
