import { num } from './format.js';

/**
 * Access layer over the Home Assistant websocket connection that the Lovelace
 * `hass` object already carries.
 *
 * Reads are the bulk of it: entity state plus `history/history_during_period`
 * and `recorder/statistics_during_period`, which are pure queries. Nothing
 * here ever mutates the recorder, so existing history is never at risk.
 *
 * `call()` is the one write path, and it exists only for the explicit device
 * controls on the Now and Night pages — starting the treadmill, calibrating
 * the posture sensor, marking a sleep session. It calls ordinary HA services;
 * it does not touch stored data.
 */
export class HaData {
  constructor() {
    this.hass = null;
    this._cache = new Map();
    this._inflight = new Map();
    this._listeners = new Set();
  }

  setHass(hass) {
    this.hass = hass;
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn();
  }

  // ---------------------------------------------------------------- states

  st(entityId) {
    return this.hass && this.hass.states ? this.hass.states[entityId] : undefined;
  }

  /** Numeric state, or null for unknown/unavailable/non-numeric. */
  val(entityId) {
    const s = this.st(entityId);
    return s ? num(s.state) : null;
  }

  raw(entityId) {
    const s = this.st(entityId);
    if (!s) return null;
    return s.state === 'unknown' || s.state === 'unavailable' ? null : s.state;
  }

  attr(entityId, key) {
    const s = this.st(entityId);
    return s && s.attributes ? s.attributes[key] : undefined;
  }

  unit(entityId) {
    return this.attr(entityId, 'unit_of_measurement') || '';
  }

  name(entityId) {
    return this.attr(entityId, 'friendly_name') || entityId;
  }

  exists(entityId) {
    return !!this.st(entityId);
  }

  /** Milliseconds since this entity last reported anything at all. */
  ageMs(entityId) {
    const s = this.st(entityId);
    if (!s) return null;
    const t = s.last_reported || s.last_updated || s.last_changed;
    if (!t) return null;
    const ms = Date.now() - new Date(t).getTime();
    return Number.isFinite(ms) ? Math.max(0, ms) : null;
  }

  /** Freshest age across a group of entities — used for source liveness. */
  ageOfAny(ids) {
    const ages = ids.map((id) => this.ageMs(id)).filter((x) => x !== null);
    return ages.length ? Math.min(...ages) : null;
  }

  /** true when at least one entity in the list carries a usable value. */
  anyLive(ids) {
    return ids.some((id) => {
      const s = this.st(id);
      return s && s.state !== 'unavailable' && s.state !== 'unknown';
    });
  }

  /** Every entity whose id starts with the prefix. */
  byPrefix(prefix) {
    if (!this.hass || !this.hass.states) return [];
    return Object.keys(this.hass.states).filter((id) => id.startsWith(prefix));
  }

  /** Numeric bounds a `number` entity declares, so sliders never invent a range. */
  bounds(entityId, fallback = {}) {
    const s = this.st(entityId);
    const a = (s && s.attributes) || {};
    return {
      min: Number.isFinite(a.min) ? a.min : (fallback.min ?? 0),
      max: Number.isFinite(a.max) ? a.max : (fallback.max ?? 100),
      step: Number.isFinite(a.step) ? a.step : (fallback.step ?? 1),
      unit: a.unit_of_measurement || fallback.unit || '',
    };
  }

  // --------------------------------------------------------------- controls

  /**
   * Call a Home Assistant service. The only write the card performs, and only
   * from a control the user pressed. Returns true on success.
   */
  async call(domain, service, data) {
    if (!this.hass || !this.hass.callService) return false;
    try {
      await this.hass.callService(domain, service, data);
      return true;
    } catch (err) {
      console.warn('[health-hub] service call failed', `${domain}.${service}`, err);
      return false;
    }
  }

  /** Press a `button` / `input_button` entity. */
  press(entityId) {
    const domain = entityId.split('.')[0];
    return this.call(domain, 'press', { entity_id: entityId });
  }

  /** Set a `number` / `input_number` entity, clamped to its declared bounds. */
  setNumber(entityId, value) {
    const { min, max, step } = this.bounds(entityId);
    let v = Math.min(max, Math.max(min, value));
    if (step) v = Math.round(v / step) * step;
    v = Number(v.toFixed(4));
    const domain = entityId.split('.')[0];
    return this.call(domain, 'set_value', { entity_id: entityId, value: v });
  }

