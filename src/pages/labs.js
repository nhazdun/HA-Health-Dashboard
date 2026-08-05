import { h } from '../core/dom.js';
import { P, MONO } from '../core/tokens.js';
import { panel, banner, emptyState, rangeBar } from '../core/ui.js';
import { lineChart } from '../charts/svg.js';
import { fmt, age, barGeom, rangeStatus, dateOf, NO_DATA } from '../core/format.js';
import { E, ORNAMENT_META } from '../core/registry.js';

/**
 * Page 6 — the laboratory.
 *
 * Every marker is read live from the Ornament integration's entity attributes:
 * `reference_min/max`, `optimal_min/max`, `category`, `measured_at` and the
 * full `history` array. Nothing is copied into the card — change a value in
 * Home Assistant and this page changes with it.
 *
 * The central claim of the brief lives here: far more markers fall outside the
 * *optimal* corridor than outside the laboratory reference, and that gap is
 * the analytical value.
 */

const STATUS_LABEL = {
  ref: 'out of reference',
  opt: 'out of optimum',
  in: 'in optimum',
  qual: 'qualitative',
};
const STATUS_COLOR = { ref: P.alert, opt: P.warn, in: P.good, qual: P.off };

const FILTERS = [
  { id: 'ref', label: 'Out of reference', f: (m) => m.status === 'ref' },
  { id: 'opt', label: 'Out of optimum', f: (m) => m.status === 'opt' || m.status === 'ref' },
  { id: 'in', label: 'In optimum', f: (m) => m.status === 'in' },
  { id: 'qual', label: 'Qualitative', f: (m) => m.status === 'qual' },
  { id: 'all', label: 'All', f: () => true },
];

