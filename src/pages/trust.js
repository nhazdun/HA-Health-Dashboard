import { h } from '../core/dom.js';
import { P, ST } from '../core/tokens.js';
import { panel, banner, emptyState, legendRow } from '../core/ui.js';
import { laneChart, scatterChart } from '../charts/svg.js';
import { dayKey } from '../core/ha.js';
import { fmt, age, mean, sd, NO_DATA } from '../core/format.js';
import { SOURCES, sourceState, sourceEntities, E, padMoving } from '../core/registry.js';

/**
 * Page 10 — can I believe what I just looked at?
 *
 * Everything on this page is derived: liveness from `last_reported` against
 * each source's declared cadence, coverage from the recorder, warnings from
 * conditions that are true right now. Nothing is a hard-coded verdict, which
 * is the only way a fixed channel can ever go green again.
 */

const COVER_DAYS = 30;

export default {
  id: 'trust',
  label: 'Data trust',
  title: 'Data trust',
  question: 'Can I believe what I just looked at?',
  scale: 'audit',

  live(ctx) {
    const warn = buildWarnings(ctx).length;
    if (!warn) return { color: P.good, label: 'no warnings' };
    return { color: warn > 3 ? P.alert : P.warn, label: `${warn} warnings` };
  },

  async load(ctx) {
    const { data } = ctx;
    const probes = SOURCES.map((src) => {
      const ids = sourceEntities(src, data);
      // one representative entity per source is enough to see the gaps
      return { src, id: ids.find((x) => data.val(x) !== null) || ids[0] };
    }).filter((p) => p.id);

    const coverage = {};
    await Promise.all(probes.map(async ({ src, id }) => {
      const rows = await data.stats(id, COVER_DAYS, 'day', ['mean', 'max']);
      coverage[src.key] = new Set((rows[id] || [])
        .filter((r) => Number.isFinite(r.mean ?? r.max))
        .map((r) => dayKey(r.t)));
    }));

    const [ouraAwake, museAwake] = await Promise.all([
      data.exists(E.ouraAwake) ? data.daily(E.ouraAwake, 60, 'max') : new Map(),
      data.exists(E.museAwake) ? data.daily(E.museAwake, 60, 'max') : new Map(),
    ]);
    const bland = [];
    for (const [k, o] of ouraAwake) {
      const m = museAwake.get(k);
      if (Number.isFinite(o) && Number.isFinite(m)) bland.push({ k, o, m });
    }

    return { coverage, bland, probes };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];

    out.push(banner('THE CORE PATTERN',
      'A dead CGM showed a number for three days and the number looked live. Every metric here carries '
      + 'its age and its state. The page dims a value with low trust and keeps it out of the totals. '
      + 'Every verdict on this page is computed now from last_reported and not written in advance.',
      P.alert));

    // ------------------------------------------------------ liveness matrix
    const rows = SOURCES.map((src) => {
      const st = sourceState(src, data);
      return { src, st };
    });
    const dead = rows.filter((r) => r.st.state === 'dead' || r.st.state === 'empty').length;

    out.push(h('div.hh-table', [
      h('div.hh-th', [
        h('span', 'Source'), h('span', 'Last update'),
        h('span', 'Expected step'), h('span', 'State'),
      ]),
      ...rows.map(({ src, st }) => {
        const meta = ST[st.state] || ST.ok;
        return h('div.hh-tr', [
          h('span.s', [h('i.hh-dot', { style: { background: meta.c, width: '7px', height: '7px' } }), src.name]),
          h('span.m', { style: { color: meta.c } }, st.ageMs === null ? NO_DATA : age(st.ageMs)),
          h('span.m', { style: { color: P.off } }, src.stepLabel),
          h('span.n', [
            h('b', { style: { color: meta.c, fontWeight: '500' } }, meta.l),
            ' · ',
            st.total ? `${st.live}/${st.total} sensors return a value. ` : '',
            src.note,
          ]),
        ]);
      }),
    ]));

    // ------------------------------------------------------------- coverage
    const lanes = SOURCES.map((src) => {
      const days = pd.coverage[src.key];
      if (!days) return null;
      const segs = [];
      let runStart = null;
      for (let i = 0; i < COVER_DAYS; i++) {
        const k = dayKey(Date.now() - (COVER_DAYS - 1 - i) * 86400e3);
        const has = days.has(k);
        if (has && runStart === null) runStart = i;
        if (!has && runStart !== null) {
          segs.push([runStart / COVER_DAYS, i / COVER_DAYS]);
          runStart = null;
        }
      }
      if (runStart !== null) segs.push([runStart / COVER_DAYS, 1]);
      const pct = Math.round((days.size / COVER_DAYS) * 100);
      return {
        label: src.name,
        segs,
        color: ST[sourceState(src, data).state].c,
        note: `${pct}% of days`,
      };
    }).filter(Boolean);

    out.push(panel(
      `Coverage over ${COVER_DAYS} days`,
      'One bar per source and the gaps stay visible. A bar is built from the long-term statistics: a day '
      + 'is present when the recorder holds at least one aggregate for it. Sources without state_class '
      + '(noise, TVOC, PM10) never appear here because they carry no long-term statistics.',
      'gaps left visible',
      lanes.length
        ? laneChart({ lanes, labelWidth: 150, noteWidth: 70, rowH: 24, xLabels: [`−${COVER_DAYS} d`, '−20', '−10', 'today'] })
        : emptyState('The long-term statistics have not accumulated for any source yet.'),
    ));

    // -------------------------------------------------------- Bland–Altman
    const bland = pd.bland || [];
    out.push(panel(
      'Bland-Altman: Oura against Muse on awake time',
      bland.length >= 5
        ? `The chart does not name a correct source. It shows the size and the direction of the difference `
          + `across ${bland.length} shared nights. A constant bias means the accelerometer counts movement `
          + 'as time awake. The bands are ±1.96 SD of the difference.'
        : 'This needs nights where both devices wrote at the same time.',
      bland.length >= 5 ? `n = ${bland.length}` : 'n too small',
      bland.length >= 5
        ? (() => {
          const diffs = bland.map((r) => r.o - r.m);
          const avgs = bland.map((r) => (r.o + r.m) / 2);
          const bias = mean(diffs);
          const s = sd(diffs) || 0;
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            scatterChart({
              w: 940, h: 260,
              pts: bland.map((r, i) => ({
                x: avgs[i], y: diffs[i], c: ctx.accent,
                title: `${r.k} · Oura ${fmt(r.o, 0)} / Muse ${fmt(r.m, 0)}`,
              })),
              xMin: Math.min(...avgs) * 0.9, xMax: Math.max(...avgs) * 1.1,
              yMin: Math.min(...diffs, bias - 2 * s) * 1.15,
              yMax: Math.max(...diffs, bias + 2 * s) * 1.15,
              xLabel: 'mean of the two sources, minutes awake',
              hlines: [
                { v: bias, label: `bias ${bias >= 0 ? '+' : ''}${fmt(bias, 0)} min`, color: P.self, dash: '6 3' },
                { v: bias + 1.96 * s, label: '+1.96 SD', color: P.ref },
                { v: bias - 1.96 * s, label: '−1.96 SD', color: P.ref },
              ],
            }),
            legendRow([{ color: ctx.accent, label: 'one night is one point' }]),
          ]);
        })()
        : emptyState(
          `Nights with both sources: ${bland.length}. E12 needs 30. While one source stays silent there `
          + 'is nothing to check the agreement against.',
        ),
    ));

    // ------------------------------------------------------- disagreements
    const disagree = buildDisagreements(ctx);
    if (disagree.length) {
      out.push(panel(
        'Source disagreement',
        'Where two independent systems measure one quantity, the difference between them is a metric of '
        + 'its own. The page shows it instead of hiding it behind an average.',
        `${disagree.length} pairs`,
        h('div.hh-warns', disagree.map((d) => h('div.hh-warn', {
          style: { borderLeft: `3px solid ${d.color}` },
        }, [
          h('b', d.title),
          h('span.b', d.body),
          h('span.a', { style: { color: d.color } }, d.action),
        ]))),
      ));
    }

    // ------------------------------------------------------------ warnings
    const warnings = buildWarnings(ctx);
    out.push(panel(
      'Active warnings',
      warnings.length
        ? 'Each one is true right now and each will clear itself once its cause is gone.'
        : 'No active problem found in the stack.',
      `${warnings.length} active · ${dead} sources silent`,
      warnings.length
        ? h('div.hh-warns', warnings.map((w) => h('div.hh-warn', {
          style: { borderLeft: `3px solid ${w.color}` },
        }, [
          h('b', w.title),
          h('span.b', w.body),
          h('span.a', { style: { color: w.color } }, w.action),
        ])))
        : emptyState('Every source is within its expected freshness, the units agree and the subscriptions are active.'),
    ));

    return out;
  },
};

