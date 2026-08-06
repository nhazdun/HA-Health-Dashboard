import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { panel, banner, emptyState } from '../core/ui.js';
import { fmt, mean, NO_DATA } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 12 — the lines everything else is coloured against.
 *
 * A target is only useful if it is yours, so every row is editable here and
 * the value persists across reloads. Scoring is deliberately strict: a row
 * whose current value cannot be read today is marked "no data" and is left
 * *out* of the count, because counting an unmeasured target as met is exactly
 * the comfortable lie this dashboard exists to avoid.
 */

const STORAGE_KEY = 'health-hub.targets.v1';

export const DEFAULT_TARGETS = {
  steps: 9000,
  padMin: 90,
  slouch: 20,
  carbs: 150,
  spikes: 0,
  sleep: 8,
  deep: 1.6,
  hrv: 55,
  bedT: 19,
  iqos: 0,
  water: 2500,
  co2: 800,
  pm25: 5,
};

export function loadTargets() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TARGETS };
    return { ...DEFAULT_TARGETS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_TARGETS };
  }
}

function saveTargets(t) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    // Private mode or a full quota. The targets still work for this session.
  }
}

export default {
  id: 'targets',
  label: 'Targets',
  title: 'Daily targets',
  question: 'What am I aiming for each day?',
  scale: 'per day',

  live(ctx) {
    const rows = buildRows(ctx).filter((r) => !r.skip);
    if (!rows.length) return { color: P.off, label: 'nothing measurable today' };
    const met = rows.filter((r) => r.met).length;
    const ratio = met / rows.length;
    return {
      color: ratio >= 0.7 ? P.good : ratio >= 0.4 ? P.warn : P.alert,
      label: `${met} of ${rows.length} met`,
    };
  },

  async load(ctx) {
    const { data } = ctx;
    // Sleep and HRV arrive as nightly snapshots; the rest are live counters.
    const ids = [E.ouraTotalSleep, E.ouraDeep, E.ouraSleepHrv].filter((id) => data.exists(id));
    const stats = ids.length ? await data.stats(ids, 2, 'day', ['max', 'mean']) : {};
    return { stats };
  },

  render(ctx) {
    const out = [];
    const rows = buildRows(ctx);
    const scored = rows.filter((r) => !r.skip);
    const met = scored.filter((r) => r.met).length;
    const pct = scored.length ? (met / scored.length) * 100 : 0;
    const color = pct >= 70 ? P.good : pct >= 40 ? P.warn : P.alert;

    out.push(banner('ONE DAY AT A TIME',
      'Set a target for each daily metric here. The other pages colour their values against these '
      + 'lines. Change one target at a time, otherwise you cannot read which change moved anything.',
      P.ref));

    // ---------------------------------------------------------------- summary
    out.push(h('div.hh-tsum', [
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, [
        h('span', { style: { fontSize: '11.5px', color: P.mut } }, 'Targets met today'),
        h('span.big', scored.length ? `${met} of ${scored.length}` : NO_DATA),
      ]),
      h('div.mid', [
        h('div.hh-tbar', h('i', { style: { width: `${pct.toFixed(0)}%`, background: color } })),
        h('span.note',
          `Scored against today, ${todayLabel()}. `
          + (rows.length - scored.length
            ? `${rows.length - scored.length} row${rows.length - scored.length === 1 ? '' : 's'} `
              + 'cannot be read today and stay out of the count. '
            : '')
          + 'A target sets the line the other pages colour against, so raise it only once the '
          + 'current value has held for a week.'),
      ]),
      h('button.hh-linkbtn', {
        type: 'button',
        onClick: () => {
          saveTargets({ ...DEFAULT_TARGETS });
          ctx.setState({ targets: { ...DEFAULT_TARGETS } });
        },
      }, 'Reset to defaults'),
    ]));

    // ----------------------------------------------------------------- groups
    const groups = [];
    for (const r of rows) {
      let g = groups.find((x) => x.title === r.group);
      if (!g) { g = { title: r.group, rows: [] }; groups.push(g); }
      g.rows.push(r);
    }

    if (!groups.length) {
      out.push(emptyState('No target metric has a source in this Home Assistant instance.'));
      return out;
    }

    for (const g of groups) {
      const gScored = g.rows.filter((r) => !r.skip);
      const gMet = gScored.filter((r) => r.met).length;
      out.push(h('div.hh-group', [
        h('div.hh-gh', [
          h('b', g.title),
          h('span', `${gMet} of ${gScored.length} met`
            + (gScored.length < g.rows.length
              ? `, ${g.rows.length - gScored.length} without data` : '')),
        ]),
        ...g.rows.map((r) => targetRow(ctx, r)),
      ]));
    }

    out.push(panel(
      'How scoring works',
      'A row is met when the current value is on the right side of its target: at or above for a '
      + '"higher is better" metric, at or below for a "lower is better" one. A row whose value cannot '
      + 'be read today shows why and is excluded from the count entirely — it is neither met nor '
      + 'missed, because nothing was measured.',
      `${scored.length} of ${rows.length} rows measurable today`,
      null,
    ));

    return out;
  },
};

