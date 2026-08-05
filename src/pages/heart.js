import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart } from '../charts/svg.js';
import { dayKey } from '../core/ha.js';
import { fmt, age, NO_DATA } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 5 — heart and vessels.
 *
 * Two HRV channels (Oura at night, H10 in the morning) stay as two lines and
 * are never averaged: different protocols measure different physiology. Where
 * two sources measure the *same* quantity — pulse wave velocity — their
 * agreement is shown as a value in itself.
 */

const DAYS = 30;

export default {
  id: 'heart',
  label: 'Heart & vessels',
  title: 'Heart & vessels',
  question: 'How are the vessels holding up?',
  scale: 'beat · day',

  live(ctx) {
    const oura = ctx.sourceState('oura');
    const orn = ctx.sourceState('ornament');
    if (oura.state === 'dead') return { color: P.alert, label: 'Oura is silent' };
    if (orn.state === 'dead') return { color: P.warn, label: 'the lipid panel is stale' };
    return { color: P.good, label: 'sources in place' };
  },

  async load(ctx) {
    const { data } = ctx;
    const ids = [E.ouraSleepHrv, E.polarRmssd, E.ouraLowestHr, E.ouraHrAvg, E.ouraSpo2]
      .filter((id) => data.exists(id));
    const stats = await data.stats(ids, DAYS, 'day', ['mean', 'min', 'max']);
    return { stats, grid: buildGrid(stats, ids, DAYS) };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];
    const orn = ctx.sourceState('ornament');

    // Two devices, one quantity — Withings reports PWV in mph, Oura in m/s.
    const ouraPwv = data.val(E.ouraPwv);
    const wPwvRaw = data.val(E.wPwv);
    const wPwv = wPwvRaw !== null ? convertPwv(wPwvRaw, data.unit(E.wPwv)) : null;
    if (ouraPwv !== null && wPwv !== null) {
      const diff = Math.abs(ouraPwv - wPwv);
      const agree = diff < 1;
      out.push(banner(agree ? 'SOURCES AGREE' : 'SOURCES DISAGREE',
        `Pulse wave velocity: Oura ${fmt(ouraPwv, 2)} m/s and Withings ${fmt(wPwv, 2)} m/s, a gap of ${fmt(diff, 2)} m/s. `
        + (agree
          ? 'Two independent devices agree, so the value can be trusted.'
          : 'The gap is over a metre per second, so treat both values as approximate.')
        + (data.unit(E.wPwv) && !/m\/s/i.test(data.unit(E.wPwv))
          ? ` Withings reports the unit "${data.unit(E.wPwv)}". The page converts it here and leaves it raw in Home Assistant.`
          : ''),
        agree ? P.good : P.warn));
    }

    // ----------------------------------------------------------------- cards
    const cards = [];

    cards.push(entityCard(ctx, {
      span: 2, size: '40px', label: 'Nocturnal dipping ratio',
      value: null, text: NO_DATA, unit: '%',
      srcState: 'empty',
      emptyHint: 'a cuff cannot give this. It needs Aktiia with a night blood-pressure profile',
      delta: '',
      source: 'the one unique gap in the stack',
      note: 'E17 blocked on hardware',
      noteColor: P.ref,
    }));

    cards.push(entityCard(ctx, {
      label: 'HRV during sleep', entity: E.ouraSleepHrv, dec: 0, unit: 'ms',
      srcState: ctx.sourceState('oura').state, ageText: 'morning',
      ranges: { optMin: 40, optMax: 90 },
      delta: `HRV balance ${fmt(data.val(E.ouraHrvBalance), 0)}`,
      deltaColor: P.good,
      source: 'Oura · PPG',
      emptyHint: 'Oura has not returned this night yet',
    }));
    cards.push(entityCard(ctx, {
      label: 'RMSSD, morning', entity: E.polarRmssd, dec: 0, unit: 'ms',
      srcState: ctx.sourceState('polar').state,
      ranges: { optMin: 40, optMax: 90 },
      delta: '5 min seated protocol (E22)',
      source: 'Polar H10 · ECG-grade',
      emptyHint: 'the strap is not worn',
    }));
    cards.push(entityCard(ctx, {
      label: 'Lowest HR asleep', entity: E.ouraLowestHr, dec: 0, unit: 'bpm',
      srcState: ctx.sourceState('oura').state, ageText: 'morning',
      ranges: { optMin: 45, optMax: 60 },
      delta: 'the cleanest recovery marker',
      source: 'Oura',
    }));
    cards.push(entityCard(ctx, {
      label: 'PWV · Oura', entity: E.ouraPwv, dec: 2, unit: 'm/s',
      srcState: ctx.sourceState('oura').state, ageText: 'morning',
      ranges: { optMin: 5, optMax: 7 },
      delta: wPwv !== null ? `Withings ${fmt(wPwv, 2)} m/s` : '',
      deltaColor: P.ref,
      source: 'Oura PPG',
    }));
    cards.push(entityCard(ctx, {
      label: 'Cardiovascular age', entity: E.ouraCvAge, dec: 0, unit: 'years',
      srcState: ctx.sourceState('oura').state, ageText: 'morning',
      delta: 'a composite score, so read it only against itself',
      deltaColor: P.warn,
      source: 'Oura composite',
    }));

    for (const [label, id, ranges] of [
      ['Atherogenic index', 'sensor.ornament_nazariy_atherogenic_index', null],
      ['ApoB', 'sensor.ornament_nazariy_apolipoprotein_b', null],
      ['LDL cholesterol', 'sensor.ornament_nazariy_ldl_cholesterol', null],
      ['Triglycerides', 'sensor.ornament_nazariy_triglycerides', null],
    ]) {
      cards.push(entityCard(ctx, {
        label, entity: id, dec: 2,
        srcState: orn.state, ageText: ornAge(data, id),
        ranges: ranges || ornRanges(data, id),
        delta: ornDelta(data, id),
        deltaColor: P.alert,
        source: 'Ornament · lipids',
      }));
    }

    cards.push(entityCard(ctx, {
      label: 'Nocturnal SpO₂', entity: E.ouraSpo2, dec: 1, unit: '%',
      srcState: ctx.sourceState('oura').state, ageText: 'morning',
      ranges: { optMin: 95, optMax: 100 },
      delta: `breathing disturbance index ${fmt(data.val(E.ouraBdi), 0)}`,
      deltaColor: (data.val(E.ouraBdi) ?? 0) > 5 ? P.warn : P.good,
      source: 'Oura',
    }));

    out.push(h('div.hh-cards', cards));

    // ------------------------------------------------------------ HRV chart
    const night = pd.grid[E.ouraSleepHrv] || [];
    const morn = pd.grid[E.polarRmssd] || [];
    const both = [...night, ...morn].filter(Number.isFinite);
    out.push(panel(
      'HRV: two independent channels',
      `Oura at night (${night.filter(Number.isFinite).length} days) and the morning H10 protocol `
      + `(${morn.filter(Number.isFinite).length} days). Keep the two lines apart. The protocols differ and so `
      + 'does the physiology. A break is a day without a measurement.',
      'Oura night · H10 morning',
      both.length >= 3
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 230,
            yMin: Math.max(0, Math.floor(Math.min(...both) - 5)),
            yMax: Math.ceil(Math.max(...both) + 5),
            yTicks: ticks(Math.min(...both) - 5, Math.max(...both) + 5),
            xLabels: [`−${DAYS} d`, `−${Math.round(DAYS * 0.66)}`, `−${Math.round(DAYS * 0.33)}`, 'today'],
            series: [
              { pts: night, color: P.ref, w: 1.8, dot: true },
              { pts: morn, color: ctx.accent, w: 1.8, dot: true },
            ],
          }),
          legendRow([
            { color: P.ref, label: 'Oura, nightly HRV' },
            { color: ctx.accent, label: 'Polar H10, morning RMSSD' },
          ]),
        ])
        : emptyState('Neither HRV channel has long-term statistics for this window yet.'),
    ));

    // ------------------------------------------------------- resting HR trend
    const lowest = pd.grid[E.ouraLowestHr] || [];
    const avgHr = pd.grid[E.ouraHrAvg] || [];
    const hrVals = [...lowest, ...avgHr].filter(Number.isFinite);
    out.push(panel(
      'Resting heart rate against the daily mean',
      'The lowest heart rate asleep is the cleanest recovery marker. The daily mean shows the load. '
      + 'Together they give the width of the reserve across the day.',
      'lowest asleep · daily mean',
      hrVals.length >= 3
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 210,
            yMin: Math.max(30, Math.floor(Math.min(...hrVals) - 5)),
            yMax: Math.ceil(Math.max(...hrVals) + 5),
            yTicks: ticks(Math.min(...hrVals) - 5, Math.max(...hrVals) + 5),
            xLabels: [`−${DAYS} d`, `−${Math.round(DAYS * 0.66)}`, `−${Math.round(DAYS * 0.33)}`, 'today'],
            series: [
              { pts: lowest, color: P.ref, w: 1.8, fill: true },
              { pts: avgHr, color: ctx.accent, w: 1.6 },
            ],
          }),
          legendRow([
            { color: P.ref, label: 'lowest asleep' },
            { color: ctx.accent, label: 'daily mean' },
          ]),
        ])
        : emptyState('The heart-rate series are empty for this window.'),
    ));

    // ----------------------------------------------- blood pressure placeholder
    out.push(panel(
      'Nocturnal blood pressure: frame waiting for Aktiia',
      'The frame is ready and the data is not here yet. When the device arrives this holds the stepped '
      + 'night curve and the dipping ratio. It is the one metric in the stack that no current device gives.',
      'empty frame',
      emptyState('There is no source of night blood pressure. BPM Connect gives single daytime readings '
        + 'only, and a dipping ratio cannot be computed from those.'),
    ));

    return out;
  },
};

