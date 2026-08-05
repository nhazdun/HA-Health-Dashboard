import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart } from '../charts/svg.js';
import { dayKey } from '../core/ha.js';
import { fmt, age, rolling, mean } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 4 — recomposition.
 *
 * Bioimpedance carries ±3–5% noise, which is roughly ±1.2 percentage points of
 * body fat. Therefore the primary line is always a 7-day rolling mean with the
 * raw points visible behind it, and the noise corridor is drawn explicitly so
 * an insignificant change cannot be read as progress.
 */

const DAYS = 120;
const NOISE = 0.04; // ±4% of the reading

export default {
  id: 'body',
  label: 'Тіло',
  title: 'Тіло',
  question: 'Чи йде рекомпозиція?',
  scale: 'тижні',

  live(ctx) {
    const w = ctx.sourceState('withings');
    if (w.state === 'dead' || w.state === 'empty') return { color: P.alert, label: 'ваги мовчать' };
    return { color: P.warn, label: 'низька довіра · шум імпедансу' };
  },

  async load(ctx) {
    const { data } = ctx;
    const ids = [E.wFat, E.wMuscle, E.wWeight, E.wFatFree, E.wBone].filter((id) => data.exists(id));
    const stats = await data.stats(ids, DAYS, 'day', ['mean', 'min', 'max']);
    const grid = buildGrid(stats, ids, DAYS);
    return { stats, grid, ids };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];
    const w = ctx.sourceState('withings');
    const battery = data.raw(E.bodyScanBattery);

    const fatSeries = pd.grid[E.wFat] || [];
    const fatObs = fatSeries.filter(Number.isFinite).length;
    const fatRoll = rolling(fatSeries, 7);
    const musRoll = rolling(pd.grid[E.wMuscle] || [], 7);

    out.push(banner('ШУМ',
      `Шум біоімпедансу ±3–5% — це ±${fmt((data.val(E.wFat) || 24) * NOISE, 1)} процентного пункту жиру. `
      + `Тренд за ${DAYS} днів реальний; різниця між вчора і сьогодні — ні. Тому головна лінія тут завжди `
      + `ковзне середнє, а сирі точки лишаються видимими позаду. Зважувань у вікні: ${fatObs}.`,
      P.warn));

    // ----------------------------------------------------------------- cards
    const cards = [];
    const fatNow = lastFinite(fatRoll);
    cards.push(entityCard(ctx, {
      span: 2, size: '40px', label: 'Жир · 7-денне ковзне',
      value: fatNow, text: fmt(fatNow, 1), unit: '%',
      srcState: fatNow === null ? 'empty' : 'low',
      ageText: age(data.ageMs(E.wFat)),
      ranges: { optMin: 10, optMax: 20 },
      delta: trendText(fatRoll, 'п.п.'),
      deltaColor: trendColor(fatRoll, true),
      source: 'Withings · біоімпеданс',
      note: 'одне зважування нічого не значить',
      entity: E.wFat,
      emptyHint: 'у статистиці ще немає зважувань',
    }));

    cards.push(entityCard(ctx, {
      label: 'М’язова маса', entity: E.wMuscle, dec: 2, unit: 'кг',
      srcState: w.state, ageText: age(data.ageMs(E.wMuscle)),
      delta: trendText(musRoll, 'кг'),
      deltaColor: trendColor(musRoll, false),
      source: 'Withings',
    }));
    cards.push(entityCard(ctx, {
      label: 'Вага', entity: E.wWeight, dec: 2, unit: 'кг',
      srcState: w.state, ageText: age(data.ageMs(E.wWeight)),
      delta: trendText(rolling(pd.grid[E.wWeight] || [], 7), 'кг'),
      deltaColor: P.off,
      source: 'Withings',
    }));
    cards.push(entityCard(ctx, {
      label: 'ІМТ', entity: 'sensor.ornament_nazariy_body_mass_index_averaged', dec: 2, unit: 'кг/м²',
      srcState: ctx.sourceState('ornament').state,
      ageText: ornAge(data, 'sensor.ornament_nazariy_body_mass_index_averaged'),
      ranges: ornRanges(data, 'sensor.ornament_nazariy_body_mass_index_averaged'),
      delta: 'оптимум 20–25',
      deltaColor: P.warn,
      source: 'Ornament · життєві показники',
    }));
    cards.push(entityCard(ctx, {
      label: 'Безжирова маса', entity: E.wFatFree, dec: 2, unit: 'кг',
      srcState: w.state, ageText: age(data.ageMs(E.wFatFree)),
      delta: 'м’язи + кістки + вода',
      source: 'Withings',
    }));
    cards.push(entityCard(ctx, {
      label: 'Жирова маса', entity: E.wFatMass, dec: 2, unit: 'кг',
      srcState: w.state, ageText: age(data.ageMs(E.wFatMass)),
      delta: fatNow !== null && data.val(E.wWeight)
        ? `${fmt((data.val(E.wFatMass) / data.val(E.wWeight)) * 100, 1)}% від ваги` : '',
      source: 'Withings',
    }));
    cards.push(entityCard(ctx, {
      label: 'Сегментний аналіз', entity: 'sensor.nh_health_withings_fat_mass_in_torso',
      dec: 2, unit: 'кг',
      srcState: 'empty',
      emptyHint: battery === 'low'
        ? 'батарея Body Scan розряджена — сегментний аналіз і ЕКГ недоступні'
        : 'сегментні сенсори не віддають значень',
      source: 'Withings Body Scan',
      note: battery ? `батарея: ${battery}` : null,
      noteColor: battery === 'low' ? P.alert : P.off,
    }));
    cards.push(entityCard(ctx, {
      label: 'Сила хвату', entity: null,
      value: null, text: '—', unit: 'кг',
      srcState: 'empty',
      emptyHint: 'домен із нульовим покриттям — WH-C06 в дорозі',
      delta: '',
      source: 'E24 чекає на залізо',
      note: 'немає джерела',
      noteColor: P.ref,
    }));

    out.push(h('div.hh-cards', cards));

    // ------------------------------------------------------------ main chart
    const all = [...fatSeries, ...(pd.grid[E.wMuscle] || [])].filter(Number.isFinite);
    out.push(panel(
      `Рекомпозиція — ${DAYS} днів`,
      fatObs >= 3
        ? 'Сирі точки — напівпрозорі позаду, ковзне 7-денне — суцільною. Затінена смуга — коридор шуму '
          + `±4%: поки зміна лишається всередині неї, вона незначуща. Реальних зважувань у вікні: ${fatObs}.`
        : 'Для тренду потрібно щонайменше три зважування у вікні.',
      'жир % · м’язи кг',
      fatObs >= 3
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 270,
            yMin: Math.floor(Math.min(...all) - 2), yMax: Math.ceil(Math.max(...all) + 2),
            yTicks: ticks(Math.min(...all) - 2, Math.max(...all) + 2),
            xLabels: [`−${DAYS} д`, `−${Math.round(DAYS * 0.66)}`, `−${Math.round(DAYS * 0.33)}`, 'сьогодні'],
            bands: [{
              lo: fatRoll.map((v) => (v === null ? null : v * (1 - NOISE))),
              hi: fatRoll.map((v) => (v === null ? null : v * (1 + NOISE))),
              color: P.warn, op: 0.1,
            }],
            series: [
              { pts: fatSeries, color: ctx.accent, w: 0.9, op: 0.32 },
              { pts: fatRoll, color: ctx.accent, w: 2.2, dot: true },
              { pts: pd.grid[E.wMuscle] || [], color: P.ref, w: 0.9, op: 0.28 },
              { pts: musRoll, color: P.ref, w: 2.2, dot: true },
            ],
            thresholds: [{ v: 20, color: P.good, label: 'ціль по жиру 20%' }],
          }),
          legendRow([
            { color: ctx.accent, label: 'жир % — ковзне 7 д' },
            { color: P.ref, label: 'м’язи кг — ковзне 7 д' },
            { color: P.warn, label: 'коридор шуму ±4%' },
          ]),
        ])
        : emptyState(
          `У довгостроковій статистиці ${fatObs} зважувань за ${DAYS} днів. `
          + 'Для гіпотези E23 потрібна щоденність — тренд у шумі імпедансу інакше не видно.',
        ),
    ));

    // -------------------------------------------------------- goal corridor
    if (fatNow !== null) {
      const weeks = 26;
      const rate = 0.15; // realistic: ~0.15 pp of body fat per week
      const proj = Array.from({ length: weeks }, (_, i) => Math.max(20, fatNow - i * rate));
      out.push(panel(
        'Прогрес до цілі 20% жиру',
        `Від поточних ${fmt(fatNow, 1)}% при реалістичному темпі 0.15 п.п. на тиждень ціль досяжна `
        + `приблизно за ${Math.max(0, Math.ceil((fatNow - 20) / rate))} тижнів. Коридор — той самий шум ±4%.`,
        'проєкція, не вимір',
        lineChart({
          h: 180,
          yMin: 18, yMax: Math.ceil(fatNow + 2),
          yTicks: [20, 22, 24, 26],
          xLabels: ['зараз', '+9 тиж', '+18 тиж', '+26 тиж'],
          bands: [{
            lo: proj.map((v) => v * (1 - NOISE)), hi: proj.map((v) => v * (1 + NOISE)),
            color: P.ref, op: 0.12,
          }],
          series: [{ pts: proj, color: P.ref, w: 1.8, dash: '5 4' }],
          thresholds: [{ v: 20, color: P.good, label: 'ціль 20%' }],
        }),
      ));
    }

    return out;
  },
};

// ------------------------------------------------------------------ helpers

function buildGrid(stats, ids, days) {
  const grid = {};
  for (const id of ids) {
    const byDay = new Map();
    for (const r of stats[id] || []) {
      const v = r.mean ?? r.max ?? r.min;
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

function lastFinite(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i];
  return null;
}

function trendText(roll, unit) {
  const vals = roll.filter(Number.isFinite);
  if (vals.length < 4) return 'тренду ще немає';
  const first = mean(vals.slice(0, Math.max(1, Math.floor(vals.length * 0.2))));
  const last = mean(vals.slice(-Math.max(1, Math.floor(vals.length * 0.2))));
  const d = last - first;
  return `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), 2)} ${unit} за вікно`;
}

function trendColor(roll, lowerIsBetter) {
  const vals = roll.filter(Number.isFinite);
  if (vals.length < 4) return P.off;
  const d = vals[vals.length - 1] - vals[0];
  if (Math.abs(d) < 0.2) return P.off;
  return (d < 0) === !!lowerIsBetter ? P.good : P.warn;
}

function ticks(lo, hi) {
  const step = Math.max(1, Math.round((hi - lo) / 4));
  return [0, 1, 2, 3].map((i) => Math.round(lo + step * (i + 0.5)));
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
