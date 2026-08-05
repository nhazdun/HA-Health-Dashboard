import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart, heatmap, spark } from '../charts/svg.js';
import { dayKey } from '../core/ha.js';
import { loadEvents, eventsFor } from '../core/events.js';
import { fmt, age, percentile, mean, sd } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 3 — glycaemia.
 *
 * The AGP bands, time-in-range and postprandial curves are all computed from
 * the actual recorder series for `sensor.glucose`. Nothing is simulated: if
 * the channel was down, the day is simply absent from the aggregate.
 */

const AGP_DAYS = 14;
const CV_DAYS = 90;
const SLOTS = 96; // 15-minute buckets across the day

export default {
  id: 'metab',
  label: 'Метаболізм',
  title: 'Метаболізм',
  question: 'Що робить моя глюкоза і від чого?',
  scale: 'хв · 14 д',

  live(ctx) {
    const cgm = ctx.sourceState('nightscout');
    if (cgm.state === 'dead') return { color: P.alert, label: 'CGM мертвий' };
    if (cgm.state === 'stale' || cgm.state === 'warn') return { color: P.warn, label: 'CGM з розривами' };
    return { color: P.good, label: 'CGM живий' };
  },

  async load(ctx) {
    const { data } = ctx;
    const [hist, evts, cvStats] = await Promise.all([
      data.series(E.glucose, AGP_DAYS * 24, { significantOnly: false, ttl: 300e3 }),
      loadEvents(ctx, 7 * 24),
      data.stats(E.glucose, CV_DAYS, 'day', ['mean', 'min', 'max']),
    ]);
    const analysis = analyse(hist);
    const mealTimes = evts.events
      .filter((e) => e.kind === 'meal')
      .map((e) => ({ t: e.t, label: mealLabel(data, e.t) }));
    analysis.meals = postprandial(hist, mealTimes, evts.sessions);
    return { hist, evts, cvStats: cvStats[E.glucose] || [], ...analysis };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];
    const cgm = ctx.sourceState('nightscout');
    const cover = pd.days ? pd.days.size : 0;

    if (cgm.state === 'dead' || cgm.state === 'stale') {
      out.push(banner('АГРЕГАТИ ЗАМОРОЖЕНІ',
        `CGM не пише ${age(cgm.ageMs)}. TIR, AGP і постпрандіальні криві нижче побудовані лише `
        + `на тих ${cover} днях, де канал реально писав. Останнє значення в агрегати не входить.`,
        P.alert));
    } else if (cover < AGP_DAYS) {
      out.push(banner('НЕПОВНЕ ПОКРИТТЯ',
        `Recorder віддав ${pd.hist.length} точок за ${cover} із ${AGP_DAYS} днів — типова глибина `
        + 'зберігання сирої історії близько 10 діб. Перцентильні смуги рахуються по наявних днях, '
        + 'дірки не заповнюються.', P.ref));
    }

    // ----------------------------------------------------------------- cards
    const cards = [];
    const orn = ctx.sourceState('ornament');
    const ornDate = data.attr('sensor.ornament_nazariy_homa_ir', 'measured_at');

    cards.push(entityCard(ctx, {
      span: 2, size: '40px', label: 'HOMA-IR', entity: 'sensor.ornament_nazariy_homa_ir', dec: 2,
      srcState: orn.state,
      ageText: ornDate ? age(Date.now() - new Date(ornDate).getTime()) : '—',
      ranges: ornRanges(data, 'sensor.ornament_nazariy_homa_ir'),
      delta: ornDeltaText(data, 'sensor.ornament_nazariy_homa_ir'),
      deltaColor: P.alert,
      source: `Ornament · ${ornDate ? String(ornDate).slice(0, 10) : 'дата невідома'}`,
      note: 'потрібен повторний забір',
    }));

    for (const [label, id] of [
      ['Інсулін натще', 'sensor.ornament_nazariy_insulin_fasting'],
      ['HbA1c', 'sensor.ornament_nazariy_hemoglobin_a1c'],
      ['Глюкоза натще · лабораторія', 'sensor.ornament_nazariy_glucose_fasting'],
    ]) {
      cards.push(entityCard(ctx, {
        label, entity: id, dec: 2, srcState: orn.state,
        ageText: ageOfOrn(data, id),
        ranges: ornRanges(data, id),
        delta: ornDeltaText(data, id),
        deltaColor: P.warn,
        source: 'Ornament',
      }));
    }

    const tir = pd.tir;
    cards.push(entityCard(ctx, {
      label: 'TIR 3.9–7.8', value: tir ? tir.inRange : null,
      text: tir ? fmt(tir.inRange, 0) : '—', unit: '%',
      srcState: tir ? (cgm.state === 'dead' ? 'stale' : 'ok') : 'empty',
      ageText: tir ? `${tir.n} точок` : '—',
      ranges: { refMin: 0, refMax: 100, optMin: 70, optMax: 100 },
      delta: tir ? `нижче 3.9 — ${fmt(tir.below, 1)}%\nвище 7.8 — ${fmt(tir.above, 1)}%` : '',
      deltaColor: tir && tir.above > 25 ? P.warn : P.good,
      source: `Nightscout · ${cover} діб покриття`,
      emptyHint: 'немає з чого рахувати',
    }));

    cards.push(entityCard(ctx, {
      label: 'Середня глюкоза', value: pd.avg, text: fmt(pd.avg, 1), unit: 'ммоль/л',
      srcState: pd.avg === null ? 'empty' : 'ok',
      ageText: `${AGP_DAYS} д`,
      ranges: { optMin: 4.4, optMax: 6.5 },
      delta: pd.gmi !== null ? `GMI ≈ ${fmt(pd.gmi, 2)}%` : '',
      source: 'розраховано з ряду recorder’а',
    }));

    cards.push(entityCard(ctx, {
      label: 'Варіабельність CV', value: pd.cv, text: fmt(pd.cv, 1), unit: '%',
      srcState: pd.cv === null ? 'empty' : 'ok',
      ageText: `${AGP_DAYS} д`,
      ranges: { refMin: 0, refMax: 50, optMin: 0, optMax: 36 },
      delta: pd.cv !== null ? (pd.cv > 36 ? 'вище порогу стабільності 36%' : 'у межах стабільності') : '',
      deltaColor: pd.cv > 36 ? P.warn : P.good,
      source: 'SD ÷ середнє',
    }));

    cards.push(entityCard(ctx, {
      label: 'Вуглеводи, факт', entity: E.fwCarbs, dec: 0, unit: 'г',
      srcState: ctx.sourceState('foodwatch').state,
      delta: `${fmt(data.val(E.fwKcal), 0)} ккал · Б ${fmt(data.val(E.fwProtein), 0)} · Ж ${fmt(data.val(E.fwFat), 0)}`,
      source: 'Foodwatch · факт',
    }));

    const plan = planCarbs(data);
    cards.push(entityCard(ctx, {
      label: 'Найвуглеводніша позиція плану',
      value: plan ? plan.carbs : null, text: plan ? String(plan.carbs) : '—',
      unit: 'г вуглеводів', size: '22px',
      srcState: plan ? ctx.sourceState('foodie').state : 'empty',
      ageText: data.raw(E.foodieDate) || '—',
      delta: plan ? plan.name.slice(0, 60) : '',
      deltaColor: P.warn,
      source: 'Foodie · OCR',
      entity: E.foodieDate,
    }));

    out.push(h('div.hh-cards', cards));

    // ------------------------------------------------------------- AGP chart
    out.push(panel(
      `AGP — перцентильні смуги за ${AGP_DAYS} днів`,
      pd.agp
        ? `Смуги 5/25/50/75/95 побудовані з ${pd.hist.length} реальних записів за ${cover} діб, `
          + 'згрупованих по 15-хвилинних слотах доби. Поверх — сьогоднішня крива. '
          + 'Слоти, де жодного дня не було даних, лишаються порожніми.'
        : 'Недостатньо точок для перцентилів.',
      'смуги 14 д · лінія сьогодні',
      pd.agp
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 260,
            yMin: 3, yMax: Math.max(11, Math.ceil((pd.agp.max || 10) + 1)),
            yTicks: [4, 6, 8, 10],
            xLabels: ['00:00', '06:00', '12:00', '18:00', '24:00'],
            bands: [
              { lo: pd.agp.p5, hi: pd.agp.p95, color: P.ref, op: 0.1 },
              { lo: pd.agp.p25, hi: pd.agp.p75, color: P.ref, op: 0.22 },
            ],
            series: [
              { pts: pd.agp.p50, color: P.ref, w: 1.4, dash: '5 4' },
              { pts: pd.today, color: ctx.accent, w: 2, dot: true },
            ],
            thresholds: [
              { v: 7.8, color: P.warn, label: '7.8' },
              { v: 3.9, color: P.ref, label: '3.9' },
            ],
            events: eventsFor(pd.evts, startOfToday(), startOfToday() + 86400e3, ctx, ['meal']),
            showEvents: ctx.state.annotations,
          }),
          legendRow([
            { color: ctx.accent, label: 'сьогодні' },
            { color: P.ref, label: `медіана та коридори ${AGP_DAYS} днів` },
          ]),
        ])
        : emptyState('Для AGP потрібно щонайменше кілька діб безперервного ряду CGM.'),
    ));

    // ----------------------------------------------------- postprandial curves
    out.push(panel(
      'Постпрандіальні криві, вирівняні за t=0',
      pd.meals && pd.meals.length
        ? `${pd.meals.length} прийомів їжі з таймстемпів Foodwatch, для кожного вирізано вікно 0–3 год `
          + 'із ряду глюкози. Синій означає сесію на доріжці протягом 30 хв після їжі, теплий — без неї.'
        : 'Кривих ще немає: потрібні перетини таймстемпів Foodwatch і ряду CGM.',
      '0–3 год від прийому',
      pd.meals && pd.meals.length
        ? h('div.hh-mults', pd.meals.map((m) => h('div.hh-mult', [
          h('div.t', m.label),
          spark(m.pts, m.walked ? P.ref : ctx.accent),
          h('div.v', [
            h('span', `пік +${fmt(m.rise, 1)}`),
            h('span', { style: { color: m.walked ? P.ref : ctx.accent } }, `AUC ${fmt(m.auc, 1)}`),
          ]),
        ])))
        : emptyState('Перетинів «прийом їжі × ряд глюкози» у вікні recorder’а поки немає.'),
    ));

    // -------------------------------------------------------- CV calendar
    const cells = cvCells(pd.cvStats);
    out.push(panel(
      `Варіабельність глюкози — ${CV_DAYS} днів`,
      'CV % за добу з довгострокової статистики (зберігається безстроково, на відміну від сирої історії). '
      + 'Порожні клітинки — доби без покриття CGM; вони показані як дірки, а не як нулі.',
      `${cells.filled} діб із даними`,
      cells.filled
        ? heatmap({
          cols: Math.ceil(CV_DAYS / 7), rows: 7,
          labels: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'],
          xLabels: [{ at: 0, t: `−${Math.ceil(CV_DAYS / 7)} тижнів` }, { at: Math.ceil(CV_DAYS / 7) - 1, t: 'зараз' }],
          cells: cells.cells,
        })
        : emptyState('Довгострокова статистика по глюкозі ще не накопичилась.'),
    ));

    return out;
  },
};