// ------------------------------------------------------------------ the rows

function targetRow(ctx, r) {
  const set = (delta) => {
    const current = ctx.state.targets ? ctx.state.targets[r.key] : DEFAULT_TARGETS[r.key];
    const next = Math.max(r.min, Math.min(r.max, Number((current + delta).toFixed(2))));
    const targets = { ...(ctx.state.targets || DEFAULT_TARGETS), [r.key]: next };
    saveTargets(targets);
    ctx.setState({ targets });
  };

  return h('div.hh-trow', [
    h('span.lbl', [
      h('span', r.label),
      h('span.hh-info', { title: r.info, 'aria-label': r.info }, 'i'),
    ]),
    h('span.cur', { style: { color: r.curColor } }, [
      r.currentText,
      r.skip ? null : h('em', r.unit),
    ]),
    h('div.hh-step', [
      h('button', { type: 'button', title: 'lower the target', onClick: () => set(-r.step) }, '−'),
      h('span', `${fmt(r.goal)} ${r.unit}`),
      h('button', { type: 'button', title: 'raise the target', onClick: () => set(r.step) }, '+'),
    ]),
    h('div.hh-tbar', h('i', { style: { width: r.pct, background: r.barColor } })),
    h('span.st', { style: { color: r.barColor } }, r.status),
  ]);
}

/**
 * Every target with its current value read live. `dead` carries the reason a
 * value cannot be read, which is shown instead of a number and keeps the row
 * out of the score.
 */