// ------------------------------------------------------------------ helpers

/** Conditions that are true right now — recomputed on every paint. */
function buildWarnings(ctx) {
  const { data } = ctx;
  const out = [];

  const cgm = ctx.sourceState('nightscout');
  if (cgm.state === 'dead' || cgm.state === 'stale') {
    const mins = data.val(E.glucoseAge);
    out.push({
      title: `CGM silent for ${age(cgm.ageMs)}`,
      body: `The value glucose_age is ${fmt(mins, 0)} min and the threshold is 15 min. Juggluco does not `
        + 'write into Nightscout. Every metabolic conclusion is on hold.',
      action: 'restart Juggluco → check age = 0',
      color: P.alert,
    });
  }

  const subDays = data.val(E.museSubDays);
  if (subDays !== null && subDays <= 3) {
    out.push({
      title: `Muse subscription: ${fmt(subDays, 0)} days left`,
      body: 'At zero the independent EEG channel stops. Then E12 loses its second source and the '
        + 'Bland-Altman test against Oura cannot run.',
      action: 'extend before it expires',
      color: subDays <= 1 ? P.alert : P.warn,
    });
  }

  const battery = data.raw(E.bodyScanBattery);
  if (battery && /low|critical/i.test(battery)) {
    out.push({
      title: 'Body Scan battery low',
      body: 'Segmental analysis and ECG are not available. The scale still measures composition on basic '
        + 'impedance at ±3–5%.',
      action: 'charge before the next E23 block',
      color: P.warn,
    });
  }

  const polar = ctx.sourceState('polar');
  const padRunning = padMoving(data.raw(E.padState));
  if (padRunning && data.raw(E.polarStreaming) === 'off' && data.raw(E.polarWorn) === 'on') {
    out.push({
      title: 'BLE conflict: H10 and the treadmill',
      body: 'The treadmill is running and the strap is worn, but the stream has stopped. A shared session '
        + 'breaks the real-time channel.',
      action: 'separate them in time or add a second adapter',
      color: P.warn,
    });
  } else if (polar.state === 'dead') {
    out.push({
      title: 'Polar H10 returns no value',
      body: 'Every sensor on the strap is empty. The morning HRV protocol (E20, E22) has nothing to run on.',
      action: 'check the battery and the BLE connection',
      color: P.warn,
    });
  }

  const mac = ctx.sourceState('macos');
  if (mac.state === 'dead' || mac.state === 'empty') {
    out.push({
      title: 'macOS sensors disabled',
      body: 'The sensors camera_in_use and frontmost_app are unavailable. There is no true meeting record '
        + 'and only the calendar plan remains.',
      action: 'enable the sensors → unblocks E27',
      color: P.alert,
    });
  }

  // unit sanity: a pressure of ~14.6 is psi, not hPa
  const pressure = data.val(E.phonePressure);
  const pUnit = (data.unit(E.phonePressure) || '').toLowerCase();
  if (pressure !== null && pressure < 100 && !pUnit.includes('psi')) {
    out.push({
      title: 'Wrong pressure unit',
      body: `The iPhone reports ${fmt(pressure, 3)} with the unit "${data.unit(E.phonePressure) || NO_DATA}". `
        + `This is psi, which is ${fmt(pressure * 68.9476, 0)} hPa. The chart shows a correct shape and wrong numbers.`,
      action: 'fix unit_of_measurement in customize.yaml',
      color: P.warn,
    });
  }

  const wPwv = data.val(E.wPwv);
  const wUnit = (data.unit(E.wPwv) || '').toLowerCase();
  if (wPwv !== null && wPwv > 10 && !wUnit.includes('m/s')) {
    out.push({
      title: 'Withings PWV in the wrong unit',
      body: `The value ${fmt(wPwv, 2)} "${data.unit(E.wPwv) || NO_DATA}" is mph, which is `
        + `${fmt(wPwv * 0.44704, 2)} m/s. The Heart page converts it on the fly and it stays raw in Home Assistant.`,
      action: 'fix unit_of_measurement in customize.yaml',
      color: P.warn,
    });
  }

  const orn = data.raw(E.ornLastReport);
  if (orn) {
    const months = (Date.now() - new Date(orn).getTime()) / (30.44 * 86400e3);
    if (months > 11) {
      out.push({
        title: `Main lab panel is ${Math.round(months)} months old`,
        body: 'Fast markers such as GGT, triglycerides, uric acid and vitamin D may have moved over a year '
          + 'of interventions, and there is nothing to check that against.',
        action: 'book a repeat draw, this is E31',
        color: P.warn,
      });
    }
  }

  const iqosSync = data.raw(E.iqosSync);
  if (iqosSync) {
    const d = (Date.now() - new Date(iqosSync).getTime()) / 86400e3;
    if (d > 2) {
      out.push({
        title: `IQOS not synced for ${Math.round(d)} days`,
        body: 'The stick counter updates by hand. Without a sync the daily values are frozen and the '
          + 'cross-correlation with PM2.5 (E29) runs on stale timestamps.',
        action: 'sync the device',
        color: P.warn,
      });
    }
  }

  const hidrate = ctx.sourceState('hidrate');
  if (hidrate.state === 'dead' || hidrate.state === 'empty') {
    out.push({
      title: 'Hidrate Spark offline',
      body: 'No sensor on the bottle returns a value. Hydration today is not measured at all. That is '
        + 'no data and not 0 mL.',
      action: 'check the BLE proxy for the bottle',
      color: P.warn,
    });
  }

  return out;
}

