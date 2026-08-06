import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { panel, banner, emptyState } from '../core/ui.js';
import { matrixChart, scatterChart } from '../charts/svg.js';
import { fmt, pearson, linreg } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 9 — what affects what.
 *
 * Every coefficient here is computed from real daily aggregates pulled out of
 * the recorder. Two rules from the brief are enforced in code, not in copy:
 *
 *  1. n travels with every claim. Below `MIN_N` the cell is left blank rather
 *     than filled with a grey near-zero correlation.
 *  2. the lag slider shifts Y against X in whole days, because a cause cannot
 *     follow its effect.
 */

const MIN_N = 20;

const METRICS = [
  { key: 'sleep', label: 'Sleep', entity: E.ouraTotalSleep, agg: 'max', unit: 'h' },
  { key: 'deep', label: 'Deep', entity: E.ouraDeep, agg: 'max', unit: 'h' },
  { key: 'hrv', label: 'HRV', entity: E.ouraSleepHrv, agg: 'mean', unit: 'ms' },
  { key: 'rhr', label: 'Resting HR', entity: E.ouraLowestHr, agg: 'min', unit: 'bpm' },
  { key: 'glucose', label: 'Glucose', entity: E.glucose, agg: 'mean', unit: 'mmol/L' },
  { key: 'carbs', label: 'Carbs', entity: E.fwCarbs, agg: 'max', unit: 'g' },
  { key: 'bedT', label: 'Bedroom T', entity: E.bedTemp, agg: 'mean', unit: '°C' },
  { key: 'co2', label: 'Bedroom CO₂', entity: E.bedCo2, agg: 'max', unit: 'ppm' },
  { key: 'pm25', label: 'PM2.5', entity: E.bedPm25, agg: 'max', unit: 'µg/m³' },
  { key: 'iqos', label: 'IQOS', entity: E.iqosToday, agg: 'max', unit: 'sticks' },
  { key: 'pad', label: 'Treadmill', entity: E.padTimeDay, agg: 'max', unit: 'h' },
  { key: 'steps', label: 'Steps', entity: E.ouraSteps, agg: 'max', unit: 'steps' },
  { key: 'rem', label: 'REM', entity: E.ouraRem, agg: 'max', unit: 'h' },
  { key: 'latency', label: 'Latency', entity: E.ouraLatency, agg: 'mean', unit: 'min' },
  { key: 'spo2', label: 'SpO₂', entity: E.ouraSpo2, agg: 'mean', unit: '%' },
  { key: 'noise', label: 'Bedroom noise', entity: E.bedNoise, agg: 'max', unit: 'dB' },
  { key: 'hum', label: 'Bedroom humidity', entity: E.bedHum, agg: 'mean', unit: '%' },
  { key: 'deskCo2', label: 'Desk CO₂', entity: E.deskCo2, agg: 'max', unit: 'ppm' },
  { key: 'water', label: 'Water', entity: E.waterToday, agg: 'max', unit: 'mL' },
  { key: 'slouch', label: 'Slouch time', entity: E.slouchTime, agg: 'max', unit: 'min' },
  { key: 'fat', label: 'Body fat', entity: E.wFat, agg: 'mean', unit: '%' },
];

