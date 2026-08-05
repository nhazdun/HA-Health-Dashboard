import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart, heatmap } from '../charts/svg.js';
import { resample, dayKey } from '../core/ha.js';
import { loadEvents, eventsFor } from '../core/events.js';
import { fmt, mean } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 7 — air and light, one room at a time.
 *
 * The two rooms are not symmetric and the page refuses to pretend otherwise.
 * The bedroom carries two independent air devices, so a spike there can be
 * *confirmed*; it is also the only place NO₂ and formaldehyde are measured at
 * all. The living room has a single Qingping node, so every spike there is a
 * hypothesis. Which room you are looking at changes what the data can support.
 */

const HOURS = 24;
const CAL_DAYS = 90;

const ROOMS = [
  { id: 'bed', label: 'Спальня', devices: 'Qingping 7fc5 + Dyson' },
  { id: 'living', label: 'Вітальня · робоче місце', devices: 'Qingping 554b' },
];

export default {
  id: 'env',
  label: 'Середовище',
  title: 'Середовище',
  question: 'Чим я дихаю і в якому світлі живу?',
  scale: '5 хв · доба',

  live(ctx) {
    const bed = ctx.state.room !== 'living';
    if (bed) {
      const qp = ctx.sourceState('qp_bed').state;
      const dy = ctx.sourceState('dyson').state;
      const liveCount = [qp, dy].filter((s) => s === 'ok' || s === 'warn').length;
      if (!liveCount) return { color: P.alert, label: 'спальня без даних' };
      if (liveCount === 1) return { color: P.warn, label: 'крос-валідації немає' };
      return { color: P.good, label: '2 прилади · крос-валідація' };
    }
    const s = ctx.sourceState('qp_desk').state;
    if (s === 'dead' || s === 'empty') return { color: P.alert, label: 'вітальня без даних' };
    return { color: P.warn, label: 'одне джерело' };
  },

  async load(ctx) {
    const { data } = ctx;
    const bed = ctx.state.room !== 'living';
    const pmIds = bed ? [E.bedPm25, E.dysonPm25] : [E.deskPm25];

    const [pmA, pmB, co2, noise, no2, hcho, evts, cal] = await Promise.all([
      data.series(pmIds[0], HOURS),
      pmIds[1] ? data.series(pmIds[1], HOURS) : Promise.resolve([]),
      data.series(bed ? E.bedCo2 : E.deskCo2, HOURS),
      data.series(bed ? E.bedNoise : E.deskNoise, HOURS),
      bed ? data.series(E.dysonNo2, HOURS) : Promise.resolve([]),
      bed ? data.series(E.dysonHcho, HOURS) : Promise.resolve([]),
      loadEvents(ctx, HOURS),
      data.stats(bed ? E.bedPm25 : E.deskPm25, CAL_DAYS, 'day', ['mean', 'max']),
    ]);
    return {
      bed, pmA, pmB, co2, noise, no2, hcho, evts,
      cal: cal[bed ? E.bedPm25 : E.deskPm25] || [],
    };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const bed = pd.bed;
    const out = [];
    const now = Date.now(), start = now - HOURS * 3600e3;

    // -------------------------------------------------------- room switcher
    out.push(h('div.hh-rooms', [
      h('div.hh-seg', ROOMS.map((r) => h('button', {
        type: 'button',
        'aria-pressed': (r.id === 'bed') === bed ? 'true' : 'false',
        onClick: () => ctx.setState({ room: r.id }),
      }, r.label))),
      h('span', {
        style: { fontFamily: "'Geist Mono',monospace", fontSize: '10.5px', color: P.off },
      }, bed ? ROOMS[0].devices : ROOMS[1].devices),
    ]));

    out.push(h('div.hh-roomnote', bed
      ? 'У спальні два незалежні прилади — Qingping і очищувач Dyson. Тільки тут пік PM2.5 можна '
        + 'підтвердити другим сенсором, і тільки тут NO₂ та формальдегід узагалі існують.'
      : 'У вітальні один вузол Qingping. Dyson тут немає, отже немає ні газових каналів, '
        + 'ні крос-валідації — поодинокий пік лишається гіпотезою, а не фактом.'));

    // ---------------------------------------- cross-validation / single source
    if (bed) {
      const a = data.val(E.bedPm25), b = data.val(E.dysonPm25);
      if (a !== null && b !== null) {
        const d = Math.abs(a - b);
        out.push(banner(d < 6 ? 'ДВА ПРИЛАДИ ЗІЙШЛИСЯ' : 'ПРИЛАДИ РОЗХОДЯТЬСЯ',
          `PM2.5 у спальні: Qingping ${fmt(a, 0)}, Dyson ${fmt(b, 0)} мкг/м³, різниця ${fmt(d, 0)}. `
          + (d < 6
            ? 'Сталий зсув у кілька одиниць — це різниця калібрування, а не подія. Синхронний підйом обох означає, що подія реальна.'
            : 'Розходження завелике для калібрувального зсуву — щось локальне стоїть біля одного з приладів.'),
          d < 6 ? P.good : P.warn));
      }
    } else {
      out.push(banner('ОДНЕ ДЖЕРЕЛО',
        'Усе на цій сторінці тримається на одному приладі. Пік тут неможливо підтвердити так, '
        + 'як у спальні, тому перед висновком варто дочекатись повторення або порівняти зі спальнею.',
        P.warn));
    }

    // ----------------------------------------------------------------- cards
    out.push(h('div.hh-cards', bed ? bedroomCards(ctx) : livingCards(ctx)));

    // ---------------------------------------------------------------- charts
    if (bed) {
      const both = [...pd.pmA, ...pd.pmB].map((p) => p.v);
      out.push(panel(
        'Крос-валідація PM2.5 — два прилади, одна кімната',
        'Спальня — єдина кімната з другим, лазерним сенсором, тому це єдине місце, де пік можна '
        + 'підтвердити, а не просто повірити в нього. Сталий зсув між кривими — різниця калібрування; '
        + 'значення має синхронність, а не абсолютна відстань між ними.',
        'Qingping 7fc5 · Dyson лазер',
        both.length
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            lineChart({
              h: 230, yMin: 0,
              yMax: Math.max(20, Math.ceil(Math.max(1, ...both) * 1.15)),
              yTicks: [0, 10, 20, 30],
              xLabels: ['−24 год', '−18', '−12', '−6', 'зараз'],
              series: [
                { pts: resample(pd.pmA, 120, start, now), color: ctx.accent, w: 1.7 },
                { pts: resample(pd.pmB, 120, start, now), color: P.ref, w: 1.7 },
              ],
              thresholds: [
                { v: 15, color: P.warn, label: 'референс 15' },
                { v: 5, color: P.good, label: 'оптимум 5' },
              ],
              events: eventsFor(pd.evts, start, now, ctx, ['iqos']),
              showEvents: ctx.state.annotations,
            }),
            legendRow([
              { color: ctx.accent, label: 'Qingping 7fc5' },
              { color: P.ref, label: 'Dyson лазер' },
            ]),
          ])
          : emptyState('Жоден із двох приладів спальні не віддав ряд PM2.5 за добу.'),
      ));

      const gas = [...pd.no2, ...pd.hcho].map((p) => p.v);
      out.push(panel(
        'Газові канали — тільки Dyson',
        'NO₂ і формальдегід існують у цій системі в одній кімнаті й більше ніде. Отже будь-який '
        + 'висновок про гази — це висновок про спальню, а не про квартиру. Формальдегід масштабований '
        + '×100, щоб лягти на одну вісь із NO₂.',
        'NO₂ мкг/м³ · HCHO ×100 мг/м³',
        gas.length
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            lineChart({
              h: 200, yMin: 0,
              yMax: Math.max(14, Math.ceil(Math.max(1, ...pd.no2.map((p) => p.v),
                ...pd.hcho.map((p) => p.v * 100)) * 1.2)),
              yTicks: [0, 4, 8, 12],
              xLabels: ['−24 год', '−18', '−12', '−6', 'зараз'],
              series: [
                { pts: resample(pd.no2, 100, start, now), color: P.ref, w: 1.7 },
                {
                  pts: resample(pd.hcho, 100, start, now).map((v) => (v === null ? null : v * 100)),
                  color: ctx.accent, w: 1.7,
                },
              ],
              thresholds: [
                { v: 10, color: P.warn, label: 'NO₂ оптимум 10' },
                { v: 10, color: P.off, label: '' },
              ],
            }),
            legendRow([
              { color: P.ref, label: 'NO₂ мкг/м³' },
              { color: ctx.accent, label: 'формальдегід ×100 мг/м³' },
            ]),
          ])
          : emptyState('Dyson не віддав рядів NO₂ і формальдегіду за добу.'),
      ));
    } else {
      const vals = pd.pmA.map((p) => p.v);
      const co2Vals = pd.co2.map((p) => p.v);
      out.push(panel(
        'Повітря робочого місця за добу — одне джерело',
        'Один прилад, тому пік тут не можна перевірити так, як у спальні. CO₂ поділений на 40, '
        + 'щоб лягти на ту саму вісь: поріг 800 ppm відповідає позначці 20.',
        'PM2.5 · CO₂ ÷ 40',
        vals.length || co2Vals.length
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            lineChart({
              h: 230, yMin: 0,
              yMax: Math.max(30, Math.ceil(Math.max(1, ...vals, ...co2Vals.map((v) => v / 40)) * 1.15)),
              yTicks: [0, 10, 20, 30],
              xLabels: ['−24 год', '−18', '−12', '−6', 'зараз'],
              series: [
                { pts: resample(pd.pmA, 120, start, now), color: ctx.accent, w: 1.7 },
                {
                  pts: resample(pd.co2, 120, start, now).map((v) => (v === null ? null : v / 40)),
                  color: P.ref, w: 1.5, dash: '5 4',
                },
              ],
              thresholds: [
                { v: 15, color: P.warn, label: 'PM2.5 референс 15' },
                { v: 20, color: P.ref, label: 'CO₂ 800 ppm' },
              ],
              events: eventsFor(pd.evts, start, now, ctx, ['iqos']),
              showEvents: ctx.state.annotations,
            }),
            legendRow([
              { color: ctx.accent, label: 'PM2.5 мкг/м³' },
              { color: P.ref, label: 'CO₂ ÷ 40' },
            ]),
          ])
          : emptyState('Qingping 554b не віддав рядів за добу.'),
      ));
    }

    // ------------------------------------------------------------- calendar
    const cal = calendar(pd.cal, bed);
    out.push(panel(
      `Календар PM2.5 ${bed ? 'спальні' : 'робочого місця'} — ${CAL_DAYS} днів`,
      'Темніше означає гірше. Поодинокі темні клітинки — внутрішні події; цілі темні стовпчики '
      + 'збігаються із зовнішнім AQI. Шкала однакова для обох кімнат, тож їх можна порівнювати '
      + 'оком через перемикач.',
      `${cal.filled} діб із даними`,
      cal.filled
        ? heatmap({
          cols: Math.ceil(CAL_DAYS / 7), rows: 7,
          labels: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'],
          xLabels: [
            { at: 0, t: `−${Math.ceil(CAL_DAYS / 7)} тижнів` },
            { at: Math.ceil(CAL_DAYS / 7) - 1, t: 'зараз' },
          ],
          cells: cal.cells,
        })
        : emptyState('Довгострокова статистика PM2.5 для цієї кімнати ще не накопичилась.'),
    ));

    return out;
  },
};

