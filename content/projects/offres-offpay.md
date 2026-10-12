---
slug: offres-offpay
title: OFFRes / OFFPay
summary: Offline payment device on a Raspberry Pi 5 with HMAC-signed QR transactions and a local LLM for disaster information.
repo_url: https://github.com/chrisguzman77/OffRes
live_url: null
award: Capital One Best Financial Hack
date: 2026-03-01
tech: [python, fastapi, react, sqlite, sqlalchemy, typescript, vite, leaflet.js]
---

## What it is

OFFRes / OFFPay won Capital One's Best Financial Hack at Vanderbilt's VandyHacks. It is an offline payment and information device on a Raspberry Pi 5, meant for places where a disaster has taken the network down. People can pay vendors with signed QR codes, ask a local AI assistant for safety information, and check an offline map, all with no internet.

## How it works

![Architecture of OFFRes / OFFPay: a touchscreen kiosk on a Raspberry Pi 5 talks to a FastAPI backend that signs QR payments, which a separate vendor app scans and sends back to the device to verify; the same backend runs BM25 retrieval and TinyLlama for the assistant](DIAGRAM:offres-offpay.png)

Everything inside the dashed box runs on the Pi. A user taps through a React kiosk UI (Chromium in kiosk mode with an on-screen keyboard) that talks to a FastAPI backend with a SQLite wallet ledger.

To pay, the backend checks the balance, deducts the amount right away, and records a pending transaction with a unique nonce. It signs the payment with HMAC-SHA256 over a canonical JSON payload, compresses it, and shows it as a QR code on screen.

The vendor scans that QR with a separate React app, which sends it back to the device over the local network. The device checks the HMAC and marks the payment accepted. If the device can't be reached, the vendor app accepts the payment locally as "verify on sync" and keeps the nonce so the same code can't be used twice. When connectivity returns, the vendor syncs and the device marks each transaction settled, refusing anything already settled.

For the assistant, a question goes to BM25 retrieval over 9 disaster guides (floods, earthquakes, first aid, and others). The top 3 chunks go into a prompt for TinyLlama 1.1B, run through llama.cpp on the Pi's CPU.

For the hackathon, wallet preload and bank settlement were simulated: preload just raises the SQLite balance, and settlement updates the transaction status. A real bank integration was the planned next step.

## Decisions worth noting

- **Sign over canonical JSON (sorted keys).** The device must produce the exact same bytes when it re-checks a signature, so the payload is serialized deterministically before signing. The demo uses a shared secret; a production version would use asymmetric keys so the vendor side could verify without holding the secret.
- **Deduct at QR creation, not at acceptance.** With no server to ask, deducting up front means the device can't spend the same balance twice while offline.
- **A nonce per transaction and a settle-once check.** Together they block replayed or duplicated QR codes, including ones a vendor accepted while the device was out of reach.
- **Compressed payload, low QR error correction.** A signed payload makes a dense QR. Compressing it and using error-correction level L keeps the code small enough to scan reliably off another screen.

## Results

- Won Capital One's Best Financial Hack at VandyHacks (March 2026).
- The whole stack, including a TinyLlama model of about 637 MB, runs offline on one Raspberry Pi 5.

[CHRIS: any measured numbers to add? e.g. assistant response time on the Pi, QR scan time, how many teams competed]

## My part

We were a team of five. I built the backend API with the wallet ledger, and the signed QR payments: the transaction flow, the HMAC signing, and the replay protection described above. My teammates built the vendor app, the kiosk UI and the offline assistant. [CHRIS: confirm the teammate split (vendor app, kiosk UI, assistant) and whether to credit them by name]
