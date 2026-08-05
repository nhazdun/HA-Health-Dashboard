import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart, laneChart } from '../charts/svg.js';
import { dayKey } from '../core/ha.js';
import { loadEvents } from '../core/events.js';
import { fmt, age, clockOf } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 8 — what actually happens in a day.
 *
 * The day ribbon puts meals, treadmill sessions, IQOS, meetings and air raid
 * alerts on one time axis. Without it a dip in HRV reads as a bad protocol.
 */

const WEEKS = 12;

export default {
  id: 'behav',
  label: 'Поведінка',
  title: 'Поведінка',
  question: 'Що я насправді роблю щодня?',
  scale: 'доба',

  live(ctx) {
    const iqos = ctx.sourceState('iqos');
    const mac = ctx.sourceState('macos');
    if (iqos.state === 'dead') return { color: P.alert, label: 'IQOS не синхронізований' };
    if (mac.state === 'dead' || mac.state === 'empty') return { color: P.warn, label: 'немає факту мітингів' };
    return { color: P.warn, label: 'ручна синхронізація' };
  },

  async load(ctx) {
    const { data } = ctx;
    const days = WEEKS * 7;
    const [evts, iqosStats, padStats, stepStats, waterStats, camera] = await Promise.all([
      loadEvents(ctx, 24),
      data.stats([E.iqosToday, E.iqosPuffs].filter((id) => data.exists(id)), days, 'day', ['mean', 'max', 'state']),
      data.stats([E.padTimeDay, E.padStepsDay].filter((id) => data.exists(id)), days, 'day', ['mean', 'max']),
      data.stats([E.ouraSteps, E.phoneSteps].filter((id) => data.exists(id)), days, 'day', ['max', 'mean']),
      data.stats([E.waterToday].filter((id) => data.exists(id)), days, 'day', ['max', 'mean']),
      data.exists(E.camera) ? data.history(E.camera, 24, { significantOnly: false }) : {},
    ]);
    return { evts, iqosStats, padStats, stepStats, waterStats, camera, days };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];

    // Three independent step counters — the delta between them is a metric.
    const steps = {
      pad: data.val(E.padStepsDay),
      oura: data.val(E.ouraSteps),
      phone: data.val(E.phoneSteps),
    };
    const known = Object.entries(steps).filter(([, v]) => v !== null);
    if (known.length >= 2) {
      const vs = known.map(([, v]) => v);
      const spread = Math.max(...vs) - Math.min(...vs);
      out.push(banner('ТРИ ЛІЧИЛЬНИКИ КРОКІВ',
        `Доріжка ${fmt(steps.pad, 0)}, Oura ${fmt(steps.oura, 0)}, iPhone ${fmt(steps.phone, 0)}. `
        + `Розкид ${fmt(spread, 0)} кроків. Це не надлишковість, а вбудована валідація: доріжка рахує `
        + 'лише свої сесії, кільце — рух руки, телефон — те, що в кишені. Жоден із трьох не є «правильним».',
        spread > 3000 ? P.warn : P.ref));
    }

    // ----------------------------------------------------------------- cards
    const cards = [];
    const iqos = data.val(E.iqosToday);
    cards.push(entityCard(ctx, {
      span: 2, size: '40px', label: 'IQOS за добу', entity: E.iqosToday, dec: 0, unit: 'стиків',
      srcState: ctx.sourceState('iqos').state,
      ranges: { refMin: 0, refMax: 46, optMin: 0, optMax: 0 },
      delta: `затяжок ${fmt(data.val(E.iqosPuffs), 0)} · ціль 0\nостання синхронізація ${data.raw(E.iqosSync) || '—'}`,
      deltaColor: iqos > 20 ? P.alert : P.warn,
      source: 'IQOS · ручна синхронізація ±15%',
      note: 'таймстемпи на межі для E29',
    }));

    cards.push(entityCard(ctx, {
      label: 'Доріжка сьогодні', entity: E.padTimeDay, dec: 2, unit: 'год',
      srcState: ctx.sourceState('kingsmith').state,
      delta: `${fmt(data.val(E.padStepsDay), 0)} кроків · ${fmt(data.val(E.padDistDay), 2)} км`,
      deltaColor: P.good,
      source: 'KingSmith',
    }));
    cards.push(entityCard(ctx, {
      label: 'Кроки · Oura', entity: E.ouraSteps, dec: 0, unit: 'кроків',
      srcState: ctx.sourceState('oura').state,
      delta: 'незалежний лічильник №2',
      source: 'Oura Ring',
    }));
    cards.push(entityCard(ctx, {
      label: 'Кроки · iPhone', entity: E.phoneSteps, dec: 0, unit: 'кроків',
      srcState: ctx.sourceState('iphone').state,
      delta: `дистанція ${fmt(data.val(E.phoneDistance), 0)} м`,
      source: 'iPhone · лічильник №3',
    }));
    cards.push(entityCard(ctx, {
      label: 'Вода', entity: E.waterToday, dec: 0, unit: 'мл',
      srcState: ctx.sourceState('hidrate').state,
      ranges: { refMin: 0, refMax: 3000, optMin: 2000, optMax: 3000 },
      delta: `${fmt(data.val(E.sipsToday), 0)} ковтків · ${fmt(data.val(E.refillsToday), 0)} наповнень`,
      deltaColor: P.warn,
      source: 'Hidrate Spark',
      emptyHint: 'пляшка поза звʼязком — покриття неповне',
    }));

    const slouch = data.val(E.slouchTime), upright = data.val(E.uprightTime);
    const pct = slouch !== null && upright !== null && slouch + upright > 0
      ? (slouch / (slouch + upright)) * 100 : null;
    cards.push(entityCard(ctx, {
      label: 'Час згорблено', value: pct, text: fmt(pct, 1), unit: '%',
      srcState: pct === null ? 'empty' : ctx.sourceState('upright').state,
      entity: E.slouchTime,
      ranges: { refMin: 0, refMax: 100, optMin: 0, optMax: 20 },
      delta: pct === null ? '' : `${fmt(slouch, 1)} з ${fmt(slouch + upright, 1)} хв`,
      deltaColor: pct > 30 ? P.warn : P.good,
      source: 'Upright GO 2',
    }));

    const camMin = cameraMinutes(pd.camera[E.camera] || []);
    cards.push(entityCard(ctx, {
      label: 'Мітинги, факт', value: camMin, text: camMin === null ? '—' : fmt(camMin, 0), unit: 'хв',
      srcState: camMin === null ? 'empty' : ctx.sourceState('macos').state,
      entity: E.camera,
      delta: camMin === null ? '' : `камера ноутбука активна · зараз ${data.raw(E.frontApp) || '—'}`,
      deltaColor: P.good,
      source: 'HA Companion macOS · camera_in_use',
      emptyHint: 'сенсори ноутбука вимкнені — E27 без ground truth',
      note: camMin === null ? 'E27 заблокований' : null,
    }));

    cards.push(entityCard(ctx, {
      label: 'Екранний час', entity: null, value: null, text: '—', unit: 'хв',
      srcState: 'empty',
      emptyHint: 'немає сенсора Screen Time; для E13 потрібне вікно −2 год до сну, а не добова сума',
      source: 'iPhone',
      note: 'E13 заблокований', noteColor: P.ref,
    }));

    out.push(h('div.hh-cards', cards));

    // ---------------------------------------------------------- day ribbon
    const dayStart = startOfToday();
    const dayEnd = dayStart + 86400e3;
    const lanes = buildLanes(ctx, pd, dayStart, dayEnd);
    const anySeg = lanes.some((l) => l.segs && l.segs.length);
    out.push(panel(
      'Стрічка дня',
      'Одна часова вісь для всього: прийоми їжі, сесії на доріжці, затяжки IQOS, камера ноутбука, тривоги. '
      + 'Побудована з реальних переходів станів у recorder’і за сьогодні.',
      `${clockOf(new Date(dayStart))} → 24:00`,
      anySeg
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          laneChart({
            lanes, labelWidth: 132,
            xLabels: ['00:00', '06:00', '12:00', '18:00', '24:00'],
          }),
          legendRow([
            { color: ctx.accent, label: 'їжа' },
            { color: P.good, label: 'доріжка' },
            { color: P.alert, label: 'IQOS / тривога' },
            { color: P.ref, label: 'камера ноутбука' },
          ]),
        ])
        : emptyState('За сьогодні ще немає жодної події в recorder’і.'),
    ));

    // ------------------------------------------------------- substitution
    const iqosDaily = grid(pd.iqosStats[E.iqosToday] || pd.iqosStats[E.iqosPuffs] || [], pd.days, 'max');
    const padDaily = grid(pd.padStats[E.padTimeDay] || [], pd.days, 'max');
    const hasBoth = iqosDaily.filter(Number.isFinite).length >= 3 && padDaily.filter(Number.isFinite).length >= 3;
    out.push(panel(
      `Заміщення: доріжка проти IQOS — ${WEEKS} тижнів`,
      hasBoth
        ? 'Не дві окремі лінії, а один потік. Гіпотеза E26 стверджує, що хвилини на доріжці витісняють '
          + 'мікроперерви на IQOS; якщо це так, криві мають рухатись назустріч.'
        : 'Для перевірки E26 потрібні обидва ряди в довгостроковій статистиці.',
      'стиків/добу · год на доріжці',
      hasBoth
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 240, yMin: 0,
            yMax: Math.max(10, Math.ceil(Math.max(...iqosDaily.filter(Number.isFinite)) * 1.15)),
            yTicks: tickList(Math.max(...iqosDaily.filter(Number.isFinite))),
            xLabels: [`−${WEEKS} тижнів`, `−${Math.round(WEEKS * 0.66)}`, `−${Math.round(WEEKS * 0.33)}`, 'зараз'],
            series: [
              { pts: iqosDaily, color: P.alert, fill: true, w: 2 },
              {
                pts: padDaily.map((v) => (v === null ? null : v * scaleFactor(iqosDaily, padDaily))),
                color: ctx.accent, fill: true, w: 2,
              },
            ],
          }),
          legendRow([
            { color: P.alert, label: 'IQOS стиків/добу' },
            { color: ctx.accent, label: 'доріжка, годин (масштабовано до осі)' },
          ]),
        ])
        : emptyState('Довгострокової статистики по IQOS та доріжці за це вікно бракує.'),
    ));

    // ------------------------------------------------------- step counters
    const ouraSteps = grid(pd.stepStats[E.ouraSteps] || [], pd.days, 'max');
    const phoneSteps = grid(pd.stepStats[E.phoneSteps] || [], pd.days, 'max');
    const padSteps = grid(pd.padStats[E.padStepsDay] || [], pd.days, 'max');
    const allSteps = [...ouraSteps, ...phoneSteps, ...padSteps].filter(Number.isFinite);
    out.push(panel(
      'Три лічильники кроків на одній осі',
      'Розбіжність між ними — окрема метрика, а не шум, який треба прибрати. '
      + 'Дні, коли доріжка дає більше за кільце, і дні, коли навпаки, означають різні типи активності.',
      'Oura · iPhone · доріжка',
      allSteps.length >= 3
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 220, yMin: 0, yMax: Math.ceil(Math.max(...allSteps) * 1.1),
            yTicks: tickList(Math.max(...allSteps)),
            xLabels: [`−${WEEKS} тижнів`, `−${Math.round(WEEKS * 0.66)}`, `−${Math.round(WEEKS * 0.33)}`, 'зараз'],
            series: [
              { pts: ouraSteps, color: P.ref, w: 1.6 },
              { pts: phoneSteps, color: P.olive, w: 1.6 },
              { pts: padSteps, color: ctx.accent, w: 1.6 },
            ],
          }),
          legendRow([
            { color: P.ref, label: 'Oura' },
            { color: P.olive, label: 'iPhone' },
            { color: ctx.accent, label: 'доріжка' },
          ]),
        ])
        : emptyState('Ряди кроків ще не накопичились у довгостроковій статистиці.'),
    ));

    return out;
  },
};

