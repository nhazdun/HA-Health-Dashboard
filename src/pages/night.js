import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart, stackChart } from '../charts/svg.js';
import { resample, dayKey } from '../core/ha.js';
import { loadEvents, eventsFor } from '../core/events.js';
import { controlPanel, sleepControls } from '../core/controls.js';
import { fmt, age, hhmm, clockOf, median } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 2 — one night, two independent sources.
 *
 * Oura (accelerometer + PPG) and Muse (EEG) are never collapsed into a single
 * score. They measure different physiology; the delta between them is itself
 * the metric.
 */

const NIGHTS = 30;

export default {
  id: 'night',
  label: 'Ніч',
  title: 'Ніч',
  question: 'Як я спав і чому саме так?',
  scale: 'одна ніч',

  live(ctx) {
    const oura = ctx.sourceState('oura');
    const muse = ctx.sourceState('muse');
    if (oura.state === 'dead' && muse.state === 'dead') return { color: P.alert, label: 'обидва джерела мовчать' };
    if (muse.state === 'dead') return { color: P.warn, label: 'ЕЕГ-канал зник' };
    return { color: P.ref, label: 'нічні дані приходять зранку' };
  },

  async load(ctx) {
    const { data } = ctx;
    const win = sleepWindow(data);
    const hours = win ? Math.max(6, (win.end - win.start) / 3600e3 + 1) : 12;
    const envOpts = win ? { start: win.start - 1800e3, end: win.end + 1800e3 } : {};

    const [temp, co2, pm25, noise, hum, evts, dailyStages] = await Promise.all([
      data.series(E.bedTemp, hours, envOpts),
      data.series(E.bedCo2, hours, envOpts),
      data.series(E.bedPm25, hours, envOpts),
      data.series(E.bedNoise, hours, envOpts),
      data.series(E.bedHum, hours, envOpts),
      loadEvents(ctx, Math.max(hours, 24)),
      loadNightlyStages(data, NIGHTS),
    ]);
    return { win, temp, co2, pm25, noise, hum, evts, dailyStages };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];
    const oura = ctx.sourceState('oura');
    const muse = ctx.sourceState('muse');

    // Both sources report awake time. The gap between them is the story.
    const ouraAwake = data.val(E.ouraAwake);
    const museAwake = data.val(E.museAwake);
    if (ouraAwake !== null && museAwake !== null) {
      const d = Math.abs(ouraAwake - museAwake);
      out.push(banner('ДВА ДЖЕРЕЛА',
        `Muse показує ${fmt(museAwake, 0)} хв неспання, Oura — ${fmt(ouraAwake, 0)} хв. `
        + `Розбіжність ${fmt(d, 0)} хв. Жодне з них не зламане: акселерометр рахує рух, ЕЕГ бачить кору. `
        + 'Канали лишаються окремими і ніколи не зводяться в один бал.', P.ref));
    } else if (muse.state === 'dead' || !data.exists(E.museDeep)) {
      out.push(banner('ОДНЕ ДЖЕРЕЛО',
        'ЕЕГ-канал Muse недоступний — залишається лише акселерометрична оцінка Oura. '
        + 'Порівняння Bland–Altman (E12) без другого джерела неможливе.', P.warn));
    }

    // --------------------------------------------------------------- control
    const sleep = controlPanel(ctx, sleepControls(ctx));
    if (sleep) out.push(sleep);

    // ----------------------------------------------------------------- cards
    const cards = [];
    const nightMetrics = [
      ['Загальний сон', E.ouraTotalSleep, 'год', 2, { optMin: 7, optMax: 9 }],
      ['Глибокий сон', E.ouraDeep, 'год', 2, { optMin: 1.2, optMax: 2.5 }],
      ['Глибокий, %', E.ouraDeepPct, '%', 1, { optMin: 16, optMax: 30 }],
      ['REM', E.ouraRem, 'год', 2, { optMin: 1.2, optMax: 2.2 }],
      ['REM, %', E.ouraRemPct, '%', 1, { optMin: 18, optMax: 28 }],
      ['Ефективність', E.ouraEff, '%', 0, { optMin: 85, optMax: 100 }],
      ['Латентність', E.ouraLatency, 'хв', 0, { optMin: 0, optMax: 20 }],
      ['Найнижчий пульс', E.ouraLowestHr, 'уд/хв', 0, { optMin: 45, optMax: 60 }],
    ];
    for (const [label, id, unit, dec, ranges] of nightMetrics) {
      cards.push(entityCard(ctx, {
        label, entity: id, unit, dec, ranges, size: '24px',
        srcState: oura.state,
        ageText: 'ранок',
        source: 'Oura · нічний зріз',
        emptyHint: 'Oura ще не віддала цю ніч',
      }));
    }

    cards.push(entityCard(ctx, {
      label: 'Глибокий сон · ЕЕГ', entity: E.museDeep, unit: 'год', dec: 2, size: '24px',
      srcState: muse.state,
      delta: deltaVs(data.val(E.museDeep), data.val(E.ouraDeep), 'Oura', 'год'),
      deltaColor: P.ref,
      source: 'Muse S · дельта-активність',
    }));
    cards.push(entityCard(ctx, {
      label: 'Пікова частота альфа', entity: E.museApf, unit: 'Гц', dec: 2, size: '24px',
      srcState: muse.state,
      ranges: { optMin: 9, optMax: 11 },
      delta: baselineDelta(data.val(E.museApf), data.val(E.museApfBase), 'база'),
      source: 'Muse S',
    }));
    cards.push(entityCard(ctx, {
      label: 'Температура спальні', entity: E.bedTemp, unit: '°C', dec: 1, size: '24px',
      srcState: ctx.sourceState('qp_bed').state,
      ranges: { refMin: 16, refMax: 24, optMin: 17, optMax: 19 },
      delta: tempDelta(data.val(E.bedTemp)),
      deltaColor: (data.val(E.bedTemp) ?? 0) > 21 ? P.alert : P.good,
      source: 'Qingping 7fc5',
    }));

    const subDays = data.val(E.museSubDays);
    cards.push(entityCard(ctx, {
      label: 'Підписка Muse', entity: E.museSubDays, unit: 'днів', dec: 0, size: '24px',
      srcState: subDays !== null && subDays <= 3 ? 'low' : muse.state,
      delta: subDays !== null && subDays <= 3
        ? 'на нулі ЕЕГ-канал зникає' : 'незалежне джерело живе',
      deltaColor: subDays !== null && subDays <= 3 ? P.alert : P.good,
      source: 'Muse S',
      note: subDays !== null && subDays <= 3 ? 'домен під загрозою' : null,
    }));

    out.push(h('div.hh-cards', cards));

    // -------------------------------------------------- two-source comparison
    const stages = [
      ['Глибокий', data.val(E.ouraDeep), toHours(data.val(E.museDeep), 'h'), P.stage.deep],
      ['REM', data.val(E.ouraRem), toHours(data.val(E.museRem), 'min'), P.stage.rem],
      ['Поверхневий', data.val(E.ouraLight), toHours(data.val(E.museLight), 'min'), P.stage.light],
      ['Неспання', toHours(data.val(E.ouraAwake), 'min'), toHours(data.val(E.museAwake), 'min'), P.stage.awake],
    ];
    const hasCompare = stages.some(([, a, b]) => a !== null || b !== null);
    out.push(panel(
      'Oura проти Muse — стадії цієї ночі',
      'Дві незалежні оцінки однієї ночі поруч. Різниця по кожній стадії підписана окремо: '
      + 'це і є метрика узгодженості джерел (гіпотеза E12), а не привід усереднити їх.',
      'зліва Oura · справа Muse',
      hasCompare ? compareBars(stages) : emptyState(
        'Жодне з джерел ще не віддало стадії за цю ніч. Oura пише вранці, Muse — з лагом до 20 годин.',
      ),
    ));

    // ------------------------------------------------------- environment
    const win = pd.win;
    if (win && (pd.temp.length || pd.co2.length)) {
      const s = win.start, e = win.end;
      const co2Peak = pd.co2.length ? Math.max(...pd.co2.map((p) => p.v)) : null;
      const tempPts = resample(pd.temp, 96, s, e);
      const tempVals = tempPts.filter(Number.isFinite);

      out.push(panel(
        'Середовище спальні за вікно сну',
        `Вікно ${clockOf(new Date(s))} → ${clockOf(new Date(e))} взяте з Oura bedtime_start/end. `
        + (co2Peak !== null
          ? `Піковий CO₂ за ніч ${fmt(co2Peak, 0)} ppm ${co2Peak > 900 ? '— вище порогу фрагментації 900' : '— нижче порогу 900'}. `
          : '')
        + 'Температура — тепла вісь (власні умови), CO₂ — холодна.',
        'T °C · CO₂ ppm · PM2.5',
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 230,
            yMin: tempVals.length ? Math.floor(Math.min(...tempVals) - 1) : 15,
            yMax: tempVals.length ? Math.ceil(Math.max(...tempVals) + 1) : 30,
            yTicks: tempTicks(tempVals),
            xLabels: clockLabels(s, e, 5),
            series: [{ pts: tempPts, color: ctx.accent, w: 1.8 }],
            thresholds: [
              { v: 19, color: P.good, label: 'верх оптимуму 19°' },
              { v: 17, color: P.ref, label: 'низ 17°' },
            ],
            events: eventsFor(pd.evts, s, e, ctx),
            showEvents: ctx.state.annotations,
          }),
          lineChart({
            h: 170, pad: [10, 14, 22, 44],
            yMin: 350, yMax: Math.max(1000, co2Peak ? Math.ceil(co2Peak * 1.1) : 1000),
            yTicks: [400, 600, 800, 1000],
            xLabels: clockLabels(s, e, 5),
            series: [
              { pts: resample(pd.co2, 96, s, e), color: P.ref, fill: true, w: 1.6 },
              { pts: resample(pd.pm25, 96, s, e).map((v) => (v === null ? null : 350 + v * 12)), color: ctx.accent, w: 1.4 },
            ],
            thresholds: [{ v: 900, color: P.warn, label: 'фрагментація 900' }],
            events: eventsFor(pd.evts, s, e, ctx, ['iqos', 'alert']),
            showEvents: ctx.state.annotations,
          }),
          legendRow([
            { color: ctx.accent, label: 'температура / PM2.5 (масштабовано)' },
            { color: P.ref, label: 'CO₂ ppm' },
          ]),
        ]),
      ));
    } else {
      out.push(panel('Середовище спальні за вікно сну',
        'Вікно сну беремо з Oura bedtime_start/bedtime_end.', '',
        emptyState('Oura не віддала межі сну за цю ніч, тому вікно не визначене. '
          + 'Ряди Qingping існують, але немає, до чого їх прив’язати.')));
    }

    // ---------------------------------------------------- 30-night ribbon
    const stacks = pd.dailyStages;
    const filled = stacks.filter((s) => s && s.parts && s.parts.length).length;
    out.push(panel(
      `Стрічка ${NIGHTS} ночей`,
      `Кожна ніч — один вертикальний стек стадій із довгострокової статистики Oura. `
      + `${filled} із ${NIGHTS} ночей мають дані; порожні позиції — ночі без кільця, і вони лишаються порожніми.`,
      'глибокий · REM · поверхневий · неспання',
      filled
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          stackChart({
            h: 200, stacks, yMax: 10, yTicks: [0, 2, 4, 6, 8], yUnit: ' год',
            xLabels: [`−${NIGHTS} д`, `−${Math.round(NIGHTS * 0.66)}`, `−${Math.round(NIGHTS * 0.33)}`, 'сьогодні'],
          }),
          legendRow([
            { color: P.stage.deep, label: 'глибокий' },
            { color: P.stage.rem, label: 'REM' },
            { color: P.stage.light, label: 'поверхневий' },
            { color: P.stage.awake, label: 'неспання' },
          ]),
        ])
        : emptyState('Довгострокова статистика по стадіях сну ще не накопичилась.'),
    ));

    return out;
  },
};