export default {
  id: 'labs',
  label: 'Labs',
  title: 'Labs',
  question: 'What is in the blood, and where is it heading?',
  scale: 'quarters',

  live(ctx) {
    const { data } = ctx;
    const last = data.raw(E.ornLastReport);
    if (!last) return { color: P.off, label: 'no reports' };
    const months = (Date.now() - new Date(last).getTime()) / (30.44 * 86400e3);
    if (months > 12) return { color: P.alert, label: `snapshot ${Math.round(months)} mo old` };
    if (months > 6) return { color: P.warn, label: `snapshot ${Math.round(months)} mo old` };
    return { color: P.ref, label: `snapshot ${Math.round(months)} mo old` };
  },

  async load(ctx) {
    return { markers: collect(ctx.data) };
  },

  render(ctx, pd) {
    const { data, state } = ctx;
    const all = pd.markers;
    const out = [];

    if (!all.length) {
      return [emptyState('The Ornament integration returns no biomarker. '
        + 'Check that the sensor.ornament_nazariy_* entities exist.')];
    }

    const counts = {};
    for (const f of FILTERS) counts[f.id] = all.filter(f.f).length;
    const outRef = counts.ref;
    const outOpt = all.filter((m) => m.status === 'opt').length;
    const ratio = outRef ? (outRef + outOpt) / outRef : null;

    // ---------------------------------------------------------------- banner
    out.push(banner('DUAL RANGE',
      `${outRef} markers are outside the laboratory reference and ${outRef + outOpt} are outside the `
      + `optimal range${ratio ? `, a difference of ${fmt(ratio, 1)} times` : ''}. That gap is the main `
      + 'analytical value of this page. The pale bar is the reference range, the solid blue bar is the '
      + 'optimum and the tick is your value.',
      P.warn));

    const lastReport = data.raw(E.ornLastReport);
    const oldest = all.filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (lastReport) {
      const months = (Date.now() - new Date(lastReport).getTime()) / (30.44 * 86400e3);
      out.push(banner('FRESHNESS',
        `The last report is ${dateOf(lastReport)}, ${age(Date.now() - new Date(lastReport).getTime())} old. `
        + `It holds ${data.attr(E.ornLastReport, 'results_in_report') ?? NO_DATA} results out of `
        + `${data.attr(E.ornLastReport, 'reports_total') ?? NO_DATA} reports in total. `
        + (oldest ? `The oldest marker in the list is dated ${oldest.date}. ` : '')
        + 'Every row carries its own date, so this snapshot is never uniform.',
        months > 12 ? P.alert : P.ref));
    }

    // --------------------------------------------------------------- filters
    out.push(h('div.hh-filters', [
      ...FILTERS.map((f) => h('button.hh-chip', {
        type: 'button',
        'aria-pressed': state.labFilter === f.id ? 'true' : 'false',
        onClick: () => ctx.setState({ labFilter: f.id }),
      }, [h('span', f.label), h('span.n', String(counts[f.id]))])),
      h('input', {
        type: 'search',
        placeholder: 'search markers…',
        value: state.labQuery,
        onInput: (ev) => ctx.setState({ labQuery: ev.target.value }),
        style: {
          border: `1px solid ${P.rule}`, borderRadius: '999px', padding: '6px 13px',
          fontFamily: 'inherit', fontSize: '11.5px', color: P.ink, background: P.surf,
          minWidth: '180px', outline: 'none',
        },
      }),
    ]));

    // ------------------------------------------------------------ the tables
    const active = FILTERS.find((f) => f.id === state.labFilter) || FILTERS[1];
    const q = (state.labQuery || '').trim().toLowerCase();
    const rows = all.filter(active.f).filter((m) => !q
      || m.name.toLowerCase().includes(q)
      || m.panel.toLowerCase().includes(q)
      || m.entity.includes(q));

    if (!rows.length) {
      out.push(emptyState(`Nothing matches the "${active.label}" filter${q ? ` and the query "${state.labQuery}"` : ''}.`));
      return out;
    }

    const panels = [...new Set(rows.map((m) => m.panel))].sort((a, b) => a.localeCompare(b, 'uk'));
    for (const p of panels) {
      const group = rows.filter((m) => m.panel === p);
      const bad = group.filter((m) => m.status === 'ref').length;
      const sub = group.filter((m) => m.status === 'opt').length;
      out.push(h('div.hh-group', [
        h('div.hh-gh', [
          h('b', p),
          h('span', `${group.length} items · ${bad} out of reference · ${sub} out of optimum`),
        ]),
        ...group.map((m) => row(ctx, m)),
      ]));
    }

    return out;
  },

  /** Right-hand drawer: the marker's own longitudinal history from HA. */
  drawer(ctx, marker) {
    const { data } = ctx;
    const m = marker;
    const color = STATUS_COLOR[m.status];
    const hist = (data.attr(m.entity, 'history') || [])
      .map((r) => ({ t: new Date(r.date).getTime(), v: typeof r.value === 'number' ? r.value : null, raw: r.value }))
      .filter((r) => Number.isFinite(r.t))
      .sort((a, b) => a.t - b.t);

    const numeric = hist.filter((r) => r.v !== null);
    let chart;
    if (m.value === null || numeric.length === 0) {
      chart = h('div', {
        style: {
          padding: '18px', background: P.bg, border: `1px dashed ${P.rule}`, borderRadius: '10px',
          color: P.mut, fontSize: '12px', lineHeight: 1.5,
        },
      }, numeric.length === 0 && hist.length
        ? `This marker is qualitative, so the page draws no trend. History holds ${hist.length} records and the last is "${m.raw}".`
        : `This marker is qualitative, so the page draws no trend. Value: ${m.raw}`);
    } else {
      const vals = numeric.map((r) => r.v);
      const bounds = [...vals, m.refMin, m.refMax, m.optMin, m.optMax].filter(Number.isFinite);
      const lo = Math.min(...bounds), hi = Math.max(...bounds);
      const padY = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
      const n = numeric.length;
      const flat = (v) => (Number.isFinite(v) ? new Array(n).fill(v) : null);
      chart = lineChart({
        w: 520, h: 210, pad: [10, 14, 24, 46],
        yMin: lo - padY, yMax: hi + padY,
        yTicks: [lo, (lo + hi) / 2, hi],
        xLabels: numeric.length > 1
          ? [dateOf(numeric[0].t).slice(0, 7), dateOf(numeric[n - 1].t).slice(0, 7)]
          : [dateOf(numeric[0].t)],
        bands: [
          Number.isFinite(m.refMin) && Number.isFinite(m.refMax)
            ? { lo: flat(m.refMin), hi: flat(m.refMax), color: P.ref, op: 0.1 } : null,
          Number.isFinite(m.optMin) && Number.isFinite(m.optMax)
            ? { lo: flat(m.optMin), hi: flat(m.optMax), color: P.ref, op: 0.24 } : null,
        ],
        series: [{ pts: vals, color: P.self, w: 2, dot: true }],
      });
    }

    const close = () => ctx.setState({ open: null });
    return h('div.hh-scrim', { onClick: close }, [
      h('div.hh-drawer', { onClick: (ev) => ev.stopPropagation() }, [
        h('div.dh', [
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } }, [
            h('b', m.name),
            h('span', `${m.panel}${m.biomaterial ? ' · ' + m.biomaterial : ''}`),
          ]),
          h('button.hh-x', { type: 'button', onClick: close }, '✕'),
        ]),
        h('div.hh-dval', [
          h('b', { style: { color } }, m.value === null ? m.raw : fmt(m.value)),
          h('span.u', m.unit || ''),
          h('span.s', { style: { color } }, STATUS_LABEL[m.status]),
        ]),
        m.bar ? rangeBar(m.bar, color) : null,
        h('div.hh-ddesc', describe(m, hist)),
        h('div', chart),
        h('div.hh-facts', [
          fact('Reference range',
            Number.isFinite(m.refMin) || Number.isFinite(m.refMax)
              ? `${fmt(m.refMin)} – ${fmt(m.refMax)}` : NO_DATA, P.ref),
          fact('Optimal range',
            Number.isFinite(m.optMin) || Number.isFinite(m.optMax)
              ? `${fmt(m.optMin)} – ${fmt(m.optMax)}` : 'not defined', '#2F5580'),
          fact('Draw date', m.date || NO_DATA, P.mut),
          fact('Result age', m.date
            ? age(Date.now() - new Date(m.date).getTime())
            : NO_DATA, m.stale ? P.warn : P.good),
          fact('Measurements in total', String(m.count ?? (hist.length || NO_DATA)), P.mut),
          fact('Previous value',
            m.prev !== null && m.prev !== undefined
              ? `${fmt(m.prev)}${m.trend ? ` · ${m.trend === 'up' ? '↑' : m.trend === 'down' ? '↓' : '='}` : ''}`
              : NO_DATA,
            m.trend === 'up' ? P.warn : m.trend === 'down' ? P.good : P.mut),
        ]),
        h('div.hh-eid', m.entity),
      ]),
    ]);
  },
};

