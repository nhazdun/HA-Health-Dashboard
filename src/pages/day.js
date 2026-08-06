import { h } from '../core/dom.js';
import { P, MONO } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow, cardHeading } from '../core/ui.js';
import { lineChart, laneChart, spark } from '../charts/svg.js';
import { resample } from '../core/ha.js';
import { loadEvents } from '../core/events.js';
import { controlPanel, nowControls } from '../core/controls.js';
import { fmt, mean, NO_DATA } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 2 — one day, hour by hour.
 *
 * Every other page answers a question at one time scale. This one holds a
 * single day and puts every channel on the same axis, so "the HRV dip" and
 * "the two-hour meeting" and "the 60 g lunch" can be read off the same column.
 *
 * The tracked window is 08:00 to 20:00 because that is when the desk devices
 * are awake. Outside it the lanes would be empty by construction, and an empty
 * lane that only means "the device was off" is worse than no lane at all.
 */

const FROM_HOUR = 8;
const TO_HOUR = 20;
const HOURS = TO_HOUR - FROM_HOUR;

export default {
  id: 'work',
  label: 'Day',
  title: 'Day',
  question: 'What do I do across the day, hour by hour?',
  scale: 'hours',
  dayScoped: true,

  live(ctx) {
    const off = ctx.state.dayOffset;
    const mac = ctx.sourceState('macos');
    if (off > 10) return { color: P.warn, label: 'beyond raw history' };
    if (mac.state === 'dead' || mac.state === 'empty') {
      return { color: P.warn, label: 'meetings are plan, not fact' };
    }
    return { color: off === 0 ? P.good : P.ref, label: off === 0 ? 'live day' : 'stored day' };
  },

  async load(ctx) {
    const { data } = ctx;
    const win = dayWindow(ctx.state.dayOffset);
    const opts = { start: win.start, end: win.end, significantOnly: false, ttl: 180e3 };

    const [glu, hrPolar, hrOura, padState, slouch, camera, evts] = await Promise.all([
      data.series(E.glucose, 24, opts),
      data.series(E.polarHr, 24, opts),
      data.series(E.ouraHr, 24, opts),
      data.exists(E.padState) ? data.history(E.padState, 24, opts) : {},
      data.exists(E.slouching) ? data.history(E.slouching, 24, opts) : {},
      data.exists(E.camera) ? data.history(E.camera, 24, opts) : {},
      loadEvents(ctx, Math.max(26, (Date.now() - win.start) / 3600e3)),
    ]);

    const hr = hrPolar.length >= 3 ? hrPolar : hrOura;
    const meals = evts.events.filter((e) => e.kind === 'meal' && e.t >= win.start && e.t <= win.end);
    const iqos = evts.events.filter((e) => e.kind === 'iqos' && e.t >= win.start && e.t <= win.end);
    const padSpans = spansOf(padState[E.padState] || [], (st) => st === 'running' || st === 'startup', win);
    const slouchSpans = spansOf(slouch[E.slouching] || [], (st) => st === 'on', win);
    const camSpans = spansOf(camera[E.camera] || [], (st) => st === 'on', win);

    return {
      win,
      glu, hr, hrFromRing: hrPolar.length < 3,
      padSpans, slouchSpans, camSpans, meals, iqos,
      hourly: {
        pad: minutesPerHour(padSpans, win),
        slouch: sharePerHour(slouchSpans, win),
        cam: minutesPerHour(camSpans, win),
        hr: meanPerHour(hr, win),
        glucose: meanPerHour(glu, win),
        iqos: countPerHour(iqos, win),
      },
    };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const off = ctx.state.dayOffset;
    const live = off === 0;
    const win = pd.win;
    const out = [];
    const H = pd.hourly;

    out.push(banner('ONE DAY',
      `This page holds one day, ${win.label}. It puts every action on one axis: treadmill, IQOS, `
      + `posture, laptop camera, food and glucose. The tracked hours run from ${pad2(FROM_HOUR)}:00 to `
      + `${pad2(TO_HOUR)}:00, because the desk devices sleep outside that window.`
      + (off > 10
        ? ' This day is older than the usual recorder retention, so most lanes will be empty.'
        : ''),
      off > 10 ? P.warn : P.ref));

    if (live) {
      const controls = controlPanel(ctx, nowControls(ctx));
      if (controls) out.push(controls);
    }

    // ----------------------------------------------------------------- cards
    const cards = [];
    const padMin = sum(H.pad);
    const slouchMean = H.slouch.filter(Number.isFinite).length
      ? mean(H.slouch.filter(Number.isFinite)) : null;
    const hrVals = H.hr.filter(Number.isFinite);
    const gluVals = H.glucose.filter(Number.isFinite);

    cards.push(cardHeading(
      live ? 'Right now' : `Channels on ${win.label}`,
      live ? 'live channels, seconds to minutes' : 'stored values for that day',
    ));

    cards.push(entityCard(ctx, {
      span: 2, size: '34px', label: 'Steps on the treadmill',
      entity: live ? E.padStepsDay : null,
      value: live ? undefined : (padMin ? Math.round(padMin * 54) : null),
      text: live ? undefined : (padMin ? fmt(Math.round(padMin * 54), 0) : NO_DATA),
      dec: 0, unit: 'steps',
      srcState: ctx.sourceState('kingsmith').state,
      ageText: live ? undefined : win.label,
      delta: `${fmt(padMin, 0)} min walking in ${pd.padSpans.length} session`
        + `${pd.padSpans.length === 1 ? '' : 's'}`
        + (live ? `\n${fmt(data.val(E.padDistDay), 2)} km today` : ''),
      deltaColor: padMin > 30 ? P.good : P.off,
      spark: spark(H.pad, ctx.accent),
      source: 'KingSmith',
      info: 'Steps counted by the treadmill across the day. The treadmill is the ground truth for '
        + 'walking at the desk, because the ring reads arm movement and misses it.',
      emptyHint: 'the treadmill wrote nothing on this day',
    }));

    cards.push(entityCard(ctx, {
      label: 'Heart rate',
      value: hrVals.length ? mean(hrVals) : null,
      text: hrVals.length ? fmt(mean(hrVals), 0) : NO_DATA, unit: 'bpm mean',
      srcState: hrVals.length ? 'ok' : 'empty',
      ageText: win.label,
      delta: hrVals.length ? `peak ${fmt(Math.max(...hrVals), 0)} bpm in a session` : '',
      deltaColor: P.good,
      spark: spark(H.hr, ctx.accent),
      source: pd.hrFromRing ? 'Oura Ring · PPG' : 'Polar H10',
      info: 'Heart rate across the tracked hours. Each rise usually marks a treadmill session, so it '
        + 'shows which speed actually moves you into a training zone.',
      emptyHint: 'no heart-rate record for this day',
    }));

    cards.push(entityCard(ctx, {
      label: 'Posture angle',
      entity: live ? E.postureAngle : null,
      value: live ? undefined : (slouchMean === null ? null : slouchMean),
      text: live ? undefined : (slouchMean === null ? NO_DATA : fmt(slouchMean, 0)),
      dec: 1, unit: live ? '°' : '% slouched',
      srcState: ctx.sourceState('upright').state,
      ageText: live ? undefined : win.label,
      ranges: live ? { refMin: 0, refMax: 45, optMin: 0, optMax: 10 } : null,
      delta: live ? 'optimum 0 to 10°' : 'mean of the tracked hours',
      deltaColor: P.warn,
      spark: spark(H.slouch, ctx.accent),
      source: 'Upright GO 2',
      emptyHint: 'the posture sensor wrote nothing on this day',
    }));

    cards.push(entityCard(ctx, {
      label: 'Glucose trend',
      value: gluVals.length ? gluVals[gluVals.length - 1] : null,
      text: gluVals.length ? fmt(gluVals[gluVals.length - 1], 1) : NO_DATA, unit: 'mmol/L',
      srcState: gluVals.length ? (live ? ctx.sourceState('nightscout').state : 'stale') : 'empty',
      ageText: win.label,
      delta: gluVals.length ? `peak ${fmt(Math.max(...gluVals), 1)} in the tracked hours` : '',
      deltaColor: gluVals.length && Math.max(...gluVals) > 7.8 ? P.alert : P.good,
      spark: spark(H.glucose, ctx.accent),
      source: 'Nightscout',
      info: 'Glucose across the tracked hours. Each peak follows its meal by about an hour, so the '
        + 'height of the peak reads as the cost of that dish.',
      emptyHint: 'the CGM wrote nothing on this day',
    }));

    // ------------------------------------------------------------ day totals
    cards.push(cardHeading('Day totals', `the tracked hours, ${pad2(FROM_HOUR)}:00 to ${pad2(TO_HOUR)}:00`));

    const worstHour = H.slouch.reduce((best, v, i) => (
      Number.isFinite(v) && (best === -1 || v > H.slouch[best]) ? i : best), -1);
    cards.push(entityCard(ctx, {
      label: 'Time slouched',
      value: slouchMean, text: slouchMean === null ? NO_DATA : fmt(slouchMean, 0), unit: '%',
      srcState: slouchMean === null ? 'empty' : ctx.sourceState('upright').state,
      ageText: win.label,
      ranges: { refMin: 0, refMax: 100, optMin: 0, optMax: 20 },
      delta: worstHour >= 0
        ? `mean of the ${H.slouch.filter(Number.isFinite).length} tracked hours\n`
          + `worst hour ${pad2(FROM_HOUR + worstHour)}:00 at ${fmt(H.slouch[worstHour], 0)}%`
        : '',
      deltaColor: P.warn,
      spark: spark(H.slouch, ctx.accent),
      source: 'Upright GO 2',
      emptyHint: 'no posture record for this day',
    }));

    const camMin = sum(H.cam);
    cards.push(entityCard(ctx, {
      label: 'Meetings, ground truth',
      value: pd.camSpans.length ? camMin : null,
      text: pd.camSpans.length ? fmt(camMin, 0) : NO_DATA, unit: 'min',
      srcState: pd.camSpans.length ? ctx.sourceState('macos').state : 'empty',
      ageText: win.label,
      delta: pd.camSpans.length
        ? `${pd.camSpans.length} block${pd.camSpans.length === 1 ? '' : 's'} with the camera on`
        : '',
      deltaColor: P.ref,
      source: 'HA Companion macOS · camera_in_use',
      emptyHint: 'the laptop camera sensor wrote nothing on this day',
    }));

    cards.push(entityCard(ctx, {
      label: 'CO₂ at the desk', entity: live ? E.deskCo2 : null,
      value: live ? undefined : null, text: live ? undefined : NO_DATA,
      dec: 0, unit: 'ppm',
      srcState: live ? ctx.sourceState('qp_desk').state : 'empty',
      ranges: { refMin: 400, refMax: 1400, optMin: 400, optMax: 800 },
      delta: 'focus drops above 800',
      deltaColor: (data.val(E.deskCo2) ?? 0) > 800 ? P.warn : P.good,
      source: 'Qingping 554b',
      emptyHint: 'switch to today for the live desk reading',
    }));

    cards.push(entityCard(ctx, {
      label: 'IQOS in tracked hours',
      value: pd.iqos.length, text: String(pd.iqos.length), unit: 'events',
      srcState: ctx.sourceState('iqos').state,
      ageText: win.label,
      delta: `${H.iqos.filter((v) => v > 0).length} hours with a stick`,
      deltaColor: pd.iqos.length ? P.warn : P.good,
      spark: spark(H.iqos.map((v) => v + 0.05), P.alert),
      source: 'IQOS · manual sync ±15%',
      info: 'Puff batches recorded inside the tracked hours. The timestamps carry a ±15% error, which '
        + 'is just enough for the PM2.5 correlation and not enough for anything finer.',
    }));

    cards.push(cardHeading('Food', 'the only meal timestamps in the system'));
    cards.push(entityCard(ctx, {
      label: 'Meals in the block',
      value: pd.meals.length, text: String(pd.meals.length), unit: 'meals',
      srcState: pd.meals.length ? ctx.sourceState('foodwatch').state : 'empty',
      ageText: win.label,
      delta: pd.meals.length
        ? pd.meals.map((m) => clock(m.t)).join(' · ')
        : '',
      source: 'Foodwatch',
      emptyHint: 'no meal logged on this day',
    }));

    out.push(h('div.hh-cards', cards));

    // ------------------------------------------------------ the day on one axis
    const lanes = buildLanes(ctx, pd, win);
    const anyLane = lanes.some((l) => l.segs && l.segs.length);
    out.push(panel(
      'The day on one axis',
      'Lanes run from planned time at the top to physiology at the bottom. Read down a single column '
      + 'to see what happened at the same minute. A lane with no source says so rather than showing '
      + 'an empty bar that could be mistaken for a quiet day.',
      `${win.label} · ${pad2(FROM_HOUR)}:00 to ${pad2(TO_HOUR)}:00`,
      anyLane
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          laneChart({
            lanes, labelWidth: 150, rowH: 30,
            xLabels: axisHours(),
          }),
          legendRow([
            { color: P.ref, label: 'laptop camera' },
            { color: P.good, label: 'treadmill' },
            { color: ctx.accent, label: 'meals' },
            { color: P.alert, label: 'IQOS / alerts' },
            { color: P.olive, label: 'slouching' },
          ]),
        ])
        : emptyState('The recorder holds no event for this day inside the tracked hours.'),
    ));

    // ------------------------------------------ glucose and heart rate
    const bothVals = [...gluVals, ...hrVals.map((v) => v / 10)];
    out.push(panel(
      'Glucose and heart rate through the day',
      'The warm line is glucose. The blue line is heart rate divided by ten, so both fit one axis. '
      + 'Each heart-rate rise is a treadmill session; each glucose peak follows its meal by about an '
      + 'hour, so the peak height reads as the cost of that dish.',
      'glucose mmol/L · heart rate ÷ 10',
      bothVals.length >= 3
        ? lineChart({
          h: 240,
          yMin: Math.max(3, Math.floor(Math.min(...bothVals) - 1)),
          yMax: Math.ceil(Math.max(...bothVals) + 1),
          yTicks: [5, 6, 7, 8, 9],
          xLabels: axisHours(),
          series: [
            { pts: H.glucose, color: ctx.accent, w: 2, dot: true },
            { pts: H.hr.map((v) => (v === null ? null : v / 10)), color: P.ref, w: 1.8, dot: true },
          ],
          thresholds: [{ v: 7.8, color: P.warn, label: 'spike threshold 7.8' }],
          events: pd.meals.map((m) => ({
            at: frac(m.t, win), label: 'meal', color: ctx.accent,
          })),
          showEvents: ctx.state.annotations,
        })
        : emptyState('Neither glucose nor heart rate has a series for the tracked hours of this day.'),
    ));

    // ------------------------------------------ hour by hour bars
    const hasHourly = H.slouch.some(Number.isFinite) || H.pad.some((v) => v > 0);
    out.push(panel(
      'Hour by hour: slouch share and treadmill minutes',
      'Bars show the share of each hour spent above the slouch threshold. The line shows treadmill '
      + 'minutes in that hour. Point at a bar to read the hour, the share and the minutes walked.',
      `${HOURS} tracked hours`,
      hasHourly ? hourBars(ctx, H) : emptyState(
        'Neither the posture sensor nor the treadmill wrote anything inside the tracked hours.',
      ),
    ));

    return out;
  },
};