// -------------------------------------------------------------------- cards

function bedroomCards(ctx) {
  const { data } = ctx;
  const cards = [];
  const t = data.val(E.bedTemp);
  const dysonT = data.val(E.dysonTemp);

  cards.push(entityCard(ctx, {
    span: 2, size: '40px', label: 'Температура', entity: E.bedTemp, dec: 1, unit: '°C',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 16, refMax: 24, optMin: 17, optMax: 19 },
    delta: t === null ? '' : (t > 19
      ? `+${fmt(t - 19, 1)}° над оптимумом 17–19\nE09: чергування блоками по 4 ночі`
      : 'в оптимумі 17–19'),
    deltaColor: t > 21 ? P.alert : t > 19 ? P.warn : P.good,
    source: `Qingping 7fc5 · Dyson показує ${fmt(dysonT, 1)}°`,
    note: dysonT !== null && t !== null && Math.abs(dysonT - t) < 1.5 ? 'два прилади збігаються' : null,
  }));

  const qpPm = data.val(E.bedPm25), dyPm = data.val(E.dysonPm25);
  cards.push(entityCard(ctx, {
    label: 'CO₂', entity: E.bedCo2, dec: 0, unit: 'ppm',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 400, refMax: 1400, optMin: 400, optMax: 800 },
    delta: 'поріг фрагментації сну 900',
    deltaColor: (data.val(E.bedCo2) ?? 0) > 900 ? P.warn : P.good,
    source: 'Qingping 7fc5',
  }));
  cards.push(entityCard(ctx, {
    label: 'PM2.5 · Qingping', entity: E.bedPm25, dec: 0, unit: 'мкг/м³',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 0, refMax: 15, optMin: 0, optMax: 5 },
    delta: dyPm !== null && qpPm !== null ? `Δ ${fmt(Math.abs(qpPm - dyPm), 0)} проти Dyson` : '',
    deltaColor: P.ref,
    source: 'Qingping 7fc5',
  }));
  cards.push(entityCard(ctx, {
    label: 'PM2.5 · Dyson', entity: E.dysonPm25, dec: 0, unit: 'мкг/м³',
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 15, optMin: 0, optMax: 5 },
    delta: 'лазерний сенсор — друга думка',
    deltaColor: P.ref,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'NO₂', entity: E.dysonNo2, dec: 0, unit: 'мкг/м³',
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 25, optMin: 0, optMax: 10 },
    delta: 'лише Dyson — більше ніде',
    deltaColor: P.ref,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'Формальдегід', entity: E.dysonHcho, dec: 3, unit: 'мг/м³',
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 0.1, optMin: 0, optMax: 0.03 },
    delta: 'поріг ВООЗ 0.1 за 30 хв',
    deltaColor: (data.val(E.dysonHcho) ?? 0) > 0.03 ? P.warn : P.good,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'Шум', entity: E.bedNoise, dec: 0, unit: 'дБ',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 0, refMax: 45, optMin: 0, optMax: 30 },
    delta: 'нічний поріг ВООЗ 30 дБ',
    deltaColor: (data.val(E.bedNoise) ?? 0) > 30 ? P.warn : P.good,
    source: 'Qingping 7fc5',
    note: 'без state_class',
  }));

  const qpH = data.val(E.bedHum), dyH = data.val(E.dysonHumidity);
  cards.push(entityCard(ctx, {
    label: 'Вологість', entity: E.bedHum, dec: 1, unit: '%',
    srcState: ctx.sourceState('qp_bed').state,
    ranges: { refMin: 30, refMax: 70, optMin: 40, optMax: 60 },
    delta: dyH !== null ? `Dyson показує ${fmt(dyH, 0)}%` : '',
    deltaColor: qpH !== null && dyH !== null && Math.abs(qpH - dyH) < 6 ? P.good : P.warn,
    source: 'Qingping 7fc5',
  }));
  cards.push(entityCard(ctx, {
    label: 'AQI за 15 хв', entity: E.dysonAqi, dec: 1,
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 50, optMin: 0, optMax: 25 },
    delta: `надворі ${fmt(data.val(E.dysonOutdoor), 0)} · домінує ${data.raw(E.dysonDominant) || '—'}`,
    deltaColor: P.good,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'Ресурс HEPA', entity: E.dysonFilter, dec: 0, unit: '%',
    srcState: ctx.sourceState('dyson').state,
    ranges: { refMin: 0, refMax: 100, optMin: 20, optMax: 100 },
    delta: `${fmt(data.val(E.dysonNextClean), 0)} год напрацювання`,
    source: 'Dyson 5JB-EU',
  }));
  cards.push(entityCard(ctx, {
    label: 'Melanopic EDI', entity: null, value: null, text: '—', unit: 'лк',
    srcState: 'empty',
    emptyHint: 'AS7341 в дорозі — світло поки невиміряний домен',
    source: 'новий домен: світло',
    note: 'немає джерела', noteColor: P.ref,
  }));
  return cards;
}