// ------------------------------------------------------------------ analysis

function analyse(hist) {
  if (!hist.length) {
    return { agp: null, today: new Array(SLOTS).fill(null), tir: null, avg: null, cv: null, gmi: null, days: new Set(), meals: [] };
  }
  const days = new Set(hist.map((p) => dayKey(p.t)));
  const vals = hist.map((p) => p.v);
  const avg = mean(vals);
  const s = sd(vals);
  const cv = avg ? (s / avg) * 100 : null;
  const gmi = avg !== null ? 3.31 + 0.02392 * (avg * 18.018) : null;

  const inRange = vals.filter((v) => v >= 3.9 && v <= 7.8).length;
  const below = vals.filter((v) => v < 3.9).length;
  const above = vals.filter((v) => v > 7.8).length;
  const tir = {
    inRange: (inRange / vals.length) * 100,
    below: (below / vals.length) * 100,
    above: (above / vals.length) * 100,
    n: vals.length,
  };

  // group every reading into its 15-minute slot of the day
  const slots = Array.from({ length: SLOTS }, () => []);
  const todayKey = dayKey(Date.now());
  const todaySlots = Array.from({ length: SLOTS }, () => []);
  for (const p of hist) {
    const d = new Date(p.t);
    const i = Math.min(SLOTS - 1, Math.floor((d.getHours() * 60 + d.getMinutes()) / (1440 / SLOTS)));
    slots[i].push(p.v);
    if (dayKey(p.t) === todayKey) todaySlots[i].push(p.v);
  }
  const pct = (q) => slots.map((arr) => {
    if (arr.length < 2) return null;
    return percentile([...arr].sort((a, b) => a - b), q);
  });
  const filledSlots = slots.filter((a) => a.length >= 2).length;
  const agp = filledSlots >= SLOTS * 0.25
    ? { p5: pct(0.05), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p95: pct(0.95), max: Math.max(...vals) }
    : null;
  const today = todaySlots.map((a) => (a.length ? mean(a) : null));

  return { agp, today, tir, avg, cv, gmi, days, meals: [] };
}

