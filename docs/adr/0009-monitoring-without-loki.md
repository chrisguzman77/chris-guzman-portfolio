# 0009 — Monitoring with Prometheus and Grafana, no Loki; public status served through the API

Status: accepted · 2026-10-03

## Context
Phase 6 needs an email when something breaks and an honest status card on the homepage. The VM has 4 GiB of RAM with about 2.8 GiB free, one maintainer, and little log volume. Better Stack already checks the site from outside.

## Decision
- Prometheus (30 s scrapes, 35 days or 2 GB), node-exporter, cAdvisor and blackbox-exporter, with Grafana for dashboards and alerts. Alerts are Grafana-managed and go out as email through Resend's SMTP. Every container has a memory limit.
- No Loki or Alloy. `docker logs` with the existing rotation (3 × 10 MB per container) stays the log tool. Log search would cost several hundred MB of RAM for little benefit at this size.
- No Uptime Kuma. Better Stack checks from outside the home network, and a blackbox probe of the public URL covers it from inside.
- Grafana stays private, behind Cloudflare Access and its own login. The public status card gets its numbers from `GET /v1/status`. The API runs fixed PromQL queries (2 s timeout), caches the result for 60 s, and returns `degraded` with null values when Prometheus fails. Nothing from the request reaches Prometheus, and Prometheus has no public hostname.
- The API's `/metrics` returns 404 when the request carries `CF-Connecting-IP`, the same rule as `/internal/*`, so only containers on the VM can scrape it.

## Consequences
- Searching logs means SSH and `docker logs`; old logs rotate away.
- Directus and cloudflared are not scraped. Their failures show up through cAdvisor's `container_last_seen` and the site probe.
- Grafana cannot report a dead VM or a home-internet outage; Better Stack covers those.
- The card counts time with no probe samples as downtime, so its uptime figure errs low rather than high.
- Prometheus and Grafana data are not backed up. Losing them resets graphs and the card's 30-day history.
