import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart, laneChart, spark } from '../charts/svg.js';
import { dayKey, resample } from '../core/ha.js';
import { loadEvents, eventsFor } from '../core/events.js';
import { fmt, age, clockOf, NO_DATA } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 8 — what actually happens in a day.
 *
 * The day ribbon puts meals, treadmill sessions, IQOS, meetings and air raid
 * alerts on one time axis. Without it a dip in HRV reads as a bad protocol.
 */

const WEEKS = 12;

export default {
  id: 'behav',
  label: 'Behaviour',
  title: 'Behaviour',
  question: 'What do I actually do every day?',
  scale: 'day',

  live(ctx) {
    const iqos = ctx.sourceState('iqos');
    const mac = ctx.sourceState('macos');
    if (iqos.state === 'dead') return { color: P.alert, label: 'IQOS not synced' };
    if (mac.state === 'dead' || mac.state === 'empty') return { color: P.warn, label: 'no true meeting record' };
    return { color: P.warn, label: 'manual sync' };
  },

  async load(ctx) {
    const { data } = ctx;
    const days = WEEKS * 7;
    const [evts, iqosStats, padStats, stepStats, waterStats, camera, posture, slouchHist] = await Promise.all([
      loadEvents(ctx, 24),
      data.stats([E.iqosToday, E.iqosPuffs].filter((id) => data.exists(id)), days, 'day', ['mean', 'max', 'state']),
      data.stats([E.padTimeDay, E.padStepsDay].filter((id) => data.exists(id)), days, 'day', ['mean', 'max']),
      data.stats([E.ouraSteps, E.phoneSteps].filter((id) => data.exists(id)), days, 'day', ['max', 'mean']),
      data.stats([E.waterToday].filter((id) => data.exists(id)), days, 'day', ['max', 'mean']),
      data.exists(E.camera) ? data.history(E.camera, 24, { significantOnly: false }) : {},
      data.exists(E.postureAngle)
        ? data.series(E.postureAngle, 24, { significantOnly: false }) : Promise.resolve([]),
      data.exists(E.slouching)
        ? data.history(E.slouching, 24, { significantOnly: false }) : Promise.resolve({}),
    ]);
    return { evts, iqosStats, padStats, stepStats, waterStats, camera, posture, slouchHist, days };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];

    // Three independent step counters — the delta between them is a metric.
    const steps = {
      pad: data.val(E.padStepsDay),
      oura: data.val(E.ouraSteps),
      phone: data.val(E.phoneSteps),
    };
    const known = Object.entries(steps).filter(([, v]) => v !== null);
    if (known.length >= 2) {
      const vs = known.map(([, v]) => v);
      const spread = Math.max(...vs) - Math.min(...vs);
      out.push(banner('THREE STEP COUNTERS',
        `Treadmill ${fmt(steps.pad, 0)}, Oura ${fmt(steps.oura, 0)}, iPhone ${fmt(steps.phone, 0)}. `
        + `The spread is ${fmt(spread, 0)} steps. This is not redundancy but built-in validation: the `
        + 'treadmill counts only its own sessions, the ring reads arm movement and the phone counts what '
        + 'is in your pocket. None of the three is the correct one.',
        spread > 3000 ? P.warn : P.ref));
    }

    // ----------------------------------------------------------------- cards
    const cards = [];
    const iqos = data.val(E.iqosToday);
    const iqosTrend = grid(pd.iqosStats[E.iqosToday] || pd.iqosStats[E.iqosPuffs] || [], pd.days, 'max');
    cards.push(entityCard(ctx, {
      span: 2, size: '40px', label: 'IQOS per day', entity: E.iqosToday, dec: 0, unit: 'sticks',
      srcState: ctx.sourceState('iqos').state,
      ranges: { refMin: 0, refMax: 46, optMin: 0, optMax: 0 },
      delta: `${fmt(data.val(E.iqosPuffs), 0)} puffs · target 0\nlast sync ${data.raw(E.iqosSync) || NO_DATA}`,
      deltaColor: iqos > 20 ? P.alert : P.warn,
      spark: spark(iqosTrend, P.alert),
      source: 'IQOS · manual sync ±15%',
      note: 'timestamps borderline for E29',
    }));

    cards.push(entityCard(ctx, {
      label: 'Treadmill today', entity: E.padTimeDay, dec: 2, unit: 'h',
      srcState: ctx.sourceState('kingsmith').state,
      delta: `${fmt(data.val(E.padStepsDay), 0)} steps · ${fmt(data.val(E.padDistDay), 2)} km`,
      deltaColor: P.good,
      source: 'KingSmith',
    }));
    cards.push(entityCard(ctx, {
      label: 'Steps · Oura', entity: E.ouraSteps, dec: 0, unit: 'steps',
      srcState: ctx.sourceState('oura').state,
      delta: 'independent counter number two',
      source: 'Oura Ring',
    }));
    cards.push(entityCard(ctx, {
      label: 'Steps · iPhone', entity: E.phoneSteps, dec: 0, unit: 'steps',
      srcState: ctx.sourceState('iphone').state,
      delta: `distance ${fmt(data.val(E.phoneDistance), 0)} m`,
      source: 'iPhone · counter number three',
    }));
    cards.push(entityCard(ctx, {
      label: 'Water', entity: E.waterToday, dec: 0, unit: 'mL',
      srcState: ctx.sourceState('hidrate').state,
      ranges: { refMin: 0, refMax: 3000, optMin: 2000, optMax: 3000 },
      delta: `${fmt(data.val(E.sipsToday), 0)} sips · ${fmt(data.val(E.refillsToday), 0)} refills`,
      deltaColor: P.warn,
      source: 'Hidrate Spark',
      emptyHint: 'the bottle is offline. Coverage is incomplete',
    }));

    const slouch = data.val(E.slouchTime), upright = data.val(E.uprightTime);
    const pct = slouch !== null && upright !== null && slouch + upright > 0
      ? (slouch / (slouch + upright)) * 100 : null;
    cards.push(entityCard(ctx, {
      label: 'Posture angle', entity: E.postureAngle, dec: 1, unit: '°',
      srcState: ctx.sourceState('upright').state,
      ranges: { refMin: 0, refMax: 45, optMin: 0, optMax: 10 },
      delta: 'optimum 0 to 10°',
      deltaColor: (data.val(E.postureAngle) ?? 0) > 10 ? P.warn : P.good,
      source: 'Upright GO 2',
    }));
    cards.push(entityCard(ctx, {
      label: 'Time slouched', value: pct, text: fmt(pct, 1), unit: '%',
      srcState: pct === null ? 'empty' : ctx.sourceState('upright').state,
      entity: E.slouchTime,
      ranges: { refMin: 0, refMax: 100, optMin: 0, optMax: 20 },
      delta: pct === null ? '' : `${fmt(slouch, 1)} slouched / ${fmt(upright, 1)} upright, min`,
      deltaColor: pct > 30 ? P.warn : P.good,
      source: 'Upright GO 2',
    }));
    cards.push(entityCard(ctx, {
      label: 'Movement', entity: E.movement,
      text: movementLabel(data.raw(E.movement)), size: '22px', unit: '',
      srcState: ctx.sourceState('upright').state,
      delta: 'a proxy for sedentary time',
      source: 'Upright GO 2',
      emptyHint: 'the movement sensor has not reported a state yet',
    }));

    const camMin = cameraMinutes(pd.camera[E.camera] || []);
    cards.push(entityCard(ctx, {
      label: 'Meetings, ground truth', value: camMin, text: camMin === null ? NO_DATA : fmt(camMin, 0), unit: 'min',
      srcState: camMin === null ? 'empty' : ctx.sourceState('macos').state,
      entity: E.camera,
      delta: camMin === null ? '' : `laptop camera active · now ${data.raw(E.frontApp) || NO_DATA}`,
      deltaColor: P.good,
      source: 'HA Companion macOS · camera_in_use',
      emptyHint: 'the laptop sensors are off, so E27 has no ground truth',
      note: camMin === null ? 'E27 blocked' : null,
    }));

    cards.push(entityCard(ctx, {
      label: 'Screen time', entity: null, value: null, text: NO_DATA, unit: 'min',
      srcState: 'empty',
      emptyHint: 'there is no Screen Time sensor. E13 needs the 2 hours before bed and not the daily total',
      source: 'iPhone',
      note: 'E13 blocked', noteColor: P.ref,
    }));

    out.push(h('div.hh-cards', cards));

    // ----------------------------------------------------- posture over the day
    const postureVals = (pd.posture || []).map((p) => p.v);
    out.push(panel(
      'Posture angle across the day',
      pd.posture && pd.posture.length
        ? 'How far the upper back leans from vertical. Everything above the 10° line counts as a slouch, '
          + `which today is ${pct === null ? NO_DATA : fmt(pct, 1) + '%'} of the tracked time. `
          + `${pd.posture.length} records from the recorder over the day.`
        : 'The posture-angle series for the day is empty.',
      'Upright GO 2 · degrees',
      pd.posture && pd.posture.length >= 2
        ? lineChart({
          h: 210, yMin: 0,
          yMax: Math.max(48, Math.ceil(Math.max(...postureVals) * 1.1)),
          yTicks: [0, 10, 20, 30, 40],
          xLabels: ['−24 h', '−18', '−12', '−6', 'now'],
          series: [{
            pts: resample(pd.posture, 120, Date.now() - 24 * 3600e3, Date.now(), { bridgeMinutes: 45 }),
            color: ctx.accent, w: 1.5, fill: true,
          }],
          thresholds: [
            { v: 10, color: P.warn, label: 'slouch threshold 10°' },
            { v: data.val(E.postureAngle) ?? 0, color: P.off, label: `now ${fmt(data.val(E.postureAngle), 1)}°` },
          ],
          events: eventsFor(pd.evts, Date.now() - 24 * 3600e3, Date.now(), ctx, ['meal', 'iqos']),
          showEvents: ctx.state.annotations,
        })
        : emptyState('The posture sensor returned no series for the last 24 hours.'),
    ));

    // ---------------------------------------------------------- day ribbon
    const dayStart = startOfToday();
    const dayEnd = dayStart + 86400e3;
    const lanes = buildLanes(ctx, pd, dayStart, dayEnd);
    const anySeg = lanes.some((l) => l.segs && l.segs.length);
    out.push(panel(
      'Day ribbon',
      'One time axis holds every event: meals, treadmill sessions, IQOS, the laptop camera and alerts. '
      + 'It is built from the real state transitions the recorder holds for today.',
      `${clockOf(new Date(dayStart))} → 24:00`,
      anySeg
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          laneChart({
            lanes, labelWidth: 132,
            xLabels: ['00:00', '06:00', '12:00', '18:00', '24:00'],
          }),
          legendRow([
            { color: ctx.accent, label: 'meals' },
            { color: P.good, label: 'treadmill' },
            { color: P.alert, label: 'IQOS / alert' },
            { color: P.olive, label: 'slouched' },
            { color: P.ref, label: 'laptop camera' },
          ]),
        ])
        : emptyState('The recorder holds no event for today yet.'),
    ));

    // ------------------------------------------------------- substitution
    const iqosDaily = iqosTrend;
    const padDaily = grid(pd.padStats[E.padTimeDay] || [], pd.days, 'max');
    const hasBoth = iqosDaily.filter(Number.isFinite).length >= 3 && padDaily.filter(Number.isFinite).length >= 3;
    out.push(panel(
      `Substitution: treadmill against IQOS over ${WEEKS} weeks`,
      hasBoth
        ? 'This is one flow and not two separate lines. Hypothesis E26 says treadmill minutes displace '
          + 'IQOS micro-breaks. If that holds, the curves must move towards each other.'
        : 'Testing E26 needs both series in the long-term statistics.',
      'sticks/day · treadmill hours',
      hasBoth
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 240, yMin: 0,
            yMax: Math.max(10, Math.ceil(Math.max(...iqosDaily.filter(Number.isFinite)) * 1.15)),
            yTicks: tickList(Math.max(...iqosDaily.filter(Number.isFinite))),
            xLabels: [`−${WEEKS} weeks`, `−${Math.round(WEEKS * 0.66)}`, `−${Math.round(WEEKS * 0.33)}`, 'now'],
            series: [
              { pts: iqosDaily, color: P.alert, fill: true, w: 2 },
              {
                pts: padDaily.map((v) => (v === null ? null : v * scaleFactor(iqosDaily, padDaily))),
                color: ctx.accent, fill: true, w: 2,
              },
            ],
          }),
          legendRow([
            { color: P.alert, label: 'IQOS sticks per day' },
            { color: ctx.accent, label: 'treadmill hours (scaled to the axis)' },
          ]),
        ])
        : emptyState('The long-term statistics for IQOS and the treadmill are missing for this window.'),
    ));

    // ------------------------------------------------------- step counters
    const ouraSteps = grid(pd.stepStats[E.ouraSteps] || [], pd.days, 'max');
    const phoneSteps = grid(pd.stepStats[E.phoneSteps] || [], pd.days, 'max');
    const padSteps = grid(pd.padStats[E.padStepsDay] || [], pd.days, 'max');
    const allSteps = [...ouraSteps, ...phoneSteps, ...padSteps].filter(Number.isFinite);
    out.push(panel(
      'Three step counters on one axis',
      'The spread between them is a metric and not noise to remove. Days where the treadmill leads the '
      + 'ring and days where it trails mean different kinds of activity.',
      'Oura · iPhone · treadmill',
      allSteps.length >= 3
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 220, yMin: 0, yMax: Math.ceil(Math.max(...allSteps) * 1.1),
            yTicks: tickList(Math.max(...allSteps)),
            xLabels: [`−${WEEKS} weeks`, `−${Math.round(WEEKS * 0.66)}`, `−${Math.round(WEEKS * 0.33)}`, 'now'],
            series: [
              { pts: ouraSteps, color: P.ref, w: 1.6 },
              { pts: phoneSteps, color: P.olive, w: 1.6 },
              { pts: padSteps, color: ctx.accent, w: 1.6 },
            ],
          }),
          legendRow([
            { color: P.ref, label: 'Oura' },
            { color: P.olive, label: 'iPhone' },
            { color: ctx.accent, label: 'treadmill' },
          ]),
        ])
        : emptyState('The step series have not accumulated in the long-term statistics yet.'),
    ));

    return out;
  },
};

