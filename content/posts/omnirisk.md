---
title: "OmniRisk: what we built at SwampHacks XII"
slug: omnirisk
excerpt: Four of us built a jobsite safety platform in about 30 hours, with a machine learning hazard index, a beacon that cuts equipment power when lightning is near, and a Roblox digital twin that won Best Use of Roblox Studio.
tags: [hackathon, machine-learning, raspberry-pi, roblox, fastapi, iot]
published_at: "2026-10-23"
---

In October, four of us spent about 30 hours at SwampHacks XII, the University of Florida's hackathon, building OmniRisk: a jobsite safety platform for utility field crews. We built it for the PlanIT Control challenge, and it won **Best Use of Roblox Studio** (the prize was a Roblox gift card).

It starts from one observation. Crews get hurt by hazards that were knowable the night before: lightning, extreme heat, flooding, soft soil. The data exists, but it lives in a dozen places and nobody turns it into a decision. OmniRisk tries to close that gap, from tomorrow's forecast all the way to the switch on the equipment.

This post covers what we built, the part that won, my share of it, and what broke.

![The OmniRisk dashboard: a map of 50 power plant sites across Florida and the Gulf states, each dot colored by its 0 to 10 hazard index, next to a ranked list of sites and the selected site's index, crew count and next-day briefing](/assets/cc450a0a-35f5-4ea7-906d-0ec7330c0aba)

## What it does

- **One risk picture per site.** The dashboard watches 50 real power plant sites across Florida and the Gulf states, merges public weather, flood, alert and wildlife feeds, and ranks the sites by a 0 to 10 hazard index with the three reasons behind each score.
- **Stop-work rules.** A lightning strike within 10 miles starts a 30-minute countdown that restarts on every new strike, and only a supervisor PIN ends it. Heat, flooding and wind raise alerts too.
- **Briefings and a crew page.** Every site gets a briefing for the next day at 6 PM, in English and Spanish. Crew check in from their phones and photograph hazards, which AI tags and pins to the site map.
- **A beacon on site.** It sees a lightning flash with its own light sensor, cuts the equipment motor, counts down, speaks the alert, and keeps enforcing its rules with no internet.
- **A Roblox digital twin** of the site, where a simulated storm walks in and its strikes reach the real beacon.

## The part that won: a storm in Roblox

[Yaroslav Kulyna](https://www.linkedin.com/in/kulynayaroslav/) built the Roblox world and its scenarios, and [Viet Nguyen](https://www.linkedin.com/in/02-vietnguyen/) wrote the storm model and the bridge to our backend.

The twin's lightning is simulated, not scripted. A storm cell starts about 20 miles out and moves toward the site, its flash rate rising and falling over its life. Strike times come from a random (Poisson) process, most strikes land near the core, and 5% are "bolts from the blue" 5 to 10 miles ahead of it. Each strike's distance to the site comes from where it landed, and its thunder arrives as late as sound would at the scenario's air temperature.

This is the heart of Viet's storm model, from `sim/src/World/StormModel.module.lua`. It draws the time of the next candidate strike, keeps it with the storm's current odds, then places it:

```luau
while true do
  t += -math.log(rand()) / lambdaMax
  if t >= life then break end
  if rand() <= math.sin(math.pi * t / life) then
    -- storm frame: the cell moves along +x, the site at the origin, cross_track_mi to its left
    local cx, cy = -p.start_mi + v * t, p.cross_track_mi
    local x, y
    if rand() < StormModel.BLUE_SHARE then
      local d = 5 + 5 * rand()
      local a = math.rad((rand() * 2 - 1) * 45)
      x, y = cx + d * math.cos(a), cy + d * math.sin(a)
    else
      local r = StormModel.SIGMA_MI * math.sqrt(-2 * math.log(rand()))
      local th = 2 * math.pi * rand()
      x, y = cx + r * math.cos(th), cy + r * math.sin(th)
    end
    -- ... then the strike's bearing and distance to the site
  end
end
```

`math.sqrt(-2 * math.log(rand()))` turns a uniform random number into a Rayleigh-distributed distance from the core. `rand` is a small Park-Miller generator written out by hand instead of Roblox's `Random` and seeded per storm, so a scenario plays out the same way every time and the Lune test harness gets the exact strikes Studio fires.

That is what made the demo work end to end. On screen, the storm walks in. When a strike lands inside 10 miles, the twin posts it to the backend, the backend opens a stop work and tells the beacon, and the real fan motor on the table stops while the beacon counts down and says how far away the strike was. The beacon in the Roblox world mirrors the real one, and a player who walks into the work zone shows up on the muster list.

## How the pieces fit

![OmniRisk architecture: a FastAPI backend on Vultr pulls public data, stores it in TimescaleDB, scores the hazard index and has Gemini write briefings; the React web app talks to it over REST and websockets; the Roblox twin posts strikes to it; it sends STOPWORK over a websocket to the Raspberry Pi gateway on site, which reads the sensor pod, drives the UNO beacon head and stops the fan motor on GPIO 18](/assets/648f5db2-48b6-42b7-8f54-758fabe705a9)

Green arrows trace a lightning strike from the twin to the motor. Accent bars mark the parts I built myself; Viet and I built the backend together. It is FastAPI on a Vultr server, with its data in TimescaleDB on Tiger Data.

Before the feature work, I wrote the contracts: the event shapes, the serial lines between the boards, the websocket messages and the REST routes, each as a markdown file in `contracts/`. With those agreed, four people could build in parallel and connect the pieces near the end. Viet and I built the backend core, [Cameron Clemons](https://www.linkedin.com/in/cameron-clemons-jm3/) built the web app (the dashboard, each site's Hub and the crew phone page), and Yaroslav also wired the beacon's hardware.

## My part

I built the hazard index, the briefings, the beacon's software, the contracts and the deployment.

### The hazard index

Every site gets a 0 to 10 score for tomorrow, plus the three weather readings that pushed it up (from SHAP values), like "3 day rain 111 mm". I trained a LightGBM model on site-days: each of the 50 plants on each day from 2016 to 2024, 164,400 examples. A site-day counts as a hazard (about 6% do) if NOAA recorded a storm event like heat, lightning or flooding within 40 km that day, or OSHA has a severe injury report for outdoor work within 25 km. The inputs are that day's weather plus fixed facts about the site, like its flood zone.

I split the data by time, never at random: train on 2016 to 2022, tune on 2023, test once on 2024. In `ml/train.py` that is one line:

```python
tr, va, te = df[df.date.dt.year <= 2022], df[df.date.dt.year == 2023], df[df.date.dt.year == 2024]
```

A random split would let the same storm leak into training and testing through neighboring sites and days. Every number sits next to the rule a supervisor would write by hand (a heat index of at least 103 °F, 3-day rain of at least 75 mm, or gusts of at least 60 km/h):

| 2024 test year | Model | Hand-written rule |
|---|---|---|
| Average precision | **0.246** | 0.084 |
| ROC AUC | **0.817** | 0.594 |
| Brier score (lower is better) | **0.049** | 0.136 |

![Precision-recall curve for the 2024 test year: the model's curve, with an average precision of 0.246, sits above the hand-written rule's single point and well above the 5.8% positive rate](/assets/934cc453-23b7-4948-8f76-cd0714fca081)

A random guess scores about 0.058, the share of days that are hazards, so the model is about 4 times better than chance and 3 times better than the rule. The rule catches 29% of hazard days and is right 15% of the time it fires. Set to catch half of them, the model is right 21% of the time. That is still wrong most of the time, so it's a tool for deciding where to look first, not a forecast of injuries. And since location ranks high among its inputs, part of what it learned is which sites have been riskier in the past, not only which weather is.

### Briefings that can't invent numbers

Gemini writes the 6 PM briefings in English and Spanish, the one-sentence explanation of each score, and the hazard photo tags. A language model can state a number that isn't in the data, so every number in a generated briefing is checked against the numbers it was given. If the output has a number that isn't in the input, it retries once, then falls back to a template built from the data alone. The whole check is two functions and a loop, from `backend/app/intel/gemini.py`:

```python
def numbers(s: str) -> set[float]:
    return {float(n) for n in re.findall(r'\d+(?:\.\d+)?', s)}


def invented(text: str, payload: dict) -> set[float]:
    """Numbers in text that do not appear anywhere in the payload."""
    return numbers(text) - numbers(json.dumps(payload, ensure_ascii=False))


async def briefing(payload: dict) -> tuple[dict, str]:
    prompt = ...  # "Use only the numbers in this payload and add no others", then the payload as JSON
    for attempt in range(2):
        try:
            out = await generate(prompt, BRIEFING_SCHEMA, patient=True)
        except Exception:
            log.exception('briefing call failed')
            break
        bad = invented(out['english'], payload) | invented(out['spanish'], payload)
        if not bad:
            return {'english': out['english'], 'spanish': out['spanish']}, 'gemini'
        log.warning('briefing attempt %d invented %s', attempt + 1, sorted(bad))
        prompt += ' Your last answer used numbers that are not in the payload. Use only payload numbers.'
    return template_briefing(payload), 'template'
```

The forecast numbers in the payload are rounded to whole numbers before the model sees them, because the model rounds, and a briefing that says "97 °F" for 96.8 would otherwise fail the check.

### The beacon

The beacon has three boards. A sensor pod (an RP2040 running MicroPython) samples a light sensor 5,000 times a second to catch a lightning flash, and reads a radar, a water probe and an IR remote. A Raspberry Pi 5 runs the rules and speaks alerts offline in English and Spanish. An Arduino UNO drives the LCD, the countdown display and a 29-LED strip that shows the hazard index.

The flash detector runs on the pod's second core. At startup it measures the resting light for 0.4 seconds, then sets the threshold 6 standard deviations above it, and at least 1,500 counts (`FLASH_SIGMA` and `FLASH_MIN_DELTA`), so a very steady room doesn't fire on sensor noise:

```python
mean = sum(rest) / len(rest)
sd = math.sqrt(sum((v - mean) ** 2 for v in rest) / len(rest))
delta = max(int(FLASH_SIGMA * sd), FLASH_MIN_DELTA)
mean_q = int(mean) << 8                       # the mean in 1/256 counts, so the slow average stays a small int
thresh = int(mean) + delta
# ...
while running:
    v = ldr.read_u16()
    if v > thresh:
        above += 1
        if above == 2:
            t = time.ticks_us()
            if time.ticks_diff(t, last) > 300000:
                flash_us, last = t, t
                flash_count += 1
    else:
        above = 0
        mean_q += ((v << 8) - mean_q) >> 13
        thresh = (mean_q >> 8) + delta
```

Two samples in a row above the threshold count as a flash, followed by 300 ms when nothing counts. Between flashes, the resting mean slowly follows the room's light, so a passing shadow or a screen changing brightness isn't lightning.

The rule I cared about most: the beacon has to keep working when the internet doesn't. The Pi enforces the stop-work rules itself (if it sees a flash but has no thunder to time, it stops work anyway with the distance unknown), queues its events while offline, and replays them in order with their original timestamps when it reconnects. A stop work survives a reboot, and a release made on the dashboard while the beacon was offline is applied when it comes back. The motor runs only while the Pi holds GPIO 18 high, and the pin goes low if the program stops or crashes, so a failure stops the equipment instead of leaving it running. Only a supervisor PIN, on the dashboard or the beacon's IR remote, starts it again.

The same idea runs through `firmware/gateway/interlock.py`. The motor pin starts low, so the equipment can't run until the gateway decides it may, and a physical e-stop button on GPIO 23 cuts the motor before the rest of the program even hears about it:

```python
class Interlock:
    def __init__(self, loop, on_estop):
        # initial_value False: the motor stays off until the gateway decides it may run (fails safe on boot)
        self.motor = DigitalOutputDevice(18, initial_value=False)
        self.button = Button(23, pull_up=True, bounce_time=0.05)

        def pressed():   # runs on gpiozero's thread: cut the motor before anything else happens
            self.motor.off()
            log.info('E-STOP: GPIO 18 low, motor STOPPED')
            loop.call_soon_threadsafe(on_estop)

        self.button.when_pressed = pressed
```

## What broke

The hardware broke in ways software doesn't:

- **The motor garbled the screen.** The DC motor's electrical kick could corrupt the LCD in the middle of a write. The UNO now resyncs and redraws the screen every 5 seconds.
- **The power bank browned out.** Under load it dragged the Pi's 5 V down and the speaker cut out, so the beacon runs on wall power.
- **The only spare servo couldn't hold a position.** It was a continuous rotation servo, so it couldn't point a needle at a number. The LED strip became the gauge instead.

## What I took from it

- **Agree on the interfaces first.** The contracts are what let four people work at once without stepping on each other.
- **Put the baseline in every table.** The model's numbers only mean something next to the rule it would replace.
- **Fail safe.** When something goes wrong, the beacon stops the equipment.

## Links

- Devpost: [devpost.com/software/omnirisk-planit-beacon](https://devpost.com/software/omnirisk-planit-beacon)
- Code: [github.com/chrisguzman77/beacon](https://github.com/chrisguzman77/beacon)
- Live dashboard: [omnirisking-it-all-at-swamphacks.us](https://omnirisking-it-all-at-swamphacks.us)
- Project page: [OmniRisk](/projects/omnirisk)

If you have questions, or you're hiring, [get in touch](/contact).