/** Pairs of independent sources measuring the same quantity. */
function buildDisagreements(ctx) {
  const { data } = ctx;
  const out = [];

  const ouraPwv = data.val(E.ouraPwv);
  const wPwvRaw = data.val(E.wPwv);
  if (ouraPwv !== null && wPwvRaw !== null) {
    const wPwv = /mph/i.test(data.unit(E.wPwv) || '') ? wPwvRaw * 0.44704 : wPwvRaw;
    const d = Math.abs(ouraPwv - wPwv);
    out.push({
      title: 'PWV: Oura against Withings',
      body: `${fmt(ouraPwv, 2)} against ${fmt(wPwv, 2)} m/s, a gap of ${fmt(d, 2)}. `
        + (d < 1 ? 'Two independent devices agree, so the value can be trusted.'
          : 'The gap is over a metre per second, so both values are approximate.'),
      action: d < 1 ? 'sources agree' : 'a third source is needed',
      color: d < 1 ? P.good : P.warn,
    });
  }

  const steps = [
    ['treadmill', data.val(E.padStepsDay)],
    ['Oura', data.val(E.ouraSteps)],
    ['iPhone', data.val(E.phoneSteps)],
  ].filter(([, v]) => v !== null);
  if (steps.length >= 2) {
    const vs = steps.map(([, v]) => v);
    const spread = Math.max(...vs) - Math.min(...vs);
    out.push({
      title: 'Three step counters',
      body: steps.map(([k, v]) => `${k} ${fmt(v, 0)}`).join(' · ')
        + `. The spread is ${fmt(spread, 0)} steps. They measure different things and do not reduce to one number.`,
      action: 'none of them is the correct one',
      color: spread > 3000 ? P.warn : P.ref,
    });
  }

  const pm = [
    ['bedroom', data.val(E.bedPm25)],
    ['living room', data.val(E.deskPm25)],
    ['Dyson', data.val(E.dysonPm25)],
  ].filter(([, v]) => v !== null);
  if (pm.length >= 2) {
    const vs = pm.map(([, v]) => v);
    const spread = Math.max(...vs) - Math.min(...vs);
    out.push({
      title: 'Three PM2.5 sensors',
      body: pm.map(([k, v]) => `${k} ${fmt(v, 0)}`).join(' · ')
        + `. The spread is ${fmt(spread, 0)} µg/m³, and that spread is the signal that a source is local.`,
      action: spread > 8 ? 'a local source sits next to one sensor' : 'the devices agree',
      color: spread > 8 ? P.warn : P.good,
    });
  }

  const ouraAwake = data.val(E.ouraAwake);
  const museAwake = data.val(E.museAwake);
  if (ouraAwake !== null && museAwake !== null) {
    out.push({
      title: 'Awake time: Oura against Muse',
      body: `Oura ${fmt(ouraAwake, 0)} min and Muse ${fmt(museAwake, 0)} min. `
        + 'The accelerometer counts movement and the EEG reads the cortex, so neither one is wrong.',
      action: 'the channels stay separate',
      color: P.ref,
    });
  }

  return out;
}