// ------------------------------------------------------------------ helpers

function movementLabel(state) {
  return { idle: 'idle', moving: 'moving', unknown: NO_DATA }[state] || (state || NO_DATA);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function buildLanes(ctx, pd, dayStart, dayEnd) {
  const span = dayEnd - dayStart;
  const at = (t) => (t - dayStart) / span;
  const pick = (kind) => pd.evts.events
    .filter((e) => e.kind === kind && e.t >= dayStart && e.t <= dayEnd)
    .map((e) => [at(e.t), at(e.t) + 0.004]);

  const sessions = (pd.evts.sessions || [])
    .filter(([a, b]) => b >= dayStart && a <= dayEnd)
    .map(([a, b]) => [at(Math.max(a, dayStart)), at(Math.min(b, dayEnd))]);

  const onSegments = (rows, dayStartMs) => {
    const segs = [];
    let onAt = null;
    for (const r of rows) {
      if (r.s === 'on' && onAt === null) onAt = r.t;
      if (r.s !== 'on' && onAt !== null) { segs.push([at(onAt), at(r.t)]); onAt = null; }
    }
    if (onAt !== null) segs.push([at(onAt), at(Date.now())]);
    return segs.filter(([a, b]) => b > a);
  };

  const camSegs = onSegments(pd.camera[ctx.E.camera] || []);
  const slouchSegs = onSegments((pd.slouchHist || {})[ctx.E.slouching] || []);

  return [
    { label: 'Meals', segs: pick('meal'), color: ctx.accent },
    { label: 'Treadmill', segs: sessions, color: P.good },
    { label: 'IQOS', segs: pick('iqos'), color: P.alert },
    { label: 'Slouched', segs: slouchSegs, color: P.olive },
    { label: 'Laptop camera', segs: camSegs, color: P.ref },
    { label: 'Alerts', segs: pick('alert'), color: P.alert },
  ];
}

function cameraMinutes(rows) {
  if (!rows.length) return null;
  let total = 0, onAt = null;
  for (const r of rows) {
    if (r.s === 'on' && onAt === null) onAt = r.t;
    if (r.s !== 'on' && onAt !== null) { total += r.t - onAt; onAt = null; }
  }
  if (onAt !== null) total += Date.now() - onAt;
  return total / 60000;
}

function grid(rows, days, agg) {
  const byDay = new Map();
  for (const r of rows) {
    const v = agg === 'max' ? (r.max ?? r.mean) : (r.mean ?? r.max);
    if (Number.isFinite(v)) byDay.set(dayKey(r.t), v);
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 86400e3);
    out.push(byDay.has(k) ? byDay.get(k) : null);
  }
  return out;
}

function scaleFactor(a, b) {
  const av = a.filter(Number.isFinite), bv = b.filter(Number.isFinite);
  if (!av.length || !bv.length) return 1;
  const am = Math.max(...av), bm = Math.max(...bv);
  return bm ? (am * 0.8) / bm : 1;
}

function tickList(max) {
  const step = Math.max(1, Math.round(max / 4));
  return [step, step * 2, step * 3].map((v) => Math.round(v));
}

export { age };