// ------------------------------------------------------------------ helpers

function sleepWindow(data) {
  const s = data.raw(E.ouraBedStart) || data.raw(E.museStart);
  const e = data.raw(E.ouraBedEnd) || data.raw(E.museEnd);
  if (!s || !e) return null;
  const start = new Date(s).getTime(), end = new Date(e).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/** Oura durations arrive in hours, Muse in minutes — normalise before comparing. */
function toHours(v, unit) {
  if (v === null || v === undefined) return null;
  return unit === 'min' ? v / 60 : v;
}

function deltaVs(a, b, name, unit) {
  if (a === null || b === null) return '';
  const d = a - b;
  return `Δ ${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), 2)} ${unit} проти ${name}`;
}

function baselineDelta(v, base, label) {
  if (v === null || base === null) return '';
  const d = v - base;
  return Math.abs(d) < 0.02 ? `${label} ${fmt(base, 2)} — рівно` : `Δ ${d > 0 ? '+' : '−'}${fmt(Math.abs(d), 2)} до ${label}`;
}

function tempDelta(t) {
  if (t === null) return '';
  if (t > 19) return `+${fmt(t - 19, 1)}° над оптимумом 17–19`;
  if (t < 17) return `−${fmt(17 - t, 1)}° під оптимумом 17–19`;
  return 'в оптимумі 17–19';
}

function tempTicks(vals) {
  if (!vals.length) return [16, 20, 24, 28];
  const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  const step = Math.max(1, Math.round((hi - lo) / 4));
  return [lo, lo + step, lo + 2 * step, lo + 3 * step].filter((t) => t <= hi);
}

function clockLabels(start, end, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(start + ((end - start) * i) / (n - 1));
    out.push(clockOf(t));
  }
  return out;
}

