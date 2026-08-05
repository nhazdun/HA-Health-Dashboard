import { h } from './dom.js';
import { P, ST } from './tokens.js';
import { rangeBar } from './ui.js';
import { lineChart } from '../charts/svg.js';
import { fmt, age, NO_DATA } from './format.js';
import { resample } from './ha.js';

/**
 * The card detail modal.
 *
 * Opening a card shows where its number came from: the real recorder series
 * behind it, its dual range, and the four facts that decide whether it can be
 * trusted. The trend is fetched live for the card's entity — a card with no
 * entity (a derived metric, or a domain with no source yet) says so instead of
 * drawing a plausible line.
 */

const WINDOW_HOURS = { fast: 6, hour: 48, day: 30 * 24 };

export function cardDetail(ctx, detail) {
  const { data } = ctx;
  const close = () => ctx.setState({ openCard: null });
  const meta = ST[detail.state] || ST.ok;
  const series = ctx.pageData.__cardSeries;
  const loading = series === undefined || series.key !== detail.key;

  return h('div.hh-scrim.is-centred', { onClick: close }, [
    h('div.hh-modal', { onClick: (ev) => ev.stopPropagation() }, [
      h('div.dh', [
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } }, [
          h('b', detail.label),
          h('span', {
            style: { fontFamily: "'Geist Mono',monospace", fontSize: '11px', color: P.mut },
          }, detail.source || NO_DATA),
          detail.info ? h('span.info', detail.info) : null,
        ]),
        h('button.hh-x', { type: 'button', onClick: close }, '✕'),
      ]),

      h('div.hh-dval', [
        h('b', { style: { color: detail.state === 'empty' || detail.state === 'dead' ? P.off : detail.color } },
          detail.value),
        h('span.u', detail.unit || ''),
        detail.delta
          ? h('span', {
            style: {
              marginLeft: 'auto', fontFamily: "'Geist Mono',monospace", fontSize: '11px',
              color: P.mut, textAlign: 'right', lineHeight: 1.4, paddingBottom: '8px',
              whiteSpace: 'pre-line',
            },
          }, detail.delta)
          : null,
      ]),

      detail.bar
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
          rangeBar(detail.bar, detail.markColor || P.self),
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
              fontFamily: "'Geist Mono',monospace", fontSize: '10px', color: P.off,
            },
          }, [
            legendSwatch(P.band, '14px', '3px', 'reference'),
            legendSwatch(P.bandOpt, '14px', '6px', 'optimum'),
            legendSwatch(detail.markColor || P.self, '2px', '12px', 'current'),
          ]),
        ])
        : null,

      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, [
        h('span', { style: { fontSize: '12px', color: P.mut, lineHeight: 1.5 } }, chartNote(detail, series, loading)),
        h('div', trendChart(ctx, detail, series, loading)),
      ]),

      h('div.hh-facts', [
        fact('Data age', detail.ageText || NO_DATA, meta.c),
        fact('Trust state', meta.l, meta.c),
        fact('Source', detail.source || NO_DATA, P.mut),
        fact('Caveat', detail.note || NO_DATA,
          detail.state === 'dead' || detail.state === 'empty' ? P.alert
            : detail.state === 'ok' ? P.mut : P.warn),
      ]),

      detail.entity ? h('div.hh-eid', detail.entity) : null,
    ]),
  ]);
}

function legendSwatch(color, w, hgt, label) {
  return h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
    h('i', {
      style: { width: w, height: hgt, background: color, borderRadius: '2px', display: 'inline-block' },
    }),
    label,
  ]);
}

function fact(k, v, c) {
  return h('div.hh-fact', [
    h('span.k', k),
    h('span.v', { style: { color: c, whiteSpace: 'pre-line' } }, v),
  ]);
}

function chartNote(detail, series, loading) {
  if (!detail.entity) {
    return 'This metric has no entity of its own in Home Assistant. It is either computed from a '
      + 'series or the domain has no source yet, so there is no trend to draw.';
  }
  if (loading) return 'Reading the recorder…';
  if (!series || !series.rows.length) {
    return 'The recorder holds no record for this entity in the window. Empty is not zero.';
  }
  return `${series.rows.length} records over ${series.label} from the recorder. `
    + (detail.state === 'dead' || detail.state === 'stale'
      ? 'The line stops at the last trusted record. It does not flatten into a straight line.'
      : 'This is the actual series and not a smoothed estimate.');
}

function trendChart(ctx, detail, series, loading) {
  if (!detail.entity || loading || !series || series.rows.length < 2) {
    return h('div', {
      style: {
        padding: '20px', background: P.bg, border: `1px dashed ${P.rule}`, borderRadius: '10px',
        color: P.mut, fontSize: '12px', lineHeight: 1.5,
      },
    }, loading && detail.entity
      ? 'Reading the recorder…'
      : `Value: ${detail.value}${detail.unit ? ' ' + detail.unit : ''}`);
  }

  const rows = series.rows;
  const vals = rows.map((r) => r.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
  const dead = detail.state === 'dead' || detail.state === 'stale';
  const start = rows[0].t, end = rows[rows.length - 1].t;

  return lineChart({
    w: 620, h: 200, pad: [10, 14, 24, 50],
    yMin: lo - pad, yMax: hi + pad,
    yTicks: [lo, (lo + hi) / 2, hi],
    tickDec: Math.abs(hi) < 10 ? 2 : Math.abs(hi) < 100 ? 1 : 0,
    xLabels: series.xLabels,
    series: [{
      pts: resample(rows, 90, start, end),
      color: dead ? P.off : ctx.accent,
      w: 2, dash: dead ? '4 4' : null, dot: true, fill: !dead,
    }],
    ...(detail.ranges && Number.isFinite(detail.ranges.optMin) && Number.isFinite(detail.ranges.optMax)
      ? {
        bands: [{
          lo: new Array(90).fill(detail.ranges.optMin),
          hi: new Array(90).fill(detail.ranges.optMax),
          color: P.ref, op: 0.16,
        }],
      }
      : {}),
  });
}

/**
 * Fetch the trend behind the opened card. The window follows the source's
 * cadence: fast channels get hours, daily ones get a month.
 */
export async function loadCardSeries(ctx, detail) {
  const { data } = ctx;
  if (!detail || !detail.entity || !data.exists(detail.entity)) return { key: detail && detail.key, rows: [] };

  const ageMs = data.ageMs(detail.entity) ?? 0;
  const tier = ageMs > 6 * 3600e3 ? 'day' : ageMs > 20 * 60e3 ? 'hour' : 'fast';
  const hours = WINDOW_HOURS[tier];

  let rows = await data.series(detail.entity, hours, { significantOnly: false, ttl: 120e3 });
  let label = tier === 'fast' ? '6 h' : tier === 'hour' ? '48 h' : '30 days';

  // A daily-cadence sensor may fall outside raw history; fall back to statistics.
  if (rows.length < 2 && tier === 'day') {
    const st = await data.stats(detail.entity, 90, 'day', ['mean', 'max', 'min']);
    rows = (st[detail.entity] || [])
      .map((r) => ({ t: r.t, v: r.mean ?? r.max ?? r.min }))
      .filter((r) => Number.isFinite(r.v));
    label = '90 days (long-term statistics)';
  }

  const xLabels = rows.length >= 2
    ? [stamp(rows[0].t, tier), stamp(rows[Math.floor(rows.length / 2)].t, tier), stamp(rows[rows.length - 1].t, tier)]
    : [];

  return { key: detail.key, rows, label, xLabels };
}

function stamp(t, tier) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return tier === 'day'
    ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`
    : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
