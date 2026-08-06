import { h } from '../core/dom.js';
import { P, MONO } from '../core/tokens.js';
import { fmt } from '../core/format.js';

/**
 * SVG chart primitives. Every one of them treats `null` as a genuine gap:
 * lines break, cells stay empty, points are dropped. Never interpolate a hole
 * into a value — a missing reading and a zero reading mean different things.
 */

const svg = (w, hgt, kids, extra) =>
  h('svg', { viewBox: `0 0 ${w} ${hgt}`, ...(extra || {}) }, kids);

function scale(min, max) {
  const span = (max - min) || 1;
  return (v) => (v - min) / span;
}

/** Split a series into contiguous runs of non-null values. */
function runs(pts) {
  const out = [];
  let cur = null;
  pts.forEach((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(v)) { cur = null; return; }
    if (!cur) { cur = []; out.push(cur); }
    cur.push({ i, v });
  });
  return out;
}

/**
 * Multi-series time chart with percentile bands, threshold lines and a shared
 * annotation layer (alerts, meals, IQOS...).
 */
export function lineChart(o) {
  const w = o.w || 940, hgt = o.h || 220;
  const pad = o.pad || [10, 14, 24, 44];
  const iw = w - pad[3] - pad[1], ih = hgt - pad[0] - pad[2];
  const sy = scale(o.yMin, o.yMax);
  const Y = (v) => pad[0] + ih - Math.max(0, Math.min(1, sy(v))) * ih;
  const kids = [];

  (o.yTicks || []).forEach((t, i) => {
    kids.push(h('line', { x1: pad[3], x2: w - pad[1], y1: Y(t), y2: Y(t), stroke: P.ruleSoft, strokeWidth: 1 }));
    kids.push(h('text', {
      x: pad[3] - 7, y: Y(t) + 3.5, textAnchor: 'end', fill: P.off, fontSize: 9, fontFamily: MONO,
    }, fmt(t, o.tickDec)));
  });

  (o.bands || []).filter(Boolean).forEach((b) => {
    const n = b.lo.length;
    const X = (i) => pad[3] + (n > 1 ? i / (n - 1) : 0) * iw;
    const pairs = [];
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(b.lo[i]) && Number.isFinite(b.hi[i])) pairs.push(i);
    }
    if (pairs.length < 2) return;
    const top = pairs.map((i) => `${X(i).toFixed(1)},${Y(b.hi[i]).toFixed(1)}`).join('L');
    const bot = pairs.slice().reverse().map((i) => `${X(i).toFixed(1)},${Y(b.lo[i]).toFixed(1)}`).join('L');
    kids.push(h('path', { d: `M${top}L${bot}Z`, fill: b.color, opacity: b.op ?? 0.22, stroke: 'none' }));
  });

  (o.thresholds || []).forEach((t) => {
    kids.push(h('line', {
      x1: pad[3], x2: w - pad[1], y1: Y(t.v), y2: Y(t.v),
      stroke: t.color || P.off, strokeWidth: 1, strokeDasharray: '4 4',
    }));
    if (t.label) {
      kids.push(h('text', {
        x: w - pad[1] - 2, y: Y(t.v) - 4, textAnchor: 'end',
        fill: t.color || P.off, fontSize: 9, fontFamily: MONO,
      }, t.label));
    }
  });

  if (o.showEvents !== false) {
    (o.events || []).forEach((ev) => {
      const x = pad[3] + Math.max(0, Math.min(1, ev.at)) * iw;
      kids.push(h('line', {
        x1: x, x2: x, y1: pad[0], y2: hgt - pad[2],
        stroke: ev.color || P.off, strokeWidth: 1, strokeDasharray: '2 3', opacity: 0.7,
      }));
      if (ev.label) {
        kids.push(h('text', {
          x: x + 3, y: pad[0] + 9, fill: ev.color || P.off, fontSize: 8.5, fontFamily: MONO,
        }, ev.label));
      }
    });
  }

  (o.series || []).forEach((s) => {
    const n = s.pts.length;
    const frac = s.frac === undefined ? 1 : s.frac;
    const X = (i) => pad[3] + (n > 1 ? i / (n - 1) : 0) * iw * frac;
    const segs = runs(s.pts);
    segs.forEach((seg) => {
      const d = 'M' + seg.map((p) => `${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('L');
      if (s.fill && seg.length > 1) {
        kids.push(h('path', {
          d: `${d}L${X(seg[seg.length - 1].i).toFixed(1)},${Y(o.yMin)}L${X(seg[0].i).toFixed(1)},${Y(o.yMin)}Z`,
          fill: s.color, opacity: 0.1, stroke: 'none',
        }));
      }
      if (seg.length === 1) {
        kids.push(h('circle', { cx: X(seg[0].i), cy: Y(seg[0].v), r: 2, fill: s.color, opacity: s.op ?? 1 }));
      } else {
        kids.push(h('path', {
          d, fill: 'none', stroke: s.color, strokeWidth: s.w || 1.6,
          strokeDasharray: s.dash || null, strokeLinejoin: 'round', opacity: s.op ?? 1,
        }));
      }
    });
    if (s.dot && segs.length) {
      const last = segs[segs.length - 1];
      const p = last[last.length - 1];
      kids.push(h('circle', { cx: X(p.i), cy: Y(p.v), r: 3, fill: s.color }));
    }
  });

  (o.xLabels || []).forEach((l, i, a) => {
    const x = pad[3] + (a.length > 1 ? i / (a.length - 1) : 0) * iw;
    kids.push(h('text', {
      x, y: hgt - pad[2] + 13,
      textAnchor: i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle',
      fill: P.off, fontSize: 9, fontFamily: MONO,
    }, l));
  });

  return svg(w, hgt, kids);
}

export function scatterChart(o) {
  const w = o.w || 440, hgt = o.h || 240;
  const pad = o.pad || [12, 14, 30, 44];
  const iw = w - pad[3] - pad[1], ih = hgt - pad[0] - pad[2];
  const X = (v) => pad[3] + ((v - o.xMin) / ((o.xMax - o.xMin) || 1)) * iw;
  const Y = (v) => pad[0] + ih - ((v - o.yMin) / ((o.yMax - o.yMin) || 1)) * ih;
  const kids = [];

  [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
    kids.push(h('line', {
      x1: pad[3], x2: w - pad[1], y1: pad[0] + ih * f, y2: pad[0] + ih * f,
      stroke: P.ruleSoft, strokeWidth: 1,
    }));
    kids.push(h('text', {
      x: pad[3] - 6, y: pad[0] + ih * f + 3.5, textAnchor: 'end', fill: P.off,
      fontSize: 9, fontFamily: MONO,
    }, fmt(o.yMax - (o.yMax - o.yMin) * f)));
  });

  (o.hlines || []).forEach((l) => {
    kids.push(h('line', {
      x1: pad[3], x2: w - pad[1], y1: Y(l.v), y2: Y(l.v),
      stroke: l.color, strokeWidth: 1, strokeDasharray: l.dash || '5 4',
    }));
    kids.push(h('text', {
      x: w - pad[1], y: Y(l.v) - 4, textAnchor: 'end', fill: l.color, fontSize: 8.5, fontFamily: MONO,
    }, l.label));
  });

  (o.reg || []).forEach((r) => {
    kids.push(h('line', {
      x1: X(o.xMin), y1: Y(r.a + r.b * o.xMin), x2: X(o.xMax), y2: Y(r.a + r.b * o.xMax),
      stroke: r.color, strokeWidth: 1.8, opacity: 0.85,
    }));
  });

  o.pts.forEach((p) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    kids.push(h('circle', {
      cx: X(p.x), cy: Y(p.y), r: p.r || 3.2, fill: p.c || P.self,
      opacity: 0.72, stroke: P.surf, strokeWidth: 0.8,
    }, p.title ? h('title', p.title) : null));
  });

  if (o.xLabel) {
    kids.push(h('text', {
      x: pad[3] + iw / 2, y: hgt - 6, textAnchor: 'middle', fill: P.mut, fontSize: 9.5, fontFamily: MONO,
    }, o.xLabel));
  }
  [o.xMin, (o.xMin + o.xMax) / 2, o.xMax].forEach((v, i) => {
    kids.push(h('text', {
      x: X(v), y: hgt - pad[2] + 13, textAnchor: i === 0 ? 'start' : i === 2 ? 'end' : 'middle',
      fill: P.off, fontSize: 9, fontFamily: MONO,
    }, fmt(v)));
  });
  return svg(w, hgt, kids);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * A real calendar, not an abstract grid: columns are weeks, rows are weekdays,
 * month boundaries are labelled and every cell knows its own date. Hovering a
 * cell tells you which day it is, which the old anonymous grid could not.
 *
 * `values` is one entry per day ending at `end`; `null` means the day has no
 * data and renders as an outlined hole rather than as a low value.
 */
export function calendarChart(o) {
  const vals = o.values;
  const n = vals.length;
  const end = o.end ? new Date(o.end) : new Date();
  end.setHours(12, 0, 0, 0);

  const days = vals.map((v, i) => {
    const d = new Date(end);
    d.setDate(d.getDate() - (n - 1 - i));
    return { v, d, dow: (d.getDay() + 6) % 7 };
  });
  const lead = days.length ? days[0].dow : 0;
  const cols = Math.ceil((lead + n) / 7);
  const cw = o.cw || 15, gap = 3, left = 34, top = 18;
  const w = left + cols * (cw + gap) + 4;
  const hgt = top + 7 * (cw + gap) + 34;
  const kids = [];

  DOW.forEach((l, i) => {
    if (i % 2) return;
    kids.push(h('text', {
      x: left - 6, y: top + i * (cw + gap) + 11, textAnchor: 'end',
      fill: P.off, fontSize: 8.5, fontFamily: MONO,
    }, l));
  });

  let lastMonth = -1;
  days.forEach((day, i) => {
    const col = Math.floor((lead + i) / 7);
    if (day.d.getMonth() !== lastMonth && day.dow <= 3) {
      lastMonth = day.d.getMonth();
      kids.push(h('text', {
        x: left + col * (cw + gap), y: top - 6, fill: P.mut, fontSize: 9, fontFamily: MONO,
      }, MONTHS[day.d.getMonth()]));
    }
    const empty = day.v === null || day.v === undefined;
    kids.push(h('rect', {
      x: left + col * (cw + gap), y: top + day.dow * (cw + gap),
      width: cw, height: cw, rx: 3,
      fill: empty ? P.bg : o.color(day.v),
      stroke: i === n - 1 ? P.ink : (empty ? P.rule : 'none'),
      strokeWidth: i === n - 1 ? 1.4 : 1,
    }, h('title', `${DOW[day.dow]}, ${MONTHS[day.d.getMonth()]} ${day.d.getDate()}: `
      + (empty ? 'no data' : o.label(day.v)))));
  });

  const ly = top + 7 * (cw + gap) + 16;
  kids.push(h('text', { x: left, y: ly + 9, fill: P.off, fontSize: 8.5, fontFamily: MONO }, o.legendLow));
  (o.scale || []).forEach((c, i) => kids.push(h('rect', {
    x: left + 76 + i * (cw + 3), y: ly, width: cw, height: cw - 3, rx: 2.5, fill: c,
  })));
  kids.push(h('text', {
    x: left + 76 + (o.scale || []).length * (cw + 3) + 6, y: ly + 9,
    fill: P.off, fontSize: 8.5, fontFamily: MONO,
  }, o.legendHigh));

  return svg(w, hgt, kids, { style: `width:100%;max-width:${Math.round(w * 1.25)}px` });
}

/** Legacy heatmap. `cells[i].color === null` renders as an explicit gap. */
export function heatmap(o) {
  const cw = o.cw || 13, ch = o.ch || 13, gap = 2.5, left = o.left ?? 52;
  const w = o.cols * (cw + gap) + left + 6;
  const hgt = o.rows * (ch + gap) + 18;
  const kids = [];
  o.cells.forEach((c) => {
    kids.push(h('rect', {
      x: left + c.x * (cw + gap), y: c.y * (ch + gap), width: cw, height: ch, rx: 2.5,
      fill: c.color === null ? P.s2 : c.color,
      opacity: c.color === null ? 0.5 : (c.op ?? 1),
      stroke: c.color === null ? P.ruleSoft : 'none', strokeWidth: 1,
    }, c.title ? h('title', c.title) : null));
  });
  (o.labels || []).forEach((l, i) => {
    kids.push(h('text', {
      x: left - 6, y: i * (ch + gap) + 9.5, textAnchor: 'end', fill: P.off, fontSize: 8.5, fontFamily: MONO,
    }, l));
  });
  (o.xLabels || []).forEach((l) => {
    kids.push(h('text', {
      x: left + l.at * (cw + gap), y: hgt - 4, fill: P.off, fontSize: 8.5, fontFamily: MONO,
    }, l.t));
  });
  return svg(w, hgt, kids);
}

/** 30px inline sparkline for cards. */
export function spark(pts, color, dashed) {
  const w = 200, hgt = 30;
  const vals = pts.filter((v) => Number.isFinite(v));
  if (vals.length < 2) {
    return h('div', {
      style: {
        height: '30px', display: 'flex', alignItems: 'center', fontFamily: MONO,
        fontSize: '9.5px', color: P.off,
      },
    }, 'series not long enough yet');
  }
  const mn = Math.min(...vals), mx = Math.max(...vals), r = (mx - mn) || 1;
  const Y = (v) => hgt - 2 - ((v - mn) / r) * (hgt - 6);
  const X = (i) => (i / (pts.length - 1)) * w;
  const segs = runs(pts);
  const kids = [];
  segs.forEach((seg) => {
    if (seg.length < 2) return;
    const d = 'M' + seg.map((p) => `${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('L');
    kids.push(h('path', {
      d: `${d}L${X(seg[seg.length - 1].i).toFixed(1)},${hgt}L${X(seg[0].i).toFixed(1)},${hgt}Z`,
      fill: color, opacity: 0.08, stroke: 'none',
    }));
    kids.push(h('path', {
      d, fill: 'none', stroke: color, strokeWidth: 1.5,
      strokeDasharray: dashed ? '3 3' : null, opacity: dashed ? 0.5 : 1,
    }));
  });
  return svg(w, hgt, kids, { preserveAspectRatio: 'none', style: 'height:30px' });
}

/** Horizontal lanes on a shared time axis — the day ribbon and coverage bars. */
export function laneChart(o) {
  const w = o.w || 940;
  const rowH = o.rowH || 26;
  const hgt = o.lanes.length * rowH + 24;
  const pad = o.labelWidth || 118;
  const noteW = o.noteWidth || 0;
  const iw = w - pad - 14 - noteW;
  const kids = [];
  o.lanes.forEach((lane, i) => {
    const y = i * rowH + 6;
    const barH = rowH - 8;
    kids.push(h('text', { x: 0, y: y + barH - 4, fill: P.mut, fontSize: 10.5, fontFamily: MONO }, lane.label));
    kids.push(h('rect', { x: pad, y, width: iw, height: barH, rx: 3, fill: P.s3 }));
    (lane.segs || []).forEach(([a, b]) => {
      const x0 = pad + Math.max(0, Math.min(1, a)) * iw;
      const x1 = pad + Math.max(0, Math.min(1, b)) * iw;
      kids.push(h('rect', {
        x: x0, y, width: Math.max(2.5, x1 - x0), height: barH, rx: 3,
        fill: lane.color, opacity: 0.85,
      }, lane.title ? h('title', lane.title) : null));
    });
    if (lane.note) {
      kids.push(h('text', {
        x: pad + iw + 8, y: y + barH - 4, fill: P.off, fontSize: 9, fontFamily: MONO,
      }, lane.note));
    }
  });
  (o.xLabels || []).forEach((t, i, a) => {
    kids.push(h('text', {
      x: pad + iw * (i / (a.length - 1)), y: hgt - 6,
      textAnchor: i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle',
      fill: P.off, fontSize: 9, fontFamily: MONO,
    }, t));
  });
  return svg(w, hgt, kids);
}

/** Stacked vertical bars — the 30-night sleep-stage ribbon. */
export function stackChart(o) {
  const w = o.w || 940, hgt = o.h || 190, pad = 34;
  const iw = w - pad - 14;
  const bw = iw / Math.max(1, o.stacks.length);
  const k = (hgt - 40) / (o.yMax || 10);
  const kids = [];
  (o.yTicks || []).forEach((t) => {
    const y = hgt - 24 - t * k;
    kids.push(h('line', { x1: pad, x2: w - 14, y1: y, y2: y, stroke: P.ruleSoft, strokeWidth: 1 }));
    kids.push(h('text', {
      x: pad - 6, y: y + 3.5, textAnchor: 'end', fill: P.off, fontSize: 9, fontFamily: MONO,
    }, t + (o.yUnit || '')));
  });
  o.stacks.forEach((stack, i) => {
    let y = hgt - 24;
    if (!stack || !stack.parts || !stack.parts.length) {
      kids.push(h('rect', {
        x: pad + i * bw, y: hgt - 26, width: Math.max(1, bw - 2), height: 2, fill: P.s2,
      }, h('title', (stack && stack.title) || 'no data')));
      return;
    }
    stack.parts.forEach(([v, c]) => {
      if (!Number.isFinite(v) || v <= 0) return;
      const hh = v * k;
      y -= hh;
      kids.push(h('rect', {
        x: pad + i * bw, y, width: Math.max(1, bw - 2), height: Math.max(1, hh), fill: c,
      }, stack.title ? h('title', stack.title) : null));
    });
  });
  (o.xLabels || []).forEach((t, i, a) => {
    kids.push(h('text', {
      x: pad + iw * (i / (a.length - 1)), y: hgt - 6,
      textAnchor: i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle',
      fill: P.off, fontSize: 9, fontFamily: MONO,
    }, t));
  });
  return svg(w, hgt, kids);
}

/** Correlation matrix. Cells below the n threshold are left blank, not grey-filled. */
export function matrixChart(o) {
  const n = o.labels.length, cw = o.cw || 30, off = o.off || 108;
  const w = off + n * cw + 8, hgt = off + n * cw + 8;
  const kids = [];
  o.labels.forEach((m, i) => {
    kids.push(h('text', {
      x: off - 6, y: off + i * cw + cw / 2 + 3.5, textAnchor: 'end', fill: P.mut,
      fontSize: 9, fontFamily: MONO,
    }, m));
    const cx = off + i * cw + cw / 2;
    kids.push(h('text', {
      x: cx, y: off - 8, fill: P.mut, fontSize: 9, fontFamily: MONO,
      transform: `rotate(-52 ${cx} ${off - 8})`, textAnchor: 'start',
    }, m));
  });
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = o.cell(i, j);
      const selected = o.selected && o.selected[0] === i && o.selected[1] === j;
      kids.push(h('rect', {
        x: off + j * cw, y: off + i * cw, width: cw - 2, height: cw - 2, rx: 3,
        fill: cell.color === null ? P.bg : cell.color,
        opacity: cell.color === null ? 1 : cell.op,
        stroke: selected ? P.ink : (cell.color === null ? P.ruleSoft : 'none'),
        strokeWidth: 1.5,
        style: { cursor: 'pointer' },
        onClick: () => o.onPick && o.onPick(i, j),
      }, h('title', cell.title)));
    }
  }
  return svg(w, hgt, kids);
}