function livingCards(ctx) {
  const { data } = ctx;
  const cards = [];
  const t = data.val(E.deskTemp);

  cards.push(entityCard(ctx, {
    span: 2, size: '40px', label: 'Температура', entity: E.deskTemp, dec: 1, unit: '°C',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 18, refMax: 26, optMin: 20, optMax: 23 },
    delta: t === null ? '' : (t >= 20 && t <= 23
      ? 'усередині когнітивного коридору 20–23\nдругого приладу тут немає'
      : 'поза коридором 20–23\nдругого приладу тут немає'),
    deltaColor: t !== null && (t < 20 || t > 23) ? P.warn : P.good,
    source: 'Qingping 554b',
    note: 'єдине джерело',
  }));
  cards.push(entityCard(ctx, {
    label: 'CO₂', entity: E.deskCo2, dec: 0, unit: 'ppm',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 400, refMax: 1400, optMin: 400, optMax: 800 },
    delta: 'найдешевший проксі до спаду концентрації',
    source: 'Qingping 554b',
  }));
  cards.push(entityCard(ctx, {
    label: 'PM2.5', entity: E.deskPm25, dec: 0, unit: 'мкг/м³',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 0, refMax: 15, optMin: 0, optMax: 5 },
    delta: comparePm(data),
    deltaColor: P.warn,
    source: 'Qingping 554b',
    note: 'непідтверджено, один прилад',
  }));
  cards.push(entityCard(ctx, {
    label: 'PM10', entity: E.deskPm10, dec: 0, unit: 'мкг/м³',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 0, refMax: 45, optMin: 0, optMax: 15 },
    delta: 'груба фракція',
    source: 'Qingping 554b',
    note: 'без state_class',
  }));
  cards.push(entityCard(ctx, {
    label: 'Вологість', entity: E.deskHum, dec: 1, unit: '%',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 30, refMax: 70, optMin: 40, optMax: 60 },
    delta: (data.val(E.deskHum) ?? 50) < 40 ? 'нижній край комфорту' : 'у комфортному коридорі',
    deltaColor: (data.val(E.deskHum) ?? 50) < 40 ? P.warn : P.good,
    source: 'Qingping 554b',
  }));
  cards.push(entityCard(ctx, {
    label: 'Шум', entity: E.deskNoise, dec: 0, unit: 'дБ',
    srcState: ctx.sourceState('qp_desk').state,
    ranges: { refMin: 0, refMax: 55, optMin: 0, optMax: 40 },
    delta: 'проксі до дзвінків і відкритого простору',
    deltaColor: (data.val(E.deskNoise) ?? 0) > 40 ? P.warn : P.good,
    source: 'Qingping 554b',
    note: 'без state_class',
  }));
  cards.push(entityCard(ctx, {
    label: 'TVOC', entity: E.deskTvoc, dec: 0,
    srcState: 'low',
    delta: 'шкала виробника — порівнювати лише саму з собою',
    deltaColor: P.warn,
    source: 'Qingping 554b',
    note: 'не мг/м³',
  }));
  cards.push(entityCard(ctx, {
    label: 'NO₂ · формальдегід', entity: null, value: null, text: '—', size: '22px',
    srcState: 'empty',
    emptyHint: 'у цій кімнаті немає Dyson — газові канали недоступні',
    source: 'газові канали відсутні',
    note: 'немає приладу', noteColor: P.ref,
  }));
  cards.push(entityCard(ctx, {
    label: 'Melanopic EDI', entity: null, value: null, text: '—', unit: 'лк',
    srcState: 'empty',
    emptyHint: 'AS7341 в дорозі — світло поки невиміряний домен',
    source: 'новий домен: світло',
    note: 'немає джерела', noteColor: P.ref,
  }));
  return cards;
}

