import { h } from './dom.js';
import { P, ST, MONO } from './tokens.js';
import { fmt, age, barGeom } from './format.js';

/**
 * Shared card / panel / banner components.
 *
 * The card is the load-bearing pattern of the whole brief: label, freshness
 * dot with age, value, delta, optional sparkline, optional dual-range bar,
 * source and trust verdict. A value the system does not trust is visually
 * demoted here and excluded from aggregates by the caller.
 */

export function banner(tag, text, color) {
  return h('div.hh-banner', { style: { borderLeft: `3px solid ${color}` } }, [
    h('span.tag', { style: { color } }, tag),
    h('span.txt', text),
  ]);
}

export function panel(title, note, legend, body) {
  return h('div.hh-panel', [
    h('div.ph', [
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, [
        h('span.pt', title),
        note ? h('span.pn', note) : null,
      ]),
      legend ? h('span.pl', legend) : null,
    ]),
    h('div', body),
  ]);
}

export function emptyState(text) {
  return h('div.hh-empty', text);
}

/**
 * @param {object} o
 *  label, value (string), unit, size, state ('ok'|'warn'|'low'|'lag'|'stale'|'dead'|'empty'),
 *  ageText, delta, deltaColor, spark (Node), bar (from barGeom), markColor,
 *  source, note, span, color, onClick
 */
export function card(o) {
  const st = ST[o.state] || ST.ok;
  const dead = o.state === 'dead' || o.state === 'empty';
  const low = o.state === 'low' || o.state === 'stale';
  const cls = ['hh-card'];
  if (o.span === 2) cls.push('span2');
  if (dead) cls.push('is-dead');
  if (low) cls.push('is-low');

  const kids = [
    h('div.top', [
      h('span.lab', o.label),
      h('span.age', [
        h('i.hh-dot', { style: { background: st.c } }),
        o.ageText || '',
      ]),
    ]),
    h('div.mid', [
      h('span.val', [
        h('span.num', {
          style: { fontSize: o.size || '26px', color: dead ? P.off : (o.color || P.ink) },
        }, o.value),
        o.unit ? h('span.unit', o.unit) : null,
      ]),
      o.delta ? h('span.delta', { style: { color: o.deltaColor || P.off } }, o.delta) : null,
    ]),
    o.spark || null,
    o.bar ? rangeBar(o.bar, o.markColor || P.self) : null,
    h('div.foot', [
      h('span.src', o.source || ''),
      h('span.st', { style: { color: o.noteColor || (dead ? P.alert : low ? P.warn : st.c) } },
        o.note || st.l),
    ]),
  ];

  if (o.onClick) cls.push('is-clickable');
  return h('div', {
    class: cls.join(' '),
    tabindex: o.onClick ? '0' : null,
    role: o.onClick ? 'button' : null,
    onClick: o.onClick || null,
    onKeydown: o.onClick
      ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); o.onClick(); } }
      : null,
  }, kids);
}

export function rangeBar(geom, markColor) {
  return h('div.hh-bar', [
    h('i.track'),
    h('i.ref', { style: { left: geom.ref.l, width: geom.ref.w } }),
    h('i.opt', { style: { left: geom.opt.l, width: geom.opt.w } }),
    h('i.mark', { style: { left: geom.mark, background: markColor } }),
  ]);
}

/**
 * Build a card straight from an entity. Handles the whole trust ladder in one
 * place so no page can accidentally render a stale number as if it were live.
 *
 * spec: {label, entity, unit, dec, size, span, source, srcState, ranges:{refMin,refMax,optMin,optMax},
 *        delta, deltaColor, spark, value (override), color, emptyHint}
 */
export function entityCard(ctx, spec) {
  const { data } = ctx;
  const id = spec.entity;
  const stObj = id ? data.st(id) : null;
  const v = spec.value !== undefined ? spec.value : (id ? data.val(id) : null);

  // A card may be backed by an entity or be a derived metric computed from a
  // recorder series. Only the former can be "missing from HA" — a derived
  // metric with a value is simply a value, and must not be struck through.
  const derived = !id && (spec.value !== undefined || spec.text !== undefined);
  const missing = !stObj && !derived;
  const unavailable = stObj && (stObj.state === 'unavailable' || stObj.state === 'unknown');

  let state = spec.srcState || 'ok';
  let noteOverride = spec.note;
  if (missing) {
    state = 'empty';
    noteOverride = noteOverride || (spec.emptyHint || 'сенсора немає в HA');
  } else if (unavailable || (v === null && spec.value === undefined && !spec.text)) {
    state = 'empty';
    noteOverride = noteOverride || (spec.emptyHint
      || (id ? `недоступний з ${age(data.ageMs(id))} тому` : 'немає з чого рахувати'));
  } else if (derived && v === null && (spec.text === undefined || spec.text === '—')) {
    state = 'empty';
    noteOverride = noteOverride || spec.emptyHint || 'немає з чого рахувати';
  }

  const ranges = spec.ranges || {};
  const bar = state === 'empty' ? null
    : barGeom(v, ranges.refMin, ranges.refMax, ranges.optMin, ranges.optMax);

  let markColor = P.self;
  if (bar) {
    const outRef = (Number.isFinite(ranges.refMin) && v < ranges.refMin)
      || (Number.isFinite(ranges.refMax) && v > ranges.refMax);
    const outOpt = (Number.isFinite(ranges.optMin) && v < ranges.optMin)
      || (Number.isFinite(ranges.optMax) && v > ranges.optMax);
    markColor = outRef ? P.alert : outOpt ? P.warn : P.good;
  }

  const text = spec.text !== undefined ? spec.text : (v === null ? '—' : fmt(v, spec.dec));
  const ageMs = spec.ageMs !== undefined ? spec.ageMs : (id ? data.ageMs(id) : null);
  const unit = state === 'empty' ? '' : (spec.unit ?? (id ? data.unit(id) : ''));
  const ageText = spec.ageText || (ageMs === null ? '—' : age(ageMs));

  // Every card opens a detail view showing the recorder series behind it and
  // the four facts that decide whether the number can be trusted.
  const detail = {
    key: `${spec.label}|${id || 'derived'}`,
    label: spec.label,
    entity: id || null,
    value: text,
    unit,
    delta: state === 'empty' ? (spec.emptyDelta || '') : spec.delta,
    source: spec.source,
    note: noteOverride,
    state,
    ageText,
    color: spec.color || P.ink,
    bar,
    markColor,
    ranges,
  };

  return card({
    label: spec.label,
    value: text,
    unit,
    size: spec.size,
    span: spec.span,
    state,
    ageText,
    delta: detail.delta,
    deltaColor: spec.deltaColor,
    spark: state === 'empty' ? null : spec.spark,
    bar,
    markColor,
    color: spec.color,
    source: spec.source,
    note: noteOverride,
    noteColor: spec.noteColor,
    onClick: spec.onClick || (() => ctx.setState({ openCard: detail })),
  });
}

/** A labelled colour key for charts that carry more than two series. */
export function legendRow(items) {
  return h('div', {
    style: {
      display: 'flex', gap: '14px', flexWrap: 'wrap', fontFamily: MONO,
      fontSize: '10px', color: P.mut,
    },
  }, items.map((it) => h('span', {
    style: { display: 'flex', alignItems: 'center', gap: '6px' },
  }, [
    h('i', {
      style: {
        width: '10px', height: '3px', borderRadius: '2px', background: it.color,
        display: 'inline-block',
      },
    }),
    it.label,
  ])));
}
