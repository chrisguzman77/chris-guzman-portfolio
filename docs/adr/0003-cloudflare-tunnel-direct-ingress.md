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
