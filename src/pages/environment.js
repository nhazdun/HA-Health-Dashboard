import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart, heatmap } from '../charts/svg.js';
import { resample, dayKey } from '../core/ha.js';
import { loadEvents, eventsFor } from '../core/events.js';
import { fmt, mean, NO_DATA } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 7 — air and light, one room at a time.
 *
 * The two rooms are not symmetric and the page refuses to pretend otherwise.
 * The bedroom carries two independent air devices, so a spike there can be
 * *confirmed*; it is also the only place NO₂ and formaldehyde are measured at
 * all. The living room has a single Qingping node, so every spike there is a
 * hypothesis. Which room you are looking at changes what the data can support.
 */

const HOURS = 24;
const CAL_DAYS = 90;

const ROOMS = [
  { id: 'bed', label: 'Bedroom', devices: 'Qingping 7fc5 + Dyson' },
  { id: 'living', label: 'Living room', devices: 'Qingping 554b' },
];

export default {
  id: 'env',
  label: 'Environment',
  title: 'Environment',
  question: 'What am I breathing, and in what light do I live?',
  scale: '5 min · day',

  live(ctx) {
    const bed = ctx.state.room !== 'living';
    if (bed) {
      const qp = ctx.sourceState('qp_bed').state;
      const dy = ctx.sourceState('dyson').state;
      const liveCount = [qp, dy].filter((s) => s === 'ok' || s === 'warn').length;
      if (!liveCount) return { color: P.alert, label: 'bedroom has no data' };
      if (liveCount === 1) return { color: P.warn, label: 'no cross-check' };
      return { color: P.good, label: '2 devices · cross-checked' };
    }
    const s = ctx.sourceState('qp_desk').state;
    if (s === 'dead' || s === 'empty') return { color: P.alert, label: 'living room has no data' };
    return { color: P.warn, label: 'single source' };
  },

  async load(ctx) {
    const { data } = ctx;
    const bed = ctx.state.room !== 'living';
    const pmIds = bed ? [E.bedPm25, E.dysonPm25] : [E.deskPm25];

    const [pmA, pmB, co2, noise, no2, hcho, evts, cal] = await Promise.all([
      data.series(pmIds[0], HOURS),
      pmIds[1] ? data.series(pmIds[1], HOURS) : Promise.resolve([]),
      data.series(bed ? E.bedCo2 : E.deskCo2, HOURS),
      data.series(bed ? E.bedNoise : E.deskNoise, HOURS),
      bed ? data.series(E.dysonNo2, HOURS) : Promise.resolve([]),
      bed ? data.series(E.dysonHcho, HOURS) : Promise.resolve([]),
      loadEvents(ctx, HOURS),
      data.stats(bed ? E.bedPm25 : E.deskPm25, CAL_DAYS, 'day', ['mean', 'max']),
    ]);
    return {
      bed, pmA, pmB, co2, noise, no2, hcho, evts,
      cal: cal[bed ? E.bedPm25 : E.deskPm25] || [],
    };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const bed = pd.bed;
    const out = [];
    const now = Date.now(), start = now - HOURS * 3600e3;

    // -------------------------------------------------------- room switcher
    out.push(h('div.hh-rooms', [
      h('div.hh-seg', ROOMS.map((r) => h('button', {
        type: 'button',
        'aria-pressed': (r.id === 'bed') === bed ? 'true' : 'false',
        onClick: () => ctx.setState({ room: r.id }),
      }, r.label))),
      h('span', {
        style: { fontFamily: "'Geist Mono',monospace", fontSize: '10.5px', color: P.off },
      }, bed ? ROOMS[0].devices : ROOMS[1].devices),
    ]));

    out.push(h('div.hh-roomnote', bed
      ? 'The bedroom has two independent air devices: Qingping and the Dyson purifier. You can confirm '
        + 'a PM peak only here. NO₂ and formaldehyde exist only here.'
      : 'The living room has one Qingping node. There is no Dyson unit, so there are no gas channels and '
        + 'no cross-check. Treat a single-source peak as a hypothesis.'));

    // ---------------------------------------- cross-validation / single source
    if (bed) {
      const a = data.val(E.bedPm25), b = data.val(E.dysonPm25);
      if (a !== null && b !== null) {
        const d = Math.abs(a - b);
        out.push(banner(d < 6 ? 'TWO DEVICES AGREE' : 'DEVICES DISAGREE',
          `Bedroom PM2.5: Qingping ${fmt(a, 0)} and Dyson ${fmt(b, 0)} µg/m³, a gap of ${fmt(d, 0)}. `
          + (d < 6
            ? 'A constant offset of a few units is a calibration difference and not an event. When both rise together the event is real.'
            : 'The gap is too large for a calibration offset, so something local sits next to one of the devices.'),
          d < 6 ? P.good : P.warn));
      }
    } else {
      out.push(banner('SINGLE SOURCE',
        'Everything on this page rests on one device. A peak here cannot be confirmed the way a bedroom '
        + 'peak can, so wait for a repeat or compare against the bedroom before you act on it.',
        P.warn));
    }

    // ----------------------------------------------------------------- cards
    out.push(h('div.hh-cards', bed ? bedroomCards(ctx) : livingCards(ctx)));

    // ---------------------------------------------------------------- charts
    if (bed) {
      const both = [...pd.pmA, ...pd.pmB].map((p) => p.v);
      out.push(panel(
        'PM2.5 cross-validation: two devices, one room',
        'The bedroom is the only room with a second laser sensor, so it is the only place where a peak '
        + 'can be confirmed instead of believed. A constant offset between the curves is the calibration '
        + 'difference. What matters is whether they move together, not how far apart they sit.',
        'Qingping 7fc5 · Dyson laser',
        both.length
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            lineChart({
              h: 230, yMin: 0,
              yMax: Math.max(20, Math.ceil(Math.max(1, ...both) * 1.15)),
              yTicks: [0, 10, 20, 30],
              xLabels: ['−24 h', '−18', '−12', '−6', 'now'],
              series: [
                { pts: resample(pd.pmA, 120, start, now, { bridgeMinutes: 30 }), color: ctx.accent, w: 1.7 },
                { pts: resample(pd.pmB, 120, start, now, { bridgeMinutes: 30 }), color: P.ref, w: 1.7 },
              ],
              thresholds: [
                { v: 15, color: P.warn, label: 'reference 15' },
                { v: 5, color: P.good, label: 'optimum 5' },
              ],
              events: eventsFor(pd.evts, start, now, ctx, ['iqos']),
              showEvents: ctx.state.annotations,
            }),
            legendRow([
              { color: ctx.accent, label: 'Qingping 7fc5' },
              { color: P.ref, label: 'Dyson laser' },
            ]),
          ])
          : emptyState('Neither bedroom device returned a PM2.5 series for the day.'),
      ));

      const gas = [...pd.no2, ...pd.hcho].map((p) => p.v);
      out.push(panel(
        'Gas channels: Dyson only',
        'The system measures NO₂ and formaldehyde in one room and nowhere else, so every conclusion about '
        + 'gas applies to the bedroom and not to the flat. Formaldehyde is scaled ×100 to share the axis '
        + 'with NO₂.',
        'NO₂ µg/m³ · HCHO ×100 mg/m³',
        gas.length
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            lineChart({
              h: 200, yMin: 0,
              yMax: Math.max(14, Math.ceil(Math.max(1, ...pd.no2.map((p) => p.v),
                ...pd.hcho.map((p) => p.v * 100)) * 1.2)),
              yTicks: [0, 4, 8, 12],
              xLabels: ['−24 h', '−18', '−12', '−6', 'now'],
              series: [
                { pts: resample(pd.no2, 100, start, now, { bridgeMinutes: 30 }), color: P.ref, w: 1.7 },
                {
                  pts: resample(pd.hcho, 100, start, now, { bridgeMinutes: 30 }).map((v) => (v === null ? null : v * 100)),
                  color: ctx.accent, w: 1.7,
                },
              ],
              thresholds: [
                { v: 10, color: P.warn, label: 'NO₂ optimum 10' },
                { v: 10, color: P.off, label: '' },
              ],
            }),
            legendRow([
              { color: P.ref, label: 'NO₂ µg/m³' },
              { color: ctx.accent, label: 'formaldehyde ×100 mg/m³' },
            ]),
          ])
          : emptyState('Dyson returned no NO₂ or formaldehyde series for the day.'),
      ));
    } else {
      const vals = pd.pmA.map((p) => p.v);
      const co2Vals = pd.co2.map((p) => p.v);
      out.push(panel(
        'Desk air over 24 hours: single source',
        'One device, so a peak here cannot be checked the way a bedroom peak can. CO₂ is divided by 40 to '
        + 'share the axis: the 800 ppm threshold sits at the 20 mark.',
        'PM2.5 · CO₂ ÷ 40',
        vals.length || co2Vals.length
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            lineChart({
              h: 230, yMin: 0,
              yMax: Math.max(30, Math.ceil(Math.max(1, ...vals, ...co2Vals.map((v) => v / 40)) * 1.15)),
              yTicks: [0, 10, 20, 30],
              xLabels: ['−24 h', '−18', '−12', '−6', 'now'],
              series: [
                { pts: resample(pd.pmA, 120, start, now, { bridgeMinutes: 30 }), color: ctx.accent, w: 1.7 },
                {
                  pts: resample(pd.co2, 120, start, now, { bridgeMinutes: 30 }).map((v) => (v === null ? null : v / 40)),
                  color: P.ref, w: 1.5, dash: '5 4',
                },
              ],
              thresholds: [
                { v: 15, color: P.warn, label: 'PM2.5 reference 15' },
                { v: 20, color: P.ref, label: 'CO₂ 800 ppm' },
              ],
              events: eventsFor(pd.evts, start, now, ctx, ['iqos']),
              showEvents: ctx.state.annotations,
            }),
            legendRow([
              { color: ctx.accent, label: 'PM2.5 µg/m³' },
              { color: P.ref, label: 'CO₂ ÷ 40' },
            ]),
          ])
          : emptyState('Qingping 554b returned no series for the day.'),
      ));
    }

    // ------------------------------------------------------------- calendar
    const cal = calendar(pd.cal, bed);
    out.push(panel(
      `${bed ? 'Bedroom' : 'Desk'} PM2.5 calendar over ${CAL_DAYS} days`,
      'A darker cell is a worse day. A single dark cell is an indoor event and a full dark column matches '
      + 'the outdoor AQI. The scale is the same for both rooms, so you can compare them with the switcher.',
      `${cal.filled} days with data`,
      cal.filled
        ? heatmap({
          cols: Math.ceil(CAL_DAYS / 7), rows: 7,
          labels: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
          xLabels: [
            { at: 0, t: `−${Math.ceil(CAL_DAYS / 7)} weeks` },
            { at: Math.ceil(CAL_DAYS / 7) - 1, t: 'now' },
          ],
          cells: cal.cells,
        })
        : emptyState('The long-term PM2.5 statistics for this room have not accumulated yet.'),
    ));

    return out;
  },
};