function comparePm(data) {
  const desk = data.val(E.deskPm25), bed = data.val(E.bedPm25);
  if (desk === null || bed === null) return '';
  if (desk > bed) return `на ${fmt(desk - bed, 0)} вище за спальню — інверсія`;
  return `на ${fmt(bed - desk, 0)} нижче за спальню`;
}

function calendar(rows, bed) {
  const byDay = new Map();
  for (const r of rows) {
    const v = r.mean ?? r.max;
    if (Number.isFinite(v)) byDay.set(dayKey(r.t), v);
  }
  const cols = Math.ceil(CAL_DAYS / 7);
  const cells = [];
  let filled = 0;
  for (let i = 0; i < CAL_DAYS; i++) {
    const t = Date.now() - (CAL_DAYS - 1 - i) * 86400e3;
    const k = dayKey(t);
    const dow = (new Date(t).getDay() + 6) % 7;
    const col = Math.min(Math.floor(i / 7), cols - 1);
    const v = byDay.get(k);
    if (v === undefined) {
      cells.push({ x: col, y: dow, color: null, title: `${k} · немає даних` });
    } else {
      filled++;
      cells.push({
        x: col, y: dow,
        color: v > 25 ? P.alert : v > 15 ? P.warn : v > 5 ? '#C79A3A' : P.good,
        op: 0.25 + Math.min(1, v / 30) * 0.65,
        title: `${k} · ${bed ? 'спальня' : 'робоче'} ${fmt(v, 1)} мкг/м³`,
      });
    }
  }
  return { cells, filled };
}

export { mean };