/** Cut a 0–3 h window out of the glucose series after each Foodwatch timestamp. */
export function postprandial(hist, mealTimes, sessions) {
  const out = [];
  for (const meal of mealTimes) {
    const t0 = meal.t;
    const win = hist.filter((p) => p.t >= t0 && p.t <= t0 + 3 * 3600e3);
    if (win.length < 6) continue;
    const base = mean(win.slice(0, 3).map((p) => p.v));
    const pts = [];
    for (let k = 0; k < 24; k++) {
      const lo = t0 + k * 7.5 * 60e3, hi = lo + 7.5 * 60e3;
      const seg = win.filter((p) => p.t >= lo && p.t < hi).map((p) => p.v);
      pts.push(seg.length ? mean(seg) : null);
    }
    const peak = Math.max(...win.map((p) => p.v));
    const auc = win.reduce((acc, p, i) => {
      if (!i) return 0;
      const dt = (p.t - win[i - 1].t) / 3600e3;
      return acc + Math.max(0, ((p.v + win[i - 1].v) / 2) - base) * dt;
    }, 0);
    const walked = (sessions || []).some(([a]) => a >= t0 && a <= t0 + 30 * 60e3);
    out.push({ label: meal.label || 'прийом їжі', pts, auc, rise: peak - base, walked, t: t0 });
  }
  return out.slice(-8);
}