// -------------------------------------------------------------------- cards

function bedroomCards(ctx) {
  const { data } = ctx;
  const cards = [];
  const t = data.val(E.bedTemp);
  const dysonT = data.val(E.dysonTemp);

  cards.push(entityCard(ctx, {
    span: 2, size: '40px', label: 'Temperature', entity: E.bedTemp, dec: 1, unit: '°C',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 16, refMax: 24, optMin: 17, optMax: 19 },
    delta: t === null ? '' : (t > 19
      ? `+${fmt(t - 19, 1)}° above the 17 to 19 optimum\nE09 runs in 4-night blocks`
      : 'inside the 17 to 19 optimum'),
    deltaColor: t > 21 ? P.alert : t > 19 ? P.warn : P.good,
    source: `Qingping 7fc5 · Dyson reads ${fmt(dysonT, 1)}°`,
    note: dysonT !== null && t !== null && Math.abs(dysonT - t) < 1.5 ? 'two devices agree' : null,
  }));

  const qpPm = data.val(E.bedPm25), dyPm = data.val(E.dysonPm25);
  cards.push(entityCard(ctx, {
    label: 'CO₂', entity: E.bedCo2, dec: 0, unit: 'ppm',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 400, refMax: 1400, optMin: 400, optMax: 800 },
    delta: 'sleep fragmentation threshold 900',
    deltaColor: (data.val(E.bedCo2) ?? 0) > 900 ? P.warn : P.good,
    source: 'Qingping 7fc5',
  }));
  cards.push(entityCard(ctx, {
    label: 'PM2.5 · Qingping', entity: E.bedPm25, dec: 0, unit: 'µg/m³',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 0, refMax: 15, optMin: 0, optMax: 5 },
    delta: dyPm !== null && qpPm !== null ? `Δ ${fmt(Math.abs(qpPm - dyPm), 0)} vs Dyson` : '',
    deltaColor: P.ref,
    source: 'Qingping 7fc5',
  }));
  cards.push(entityCard(ctx, {
    label: 'PM2.5 · Dyson', entity: E.dysonPm25, dec: 0, unit: 'µg/m³',
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 15, optMin: 0, optMax: 5 },
    delta: 'laser sensor, the second opinion',
    deltaColor: P.ref,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'NO₂', entity: E.dysonNo2, dec: 0, unit: 'µg/m³',
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 25, optMin: 0, optMax: 10 },
    delta: 'Dyson only, no other source',
    deltaColor: P.ref,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'Formaldehyde', entity: E.dysonHcho, dec: 3, unit: 'mg/m³',
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 0.1, optMin: 0, optMax: 0.03 },
    delta: 'WHO limit 0.1 over 30 min',
    deltaColor: (data.val(E.dysonHcho) ?? 0) > 0.03 ? P.warn : P.good,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'Noise', entity: E.bedNoise, dec: 0, unit: 'dB',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 0, refMax: 45, optMin: 0, optMax: 30 },
    delta: 'WHO night limit 30 dB',
    deltaColor: (data.val(E.bedNoise) ?? 0) > 30 ? P.warn : P.good,
    source: 'Qingping 7fc5',
    note: 'no state_class',
  }));

  const qpH = data.val(E.bedHum), dyH = data.val(E.dysonHumidity);
  cards.push(entityCard(ctx, {
    label: 'Humidity', entity: E.bedHum, dec: 1, unit: '%',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 30, refMax: 70, optMin: 40, optMax: 60 },
    delta: dyH !== null ? `Dyson reads ${fmt(dyH, 0)}%` : '',
    deltaColor: qpH !== null && dyH !== null && Math.abs(qpH - dyH) < 6 ? P.good : P.warn,
    source: 'Qingping 7fc5',
  }));
  cards.push(entityCard(ctx, {
    label: 'AQI, 15 min', entity: E.dysonAqi, dec: 1,
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 50, optMin: 0, optMax: 25 },
    delta: `outdoor ${fmt(data.val(E.dysonOutdoor), 0)} · dominant ${data.raw(E.dysonDominant) || NO_DATA}`,
    deltaColor: P.good,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'HEPA life', entity: E.dysonFilter, dec: 0, unit: '%',
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 100, optMin: 20, optMax: 100 },
    delta: `${fmt(data.val(E.dysonNextClean), 0)} h of run time`,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'Melanopic EDI', entity: null, value: null, text: NO_DATA, unit: 'lx',
    srcState: 'empty',
    emptyHint: 'the AS7341 is on the way. Light is still an unmeasured domain',
    source: 'new domain: light',
    note: 'no source', noteColor: P.ref,
  }));
  return cards;
}

