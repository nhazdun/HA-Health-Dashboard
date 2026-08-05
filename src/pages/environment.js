import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart, heatmap } from '../charts/svg.js';
import { resample, dayKey } from '../core/ha.js';
import { loadEvents, eventsFor } from '../core/events.js';
import { fmt, mean } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 7 — air and light.
 *
 * Three PM2.5 sensors sit in one flat. That is not redundancy, it is built-in
 * validation: when one rises and the others do not, the source is local.
 */

const HOURS = 24;
const CAL_DAYS = 90;

export default {
  id: 'env',
  label: 'Середовище',
  title: 'Середовище',
  question: 'Чим я дихаю і в якому світлі живу?',
  scale: '5 хв · доба',

  live(ctx) {
    const live = ['qp_bed', 'qp_desk', 'dyson']
      .map((k) => ctx.sourceState(k).state)
      .filter((s) => s === 'ok' || s === 'warn').length;
    if (!live) return { color: P.alert, label: 'сенсори повітря мовчать' };
    if (live < 3) return { color: P.warn, label: `${live}/3 сенсори живі` };
    return { color: P.good, label: '3 сенсори живі' };
  },

  async load(ctx) {
    const { data } = ctx;
    const [bed, desk, dyson, co2Bed, co2Desk, noise, evts, calBed, calDesk] = await Promise.all([
      data.series(E.bedPm25, HOURS),
      data.series(E.deskPm25, HOURS),
      data.series(E.dysonPm25, HOURS),
      data.series(E.bedCo2, HOURS),
      data.series(E.deskCo2, HOURS),
      data.series(E.bedNoise, HOURS),
      loadEvents(ctx, HOURS),
      data.stats(E.bedPm25, CAL_DAYS, 'day', ['mean', 'max']),
      data.stats(E.deskPm25, CAL_DAYS, 'day', ['mean', 'max']),
    ]);
    return {
      bed, desk, dyson, co2Bed, co2Desk, noise, evts,
      calBed: calBed[E.bedPm25] || [], calDesk: calDesk[E.deskPm25] || [],
    };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];
    const now = Date.now(), start = now - HOURS * 3600e3;

    // ------------------------------------------- triangulation disagreement
    const vals = {
      bed: data.val(E.bedPm25), desk: data.val(E.deskPm25), dyson: data.val(E.dysonPm25),
    };
    const present = Object.values(vals).filter((v) => v !== null);
    if (present.length >= 2) {
      const spread = Math.max(...present) - Math.min(...present);
      const highest = Object.keys(vals).find((k) => vals[k] === Math.max(...present));
      const roomName = { bed: 'спальня', desk: 'робоче місце', dyson: 'Dyson' }[highest];
      out.push(banner(spread > 8 ? 'ЛОКАЛЬНЕ ДЖЕРЕЛО' : 'ТРІАНГУЛЯЦІЯ',
        `PM2.5 зараз: спальня ${fmt(vals.bed, 0)}, робоче ${fmt(vals.desk, 0)}, Dyson ${fmt(vals.dyson, 0)} мкг/м³. `
        + `Розкид ${fmt(spread, 0)} мкг/м³. `
        + (spread > 8
          ? `Найвище в точці «${roomName}» — при рівному зовнішньому AQI ${fmt(data.val(E.dysonOutdoor), 0)} це вказує на локальне джерело, а не на вулицю.`
          : 'Прилади сходяться, отже подія загальноквартирна або її немає.'),
        spread > 8 ? P.warn : P.good));
    }

    // ----------------------------------------------------------------- cards
    const cards = [];
    const bedT = data.val(E.bedTemp);
    cards.push(entityCard(ctx, {
      span: 2, size: '40px', label: 'Температура спальні', entity: E.bedTemp, dec: 1, unit: '°C',
      srcState: ctx.sourceState('qp_bed').state,
      ranges: { refMin: 16, refMax: 24, optMin: 17, optMax: 19 },
      delta: bedT === null ? '' : bedT > 19
        ? `+${fmt(bedT - 19, 1)}° над оптимумом 17–19\nE09: чергування блоками по 4 ночі`
        : 'в оптимумі 17–19',
      deltaColor: bedT > 21 ? P.alert : bedT > 19 ? P.warn : P.good,
      source: `Qingping 7fc5 · Dyson показує ${fmt(data.val(E.dysonTemp), 1)}°`,
    }));

    for (const [label, id, key, ranges, delta] of [
      ['CO₂ спальня', E.bedCo2, 'qp_bed', { refMin: 400, refMax: 1400, optMin: 400, optMax: 800 }, 'поріг фрагментації сну 900'],
      ['CO₂ робоче', E.deskCo2, 'qp_desk', { refMin: 400, refMax: 1400, optMin: 400, optMax: 800 }, 'проксі до спаду концентрації'],
      ['NO₂', E.dysonNo2, 'dyson', { refMin: 0, refMax: 25, optMin: 0, optMax: 10 }, 'більше ніде не вимірюється'],
      ['Формальдегід', E.dysonHcho, 'dyson', { refMin: 0, refMax: 0.1, optMin: 0, optMax: 0.03 }, 'поріг ВООЗ 0.1 за 30 хв'],
      ['Шум у спальні', E.bedNoise, 'qp_bed', { refMin: 0, refMax: 45, optMin: 0, optMax: 30 }, 'нічний поріг ВООЗ 30 дБ'],
      ['AQI за 15 хв', E.dysonAqi, 'dyson', { refMin: 0, refMax: 50, optMin: 0, optMax: 25 }, null],
      ['TVOC спальня', E.bedTvoc, 'qp_bed', null, 'без state_class — довгої статистики немає'],
      ['Вологість спальні', E.bedHum, 'qp_bed', { refMin: 30, refMax: 60, optMin: 40, optMax: 50 }, null],
    ]) {
      const v = data.val(id);
      cards.push(entityCard(ctx, {
        label, entity: id, dec: id === E.dysonHcho ? 3 : 1,
        srcState: ctx.sourceState(key).state,
        ranges: ranges || {},
        delta: id === E.dysonAqi
          ? `надворі ${fmt(data.val(E.dysonOutdoor), 0)} · домінує ${data.raw(E.dysonDominant) || '—'}`
          : delta || '',
        deltaColor: ranges && v !== null && ranges.optMax !== undefined && v > ranges.optMax ? P.warn : P.good,
        source: key === 'dyson' ? 'Dyson' : key === 'qp_bed' ? 'Qingping 7fc5' : 'Qingping 554b',
      }));
    }

    cards.push(entityCard(ctx, {
      label: 'Melanopic EDI', entity: null, value: null, text: '—', unit: 'лк',
      srcState: 'empty',
      emptyHint: 'AS7341 ×2 в дорозі — світло поки повністю невиміряний домен',
      source: 'новий домен: світло',
      note: 'немає джерела', noteColor: P.ref,
    }));

    cards.push(entityCard(ctx, {
      label: 'Ресурс HEPA-фільтра', entity: E.dysonFilter, dec: 0, unit: '%',
      srcState: ctx.sourceState('dyson').state,
      ranges: { refMin: 0, refMax: 100, optMin: 20, optMax: 100 },
      delta: 'нижче 20% лазерні дані стають менш надійними',
      source: 'Dyson',
    }));

    out.push(h('div.hh-cards', cards));

    // ---------------------------------------------------- PM triangulation
    const anyPm = pd.bed.length || pd.desk.length || pd.dyson.length;
    const allPm = [...pd.bed, ...pd.desk, ...pd.dyson].map((p) => p.v);
    out.push(panel(
      'Тріангуляція PM2.5 — три прилади, одна квартира',
      'Розбіжність показана, а не згладжена. Синхронний підйом усіх трьох — подія на всю квартиру; '
      + 'одиничний пік — локальне джерело поруч із конкретним сенсором. Пунктири — затяжки IQOS.',
      'Qingping ×2 · Dyson лазер',
      anyPm
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 240, yMin: 0,
            yMax: Math.max(20, Math.ceil(Math.max(1, ...allPm) * 1.15)),
            yTicks: [0, 10, 20, 30],
            xLabels: ['−24 год', '−18', '−12', '−6', 'зараз'],
            series: [
              { pts: resample(pd.bed, 120, start, now), color: ctx.accent, w: 1.6 },
              { pts: resample(pd.desk, 120, start, now), color: P.olive, w: 1.6 },
              { pts: resample(pd.dyson, 120, start, now), color: P.ref, w: 1.6 },
            ],
            thresholds: [
              { v: 15, color: P.warn, label: 'референс 15' },
              { v: 5, color: P.good, label: 'оптимум 5' },
            ],
            events: eventsFor(pd.evts, start, now, ctx, ['iqos']),
            showEvents: ctx.state.annotations,
          }),
          legendRow([
            { color: ctx.accent, label: 'спальня 7fc5' },
            { color: P.olive, label: 'робоче 554b' },
            { color: P.ref, label: 'Dyson' },
          ]),
        ])
        : emptyState('Жоден із трьох PM-сенсорів не віддав ряд за добу.'),
    ));

    // ------------------------------------------------------------ CO2 + noise
    const co2All = [...pd.co2Bed, ...pd.co2Desk].map((p) => p.v);
    out.push(panel(
      'CO₂ у двох точках і нічний шум',
      'Спальня і робоче місце на одній осі: різниця між ними показує, де провітрювання реально працює. '
      + 'Шум накладений у масштабі — нічний поріг ВООЗ 30 дБ.',
      'ppm · дБ',
      co2All.length
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 210, yMin: 350,
            yMax: Math.max(1200, Math.ceil(Math.max(...co2All) * 1.1)),
            yTicks: [400, 700, 1000, 1300],
            xLabels: ['−24 год', '−18', '−12', '−6', 'зараз'],
            series: [
              { pts: resample(pd.co2Bed, 120, start, now), color: ctx.accent, w: 1.7, fill: true },
              { pts: resample(pd.co2Desk, 120, start, now), color: P.ref, w: 1.7 },
              {
                pts: resample(pd.noise, 120, start, now).map((v) => (v === null ? null : 350 + v * 10)),
                color: P.olive, w: 1.2, dash: '3 3',
              },
            ],
            thresholds: [
              { v: 900, color: P.warn, label: 'фрагментація сну 900' },
              { v: 350 + 30 * 10, color: P.good, label: 'шум ВООЗ 30 дБ' },
            ],
            events: eventsFor(pd.evts, start, now, ctx, ['alert']),
            showEvents: ctx.state.annotations,
          }),
          legendRow([
            { color: ctx.accent, label: 'CO₂ спальня' },
            { color: P.ref, label: 'CO₂ робоче' },
            { color: P.olive, label: 'шум спальні (×10, зсув 350)' },
          ]),
        ])
        : emptyState('Ряди CO₂ порожні за це вікно.'),
    ));

    // --------------------------------------------------------- PM calendar
    const cal = calendar(pd.calBed, pd.calDesk);
    out.push(panel(
      `Календар PM2.5 по кімнатах — ${CAL_DAYS} днів`,
      'Верхній ряд кожної пари — спальня, нижній — робоче. Темніше означає гірше. '
      + 'Суцільний стовпчик — подія на всю квартиру, поодинока клітинка — локальне джерело. '
      + 'Порожні клітинки — доби без даних.',
      `${cal.filled} діб із даними`,
      cal.filled
        ? heatmap({
          cols: Math.ceil(CAL_DAYS / 7), rows: 14, cw: 12, ch: 8,
          labels: ['пн', '', 'вт', '', 'ср', '', 'чт', '', 'пт', '', 'сб', '', 'нд', ''],
          xLabels: [{ at: 0, t: `−${Math.ceil(CAL_DAYS / 7)} тижнів` }, { at: Math.ceil(CAL_DAYS / 7) - 1, t: 'зараз' }],
          cells: cal.cells,
        })
        : emptyState('Довгострокова статистика PM2.5 ще не накопичилась.'),
    ));

    return out;
  },
};