export default {
  id: 'corr',
  label: 'Correlations',
  title: 'Correlations',
  question: 'What affects what?',
  scale: 'days · lag',

  live(ctx) {
    const pd = ctx.pageData.corr;
    if (!pd) return { color: P.ref, label: 'computing…' };
    return { color: P.ref, label: `${pd.days} days in window · n on every claim` };
  },

  async load(ctx) {
    const { data, state } = ctx;
    const days = state.corrWindow || 45;
    const available = METRICS.filter((m) => data.exists(m.entity));
    const series = {};
    await Promise.all(available.map(async (m) => {
      series[m.key] = await data.daily(m.entity, days, m.agg);
    }));
    const dayList = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400e3);
      dayList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const cols = {};
    for (const m of available) {
      cols[m.key] = dayList.map((k) => {
        const v = series[m.key].get(k);
        return Number.isFinite(v) ? v : null;
      });
    }
    // Oura↔Muse agreement (E12) needs both awake-time series side by side.
    const [ouraAwake, museAwake] = await Promise.all([
      data.exists(E.ouraAwake) ? data.daily(E.ouraAwake, days, 'max') : new Map(),
      data.exists(E.museAwake) ? data.daily(E.museAwake, days, 'max') : new Map(),
    ]);
    const bland = dayList
      .map((k) => ({ k, o: ouraAwake.get(k), m: museAwake.get(k) }))
      .filter((r) => Number.isFinite(r.o) && Number.isFinite(r.m));

    return {
      metrics: available, cols, dayList, days, bland,
      experiments: experiments(cols, bland.length),
    };
  },

  render(ctx, pd) {
    const { state } = ctx;
    const out = [];
    const M = pd.metrics;

    if (M.length < 2) {
      return [emptyState('Too few metrics carry daily aggregates to build a matrix.')];
    }

    const coverage = M.map((m) => ({
      label: m.label,
      n: pd.cols[m.key].filter(Number.isFinite).length,
    }));
    const thin = coverage.filter((c) => c.n < MIN_N);

    out.push(banner('n ON EVERY CLAIM',
      `The window is ${pd.days} days. A cell with n below ${MIN_N} stays empty. The page does not show a `
      + 'weak correlation as a fact. Use the lag slider to shift Y against X: a cause cannot come after '
      + 'its effect. '
      + (thin.length
        ? `Still short of observations: ${thin.map((c) => `${c.label} (${c.n})`).join(', ')}.`
        : 'Every metric has enough coverage.'),
      P.ref));

    // -------------------------------------------------------- lag + matrix
    const lag = state.lag || 0;
    const pairAt = (i, j) => {
      const x = pd.cols[M[i].key];
      const y = pd.cols[M[j].key];
      return shift(x, y, lag);
    };
    const stat = (i, j) => {
      if (i === j) return { r: 1, n: pd.cols[M[i].key].filter(Number.isFinite).length };
      const [xs, ys] = pairAt(i, j);
      return pearson(xs, ys);
    };

    // Open on the strongest pair that actually clears the n threshold, rather
    // than on a fixed pair that may well be empty.
    const sel = state.cell && state.cell[0] < M.length && state.cell[1] < M.length
      ? state.cell : strongestPair(M, stat);
    const selStat = stat(sel[0], sel[1]);

    out.push(h('div.hh-panel', [
      h('div.ph', [
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, [
          h('span.pt', 'Lag slider'),
          h('span.pn', 'Shift Y against X in days. The coefficient updates at once.'),
        ]),
        h('div.hh-lag', [
          h('input', {
            type: 'range', min: '-3', max: '3', step: '1', value: String(lag),
            onInput: (ev) => ctx.setState({ lag: Number(ev.target.value) }),
          }),
          h('span.v', `${lag > 0 ? '+' : ''}${lag} d`),
          h('select', {
            onChange: (ev) => ctx.setState({ corrWindow: Number(ev.target.value) }),
            style: {
              border: `1px solid ${P.rule}`, borderRadius: '8px', padding: '5px 8px',
              fontFamily: 'inherit', fontSize: '11.5px', background: P.surf, color: P.ink,
            },
          }, [30, 45, 60, 90].map((d) => h('option', {
            value: String(d), selected: d === pd.days ? '' : null,
          }, `${d} days`))),
        ]),
      ]),
      h('div.hh-corr', [
        h('div', matrixChart({
          labels: M.map((m) => m.label),
          cw: 22, off: 124,
          selected: sel,
          onPick: (i, j) => ctx.setState({ cell: [i, j] }),
          cell: (i, j) => {
            const { r, n } = stat(i, j);
            if (i === j) return { color: P.rule, op: 1, title: `${M[i].label} · n=${n}` };
            if (r === null || n < MIN_N) {
              return { color: null, title: `${M[i].label} × ${M[j].label} · n=${n}, too few` };
            }
            return {
              color: r > 0 ? ctx.accent : P.ref,
              op: Math.min(1, 0.1 + Math.abs(r) * 0.85),
              title: `${M[i].label} × ${M[j].label} · r=${fmt(r, 2)} · n=${n}`,
            };
          },
        })),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          h('div', {
            style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' },
          }, [
            h('span', { style: { fontSize: '12.5px', fontWeight: '600' } },
              `${M[sel[0]].label} → ${M[sel[1]].label}`),
            h('span', {
              style: {
                fontFamily: "'Geist Mono',monospace", fontSize: '10.5px',
                color: selStat.n < MIN_N ? P.off : (selStat.r ?? 0) > 0 ? ctx.accent : P.ref,
              },
            }, `r = ${fmt(selStat.r, 2)} · n = ${selStat.n}`),
          ]),
          scatterOrEmpty(ctx, pd, M, sel, lag, selStat),
          h('div.hh-scatterwarn',
            'This slice does not control these confounders: air raid alerts at night, alcohol, bedroom '
            + `temperature and IQOS timestamps at ±15%. Lag ${lag > 0 ? '+' : ''}${lag} d over a `
            + `${pd.days}-day window. A correlation is not a cause. To show a cause you must alternate the `
            + 'intervention and not only observe.'),
        ]),
      ]),
    ]));

    // ---------------------------------------------------------- experiments
    out.push(panel(
      'Active experiments',
      'Progress comes from the real data: n is the number of days where the recorder holds both variables '
      + 'of the hypothesis at once.',
      `${pd.experiments.filter((e) => e.n >= e.need).length} of ${pd.experiments.length} have reached n`,
      h('div.hh-exps', pd.experiments.map((x) => h('div.hh-exp', [
        h('div.id', [
          h('span', x.id),
          h('span', { style: { color: x.color } }, x.ready),
        ]),
        h('span.h', x.h),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
          h('div.hh-prog', h('i', {
            style: { width: `${Math.min(100, (x.n / x.need) * 100).toFixed(0)}%`, background: x.color },
          })),
          h('span.n', `n ${x.n} / ${x.need} · ${x.effect}`),
        ]),
      ]))),
    ));

    return out;
  },
};

// ------------------------------------------------------------------ helpers