function compareBars(stages) {
  const max = Math.max(0.5, ...stages.flatMap(([, a, b]) => [a || 0, b || 0]));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    stages.map(([label, a, b, color]) => {
      const d = a !== null && b !== null ? a - b : null;
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } }, [
        h('div', {
          style: {
            display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: P.mut,
          },
        }, [
          h('span', label),
          h('span', {
            style: { fontFamily: "'Geist Mono',monospace", fontSize: '10.5px', color: d === null ? P.off : P.ref },
          }, d === null ? 'одне джерело' : `Δ ${d >= 0 ? '+' : '−'}${fmt(Math.abs(d) * 60, 0)} хв`),
        ]),
        bar('Oura', a, max, color, false),
        bar('Muse', b, max, color, true),
      ]);
    }));
}

function bar(who, v, max, color, hatched) {
  return h('div', {
    style: { display: 'grid', gridTemplateColumns: '46px 1fr 62px', gap: '10px', alignItems: 'center' },
  }, [
    h('span', { style: { fontFamily: "'Geist Mono',monospace", fontSize: '9.5px', color: P.off } }, who),
    h('div', { style: { height: '12px', background: P.s2, borderRadius: '3px', overflow: 'hidden' } },
      v === null ? null : h('i', {
        style: {
          display: 'block', height: '12px', width: `${Math.max(1, (v / max) * 100).toFixed(1)}%`,
          background: color, borderRadius: '3px',
          opacity: hatched ? 0.55 : 1,
          backgroundImage: hatched
            ? 'repeating-linear-gradient(135deg,rgba(255,255,255,.55) 0 3px,transparent 3px 6px)' : null,
        },
      })),
    h('span', {
      style: {
        fontFamily: "'Geist Mono',monospace", fontSize: '10.5px', color: v === null ? P.off : P.ink,
        textAlign: 'right',
      },
    }, v === null ? 'немає' : `${fmt(v, 2)} год`),
  ]);
}