// ------------------------------------------------------------------ helpers

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function buildLanes(ctx, pd, dayStart, dayEnd) {
  const span = dayEnd - dayStart;
  const at = (t) => (t - dayStart) / span;
  const pick = (kind) => pd.evts.events
    .filter((e) => e.kind === kind && e.t >= dayStart && e.t <= dayEnd)
    .map((e) => [at(e.t), at(e.t) + 0.004]);

  const sessions = (pd.evts.sessions || [])
    .filter(([a, b]) => b >= dayStart && a <= dayEnd)
    .map(([a, b]) => [at(Math.max(a, dayStart)), at(Math.min(b, dayEnd))]);

  const camRows = pd.camera[ctx.E.camera] || [];
  const camSegs = [];
  let onAt = null;
  for (const r of camRows) {
    if (r.s === 'on' && onAt === null) onAt = r.t;
    if (r.s !== 'on' && onAt !== null) { camSegs.push([at(onAt), at(r.t)]); onAt = null; }
  }
  if (onAt !== null) camSegs.push([at(onAt), at(Date.now())]);

  return [
    { label: 'Їжа', segs: pick('meal'), color: ctx.accent },
    { label: 'Доріжка', segs: sessions, color: P.good },
    { label: 'IQOS', segs: pick('iqos'), color: P.alert },
    { label: 'Камера ноутбука', segs: camSegs.filter(([a, b]) => b > a), color: P.ref },
    { label: 'Тривоги', segs: pick('alert'), color: P.alert },
  ];
}

function cameraMinutes(rows) {
  if (!rows.length) return null;
  let total = 0, onAt = null;
  for (const r of rows) {
    if (r.s === 'on' && onAt === null) onAt = r.t;
    if (r.s !== 'on' && onAt !== null) { total += r.t - onAt; onAt = null; }
  }
  if (onAt !== null) total += Date.now() - onAt;
  return total / 60000;
}

function grid(rows, days, agg) {
  const byDay = new Map();
  for (const r of rows) {
    const v = agg === 'max' ? (r.max ?? r.mean) : (r.mean ?? r.max);
    if (Number.isFinite(v)) byDay.set(dayKey(r.t), v);
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 86400e3);
    out.push(byDay.has(k) ? byDay.get(k) : null);
  }
  return out;
}

function scaleFactor(a, b) {
  const av = a.filter(Number.isFinite), bv = b.filter(Number.isFinite);
  if (!av.length || !bv.length) return 1;
  const am = Math.max(...av), bm = Math.max(...bv);
  return bm ? (am * 0.8) / bm : 1;
}

function tickList(max) {
  const step = Math.max(1, Math.round(max / 4));
  return [step, step * 2, step * 3].map((v) => Math.round(v));
}

export { age };
