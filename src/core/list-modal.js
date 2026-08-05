import { h } from './dom.js';
import { P } from './tokens.js';

/**
 * A generic table modal for "show me all of them".
 *
 * A chart that ranks things has to truncate; this is where the full list
 * lives. The caller supplies the columns, so the same modal serves the dish
 * ranking today and anything else that needs a full listing later.
 *
 * spec: { title, note, columns: [{key, label, align, width, mono}], rows: [{...}] }
 */
export function listModal(ctx, spec) {
  const close = () => ctx.setState({ openList: null });
  const grid = spec.columns.map((c) => c.width || '1fr').join(' ');

  return h('div.hh-scrim.is-centred', { onClick: close }, [
    h('div.hh-listmodal', { onClick: (ev) => ev.stopPropagation() }, [
      h('div.dh', {
        style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px' },
      }, [
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } }, [
          h('b', { style: { fontSize: '18px', fontWeight: '600', letterSpacing: '-.02em' } }, spec.title),
          spec.note ? h('span.note', spec.note) : null,
        ]),
        h('button.hh-x', { type: 'button', onClick: close }, '✕'),
      ]),

      h('div.hh-lhead', { style: { gridTemplateColumns: grid } },
        spec.columns.map((c) => h('span', {
          class: c.align === 'right' ? 'm' : null,
          style: c.align === 'right' ? { color: P.mut } : null,
        }, c.label))),

      ...spec.rows.map((row) => h('div.hh-lrow', { style: { gridTemplateColumns: grid } },
        spec.columns.map((c) => {
          const v = row[c.key];
          const value = v === null || v === undefined ? '' : String(v);
          if (c.align === 'right' || c.mono) {
            return h('span.m', { style: { color: row[`${c.key}Color`] || P.mut } }, value);
          }
          return h('span.nm', { title: value, style: { color: row[`${c.key}Color`] || P.ink } }, value);
        }))),

      spec.rows.length ? null : h('div', {
        style: { padding: '20px 2px', color: P.off, fontSize: '12px' },
      }, 'Nothing to list yet.'),
    ]),
  ]);
}