function buildRows(ctx) {
  const { data } = ctx;
  const T = ctx.state.targets || loadTargets();
  const cgm = ctx.sourceState('nightscout');

  const slouch = data.val(E.slouchTime);
  const upright = data.val(E.uprightTime);
  const slouchPct = slouch !== null && upright !== null && slouch + upright > 0
    ? (slouch / (slouch + upright)) * 100 : null;

  const cgmDead = cgm.state === 'dead' || cgm.state === 'stale';
  const spec = [
    {
      group: 'Movement', key: 'steps', label: 'Steps on the treadmill', unit: 'steps',
      cur: data.val(E.padStepsDay), step: 500, min: 2000, max: 20000, dir: 'max',
      info: 'Steps counted by the treadmill. The treadmill is the ground truth for walking at the desk.',
    },
    {
      group: 'Movement', key: 'padMin', label: 'Minutes on the treadmill', unit: 'min',
      cur: data.val(E.padTimeDay) === null ? null : data.val(E.padTimeDay) * 60,
      step: 10, min: 20, max: 240, dir: 'max',
      info: 'Total time on the treadmill today.',
    },
    {
      group: 'Movement', key: 'slouch', label: 'Time slouched', unit: '%',
      cur: slouchPct, step: 5, min: 5, max: 60, dir: 'min',
      info: 'Share of the tracked day with the back above the slouch threshold, from Upright GO 2.',
    },
    {
      group: 'Metabolism', key: 'carbs', label: 'Carbohydrate', unit: 'g',
      cur: null, dead: 'today’s intake is summed per meal on the Metabolism page',
      step: 10, min: 60, max: 320, dir: 'min',
      info: 'Carbohydrate eaten in the day. The Foodwatch running totals never reset, so this row '
        + 'is scored only from meals logged today.',
    },
    {
      group: 'Metabolism', key: 'spikes', label: 'Spikes above 7.8', unit: 'spikes',
      cur: null, dead: cgmDead ? 'the CGM is not writing' : 'counted on the Metabolism page',
      step: 1, min: 0, max: 6, dir: 'min',
      info: 'Number of meals that pushed glucose above 7.8 mmol/L.',
    },
    {
      group: 'Sleep', key: 'sleep', label: 'Total sleep', unit: 'h',
      cur: data.val(E.ouraTotalSleep), step: 0.25, min: 5, max: 10, dir: 'max',
      info: 'Total time asleep. It is the strongest predictor of the morning fasting glucose.',
    },
    {
      group: 'Sleep', key: 'deep', label: 'Deep sleep', unit: 'h',
      cur: data.val(E.ouraDeep), step: 0.1, min: 0.8, max: 3, dir: 'max',
      info: 'Time in slow-wave sleep, when the body repairs tissue.',
    },
    {
      group: 'Sleep', key: 'hrv', label: 'HRV during sleep', unit: 'ms',
      cur: data.val(E.ouraSleepHrv), step: 5, min: 30, max: 90, dir: 'max',
      info: 'Heart rate variability across the night. It falls after alcohol, IQOS and alerts.',
    },
    {
      group: 'Sleep', key: 'bedT', label: 'Bedroom temperature', unit: '°C',
      cur: data.val(E.bedTemp), step: 0.5, min: 16, max: 26, dir: 'min',
      info: 'Air temperature in the bedroom. The optimum for slow-wave sleep is 17°C to 19°C.',
    },
    {
      group: 'Behaviour', key: 'iqos', label: 'IQOS sticks', unit: 'sticks',
      cur: data.val(E.iqosToday), step: 1, min: 0, max: 20, dir: 'min',
      info: 'Sticks used in the day. The count comes from a manual sync at ±15%.',
    },
    {
      group: 'Behaviour', key: 'water', label: 'Water', unit: 'mL',
      cur: data.val(E.waterToday), step: 250, min: 1000, max: 4000, dir: 'max',
      info: 'Water from the bottle. The bottle does not record water from other cups.',
    },
    {
      group: 'Environment', key: 'co2', label: 'CO₂ at the desk', unit: 'ppm',
      cur: data.val(E.deskCo2), step: 50, min: 400, max: 1200, dir: 'min',
      info: 'Carbon dioxide at the desk. Above 800 ppm focus drops.',
    },
    {
      group: 'Environment', key: 'pm25', label: 'PM2.5 in the bedroom', unit: 'µg/m³',
      cur: data.val(E.bedPm25), step: 1, min: 0, max: 30, dir: 'min',
      info: 'Fine dust in the bedroom. Particles under 2.5 µm reach the lungs and the blood.',
    },
  ];

  return spec.map((r) => {
    const goal = T[r.key];
    const unreadable = r.dead || !Number.isFinite(r.cur);
    if (unreadable) {
      const why = r.dead || 'no value in Home Assistant right now';
      return {
        ...r, goal, skip: true, met: false,
        currentText: NO_DATA, curColor: P.off,
        pct: '0%', barColor: P.off, status: 'no data',
        info: `${r.info} Reason it is unscored: ${why}.`,
      };
    }
    const met = r.dir === 'max' ? r.cur >= goal : r.cur <= goal;
    const ratio = r.dir === 'max'
      ? Math.min(1, goal ? r.cur / goal : 1)
      : (r.cur <= goal ? 1 : Math.max(0.06, goal / r.cur));
    const barColor = met ? P.good : ratio > 0.7 ? P.warn : P.alert;
    const gap = r.dir === 'max' ? goal - r.cur : r.cur - goal;
    return {
      ...r, goal, skip: false, met,
      currentText: fmt(r.cur),
      curColor: met ? P.ink : barColor,
      pct: `${(ratio * 100).toFixed(0)}%`,
      barColor,
      status: met ? 'met' : `${fmt(gap)} ${r.dir === 'max' ? 'short' : 'over'}`,
    };
  });
}

function todayLabel() {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export { mean };