// ------------------------------------------------------------------ helpers

const pad2 = (n) => String(n).padStart(2, '0');
const sum = (a) => a.filter(Number.isFinite).reduce((x, y) => x + y, 0);
const clock = (t) => {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Local midnight-to-midnight for the chosen day, clipped to now for today. */
function dayWindow(offset) {
  const start = new Date();
  start.setDate(start.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    start: start.getTime(),
    end: Math.min(end.getTime(), Date.now()),
    dayStart: start.getTime(),
    trackStart: start.getTime() + FROM_HOUR * 3600e3,
    trackEnd: start.getTime() + TO_HOUR * 3600e3,
    label: `${MONTHS[start.getMonth()]} ${start.getDate()}`,
  };
}

/** Contiguous spans where the state matched, clipped to the window. */
function spansOf(rows, matches, win) {
  const out = [];
  let onAt = null;
  for (const r of rows) {
    const on = matches(r.s);
    if (on && onAt === null) onAt = r.t;
    if (!on && onAt !== null) { out.push([onAt, r.t]); onAt = null; }
  }
  if (onAt !== null) out.push([onAt, Math.min(win.end, Date.now())]);
  return out
    .map(([a, b]) => [Math.max(a, win.start), Math.min(b, win.end)])
    .filter(([a, b]) => b > a);
}

function hourIndex(t, win) {
  return Math.floor((t - win.trackStart) / 3600e3);
}

function minutesPerHour(spans, win) {
  const out = new Array(HOURS).fill(0);
  for (const [a, b] of spans) {
    for (let i = 0; i < HOURS; i++) {
      const hs = win.trackStart + i * 3600e3;
      const he = hs + 3600e3;
      const overlap = Math.min(b, he) - Math.max(a, hs);
      if (overlap > 0) out[i] += overlap / 60000;
    }
  }
  return out;
}

function sharePerHour(spans, win) {
  return minutesPerHour(spans, win).map((m) => (m / 60) * 100);
}

function meanPerHour(rows, win) {
  const acc = Array.from({ length: HOURS }, () => []);
  for (const p of rows) {
    const i = hourIndex(p.t, win);
    if (i >= 0 && i < HOURS && p.v !== null) acc[i].push(p.v);
  }
  return acc.map((a) => (a.length ? mean(a) : null));
}

function countPerHour(events, win) {
  const out = new Array(HOURS).fill(0);
  for (const e of events) {
    const i = hourIndex(e.t, win);
    if (i >= 0 && i < HOURS) out[i]++;
  }
  return out;
}

/** Position inside the tracked window, 0..1. */
function frac(t, win) {
  return (t - win.trackStart) / (win.trackEnd - win.trackStart);
}

function axisHours() {
  const out = [];
  for (let i = 0; i <= 4; i++) out.push(`${pad2(FROM_HOUR + (HOURS / 4) * i)}:00`);
  return out;
}

function buildLanes(ctx, pd, win) {
  const span = ([a, b]) => [frac(a, win), frac(b, win)];
  const point = (t, minutes) => [frac(t, win), frac(t + minutes * 60e3, win)];
  const clip = (segs) => segs
    .map(([a, b]) => [Math.max(0, a), Math.min(1, b)])
    .filter(([a, b]) => b > a);

  return [
    {
      label: 'Laptop camera', color: P.ref,
      segs: clip(pd.camSpans.map(span)),
      note: pd.camSpans.length ? null : 'sensor off',
    },
    { label: 'Treadmill', color: P.good, segs: clip(pd.padSpans.map(span)) },
    { label: 'Meals', color: ctx.accent, segs: clip(pd.meals.map((m) => point(m.t, 12))) },
    { label: 'IQOS', color: P.alert, segs: clip(pd.iqos.map((m) => point(m.t, 6))) },
    { label: 'Slouching', color: P.olive, segs: clip(pd.slouchSpans.map(span)) },
  ];
}

/** Bars for the slouch share with the treadmill minutes drawn over them. */
function hourBars(ctx, H) {
  const w = 940, hgt = 230, padL = 44, iw = w - padL - 14;
  const bw = iw / HOURS;
  const kids = [];
  const maxPad = Math.max(20, ...H.pad);

  [25, 50, 75].forEach((t) => {
    const y = hgt - 34 - (t / 100) * (hgt - 56);
    kids.push(h('line', { x1: padL, x2: w - 14, y1: y, y2: y, stroke: P.ruleSoft, strokeWidth: 1 }));
    kids.push(h('text', {
      x: padL - 6, y: y + 3.5, textAnchor: 'end', fill: P.off, fontSize: 9, fontFamily: MONO,
    }, `${t}%`));
  });

  H.slouch.forEach((v, i) => {
    const label = `${pad2(FROM_HOUR + i)}:00 · `
      + (Number.isFinite(v) ? `${fmt(v, 0)}% slouched` : 'no posture record')
      + ` · ${fmt(H.pad[i], 0)} min on the treadmill`;
    if (Number.isFinite(v) && v > 0) {
      const bh = (v / 100) * (hgt - 56);
      kids.push(h('rect', {
        x: padL + i * bw + 3, y: hgt - 34 - bh, width: bw - 6, height: Math.max(1, bh), rx: 3,
        fill: v > 55 ? P.alert : v > 35 ? '#C79A3A' : P.good, opacity: 0.85,
      }, h('title', label)));
    } else {
      kids.push(h('rect', {
        x: padL + i * bw + 3, y: hgt - 36, width: bw - 6, height: 2, rx: 1, fill: P.s2,
      }, h('title', label)));
    }
    kids.push(h('text', {
      x: padL + i * bw + bw / 2, y: hgt - 18, textAnchor: 'middle',
      fill: P.off, fontSize: 9, fontFamily: MONO,
    }, pad2(FROM_HOUR + i)));
  });

  const padPts = H.pad.map((v, i) => `${(padL + i * bw + bw / 2).toFixed(1)},`
    + `${(hgt - 34 - (v / maxPad) * (hgt - 56)).toFixed(1)}`);
  kids.push(h('path', {
    d: `M${padPts.join('L')}`, fill: 'none', stroke: P.ref, strokeWidth: 2,
  }));
  kids.push(h('text', {
    x: w - 14, y: 22, textAnchor: 'end', fill: P.ref, fontSize: 9, fontFamily: MONO,
  }, `treadmill minutes, peak ${fmt(maxPad, 0)}`));

  return h('svg', { viewBox: `0 0 ${w} ${hgt}` }, kids);
}

export { resample };
