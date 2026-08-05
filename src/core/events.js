import { P } from './tokens.js';
import { E } from './registry.js';

/**
 * The shared annotation layer.
 *
 * Every time chart in the product draws from this same set of events, toggled
 * by one switch in the sidebar. Without it a dip in HRV reads as a bad
 * protocol instead of an air raid alert at 03:40.
 */
export async function loadEvents(ctx, hours) {
  const { data } = ctx;
  const end = Date.now();
  const start = end - hours * 3600e3;
  const events = [];

  const alertIds = data.byPrefix(E.alertPrefix);
  const [alerts, meals, puffs, pad] = await Promise.all([
    alertIds.length ? data.history(alertIds, hours, { significantOnly: false }) : {},
    data.exists(E.fwLastEaten) ? data.history(E.fwLastEaten, hours, { significantOnly: false }) : {},
    data.exists(E.iqosPuffs) ? data.history(E.iqosPuffs, hours, { significantOnly: false }) : {},
    data.exists(E.padState) ? data.history(E.padState, hours, { significantOnly: false }) : {},
  ]);

  // air raid alerts — every transition to "on"
  for (const id of Object.keys(alerts)) {
    const rows = alerts[id];
    const kind = id.replace(E.alertPrefix, '');
    let prev = null;
    for (const r of rows) {
      if (r.s === 'on' && prev !== 'on') {
        events.push({ t: r.t, label: 'alert', color: P.alert, kind: 'alert', detail: kind });
      }
      prev = r.s;
    }
  }

  // meals — each new Foodwatch timestamp is one eating event
  const mealRows = meals[E.fwLastEaten] || [];
  const seen = new Set();
  for (const r of mealRows) {
    if (!r.s || r.s === 'unknown') continue;
    const t = new Date(r.s.replace(' ', 'T')).getTime();
    if (!Number.isFinite(t) || seen.has(t) || t < start || t > end) continue;
    seen.add(t);
    events.push({ t, label: 'meal', color: P.self, kind: 'meal' });
  }

  // IQOS — the utility meter steps up once per puff batch
  const puffRows = puffs[E.iqosPuffs] || [];
  let prevPuff = null;
  for (const r of puffRows) {
    if (r.v === null) continue;
    if (prevPuff !== null && r.v > prevPuff) {
      events.push({ t: r.t, label: 'IQOS', color: P.alert, kind: 'iqos' });
    }
    prevPuff = r.v;
  }

  // treadmill sessions — running → standby
  const padRows = pad[E.padState] || [];
  let runStart = null;
  const sessions = [];
  for (const r of padRows) {
    const running = r.s === 'running' || r.s === 'startup';
    if (running && runStart === null) runStart = r.t;
    if (!running && runStart !== null) { sessions.push([runStart, r.t]); runStart = null; }
  }
  if (runStart !== null) sessions.push([runStart, end]);

  events.sort((a, b) => a.t - b.t);
  return { events, sessions, start, end, hours };
}

/**
 * Convert absolute event times into 0..1 positions for a chart that spans
 * [start, end]. Collapses events closer together than ~2% of the axis so
 * labels do not pile up.
 */
export function eventsFor(bundle, start, end, ctx, kinds) {
  if (!bundle || !ctx.state.annotations) return [];
  const span = (end - start) || 1;
  const out = [];
  let lastAt = -1;
  for (const ev of bundle.events) {
    if (kinds && !kinds.includes(ev.kind)) continue;
    if (ev.t < start || ev.t > end) continue;
    const at = (ev.t - start) / span;
    out.push({ at, label: at - lastAt < 0.05 ? '' : ev.label, color: ev.color });
    if (at - lastAt >= 0.05) lastAt = at;
  }
  return out;
}
