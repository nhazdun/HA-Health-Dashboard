import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart } from '../charts/svg.js';
import { dayKey } from '../core/ha.js';
import { fmt, age } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 5 — heart and vessels.
 *
 * Two HRV channels (Oura at night, H10 in the morning) stay as two lines and
 * are never averaged: different protocols measure different physiology. Where
 * two sources measure the *same* quantity — pulse wave velocity — their
 * agreement is shown as a value in itself.
 */

const DAYS = 30;

export default {
  id: 'heart',
  label: 'Серце й судини',
  title: 'Серце й судини',
  question: 'Як тримаються судини?',
  scale: 'удар · доба',

  live(ctx) {
    const oura = ctx.sourceState('oura');
    const orn = ctx.sourceState('ornament');
    if (oura.state === 'dead') return { color: P.alert, label: 'Oura мовчить' };
    if (orn.state === 'dead') return { color: P.warn, label: 'ліпідна панель застаріла' };
    return { color: P.good, label: 'джерела на місці' };
  },

  async load(ctx) {
    const { data } = ctx;
    const ids = [E.ouraSleepHrv, E.polarRmssd, E.ouraLowestHr, E.ouraHrAvg, E.ouraSpo2]
      .filter((id) => data.exists(id));
    const stats = await data.stats(ids, DAYS, 'day', ['mean', 'min', 'max']);
    return { stats, grid: buildGrid(stats, ids, DAYS) };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];
    const orn = ctx.sourceState('ornament');

    // Two devices, one quantity — Withings reports PWV in mph, Oura in m/s.
    const ouraPwv = data.val(E.ouraPwv);
    const wPwvRaw = data.val(E.wPwv);
    const wPwv = wPwvRaw !== null ? convertPwv(wPwvRaw, data.unit(E.wPwv)) : null;
    if (ouraPwv !== null && wPwv !== null) {
      const diff = Math.abs(ouraPwv - wPwv);
      const agree = diff < 1;
      out.push(banner(agree ? 'ЗГОДА ДЖЕРЕЛ' : 'РОЗБІЖНІСТЬ ДЖЕРЕЛ',
        `ШПХ: Oura ${fmt(ouraPwv, 2)} м/с, Withings ${fmt(wPwv, 2)} м/с — розбіжність ${fmt(diff, 2)} м/с. `
        + (agree
          ? 'Два незалежні прилади зійшлися, отже величині можна вірити.'
          : 'Розбіжність більша за метр на секунду — обидва значення варто вважати орієнтовними.')
        + (data.unit(E.wPwv) && !/m\/s|м\/с/i.test(data.unit(E.wPwv))
          ? ` Withings віддає одиницю «${data.unit(E.wPwv)}» — значення сконвертоване тут, у HA воно лишається сирим.`
          : ''),
        agree ? P.good : P.warn));
    }

    // ----------------------------------------------------------------- cards
    const cards = [];

    cards.push(entityCard(ctx, {
      span: 2, size: '40px', label: 'Нічний dipping ratio',
      value: null, text: '—', unit: '%',
      srcState: 'empty',
      emptyHint: 'манжет цього не дає — потрібен Aktiia з нічним профілем АТ',
      delta: '',
      source: 'єдина унікальна прогалина в стеку',
      note: 'E17 заблокований залізом',
      noteColor: P.ref,
    }));

    cards.push(entityCard(ctx, {
      label: 'HRV уві сні', entity: E.ouraSleepHrv, dec: 0, unit: 'мс',
      srcState: ctx.sourceState('oura').state, ageText: 'ранок',
      ranges: { optMin: 40, optMax: 90 },
      delta: `баланс HRV ${fmt(data.val(E.ouraHrvBalance), 0)}`,
      deltaColor: P.good,
      source: 'Oura · PPG',
      emptyHint: 'Oura ще не віддала цю ніч',
    }));
    cards.push(entityCard(ctx, {
      label: 'RMSSD ранковий', entity: E.polarRmssd, dec: 0, unit: 'мс',
      srcState: ctx.sourceState('polar').state,
      ranges: { optMin: 40, optMax: 90 },
      delta: 'протокол 5 хв сидячи (E22)',
      source: 'Polar H10 · ЕКГ-точність',
      emptyHint: 'ремінь не вдягнений',
    }));
    cards.push(entityCard(ctx, {
      label: 'Найнижчий пульс уві сні', entity: E.ouraLowestHr, dec: 0, unit: 'уд/хв',
      srcState: ctx.sourceState('oura').state, ageText: 'ранок',
      ranges: { optMin: 45, optMax: 60 },
      delta: 'найчистіший маркер відновлення',
      source: 'Oura',
    }));
    cards.push(entityCard(ctx, {
      label: 'ШПХ · Oura', entity: E.ouraPwv, dec: 2, unit: 'м/с',
      srcState: ctx.sourceState('oura').state, ageText: 'ранок',
      ranges: { optMin: 5, optMax: 7 },
      delta: wPwv !== null ? `Withings: ${fmt(wPwv, 2)} м/с` : '',
      deltaColor: P.ref,
      source: 'Oura PPG',
    }));
    cards.push(entityCard(ctx, {
      label: 'Кардіоваскулярний вік', entity: E.ouraCvAge, dec: 0, unit: 'років',
      srcState: ctx.sourceState('oura').state, ageText: 'ранок',
      delta: 'композитний бал — лише внутрішньоджерельний тренд',
      deltaColor: P.warn,
      source: 'Oura composite',
    }));

    for (const [label, id, ranges] of [
      ['Коефіцієнт атерогенності', 'sensor.ornament_nazariy_atherogenic_index', null],
      ['ApoB', 'sensor.ornament_nazariy_apolipoprotein_b', null],
      ['Холестерин ЛПНЩ', 'sensor.ornament_nazariy_ldl_cholesterol', null],
      ['Тригліцериди', 'sensor.ornament_nazariy_triglycerides', null],
    ]) {
      cards.push(entityCard(ctx, {
        label, entity: id, dec: 2,
        srcState: orn.state, ageText: ornAge(data, id),
        ranges: ranges || ornRanges(data, id),
        delta: ornDelta(data, id),
        deltaColor: P.alert,
        source: 'Ornament · ліпіди',
      }));
    }

    cards.push(entityCard(ctx, {
      label: 'Нічний SpO₂', entity: E.ouraSpo2, dec: 1, unit: '%',
      srcState: ctx.sourceState('oura').state, ageText: 'ранок',
      ranges: { optMin: 95, optMax: 100 },
      delta: `індекс порушень дихання ${fmt(data.val(E.ouraBdi), 0)}`,
      deltaColor: (data.val(E.ouraBdi) ?? 0) > 5 ? P.warn : P.good,
      source: 'Oura',
    }));

    out.push(h('div.hh-cards', cards));

    // ------------------------------------------------------------ HRV chart
    const night = pd.grid[E.ouraSleepHrv] || [];
    const morn = pd.grid[E.polarRmssd] || [];
    const both = [...night, ...morn].filter(Number.isFinite);
    out.push(panel(
      'HRV: два незалежні канали',
      `Oura вночі (${night.filter(Number.isFinite).length} діб) і ранковий протокол H10 `
      + `(${morn.filter(Number.isFinite).length} діб). Дві лінії, ніколи не усереднені — різні протоколи, `
      + 'різна фізіологія. Розриви — доби без вимірювання.',
      'Oura ніч · H10 ранок',
      both.length >= 3
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 230,
            yMin: Math.max(0, Math.floor(Math.min(...both) - 5)),
            yMax: Math.ceil(Math.max(...both) + 5),
            yTicks: ticks(Math.min(...both) - 5, Math.max(...both) + 5),
            xLabels: [`−${DAYS} д`, `−${Math.round(DAYS * 0.66)}`, `−${Math.round(DAYS * 0.33)}`, 'сьогодні'],
            series: [
              { pts: night, color: P.ref, w: 1.8, dot: true },
              { pts: morn, color: ctx.accent, w: 1.8, dot: true },
            ],
          }),
          legendRow([
            { color: P.ref, label: 'Oura — нічна HRV' },
            { color: ctx.accent, label: 'Polar H10 — ранковий RMSSD' },
          ]),
        ])
        : emptyState('Обидва канали HRV поки без довгострокової статистики за це вікно.'),
    ));

    // ------------------------------------------------------- resting HR trend
    const lowest = pd.grid[E.ouraLowestHr] || [];
    const avgHr = pd.grid[E.ouraHrAvg] || [];
    const hrVals = [...lowest, ...avgHr].filter(Number.isFinite);
    out.push(panel(
      'Пульс спокою проти денного середнього',
      'Найнижчий пульс уві сні — найчистіший маркер відновлення; денне середнє показує навантаження. '
      + 'Разом вони дають ширину «резерву» за добу.',
      'найнижчий уві сні · денне середнє',
      hrVals.length >= 3
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 210,
            yMin: Math.max(30, Math.floor(Math.min(...hrVals) - 5)),
            yMax: Math.ceil(Math.max(...hrVals) + 5),
            yTicks: ticks(Math.min(...hrVals) - 5, Math.max(...hrVals) + 5),
            xLabels: [`−${DAYS} д`, `−${Math.round(DAYS * 0.66)}`, `−${Math.round(DAYS * 0.33)}`, 'сьогодні'],
            series: [
              { pts: lowest, color: P.ref, w: 1.8, fill: true },
              { pts: avgHr, color: ctx.accent, w: 1.6 },
            ],
          }),
          legendRow([
            { color: P.ref, label: 'найнижчий уві сні' },
            { color: ctx.accent, label: 'середній за добу' },
          ]),
        ])
        : emptyState('Ряди пульсу за це вікно порожні.'),
    ));

    // ----------------------------------------------- blood pressure placeholder
    out.push(panel(
      'Нічний профіль АТ — каркас чекає на Aktiia',
      'Каркас побудований, даних немає і вигадувати їх нема сенсу. Коли зʼявиться прилад, сюди ляже '
      + 'ступінчаста нічна крива і велика цифра dipping ratio — це єдина метрика в стеку, якої не дає '
      + 'жоден наявний пристрій.',
      'порожній каркас',
      emptyState('Немає джерела нічного артеріального тиску. '
        + 'BPM Connect дає лише разові вимірювання вдень, dipping ratio з них не рахується.'),
    ));

    return out;
  },
};