function livingCards(ctx) {
  const { data } = ctx;
  const cards = [];
  const t = data.val(E.deskTemp);

  cards.push(entityCard(ctx, {
    span: 2, size: '40px', label: 'Temperature', entity: E.deskTemp, dec: 1, unit: '°C',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 18, refMax: 26, optMin: 20, optMax: 23 },
    delta: t === null ? '' : (t >= 20 && t <= 23
      ? 'inside the 20 to 23 cognitive band\nno second device here'
      : 'outside the 20 to 23 band\nno second device here'),
    deltaColor: t !== null && (t < 20 || t > 23) ? P.warn : P.good,
    source: 'Qingping 554b',
    note: 'single source',
  }));
  cards.push(entityCard(ctx, {
    label: 'CO₂', entity: E.deskCo2, dec: 0, unit: 'ppm',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 400, refMax: 1400, optMin: 400, optMax: 800 },
    delta: 'the cheapest proxy for focus decay',
    source: 'Qingping 554b',
  }));
  cards.push(entityCard(ctx, {
    label: 'PM2.5', entity: E.deskPm25, dec: 0, unit: 'µg/m³',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 0, refMax: 15, optMin: 0, optMax: 5 },
    delta: comparePm(data),
    deltaColor: P.warn,
    source: 'Qingping 554b',
    note: 'unconfirmed, one device',
  }));
  cards.push(entityCard(ctx, {
    label: 'PM10', entity: E.deskPm10, dec: 0, unit: 'µg/m³',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 0, refMax: 45, optMin: 0, optMax: 15 },
    delta: 'coarse fraction',
    source: 'Qingping 554b',
    note: 'no state_class',
  }));
  cards.push(entityCard(ctx, {
    label: 'Humidity', entity: E.deskHum, dec: 1, unit: '%',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 30, refMax: 70, optMin: 40, optMax: 60 },
    delta: (data.val(E.deskHum) ?? 50) < 40 ? 'lower edge of comfort' : 'inside the comfort band',
    deltaColor: (data.val(E.deskHum) ?? 50) < 40 ? P.warn : P.good,
    source: 'Qingping 554b',
  }));
  cards.push(entityCard(ctx, {
    label: 'Noise', entity: E.deskNoise, dec: 0, unit: 'dB',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 0, refMax: 55, optMin: 0, optMax: 40 },
    delta: 'a proxy for calls and open space',
    deltaColor: (data.val(E.deskNoise) ?? 0) > 40 ? P.warn : P.good,
    source: 'Qingping 554b',
    note: 'no state_class',
  }));
  cards.push(entityCard(ctx, {
    label: 'TVOC', entity: E.deskTvoc, dec: 0,
    srcState: 'low',
    delta: 'vendor scale, compare only with itself',
    deltaColor: P.warn,
    source: 'Qingping 554b',
    note: 'not mg/m³',
  }));
  cards.push(entityCard(ctx, {
    label: 'NO₂ · formaldehyde', entity: null, value: null, text: NO_DATA, size: '22px',
    srcState: 'empty',
    emptyHint: 'there is no Dyson unit in this room, so the gas channels are unavailable',
    source: 'gas channels unavailable',
    note: 'no device', noteColor: P.ref,
  }));
  cards.push(entityCard(ctx, {
    label: 'Melanopic EDI', entity: null, value: null, text: NO_DATA, unit: 'lx',
    srcState: 'empty',
    emptyHint: 'the AS7341 is on the way. Light is still an unmeasured domain',
    source: 'new domain: light',
    note: 'no source', noteColor: P.ref,
  }));
  return cards;
}

