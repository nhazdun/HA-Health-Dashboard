import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart, spark } from '../charts/svg.js';
import { resample } from '../core/ha.js';
import { loadEvents, eventsFor } from '../core/events.js';
import { controlPanel, nowControls } from '../core/controls.js';
import { fmt, age, hhmm, clockOf, NO_DATA } from '../core/format.js';
import { E, padMoving } from '../core/registry.js';

/** Page 1 — the realtime cockpit. Only channels that move faster than a minute. */

const HOURS = 6;

export default {
  id: 'now',
  label: 'Now',
  title: 'Now',
  question: 'What is my body doing this minute?',
  scale: 's · min',

  live(ctx) {
    const cgm = ctx.sourceState('nightscout');
    const polar = ctx.sourceState('polar');
    if (cgm.state === 'dead') return { color: P.alert, label: 'glucose channel is dead' };
    if (cgm.state === 'stale') return { color: P.warn, label: 'glucose is behind' };
    if (polar.idle) return { color: P.ref, label: 'H10 not worn' };
    return { color: P.good, label: 'all fast channels live' };
  },

  async load(ctx) {
    const { data } = ctx;
    const [glu, hr, pmBed, pmDesk, pmDyson, evts] = await Promise.all([
      data.series(E.glucose, HOURS, { significantOnly: false }),
      data.series(E.polarHr, HOURS, { significantOnly: false }),
      data.series(E.bedPm25, HOURS),
      data.series(E.deskPm25, HOURS),
      data.series(E.dysonPm25, HOURS),
      loadEvents(ctx, HOURS),
    ]);
    let hrSeries = hr;
    if (hrSeries.length < 3) {
      // The chest strap only writes while worn — fall back to the ring.
      hrSeries = await data.series(E.ouraHr, HOURS, { significantOnly: false });
    }
    return { glu, hr: hrSeries, hrFromRing: hr.length < 3, pmBed, pmDesk, pmDyson, evts };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const now = Date.now();
    const start = now - HOURS * 3600e3;
    const cgm = ctx.sourceState('nightscout');
    const out = [];

    // ---------------------------------------------------------------- banner
    const gAgeMin = data.val(E.glucoseAge);
    if (cgm.state === 'dead' || cgm.state === 'stale') {
      out.push(banner('DEAD CHANNEL',
        `CAUTION: THE CGM CHANNEL IS DEAD. It wrote nothing for ${age(cgm.ageMs)}. `
        + `The threshold is 15 min and glucose_age is ${fmt(gAgeMin, 0)} min. `
        + 'The number on screen is the last frame before the break. This page excludes it from every total.',
        P.alert));
    } else if (cgm.state === 'warn') {
      out.push(banner('UNEVEN CHANNEL',
        `The last CGM record arrived ${age(cgm.ageMs)} ago and the step is 1 min. `
        + 'The curve below has breaks. A break is a gap and not a zero.',
        P.warn));
    }

    // --------------------------------------------------------------- controls
    const controls = controlPanel(ctx, nowControls(ctx));
    if (controls) out.push(controls);

    // ----------------------------------------------------------------- cards
    const cards = [];
    const gluDead = cgm.state === 'dead' || cgm.state === 'stale';
    const gluPts = pd.glu.map((p) => p.v);
    const trend = data.raw(E.glucoseTrend);

    cards.push(entityCard(ctx, {
      span: 2, size: '44px', label: 'Glucose · CGM', entity: E.glucose, dec: 1,
      srcState: gluDead ? 'dead' : cgm.state,
      ageText: gAgeMin !== null ? `${fmt(gAgeMin, 0)} min` : age(cgm.ageMs),
      delta: `trend ${trend || NO_DATA}\n${pd.glu.length} points over ${HOURS} h`,
      deltaColor: gluDead ? P.alert : P.good,
      spark: spark(gluPts.slice(-72), gluDead ? P.off : ctx.accent, gluDead),
      ranges: { optMin: 3.9, optMax: 7.8 },
      source: 'Nightscout · 1 min step',
      note: gluDead ? 'Juggluco stopped writing' : null,
    }));

    const hrEnt = data.raw(E.polarHr) !== null ? E.polarHr : E.ouraHr;
    const hrMax = data.val(E.hrMax) || 186;
    const hrVal = data.val(hrEnt);
    cards.push(entityCard(ctx, {
      label: hrEnt === E.polarHr ? 'Heart rate · Polar H10' : 'Heart rate · Oura (H10 not worn)',
      entity: hrEnt, dec: 0, unit: 'bpm',
      srcState: hrEnt === E.polarHr ? ctx.sourceState('polar').state : 'lag',
      delta: hrVal ? `zone ${zone(hrVal, hrMax)} · ${fmt((hrVal / hrMax) * 100, 0)}% HRmax` : '',
      deltaColor: hrVal && hrVal / hrMax > 0.7 ? P.warn : P.good,
      spark: spark(pd.hr.slice(-90).map((p) => p.v), ctx.accent),
      source: hrEnt === E.polarHr ? 'Polar H10 · per beat' : 'Oura Ring · PPG',
    }));

    cards.push(entityCard(ctx, {
      label: 'RMSSD now', entity: E.polarRmssd, dec: 0, unit: 'ms',
      srcState: ctx.sourceState('polar').state,
      emptyHint: 'the H10 is not streaming, put the strap on',
      source: 'Polar H10 · RR intervals',
      ranges: { optMin: 40, optMax: 90 },
    }));

    const lastEaten = parseDt(data.raw(E.fwLastEaten));
    const sinceMeal = lastEaten ? (now - lastEaten.getTime()) / 60000 : null;
    cards.push(entityCard(ctx, {
      label: 'Since last meal',
      value: sinceMeal, text: sinceMeal === null ? NO_DATA : hhmm(sinceMeal), unit: 'h',
      srcState: sinceMeal === null ? 'empty' : sinceMeal > 16 * 60 ? 'stale' : 'ok',
      ageText: lastEaten ? clockOf(lastEaten) : NO_DATA,
      delta: (data.raw(E.fwLastMeal) || '').slice(0, 70),
      source: 'Foodwatch · the only meal timestamp',
      entity: E.fwLastEaten,
    }));

    const padTime = data.val(E.padTimeDay);
    const padRunning = data.raw(E.padBelt) === 'on' || padMoving(data.raw(E.padState));
    cards.push(entityCard(ctx, {
      label: 'Treadmill today', entity: E.padTimeDay, dec: 2, unit: 'h',
      srcState: ctx.sourceState('kingsmith').state,
      delta: `${fmt(data.val(E.padStepsDay), 0)} steps · ${fmt(data.val(E.padDistDay), 2)} km\n`
        + `speed ${fmt(data.val(E.padSpeed), 1)} km/h`,
      deltaColor: padRunning ? P.good : (padTime > 0.5 ? P.good : P.off),
      source: 'KingSmith · 5 s',
    }));

    const slouch = data.val(E.slouchTime), upright = data.val(E.uprightTime);
    const slouchPct = slouch !== null && upright !== null && slouch + upright > 0
      ? (slouch / (slouch + upright)) * 100 : null;
    cards.push(entityCard(ctx, {
      label: 'Posture angle', entity: E.postureAngle, dec: 1, unit: '°',
      srcState: ctx.sourceState('upright').state,
      delta: slouchPct === null ? '' : `${fmt(slouchPct, 1)}% of the day slouched`,
      deltaColor: slouchPct > 30 ? P.warn : P.good,
      source: 'Upright GO 2',
    }));

    // Named by room, not by device: the bedroom carries two sensors, the
    // living room one, and that asymmetry is the point.
    [
      ['PM2.5 · bedroom', E.bedPm25, 'Qingping 7fc5 · bedroom', 'qp_bed'],
      ['PM2.5 · living room', E.deskPm25, 'Qingping 554b · desk', 'qp_desk'],
      ['PM2.5 · bedroom, Dyson', E.dysonPm25, 'Dyson laser · bedroom', 'dyson'],
    ].forEach(([label, id, src, key]) => {
      const v = data.val(id);
      cards.push(entityCard(ctx, {
        label, entity: id, dec: 0, unit: 'µg/m³',
        srcState: ctx.sourceState(key).state,
        ranges: { refMin: 0, refMax: 15, optMin: 0, optMax: 5 },
        delta: v === null ? '' : v > 15 ? 'above the reference' : v > 5 ? 'above the optimum' : 'inside the optimum',
        deltaColor: v > 15 ? P.alert : v > 5 ? P.warn : P.good,
        source: src,
      }));
    });

    const water = data.val(E.waterToday);
    cards.push(entityCard(ctx, {
      label: 'Water today', entity: E.waterToday, dec: 0, unit: 'mL',
      srcState: ctx.sourceState('hidrate').state,
      ranges: { refMin: 0, refMax: 3000, optMin: 2000, optMax: 3000 },
      delta: water === null ? '' : `${fmt(data.val(E.sipsToday), 0)} sips · ${fmt((water / 2500) * 100, 0)}% of target`,
      deltaColor: water !== null && water < 2000 ? P.warn : P.good,
      source: 'Hidrate Spark · incomplete coverage',
      emptyHint: 'the bottle is offline',
    }));

    const alertOn = data.byPrefix(E.alertPrefix).filter((id) => data.raw(id) === 'on');
    cards.push(entityCard(ctx, {
      label: 'Air raid alert', value: 1, text: alertOn.length ? 'active' : 'none', size: '20px',
      unit: '', color: alertOn.length ? P.alert : P.good, srcState: 'ok',
      entity: data.byPrefix(E.alertPrefix)[0],
      delta: 'covariate for HRV and sleep',
      deltaColor: alertOn.length ? P.alert : P.off,
      source: 'Zolochiv community',
      note: alertOn.length ? alertOn.map((i) => i.split('_').pop()).join(', ') : 'quiet',
      noteColor: alertOn.length ? P.alert : P.good,
    }));

    cards.push(entityCard(ctx, {
      label: 'IQOS today', entity: E.iqosToday, dec: 0, unit: 'sticks',
      srcState: ctx.sourceState('iqos').state,
      ranges: { refMin: 0, refMax: 46, optMin: 0, optMax: 0 },
      delta: `${fmt(data.val(E.iqosPuffs), 0)} puffs · target 0`,
      deltaColor: P.warn,
      source: 'IQOS · manual sync ±15%',
    }));

    out.push(h('div.hh-cards', cards));

    // ---------------------------------------------------------------- charts
    const gluRes = resample(pd.glu, 120, start, now, { bridgeMinutes: 20 });
    const gluVals = gluRes.filter(Number.isFinite);
    out.push(panel(
      `Glucose over ${HOURS} hours`,
      pd.glu.length
        ? `${pd.glu.length} records from the recorder. A break in the curve is a real gap in the channel `
          + 'and the page does not fill it with zeros. The dashed lines mark meals and IQOS.'
        : 'The recorder returned no point for this window.',
      'mmol/L · events',
      pd.glu.length >= 2
        ? lineChart({
          h: 240,
          yMin: Math.min(3.5, Math.floor(Math.min(...gluVals) - 0.5)),
          yMax: Math.max(9, Math.ceil(Math.max(...gluVals) + 0.5)),
          yTicks: [4, 6, 8, 10],
          xLabels: axisLabels(start, now, 5),
          series: [{ pts: gluRes, color: gluDead ? P.off : ctx.accent, w: 2, dot: !gluDead, dash: gluDead ? '4 4' : null }],
          thresholds: [
            { v: 7.8, color: P.warn, label: 'upper range 7.8' },
            { v: 3.9, color: P.ref, label: 'lower 3.9' },
          ],
          events: eventsFor(pd.evts, start, now, ctx),
          showEvents: ctx.state.annotations,
        })
        : emptyState('There is no glucose data for this window. Check that Juggluco writes into Nightscout.'),
    ));

    const hrRes = resample(pd.hr, 120, start, now, { bridgeMinutes: 20 });
    out.push(panel(
      pd.hrFromRing ? 'Heart rate over 6 hours · Oura (H10 idle)' : 'Heart rate over 6 hours · Polar H10',
      pd.hrFromRing
        ? 'The chest strap writes only while worn, so this is the ring series. The two protocols differ '
          + 'and the page never averages them together.'
        : 'Real time from the strap. The step is one heartbeat.',
      'bpm',
      pd.hr.length >= 2
        ? lineChart({
          h: 200,
          yMin: 40, yMax: Math.max(120, Math.ceil((Math.max(...pd.hr.map((p) => p.v)) + 10) / 10) * 10),
          yTicks: [50, 70, 90, 110],
          xLabels: axisLabels(start, now, 5),
          series: [{ pts: hrRes, color: pd.hrFromRing ? P.ref : ctx.accent, w: 1.7, fill: true, dot: true }],
          thresholds: [{ v: hrMax * 0.7, color: P.warn, label: '70% HRmax' }],
          events: eventsFor(pd.evts, start, now, ctx, ['alert', 'iqos']),
          showEvents: ctx.state.annotations,
        })
        : emptyState('Neither the H10 nor the ring returned a heart-rate series for the last 6 hours.'),
    ));

    const anyPm = pd.pmBed.length || pd.pmDesk.length || pd.pmDyson.length;
    out.push(panel(
      'PM2.5 across both rooms',
      'Two rooms and three devices. The bedroom has Qingping and Dyson. The living room has one Qingping. '
      + 'The gap between the two bedroom devices is a metric and the page shows it. '
      + 'A peak in the living room cannot be confirmed by anything.',
      'bedroom · living room · bedroom Dyson',
      anyPm
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 200, yMin: 0,
            yMax: Math.max(20, Math.ceil(Math.max(
              1, ...[...pd.pmBed, ...pd.pmDesk, ...pd.pmDyson].map((p) => p.v),
            ) * 1.15)),
            yTicks: [0, 10, 20, 30],
            xLabels: axisLabels(start, now, 5),
            series: [
              { pts: resample(pd.pmBed, 90, start, now, { bridgeMinutes: 25 }), color: ctx.accent, w: 1.6 },
              { pts: resample(pd.pmDesk, 90, start, now, { bridgeMinutes: 25 }), color: P.olive, w: 1.6 },
              { pts: resample(pd.pmDyson, 90, start, now, { bridgeMinutes: 25 }), color: P.ref, w: 1.6 },
            ],
            thresholds: [
              { v: 15, color: P.warn, label: 'reference 15' },
              { v: 5, color: P.good, label: 'optimum 5' },
            ],
            events: eventsFor(pd.evts, start, now, ctx, ['iqos']),
            showEvents: ctx.state.annotations,
          }),
          legendRow([
            { color: ctx.accent, label: 'bedroom · Qingping 7fc5' },
            { color: P.olive, label: 'living room · Qingping 554b' },
            { color: P.ref, label: 'bedroom · Dyson laser' },
          ]),
        ])
        : emptyState('None of the three sensors returned a PM2.5 series.'),
    ));

    return out;
  },
};

function zone(hr, hrMax) {
  const p = hr / hrMax;
  return p < 0.6 ? 1 : p < 0.7 ? 2 : p < 0.8 ? 3 : p < 0.9 ? 4 : 5;
}

function parseDt(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(+d) ? null : d;
}

export function axisLabels(start, end, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(start + ((end - start) * i) / (n - 1));
    out.push(String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'));
  }
  return out;
}