function convertPwv(v, unit) {
  if (!unit) return v;
  const u = String(unit).toLowerCase();
  if (u.includes('mph')) return v * 0.44704;
  if (u.includes('km/h')) return v / 3.6;
  return v;
}

function buildGrid(stats, ids, days) {
  const grid = {};
  for (const id of ids) {
    const byDay = new Map();
    for (const r of stats[id] || []) {
      const v = r.mean ?? r.min ?? r.max;
      if (Number.isFinite(v)) byDay.set(dayKey(r.t), v);
    }
    const arr = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 86400e3);
      arr.push(byDay.has(k) ? byDay.get(k) : null);
    }
    grid[id] = arr;
  }
  return grid;
}

function ticks(lo, hi) {
  const step = Math.max(1, Math.round((hi - lo) / 5));
  return [1, 2, 3, 4].map((i) => Math.round(lo + step * i));
}

function ornRanges(data, id) {
  return {
    refMin: data.attr(id, 'reference_min') ?? null,
    refMax: data.attr(id, 'reference_max') ?? null,
    optMin: data.attr(id, 'optimal_min') ?? null,
    optMax: data.attr(id, 'optimal_max') ?? null,
  };
}

function ornAge(data, id) {
  const at = data.attr(id, 'measured_at');
  return at ? age(Date.now() - new Date(at).getTime()) : '—';
}

function ornDelta(data, id) {
  const r = ornRanges(data, id);
  const parts = [];
  if (r.refMax !== null) parts.push(`референс ≤${fmt(r.refMax)}`);
  if (r.optMax !== null) parts.push(`оптимум ≤${fmt(r.optMax)}`);
  return parts.join(' · ');
}