/** 30 nights of stage durations, straight from long-term statistics. */
async function loadNightlyStages(data, nights) {
  const ids = [E.ouraDeep, E.ouraRem, E.ouraLight, E.ouraAwake].filter((id) => data.exists(id));
  if (!ids.length) return new Array(nights).fill(null);
  const stats = await data.stats(ids, nights + 1, 'day', ['mean', 'max']);
  const byDay = new Map();
  for (const id of ids) {
    for (const row of stats[id] || []) {
      const k = dayKey(row.t);
      if (!byDay.has(k)) byDay.set(k, {});
      byDay.get(k)[id] = row.max ?? row.mean;
    }
  }
  const out = [];
  for (let i = nights - 1; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 86400e3);
    const rec = byDay.get(k);
    if (!rec) { out.push(null); continue; }
    const deep = rec[E.ouraDeep] ?? null;
    const rem = rec[E.ouraRem] ?? null;
    const light = rec[E.ouraLight] ?? null;
    const awake = rec[E.ouraAwake] !== undefined ? rec[E.ouraAwake] / 60 : null;
    const parts = [
      [awake, P.stage.awake], [light, P.stage.light], [rem, P.stage.rem], [deep, P.stage.deep],
    ].filter(([v]) => Number.isFinite(v) && v > 0);
    const total = parts.reduce((s, [v]) => s + v, 0);
    out.push(parts.length
      ? { parts, title: `${k} · ${fmt(total, 2)} год, глибокий ${fmt(deep, 2)}` }
      : null);
  }
  return out;
}

export { median };