  toggle(entityId, on) {
    const domain = entityId.split('.')[0];
    return this.call(domain, on ? 'turn_on' : 'turn_off', { entity_id: entityId });
  }

  selectOption(entityId, option) {
    const domain = entityId.split('.')[0];
    return this.call(domain, 'select_option', { entity_id: entityId, option });
  }

  /** Write "now" into an input_datetime, used to anchor a sleep session. */
  setDateTimeNow(entityId) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return this.call('input_datetime', 'set_datetime', {
      entity_id: entityId,
      datetime: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    });
  }

  // --------------------------------------------------------------- history

  async _ws(msg, cacheKey, ttl) {
    if (!this.hass || !this.hass.callWS) return null;
    const now = Date.now();
    if (cacheKey) {
      const hit = this._cache.get(cacheKey);
      if (hit && now - hit.t < ttl) return hit.v;
      const pending = this._inflight.get(cacheKey);
      if (pending) return pending;
    }
    const p = this.hass.callWS(msg)
      .then((res) => {
        if (cacheKey) {
          this._cache.set(cacheKey, { t: Date.now(), v: res });
          this._inflight.delete(cacheKey);
        }
        return res;
      })
      .catch((err) => {
        if (cacheKey) this._inflight.delete(cacheKey);
        console.warn('[health-hub] websocket call failed', msg.type, err);
        return null;
      });
    if (cacheKey) this._inflight.set(cacheKey, p);
    return p;
  }

  /**
   * Raw recorder history for one or more entities.
   * Returns `{ [entityId]: [{t: epochMs, v: number|null, s: string}] }`.
   */
  async history(entityIds, hours, opts = {}) {
    const ids = Array.isArray(entityIds) ? entityIds : [entityIds];
    const live = ids.filter((id) => this.exists(id));
    if (!live.length) return {};
    const end = opts.end ? new Date(opts.end) : new Date();
    const start = opts.start ? new Date(opts.start) : new Date(end.getTime() - hours * 3600e3);
    const bucket = Math.floor(end.getTime() / (opts.ttl || 120e3));
    const key = `h|${live.join(',')}|${start.getTime()}|${bucket}|${hours}`;
    const res = await this._ws({
      type: 'history/history_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: live,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: opts.significantOnly !== false,
    }, key, opts.ttl || 120e3);
    if (!res) return {};

    const out = {};
    for (const id of Object.keys(res)) {
      const rows = res[id] || [];
      let lastState = null;
      out[id] = rows.map((r) => {
        // minimal_response collapses repeats: `s` may be absent, `lu` is epoch seconds
        const s = r.s !== undefined ? r.s : (r.state !== undefined ? r.state : lastState);
        lastState = s;
        const lu = r.lu !== undefined ? r.lu * 1000
          : (r.last_updated ? new Date(r.last_updated).getTime()
            : (r.last_changed ? new Date(r.last_changed).getTime() : NaN));
        return { t: lu, v: num(s), s };
      }).filter((p) => Number.isFinite(p.t));
    }
    return out;
  }

  /** Convenience: one entity's numeric history as an ascending series. */
  async series(entityId, hours, opts = {}) {
    const h = await this.history(entityId, hours, opts);
    const rows = (h[entityId] || []).filter((p) => p.v !== null);
    rows.sort((a, b) => a.t - b.t);
    return rows;
  }

  /**
   * Long-term statistics — permanent retention, so this is what the
   * multi-month pages use. Returns `{ [id]: [{t, mean, min, max, sum, state, change}] }`.
   */
  async stats(statisticIds, days, period = 'day', types = ['mean', 'min', 'max', 'state', 'change']) {
    const ids = (Array.isArray(statisticIds) ? statisticIds : [statisticIds]).filter(Boolean);
    if (!ids.length) return {};
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400e3);
    const bucket = Math.floor(end.getTime() / 300e3);
    const key = `s|${ids.join(',')}|${days}|${period}|${bucket}`;
    const res = await this._ws({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: ids,
      period,
      types,
    }, key, 300e3);
    if (!res) return {};
    const out = {};
    for (const id of Object.keys(res)) {
      out[id] = (res[id] || []).map((r) => ({
        t: typeof r.start === 'number' ? r.start : new Date(r.start).getTime(),
        mean: r.mean ?? null,
        min: r.min ?? null,
        max: r.max ?? null,
        sum: r.sum ?? null,
        state: r.state ?? null,
        change: r.change ?? null,
      })).filter((r) => Number.isFinite(r.t));
    }
    return out;
  }

  /**
   * Daily series for correlation work. Prefers long-term statistics (permanent)
   * and falls back to bucketing raw history when the entity has no state_class.
   */
  async daily(entityId, days, agg = 'mean') {
    if (!this.exists(entityId)) return new Map();
    const key = `d|${entityId}|${days}|${agg}|${Math.floor(Date.now() / 600e3)}`;
    const hit = this._cache.get(key);
    if (hit) return hit.v;

    const out = new Map();
    const s = await this.stats(entityId, days, 'day');
    const rows = s[entityId] || [];
    if (rows.length >= Math.min(5, days / 4)) {
      for (const r of rows) {
        const v = agg === 'max' ? r.max : agg === 'min' ? r.min
          : agg === 'change' ? r.change : agg === 'state' ? r.state : r.mean;
        if (Number.isFinite(v)) out.set(dayKey(r.t), v);
      }
    } else {
      const hist = await this.series(entityId, days * 24, { significantOnly: false, ttl: 600e3 });
      const buckets = new Map();
      for (const p of hist) {
        const k = dayKey(p.t);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(p.v);
      }
      for (const [k, vs] of buckets) {
        const v = agg === 'max' ? Math.max(...vs) : agg === 'min' ? Math.min(...vs)
          : agg === 'state' ? vs[vs.length - 1]
            : vs.reduce((a, b) => a + b, 0) / vs.length;
        out.set(k, v);
      }
    }
    this._cache.set(key, { t: Date.now(), v: out });
    return out;
  }
}

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Resample an ascending {t,v} series onto `n` evenly spaced slots.
 *
 * `bridgeMinutes` closes gaps shorter than that span by linear interpolation.
 * Most visible breaks are sampling jitter — a sensor that writes every 5
 * minutes lands in only some of the slots — and drawing those as holes makes a
 * healthy channel look broken. A gap longer than the bridge is a real outage
 * and stays a hole, so a dead channel still reads as dead.
 */