// ------------------------------------------------------------------ helpers

function row(ctx, m) {
  const color = STATUS_COLOR[m.status];
  return h('button.hh-row', {
    type: 'button',
    onClick: () => ctx.setState({ open: m }),
  }, [
    h('div.nm', [
      h('b', m.name),
      h('span', `${m.date || 'no date'} · ${m.unit || (m.value === null ? 'qualitative' : 'no unit')}`),
    ]),
    h('div.v', { style: { color: m.status === 'ref' ? P.alert : P.ink } }, [
      m.value === null ? shorten(m.raw) : fmt(m.value),
      m.unit ? h('em', m.unit) : null,
    ]),
    h('div.rb', { style: { position: 'relative', height: '14px' } },
      m.bar
        ? [
          h('i', {
            style: {
              position: 'absolute', top: '5.5px', left: 0, right: 0, height: '3px',
              background: P.s2, borderRadius: '2px',
            },
          }),
          h('i', {
            style: {
              position: 'absolute', top: '5.5px', left: m.bar.ref.l, width: m.bar.ref.w,
              height: '3px', background: P.band, borderRadius: '2px',
            },
          }),
          h('i', {
            style: {
              position: 'absolute', top: '3.5px', left: m.bar.opt.l, width: m.bar.opt.w,
              height: '7px', background: P.bandOpt, borderRadius: '2px',
            },
          }),
          h('i', {
            style: {
              position: 'absolute', top: 0, left: m.bar.mark, width: '2px', height: '14px',
              background: color, borderRadius: '1px', boxShadow: `0 0 0 2px ${P.surf}`,
            },
          }),
        ]
        : h('span', {
          style: { fontFamily: MONO, fontSize: '9.5px', color: P.off, lineHeight: '14px' },
        }, m.status === 'qual' ? 'qualitative, no range' : 'no range defined')),
    h('div.st', { style: { color } }, STATUS_LABEL[m.status]),
  ]);
}