/** Pick the pair with the largest |r| among those meeting the n threshold. */
function strongestPair(M, stat) {
  let best = null;
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M.length; j++) {
      if (i === j) continue;
      const { r, n } = stat(i, j);
      if (r === null || n < MIN_N) continue;
      if (!best || Math.abs(r) > best.abs) best = { cell: [i, j], abs: Math.abs(r) };
    }
  }
  return best ? best.cell : [0, Math.min(2, M.length - 1)];
}

/** Shift Y forward against X by `lag` days, dropping the unpaired ends. */
function shift(x, y, lag) {
  if (!lag) return [x, y];
  if (lag > 0) return [x.slice(0, x.length - lag), y.slice(lag)];
  const k = -lag;
  return [x.slice(k), y.slice(0, y.length - k)];
}

function scatterOrEmpty(ctx, pd, M, sel, lag, stat) {
  if (sel[0] === sel[1]) {
    return emptyState('A metric against itself. Pick another cell in the matrix.');
  }
  const [xs, ys] = shift(pd.cols[M[sel[0]].key], pd.cols[M[sel[1]].key], lag);
  const pts = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      pts.push({ x: xs[i], y: ys[i], c: ctx.accent, title: `${fmt(xs[i], 2)} → ${fmt(ys[i], 2)}` });
    }
  }
  if (pts.length < MIN_N) {
    return emptyState(
      `Not enough data: n = ${pts.length}, ${Math.max(0, MIN_N - pts.length)} more observations needed. `
      + 'Empty is more honest than a line through five points.',
    );
  }
  const xv = pts.map((p) => p.x), yv = pts.map((p) => p.y);
  const reg = linreg(xv, yv);
  const xMin = Math.min(...xv), xMax = Math.max(...xv);
  const yMin = Math.min(...yv), yMax = Math.max(...yv);
  const padX = (xMax - xMin) * 0.08 || 1, padY = (yMax - yMin) * 0.1 || 1;
  return scatterChart({
    w: 440, h: 250, pts,
    xMin: xMin - padX, xMax: xMax + padX,
    yMin: yMin - padY, yMax: yMax + padY,
    xLabel: `${M[sel[0]].label}${M[sel[0]].unit ? `, ${M[sel[0]].unit}` : ''}`,
    reg: reg ? [{ ...reg, color: (stat.r ?? 0) > 0 ? ctx.accent : P.ref }] : [],
    hlines: [{
      v: yv.reduce((a, b) => a + b, 0) / yv.length,
      label: `${M[sel[1]].label} median`, color: P.off, dash: '3 4',
    }],
  });
}

/** Experiment readiness measured against actual paired-day coverage. */
function experiments(cols, blandNights) {
  const paired = (a, b) => {
    const x = cols[a] || [], y = cols[b] || [];
    let n = 0;
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      if (Number.isFinite(x[i]) && Number.isFinite(y[i])) n++;
    }
    return n;
  };
  const rOf = (a, b) => {
    const { r, n } = pearson(cols[a] || [], cols[b] || []);
    return n >= MIN_N && r !== null ? `r = ${fmt(r, 2)}` : 'effect not computable yet';
  };

  const list = [
    {
      id: 'E09', h: '19 °C yields more slow-wave sleep than 24 °C',
      n: paired('bedT', 'deep'), need: 16, effect: rOf('bedT', 'deep'),
    },
    {
      id: 'E10', h: 'CO₂ above 900 ppm fragments sleep',
      n: paired('co2', 'sleep'), need: 30, effect: rOf('co2', 'sleep'),
    },
    {
      id: 'E29', h: 'Bedroom PM2.5 peaks are IQOS, not the street',
      n: paired('iqos', 'pm25'), need: 30, effect: rOf('iqos', 'pm25'),
    },
    {
      id: 'E26', h: 'The treadmill displaces IQOS micro-breaks',
      n: paired('pad', 'iqos'), need: 60, effect: rOf('pad', 'iqos'),
    },
    {
      id: 'E05', h: 'Sleep duration drives the morning fasting glucose (lag +1)',
      n: paired('sleep', 'glucose'), need: 60, effect: rOf('sleep', 'glucose'),
    },
    {
      id: 'E01', h: 'Carbs per meal linearly determine the postprandial rise',
      n: paired('carbs', 'glucose'), need: 40, effect: rOf('carbs', 'glucose'),
    },
    {
      id: 'E12', h: 'Oura and Muse diverge systematically on awake time',
      n: blandNights, need: 30, effect: 'Bland-Altman on the Data trust page',
    },
    {
      id: 'E17', h: 'Nocturnal dipping under 10% is the main unmeasured risk',
      n: 0, need: 14, effect: 'waiting on Aktiia',
    },
  ];

  return list.map((x) => {
    const pct = x.need ? x.n / x.need : 0;
    const color = x.n === 0 ? P.alert : pct >= 1 ? P.good : pct >= 0.5 ? P.warn : P.ref;
    const ready = x.n === 0 ? 'no data' : pct >= 1 ? 'n reached' : `${Math.round(pct * 100)}%`;
    return { ...x, color, ready };
  });
}
