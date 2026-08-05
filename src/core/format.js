/** Number/duration/age formatting and the dual-range bar geometry. */

export const num = (s) => {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (s === 'unknown' || s === 'unavailable' || s === '' || s === 'none') return null;
  const v = Number(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

/** Missing data says so in words. A dash reads like a value; "no data" cannot. */
export const NO_DATA = 'no data';

export function fmt(v, d) {
  if (v === null || v === undefined || Number.isNaN(v)) return NO_DATA;
  const n = Number(v);
  if (!Number.isFinite(n)) return NO_DATA;
  const dec = d === undefined
    ? (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : Math.abs(n) >= 1 ? 2 : 3)
    : d;
  return n.toFixed(dec).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** "12 min", "3 h", "8 d" — how old a reading is. */
export function age(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return NO_DATA;
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min';
  const hr = Math.floor(m / 60);
  if (hr < 48) return hr + ' h';
  const d = Math.floor(hr / 24);
  if (d < 60) return d + ' d';
  const mo = Math.floor(d / 30.44);
  return mo < 24 ? mo + ' mo' : Math.floor(d / 365.25) + ' y';
}

export function hhmm(mins) {
  if (mins === null || mins === undefined || !Number.isFinite(mins)) return NO_DATA;
  const m = Math.max(0, Math.round(mins));
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

export function clockOf(d) {
  if (!d) return NO_DATA;
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function dateOf(iso) {
  if (!iso) return NO_DATA;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(+d)) return String(iso).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Geometry for the reference/optimum bar. The bar auto-scales to whatever
 * range actually contains the value, so an out-of-reference marker stays on
 * screen instead of clipping to the edge.
 */
export function barGeom(v, refMin, refMax, optMin, optMax) {
  const has = (x) => x !== null && x !== undefined && Number.isFinite(x);
  if (!has(v)) return null;
  const los = [refMin, optMin, v].filter(has);
  const his = [refMax, optMax, v].filter(has);
  if (!los.length || !his.length) return null;
  let lo = Math.min(...los);
  let hi = Math.max(...his);
  const pad = (hi - lo) * 0.18 || Math.abs(v) * 0.2 || 1;
  lo -= pad; hi += pad;
  const pc = (x) => ((x - lo) / (hi - lo)) * 100;
  const seg = (a, b) => (has(a) && has(b) && b > a
    ? { l: pc(a).toFixed(1) + '%', w: Math.max(0, pc(b) - pc(a)).toFixed(1) + '%' }
    : { l: '0%', w: '0%' });
  return {
    ref: seg(refMin, refMax),
    opt: seg(optMin, optMax),
    mark: Math.max(0, Math.min(99.4, pc(v))).toFixed(1) + '%',
  };
}

/** Where a value sits: optimal → reference-but-suboptimal → out of reference. */
export function rangeStatus(v, refMin, refMax, optMin, optMax) {
  const has = (x) => x !== null && x !== undefined && Number.isFinite(x);
  if (!has(v)) return 'qual';
  const outRef = (has(refMin) && v < refMin) || (has(refMax) && v > refMax);
  if (outRef) return 'ref';
  const hasOpt = has(optMin) || has(optMax);
  if (!hasOpt) return 'in';
  const outOpt = (has(optMin) && v < optMin) || (has(optMax) && v > optMax);
  return outOpt ? 'opt' : 'in';
}

export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
export const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Pearson r over paired samples, ignoring rows where either side is missing. */
export function pearson(xs, ys) {
  const px = [], py = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) { px.push(xs[i]); py.push(ys[i]); }
  }
  const n = px.length;
  if (n < 3) return { r: null, n };
  const mx = mean(px), my = mean(py);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const a = px[i] - mx, b = py[i] - my;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  if (sxx === 0 || syy === 0) return { r: null, n };
  return { r: sxy / Math.sqrt(sxx * syy), n };
}

/** Ordinary least squares — used for the scatter regression line. */
export function linreg(xs, ys) {
  const px = [], py = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) { px.push(xs[i]); py.push(ys[i]); }
  }
  if (px.length < 2) return null;
  const mx = mean(px), my = mean(py);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < px.length; i++) { sxy += (px[i] - mx) * (py[i] - my); sxx += (px[i] - mx) ** 2; }
  if (!sxx) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

export function rolling(arr, win) {
  return arr.map((_, i) => {
    const w = arr.slice(Math.max(0, i - win + 1), i + 1).filter(Number.isFinite);
    return w.length ? mean(w) : null;
  });
}

export const localDay = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