function comparePm(data) {
  const desk = data.val(E.deskPm25), bed = data.val(E.bedPm25);
  if (desk === null || bed === null) return '';
  if (desk > bed) return `${fmt(desk - bed, 0)} above the bedroom, inverted`;
  return `${fmt(bed - desk, 0)} below the bedroom`;
}

function calendar(rows, bed) {
  const byDay = new Map();
  for (const r of rows) {
    const v = r.mean ?? r.max;
    if (Number.isFinite(v)) byDay.set(dayKey(r.t), v);
  }
  const cols = Math.ceil(CAL_DAYS / 7);
  const cells = [];
  let filled = 0;
  for (let i = 0; i < CAL_DAYS; i++) {
    const t = Date.now() - (CAL_DAYS - 1 - i) * 86400e3;
    const k = dayKey(t);
    const dow = (new Date(t).getDay() + 6) % 7;
    const col = Math.min(Math.floor(i / 7), cols - 1);
    const v = byDay.get(k);
    if (v === undefined) {
      cells.push({ x: col, y: dow, color: null, title: `${k} · no data` });
    } else {
      filled++;
      cells.push({
        x: col, y: dow,
        color: v > 25 ? P.alert : v > 15 ? P.warn : v > 5 ? '#C79A3A' : P.good,
        op: 0.25 + Math.min(1, v / 30) * 0.65,
        title: `${k} · ${bed ? 'bedroom' : 'desk'} ${fmt(v, 1)} µg/m³`,
      });
    }
  }
  return { cells, filled };
}

export { mean };