export function resample(rows, n, start, end, opts = {}) {
  if (!rows.length) return new Array(n).fill(null);
  const t0 = start ?? rows[0].t;
  const t1 = end ?? rows[rows.length - 1].t;
  const span = t1 - t0 || 1;
  const out = new Array(n).fill(null);
  const acc = Array.from({ length: n }, () => []);
  for (const p of rows) {
    const i = Math.round(((p.t - t0) / span) * (n - 1));
    if (i >= 0 && i < n && p.v !== null) acc[i].push(p.v);
  }
  for (let i = 0; i < n; i++) {
    out[i] = acc[i].length ? acc[i].reduce((a, b) => a + b, 0) / acc[i].length : null;
  }

  const bridgeMinutes = opts.bridgeMinutes ?? DEFAULT_BRIDGE_MIN;
  if (!bridgeMinutes) return out;
  const slotMinutes = span / (n - 1 || 1) / 60000;
  return bridgeGaps(out, Math.max(1, Math.floor(bridgeMinutes / Math.max(slotMinutes, 0.0001))));
}

/** How much of a hole counts as jitter rather than an outage. */
const DEFAULT_BRIDGE_MIN = 20;

/**
 * Linearly fill interior runs of nulls no longer than `maxRun` slots. Leading
 * and trailing gaps are never invented, and a run longer than the limit stays
 * exactly as it is.
 */
export function bridgeGaps(arr, maxRun) {
  if (!maxRun || maxRun < 1) return arr;
  const out = arr.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i] !== null) { i++; continue; }
    const gapStart = i;
    while (i < out.length && out[i] === null) i++;
    const before = gapStart - 1, after = i;
    const runLength = i - gapStart;
    if (before < 0 || after >= out.length || runLength > maxRun) continue;
    const a = out[before], b = out[after];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    for (let k = 0; k < runLength; k++) {
      out[gapStart + k] = a + ((b - a) * (k + 1)) / (runLength + 1);
    }
  }
  return out;
}

/** Fill interior nulls by linear interpolation; leading/trailing gaps stay null. */
export function interpolate(arr) {
  const out = arr.slice();
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === null) continue;
    if (last >= 0 && i - last > 1) {
      const a = out[last], b = out[i];
      for (let k = last + 1; k < i; k++) out[k] = a + ((b - a) * (k - last)) / (i - last);
    }
    last = i;
  }
  return out;
}
