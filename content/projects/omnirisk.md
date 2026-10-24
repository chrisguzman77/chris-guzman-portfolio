---
slug: omnirisk
title: OmniRisk
summary: Jobsite safety platform for utility crews, with a LightGBM hazard index, a Raspberry Pi beacon that cuts equipment power when lightning is near, and a Roblox digital twin.
type: competition
repo_url: https://github.com/chrisguzman77/beacon
live_url: https://omnirisking-it-all-at-swamphacks.us
award: Best Use of Roblox Studio
date: 2026-10-18
featured: true
tech: [python, fastapi, timescaledb, lightgbm, gemini, react, typescript, raspberry-pi, micropython, arduino, roblox, luau, docker]
cover: cc450a0a-35f5-4ea7-906d-0ec7330c0aba
---

## What it is

OmniRisk won Best Use of Roblox Studio at SwampHacks XII, the University of Florida's hackathon (the prize was a Roblox gift card). Four of us built it in about 30 hours for the PlanIT Control challenge. It is a safety platform for utility field crews that turns public data into decisions, from tomorrow's forecast down to the switch on the equipment.

It watches 50 real power plant sites across Florida and the Gulf states, ranks them by a 0 to 10 hazard index with the three reasons behind each score, and enforces stop-work rules: a lightning strike within 10 miles starts a 30-minute countdown that only a supervisor PIN can end. Each site gets a 6 PM briefing for the next day in English and Spanish, crews check in from their phones, and a physical beacon on site stops the equipment on its own, even with no internet. A Roblox twin of the site runs a simulated storm whose strikes reach the real beacon.

## How it works

![OmniRisk architecture: a FastAPI backend on Vultr pulls public data, stores it in TimescaleDB, scores the hazard index and has Gemini write briefings; the React web app talks to it over REST and websockets; the Roblox twin posts strikes to it; it sends STOPWORK over a websocket to the Raspberry Pi gateway on site, which reads the sensor pod, drives the UNO beacon head and stops the fan motor on GPIO 18](/assets/648f5db2-48b6-42b7-8f54-758fabe705a9)

A FastAPI backend on Vultr pulls Open-Meteo forecasts, NWS alerts, FEMA flood zones and iNaturalist sightings on a schedule and stores them in TimescaleDB. Once a day it scores each site's hazard index with a LightGBM model, and at 6 PM in each site's time zone it has Gemini write the briefing. The React dashboard and the beacon connect over websockets.

The beacon is three boards: an RP2040 sensor pod that samples a light sensor 5,000 times a second to catch lightning flashes, a Raspberry Pi 5 that runs the rules and holds the equipment motor on GPIO 18, and an Arduino UNO that drives the LCD, the countdown and a 29-LED gauge. In the Roblox twin, a storm moves toward the site and fires strikes from a random process. Each strike inside 10 miles goes to the backend, which tells the beacon to stop work, and the real motor stops.

## Decisions worth noting

- **Contracts before code.** Event shapes, serial lines, websocket messages and REST routes were written down first in `contracts/`, so four people could build in parallel and connect the pieces near the end.
- **Split by time, and always show the baseline.** The model trains on 2016 to 2022, tunes on 2023 and is tested once on 2024, so the same storm can't leak into both training and testing. Every metric sits next to the rule a supervisor would write by hand.
- **Generated text can't invent numbers.** Every number in a Gemini briefing must appear in its input; otherwise it retries once, then falls back to a template built from the data.
- **Fail safe, offline first.** The beacon enforces its rules with no internet, replays queued events in order when it reconnects, and holds the motor's pin low if its program stops or crashes. Only a supervisor PIN restarts the equipment.

## Results

- Won Best Use of Roblox Studio at SwampHacks XII (October 2026).
- On the 2024 test year, the hazard index scores an average precision of 0.246 against 0.084 for the hand-written rule and about 0.058 for chance, and a ROC AUC of 0.817 against 0.594.
- The full loop works live: a strike in the Roblox twin stops a real motor through the backend and the beacon.

## My part

We were a team of four. I wrote the contracts, trained the hazard index (data pipeline, labels, LightGBM, calibration and SHAP reasons), built the Gemini briefings with the number check and the photo tagging, wrote the software for all three beacon boards, built the backend core with Viet, and deployed it on Vultr. Viet Nguyen also built the storm model and the Roblox bridge; Cameron Clemons built the web app; Yaroslav Kulyna built the Roblox world and the beacon's hardware. More in the post: [OmniRisk: what we built at SwampHacks XII](/blog/omnirisk).