function fact(k, v, c) {
  return h('div.hh-fact', [h('span.k', k), h('span.v', { style: { color: c } }, v)]);
}

function shorten(s) {
  const t = String(s ?? NO_DATA);
  return t.length > 14 ? t.slice(0, 13) + '…' : t;
}

function describe(m, hist) {
  const bits = [];
  if (m.status === 'ref') {
    bits.push('The value is outside the laboratory reference. This is the level at which the laboratory '
      + 'itself flags a result as abnormal.');
  } else if (m.status === 'opt') {
    bits.push('The value is inside the laboratory reference but outside the optimal range. Markers like '
      + 'this make up most of the deviations and they are the ones that usually go unnoticed.');
  } else if (m.status === 'in') {
    bits.push('The value is inside the optimal range.');
  } else {
    bits.push('This marker is qualitative: the result is a category and not a number, so ranges do not apply.');
  }
  if (hist.length > 1) {
    const first = hist[0], last = hist[hist.length - 1];
    bits.push(`History holds ${hist.length} measurements, from ${dateOf(first.t)} to ${dateOf(last.t)}.`);
  } else if (hist.length === 1) {
    bits.push('Measured once, so there is no trend yet and nothing to compare against.');
  }
  if (m.stale) {
    bits.push('The result is over 12 months old. For a fast-moving marker treat it as history and not '
      + 'as the current value.');
  }
  if (m.synonyms && m.synonyms.length) bits.push(`Synonyms: ${m.synonyms.slice(0, 4).join(', ')}.`);
  return bits.join(' ');
}

/** Read every Ornament biomarker straight out of the live entity registry. */
function collect(data) {
  const out = [];
  for (const id of data.byPrefix(E.ornPrefix)) {
    if (ORNAMENT_META.has(id)) continue;
    const s = data.st(id);
    if (!s || !s.attributes) continue;
    const a = s.attributes;
    if (a.biomarker_id === undefined && a.category === undefined) continue;

    const value = data.val(id);
    const refMin = numOrNull(a.reference_min);
    const refMax = numOrNull(a.reference_max);
    const optMin = numOrNull(a.optimal_min);
    const optMax = numOrNull(a.optimal_max);

    let status;
    if (value === null) {
      // qualitative marker — the integration knows which options count as normal
      const normal = a.normal_options;
      status = Array.isArray(normal) && normal.length
        ? (normal.includes(s.state) ? 'in' : 'ref')
        : (a.is_abnormal ? 'ref' : 'qual');
      if (status === 'in' && !a.is_abnormal) status = 'qual';
    } else {
      status = rangeStatus(value, refMin, refMax, optMin, optMax);
      // trust the integration's own verdict when it disagrees about reference
      if (a.is_abnormal && status !== 'ref') status = 'ref';
    }

    const date = a.measured_at ? String(a.measured_at).slice(0, 10) : null;
    out.push({
      entity: id,
      name: shortName(a.friendly_name || id, a.category),
      panel: a.category || 'No panel',
      biomaterial: a.biomaterial || '',
      unit: a.unit_of_measurement || '',
      value,
      raw: s.state,
      status,
      refMin, refMax, optMin, optMax,
      bar: value === null ? null : barGeom(value, refMin, refMax, optMin, optMax),
      date,
      stale: date ? Date.now() - new Date(date).getTime() > 365 * 86400e3 : false,
      count: a.measurement_count,
      prev: numOrNull(a.previous_value),
      trend: a.trend,
      synonyms: a.synonyms,
    });
  }
  out.sort((a, b) => a.panel.localeCompare(b.panel, 'uk') || a.name.localeCompare(b.name, 'uk'));
  return out;
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Strip the integration prefix and the panel name from a friendly name. */
function shortName(friendly, category) {
  let s = String(friendly).replace(/^Ornament\s+\S+\s+/i, '');
  if (category && s.startsWith(category)) s = s.slice(category.length).trim();
  return s || friendly;
}
