# Health Hub

A twelve-page analytical health console for Home Assistant.

The design comes from the Claude Design project **“Health Hub Light”**. The data is live Home
Assistant state plus reads from the recorder.

**The card never changes historical data.** The only writes are the explicit controls on the Now,
Day and Night pages — starting the treadmill, setting its speed, calibrating the posture sensor,
anchoring a sleep session. Each one is an ordinary Home Assistant service call on an entity you
pressed. Nothing touches the recorder database.

![pages](https://img.shields.io/badge/pages-12-B45309)
![history](https://img.shields.io/badge/history-never%20modified-2E7D5B)

---

## What this is

An ordinary health app shows a pretty number and says nothing about where it came from. This console
is built around three claims, and each one is visible in the interface rather than buried in the code.

**1. Trust in a signal is a first-class citizen.**
Every metric carries its age and its state. Fresh means full saturation and a green dot. Stale means
dimmed, an amber dot and the age beside it. Dead means grey, the value struck through and the reason
in words. A value with low trust is visually demoted and **kept out of every total**.

Verdicts are computed from `last_reported` against each source’s declared cadence, never written in
advance — which is the only way a channel you repaired can go green again on its own.

**2. Two sources and whether they agree.**
Oura against Muse on the same night. Three PM2.5 sensors in one flat. Three step counters. This is
not redundancy but built-in validation: **the difference between sources is shown as a metric of its
own**, never hidden behind an average.

**3. Two ranges: reference against optimum.**
The laboratory reference and the optimal range are drawn on the same bar. Far more markers fall
outside the optimum than outside the reference, and that gap is the analytical value.

**Click any card** to see where its number came from: the real recorder series over a window you
choose (24 h to 12 months, or your own dates), the dual range with a legend, and four facts — age,
trust state, source and caveat. A metric with no entity says so instead of drawing a plausible line.

**The Environment page switches by room.** The bedroom has two independent devices (Qingping and
Dyson), so a PM2.5 peak there can be *confirmed*, and only there do NO₂ and formaldehyde exist at
all. The living room has one node, so there is no cross-check — and the page says that rather than
hiding it.

---

## The twelve pages

| # | Page | Question | Scale |
|---|---|---|---|
| 01 | Now | What is my body doing this minute? | s · min |
| 02 | Day | What do I do across the day, hour by hour? | hours |
| 03 | Night | How did I sleep, and why exactly that way? | one night |
| 04 | Metabolism | What is my glucose doing, and driven by what? | min · 14 d |
| 05 | Body | Is recomposition actually happening? | weeks |
| 06 | Heart & vessels | How are the vessels holding up? | beat · day |
| 07 | Labs | What is in the blood, and where is it heading? | quarters |
| 08 | Environment | What am I breathing, and in what light do I live? | 5 min · day |
| 09 | Behaviour | What do I actually do every day? | day |
| 10 | Correlations | What affects what? | days · lag |
| 11 | Data trust | Can I believe what I just looked at? | audit |
| 12 | Targets | What am I aiming for each day? | per day |

---

## What is actually computed from real data

- **Spike detection.** Every excursion above 7.8 mmol/L is found in the real `sensor.glucose`
  series and attributed to the meal before it. Dishes are ranked by average peak rise, never by
  calories. A dish eaten once is listed with `n=1` rather than presented as a settled property.
- **AGP and time in range.** The 5/25/50/75/95 percentile bands are built from the actual series
  over 14 days, grouped into 15-minute slots of the day.
- **Postprandial windows.** A 0–3 h window is cut out of the glucose series at each Foodwatch
  timestamp; the rise is measured against the pre-meal baseline, and a treadmill session inside
  30 minutes marks the meal as walked.
- **163 biomarkers** read straight from the Ornament sensor attributes: `reference_min/max`,
  `optimal_min/max`, `category`, `measured_at` and `history`. The longitudinal chart in the drawer
  is that real `history` array.
- **The correlation matrix** is Pearson over daily aggregates from the long-term statistics. A cell
  with n < 20 stays **empty** rather than grey. The lag slider shifts Y against X by whole days.
- **Bland–Altman** compares Oura against Muse on awake time across their shared nights, with the
  bias and ±1.96 SD bands.
- **Experiment progress**: n is the number of days where the recorder holds both variables of the
  hypothesis at once.
- **Liveness and coverage** come from `last_reported` and the long-term statistics.

Today’s food intake is summed from the meals the recorder holds **for today**, not from the
Foodwatch running totals, which are counters that never reset.

Empty is never rendered as `0`. Empty says “no data”, and why.

Chart gaps: a hole shorter than the chart’s bridge threshold is sampling jitter and is interpolated;
a longer hole is a real outage and stays a visible break, so a dead channel still reads as dead.

---

## Install

### HACS (recommended)

1. HACS → **Frontend** → ⋮ → **Custom repositories**
2. Repository `https://github.com/nhazdun/HA-Health-Dashboard`, category **Lovelace/Dashboard**
3. Find **Health Hub** → Download
4. The resource `/hacsfiles/HA-Health-Dashboard/health-hub-card.js` (type **JavaScript Module**) is
   added for you

### Manually

Copy `dist/health-hub-card.js` into `/config/www/`, then
**Settings → Dashboards → Resources → Add resource**:
URL `/local/health-hub-card.js`, type **JavaScript Module**.

### The dashboard

Create a dashboard, open **Raw configuration editor** in edit mode:

```yaml
views:
  - title: Health Hub
    type: panel
    cards:
      - type: custom:health-hub-card
```

`type: panel` is required — the card renders its own full-width navigation.

---

## Card options

```yaml
type: custom:health-hub-card
page: now         # which page opens first: now, work, night, metab, body,
                  # heart, labs, env, behav, corr, trust, targets
accent: '#B45309' # the warm axis used for your own measurements
```

---

## Development

```bash
npm install
npm run build     # dist/health-hub-card.js
npm run watch
```

`npm run build` also writes `scripts/harness.built.html` with the fresh bundle spliced in — **open
that file, not `harness.html`**. Loading `dist/` as a sub-resource once let a stale cached copy hide
two whole panels that were present in the build.

The harness walks all twelve pages against synthetic-but-correctly-shaped state and catches render
errors before the card is ever installed:

```js
await window.__sweep()   // => { errors: 0, detail: [] }
window.__calls()         // the service calls the controls would have made
```

### Layout

```
src/
  core/      tokens · dom · format · ha · registry · events · info · ui
             controls · card-detail · list-modal · targets
  charts/    svg — line, scatter, calendar, lanes, stacks, matrix
  pages/     twelve pages, one question each
```

`src/core/registry.js` is the single place entity ids and expected cadences live. To add a device,
add a source there.

---

## Limits

- Raw recorder history is usually kept for about 10 days; anything deeper is read from the long-term
  statistics and is only available for entities with a `state_class`. Noise, TVOC and PM10 have none.
- Per-epoch hypnograms are not available: Oura and Muse both return aggregated stage durations, so
  the Night page compares stages instead of drawing an epoch track.
- Nocturnal blood pressure and melanopic EDI have no source yet. The frames are in place and the
  data appears when the devices do.

## Licence

MIT
