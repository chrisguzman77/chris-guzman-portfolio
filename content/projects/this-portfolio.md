---
slug: this-portfolio
title: This portfolio
summary: Next.js, FastAPI, and Directus, self-hosted on Proxmox behind a Cloudflare Tunnel with a CI/CD pipeline that scans and deploys every merge.
repo_url: https://github.com/chrisguzman77/chris-guzman-portfolio
live_url: https://christopherguzman.me
award: null
date: 2026-09-01
tech: [next.js, fastapi, directus, postgresql, docker, github actions]
---

## The stack

A Next.js frontend, a FastAPI service, and Directus as the CMS, all backed by PostgreSQL. Content is edited in Directus and the site refreshes within seconds of publishing.

## Hosting

Everything runs with Docker Compose on a VM on my Proxmox home server. A Cloudflare Tunnel is the only way in, so the VM opens no inbound ports.

## Deploys

Every merge to main builds the images in GitHub Actions and scans them with Trivy; a failed scan stops the release. An ephemeral self-hosted runner on the VM then pulls the new images and deploys them. Production secrets are encrypted in the repo with SOPS.

I wrote up how it's built in [How I built this site](/blog/how-i-built-this-site).