function convertPwv(v, unit) {
  if (!unit) return v;
  const u = String(unit).toLowerCase();
  if (u.includes('mph')) return v * 0.44704;
  if (u.includes('km/h')) return v / 3.6;
  return v;
}

function buildGrid(stats, ids, days) {
  const grid = {};
  for (const id of ids) {
    const byDay = new Map();
    for (const r of stats[id] || []) {
      const v = r.mean ?? r.min ?? r.max;
      if (Number.isFinite(v)) byDay.set(dayKey(r.t), v);
    }
    const arr = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 86400e3);
      arr.push(byDay.has(k) ? byDay.get(k) : null);
    }
    grid[id] = arr;
  }
  return grid;
}

function ticks(lo, hi) {
  const step = Math.max(1, Math.round((hi - lo) / 5));
  return [1, 2, 3, 4].map((i) => Math.round(lo + step * i));
}

function ornRanges(data, id) {
  return {
    refMin: data.attr(id, 'reference_min') ?? null,
    refMax: data.attr(id, 'reference_max') ?? null,
    optMin: data.attr(id, 'optimal_min') ?? null,
    optMax: data.attr(id, 'optimal_max') ?? null,
  };
}

function ornAge(data, id) {
  const at = data.attr(id, 'measured_at');
  return at ? age(Date.now() - new Date(at).getTime()) : NO_DATA;
}

function ornDelta(data, id) {
  const r = ornRanges(data, id);
  const parts = [];
  if (r.refMax !== null) parts.push(`reference ≤${fmt(r.refMax)}`);
  if (r.optMax !== null) parts.push(`optimum ≤${fmt(r.optMax)}`);
  return parts.join(' · ');
}