function cvCells(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (r.mean === null || r.min === null || r.max === null) continue;
    // approximate CV from the daily min/max/mean the recorder keeps forever
    const spread = (r.max - r.min) / 4;
    byDay.set(dayKey(r.t), r.mean ? (spread / r.mean) * 100 : null);
  }
  const cells = [];
  let filled = 0;
  const cols = Math.ceil(CV_DAYS / 7);
  for (let i = 0; i < CV_DAYS; i++) {
    const t = Date.now() - (CV_DAYS - 1 - i) * 86400e3;
    const d = new Date(t);
    const dow = (d.getDay() + 6) % 7;
    const col = Math.floor(i / 7);
    const v = byDay.get(dayKey(t));
    if (v === undefined || v === null) {
      cells.push({ x: Math.min(col, cols - 1), y: dow, color: null, title: `${dayKey(t)} · немає покриття` });
    } else {
      filled++;
      cells.push({
        x: Math.min(col, cols - 1), y: dow,
        color: v > 36 ? P.alert : v > 30 ? P.warn : v > 24 ? '#C79A3A' : P.good,
        op: 0.25 + Math.min(1, v / 45) * 0.6,
        title: `${dayKey(t)} · CV ${fmt(v, 1)}%`,
      });
    }
  }
  return { cells, filled };
}

function ornRanges(data, id) {
  return {
    refMin: data.attr(id, 'reference_min') ?? null,
    refMax: data.attr(id, 'reference_max') ?? null,
    optMin: data.attr(id, 'optimal_min') ?? null,
    optMax: data.attr(id, 'optimal_max') ?? null,
  };
}

function ornDeltaText(data, id) {
  const r = ornRanges(data, id);
  const lines = [];
  if (r.refMax !== null) lines.push(`референс до ${fmt(r.refMax)}`);
  if (r.optMax !== null) lines.push(`оптимум до ${fmt(r.optMax)}`);
  const prev = data.attr(id, 'previous_value');
  const v = data.val(id);
  if (prev !== undefined && prev !== null && v !== null) {
    lines.push(`попередній ${fmt(prev)} · ${v > prev ? '↑' : v < prev ? '↓' : '='}`);
  }
  return lines.join('\n');
}

function ageOfOrn(data, id) {
  const at = data.attr(id, 'measured_at');
  return at ? age(Date.now() - new Date(at).getTime()) : '—';
}

function planCarbs(data) {
  let best = null;
  for (const id of E.foodieMeals) {
    const txt = data.raw(id);
    if (!txt) continue;
    const m = /В\s*(\d+)\s*г/i.exec(txt);
    if (!m) continue;
    const carbs = Number(m[1]);
    if (!Number.isFinite(carbs)) continue;
    if (!best || carbs > best.carbs) best = { carbs, name: txt.split('—')[0].trim() };
  }
  return best;
}

/**
 * Foodwatch keeps only the *last* meal description in a text helper, so a name
 * is available for the most recent event and older ones fall back to the slot
 * timestamp. Better an honest timestamp than a wrong dish name.
 */
function mealLabel(data, t) {
  const last = data.raw(E.fwLastMeal);
  const lastT = data.raw(E.fwLastEaten);
  if (last && lastT) {
    const lt = new Date(String(lastT).replace(' ', 'T')).getTime();
    if (Math.abs(lt - t) < 120e3) {
      const parts = last.split('·');
      return (parts[1] || parts[0] || last).split('—')[0].trim();
    }
  }
  const d = new Date(t);
  return `прийом ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