function calendar(bedRows, deskRows) {
  const map = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const v = r.mean ?? r.max;
      if (Number.isFinite(v)) m.set(dayKey(r.t), v);
    }
    return m;
  };
  const bed = map(bedRows), desk = map(deskRows);
  const cols = Math.ceil(CAL_DAYS / 7);
  const cells = [];
  let filled = 0;
  for (let i = 0; i < CAL_DAYS; i++) {
    const t = Date.now() - (CAL_DAYS - 1 - i) * 86400e3;
    const k = dayKey(t);
    const dow = (new Date(t).getDay() + 6) % 7;
    const col = Math.min(Math.floor(i / 7), cols - 1);
    [[bed.get(k), 0], [desk.get(k), 1]].forEach(([v, off]) => {
      if (v === undefined) {
        cells.push({ x: col, y: dow * 2 + off, color: null, title: `${k} · немає даних` });
      } else {
        filled++;
        cells.push({
          x: col, y: dow * 2 + off,
          color: v > 25 ? P.alert : v > 15 ? P.warn : v > 5 ? '#C79A3A' : P.good,
          op: 0.25 + Math.min(1, v / 30) * 0.65,
          title: `${k} · ${off ? 'робоче' : 'спальня'} ${fmt(v, 1)} мкг/м³`,
        });
      }
    });
  }
  return { cells, filled };
}

export { mean };
