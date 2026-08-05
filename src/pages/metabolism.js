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
    // Foodwatch keeps only the latest meal in a text helper, but the recorder
    // kept every previous value — that is where dish names and carb counts for
    // earlier meals come from.
    const mealText = data.exists(E.fwLastMeal)
      ? await data.series(E.fwLastMeal, 7 * 24, { significantOnly: false })
        .catch(() => [])
      : [];
    const mealHistory = data.exists(E.fwLastMeal)
      ? (await data.history(E.fwLastMeal, 7 * 24, { significantOnly: false }))[E.fwLastMeal] || []
      : [];

    const analysis = analyse(hist);
    const mealTimes = evts.events
      .filter((e) => e.kind === 'meal')
      .map((e) => ({ t: e.t, ...describeMeal(data, e.t, mealHistory) }));
    analysis.meals = postprandial(hist, mealTimes, evts.sessions);
    return { hist, evts, cvStats: cvStats[E.glucose] || [], mealText, ...analysis };
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

    // ------------------------------------------------------------- nutrition
    // Foodwatch is the *actual* intake; Foodie is the plan. Only the actual
    // correlates with the CGM, so plan figures are shown as a comparison and
    // never substituted for fact.
    const fw = ctx.sourceState('foodwatch');
    const kcal = data.val(E.fwKcal);
    const carbs = data.val(E.fwCarbs);
    const protein = data.val(E.fwProtein);
    const fat = data.val(E.fwFat);
    const plan = planMacros(data);
    const weight = data.val(E.wWeight);

    cards.push(entityCard(ctx, {
      label: 'Калорії зʼїдено', entity: E.fwKcal, dec: 0, unit: 'ккал',
      srcState: fw.state,
      delta: plan.kcal ? `план ${fmt(plan.kcal, 0)} ккал` : '',
      source: 'Foodwatch · факт',
      note: eatenSlots(data),
    }));
    cards.push(entityCard(ctx, {
      label: 'Вуглеводи зʼїдено', entity: E.fwCarbs, dec: 0, unit: 'г',
      srcState: fw.state,
      ranges: { refMin: 0, refMax: 400, optMin: 90, optMax: 200 },
      delta: [
        plan.carbs ? `план ${fmt(plan.carbs, 0)} г` : null,
        kcal ? `${fmt(((carbs * 4) / kcal) * 100, 0)}% енергії` : null,
      ].filter(Boolean).join(' · '),
      deltaColor: P.warn,
      source: 'Foodwatch · факт',
    }));
    cards.push(entityCard(ctx, {
      label: 'Білок зʼїдено', entity: E.fwProtein, dec: 0, unit: 'г',
      srcState: fw.state,
      ranges: { refMin: 0, refMax: 250, optMin: 110, optMax: 160 },
      delta: [
        plan.protein ? `план ${fmt(plan.protein, 0)} г` : null,
        weight && protein ? `${fmt(protein / weight, 1)} г/кг` : null,
      ].filter(Boolean).join(' · '),
      deltaColor: weight && protein && protein / weight >= 1.4 ? P.good : P.warn,
      source: 'Foodwatch · факт',
    }));
    cards.push(entityCard(ctx, {
      label: 'Жир зʼїдено', entity: E.fwFat, dec: 0, unit: 'г',
      srcState: fw.state,
      ranges: { refMin: 0, refMax: 200, optMin: 60, optMax: 100 },
      delta: [
        plan.fat ? `план ${fmt(plan.fat, 0)} г` : null,
        kcal ? `${fmt(((fat * 9) / kcal) * 100, 0)}% енергії` : null,
      ].filter(Boolean).join(' · '),
      source: 'Foodwatch · факт',
    }));

    const last = lastMeal(data);
    cards.push(entityCard(ctx, {
      label: 'Останній прийом', entity: E.fwLastMeal,
      value: last.kcal, text: last.kcal !== null ? fmt(last.kcal, 0) : '—', unit: 'ккал',
      srcState: last.kcal === null ? 'empty' : fw.state,
      ageText: last.stamp || '—',
      delta: last.name ? `${last.name}\n${last.macros}` : '',
      source: 'Foodwatch · єдиний таймстемп їжі',
      emptyHint: 'останній прийом не описаний',
    }));

    cards.push(entityCard(ctx, {
      label: 'Найвуглеводніша позиція плану',
      value: plan.top ? plan.top.carbs : null, text: plan.top ? String(plan.top.carbs) : '—',
      unit: 'г вуглеводів', size: '22px',
      srcState: plan.top ? ctx.sourceState('foodie').state : 'empty',
      ageText: data.raw(E.foodieDate) || '—',
      delta: plan.top ? plan.top.name.slice(0, 60) : '',
      deltaColor: P.warn,
      source: 'Foodie · OCR',
      entity: E.foodieDate,
    }));

    const diff = plan.kcal !== null && kcal !== null ? kcal - plan.kcal : null;
    cards.push(entityCard(ctx, {
      label: 'План проти факту',
      value: diff, text: diff === null ? '—' : `${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff), 0)}`,
      unit: 'ккал',
      srcState: diff === null ? 'empty' : fw.state,
      ageText: data.raw(E.foodieDate) || '—',
      delta: diff === null ? '' : [
        macroDiff('вуглеводи', carbs, plan.carbs),
        macroDiff('білок', protein, plan.protein),
        macroDiff('жир', fat, plan.fat),
      ].filter(Boolean).join(' · '),
      source: 'план Foodie → факт Foodwatch',
      note: 'з CGM корелює факт, а не план',
      emptyHint: 'немає обох боків порівняння',
    }));

    out.push(h('div.hh-cards', cards));

    // --------------------------------------------------------------- TIR band
    out.push(panel(
      'Час у діапазоні — розбивка',
      pd.tir
        ? `Одна смуга на всі ${pd.tir.n} записів за ${cover} діб. Клінічна ціль — понад 70% у коридорі `
          + '3.9–7.8 і менше 4% нижче 3.9. Це та сама вибірка, що й у AGP: доби без покриття в неї не входять.'
        : 'Немає ряду глюкози, з якого рахувати час у діапазоні.',
      pd.tir ? `${pd.tir.n} точок` : '',
      pd.tir ? tirBand(pd.tir, ctx) : emptyState('CGM не дав жодної точки за вікно.'),
    ));

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
            h('span', m.carbs !== null ? `${fmt(m.carbs, 0)} г вугл.` : `пік +${fmt(m.rise, 1)}`),
            h('span', { style: { color: m.walked ? P.ref : ctx.accent } }, `AUC ${fmt(m.auc, 1)}`),
          ]),
        ])))
        : emptyState('Перетинів «прийом їжі × ряд глюкози» у вікні recorder’а поки немає.'),
    ));

    // ------------------------------------------------- personal meal ranking
    const ranked = (pd.meals || []).filter((m) => m.norm !== null)
      .sort((a, b) => b.norm - a.norm);
    const unranked = (pd.meals || []).filter((m) => m.norm === null);
    out.push(panel(
      'Персональний глікемічний рейтинг страв',
      ranked.length
        ? 'AUC, нормалізований на 10 г вуглеводів. Порівнюються страви, а не окремі події, '
          + 'тому нормалізація обовʼязкова — без неї великий прийом завжди «гірший» за малий. '
          + (unranked.length
            ? `Ще ${unranked.length} прийомів без підпису вуглеводів у Foodwatch — вони не нормалізуються і в рейтинг не входять.`
            : '')
        : 'Для рейтингу потрібні прийоми, у яких Foodwatch підписав вуглеводи.',
      ranked.length ? `${ranked.length} страв` : 'n = 0',
      ranked.length
        ? h('div.hh-ranks', ranked.map((m) => {
          const max = Math.max(...ranked.map((x) => x.norm)) || 1;
          return h('div.hh-rank', [
            h('span.n', { title: m.label }, m.label),
            h('div.b', h('i', {
              style: {
                width: `${Math.max(2, (m.norm / max) * 100).toFixed(1)}%`,
                background: m.norm > max * 0.85 ? P.warn : (m.walked ? P.ref : ctx.accent),
              },
            })),
            h('span.v', `${fmt(m.norm, 2)}`),
          ]);
        }))
        : emptyState(
          'Жоден прийом у вікні не має підпису вуглеводів. Рейтинг зʼявиться, коли Foodwatch '
          + 'почне писати БЖУ разом із таймстемпом — це вхідні дані для гіпотези E07.',
        ),
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

/** Stacked time-in-range strip with the three clinical zones broken out. */
function tirBand(tir, ctx) {
  const zones = [
    { k: 'нижче 3.9', v: tir.below, c: P.alert, target: '< 4%' },
    { k: '3.9 – 7.8', v: tir.inRange, c: P.good, target: '> 70%' },
    { k: 'вище 7.8', v: tir.above, c: P.warn, target: '< 25%' },
  ];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
    h('div', {
      style: {
        display: 'flex', height: '30px', borderRadius: '6px', overflow: 'hidden',
        background: P.s2,
      },
    }, zones.map((z) => (z.v <= 0 ? null : h('i', {
      style: {
        display: 'block', width: `${z.v.toFixed(2)}%`, background: z.c, height: '30px',
      },
      title: `${z.k} — ${fmt(z.v, 1)}%`,
    })))),
    h('div', {
      style: {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px',
      },
    }, zones.map((z) => h('div', {
      style: {
        display: 'flex', flexDirection: 'column', gap: '3px', borderLeft: `3px solid ${z.c}`,
        paddingLeft: '10px',
      },
    }, [
      h('span', { style: { fontSize: '11px', color: P.mut } }, z.k),
      h('span', {
        style: {
          fontFamily: "'Geist Mono',monospace", fontSize: '17px', color: P.ink,
          fontVariantNumeric: 'tabular-nums',
        },
      }, `${fmt(z.v, 1)}%`),
      h('span', {
        style: { fontFamily: "'Geist Mono',monospace", fontSize: '9.5px', color: P.off },
      }, `ціль ${z.target}`),
    ]))),
  ]);
}

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
    out.push({
      label: meal.label || 'прийом їжі', pts, auc, rise: peak - base, walked, t: t0,
      carbs: meal.carbs ?? null,
      // AUC per 10 g of carbohydrate — meals are being compared, not single
      // events, so normalisation is mandatory. Null when carbs are unknown.
      norm: Number.isFinite(meal.carbs) && meal.carbs > 0 ? (auc / meal.carbs) * 10 : null,
    });
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

/**
 * Sum the Foodie plan for the day out of its five free-text slots, and find
 * the single highest-carbohydrate item. Each slot reads like
 * "Гречка, яловічі болі — 480 ккал, Б 38г, Ж 18г, В 48г".
 */
function planMacros(data) {
  const out = { kcal: null, protein: null, fat: null, carbs: null, top: null };
  const add = (key, v) => { if (Number.isFinite(v)) out[key] = (out[key] ?? 0) + v; };
  const grab = (txt, re) => {
    const m = re.exec(txt);
    return m ? Number(String(m[1]).replace(',', '.')) : null;
  };
  for (const id of E.foodieMeals) {
    const txt = data.raw(id);
    if (!txt) continue;
    add('kcal', grab(txt, /(\d+(?:[.,]\d+)?)\s*ккал/i));
    add('protein', grab(txt, /Б\s*(\d+(?:[.,]\d+)?)\s*г/i));
    add('fat', grab(txt, /Ж\s*(\d+(?:[.,]\d+)?)\s*г/i));
    const c = grab(txt, /В\s*(\d+(?:[.,]\d+)?)\s*г/i);
    add('carbs', c);
    if (Number.isFinite(c) && (!out.top || c > out.top.carbs)) {
      out.top = { carbs: c, name: txt.split('—')[0].trim() };
    }
  }
  return out;
}

function macroDiff(label, actual, planned) {
  if (!Number.isFinite(actual) || !Number.isFinite(planned)) return null;
  const d = actual - planned;
  return `${label} ${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), 0)} г`;
}

/** Parse the Foodwatch last-meal text: "05.08 21:19 · Назва — 238 ккал, Б 38г…" */
function lastMeal(data) {
  const txt = data.raw(E.fwLastMeal);
  if (!txt) return { kcal: null, name: '', macros: '', stamp: null };
  const stampMatch = /^(\d{2}\.\d{2}\s+\d{2}:\d{2})/.exec(txt);
  const afterDot = txt.includes('·') ? txt.slice(txt.indexOf('·') + 1) : txt;
  const name = afterDot.split('—')[0].replace(/\([^)]*\)/g, '').trim();
  const num = (re) => {
    const m = re.exec(txt);
    return m ? Number(String(m[1]).replace(',', '.')) : null;
  };
  const p = num(/Б\s*(\d+(?:[.,]\d+)?)\s*г/i);
  const f = num(/Ж\s*(\d+(?:[.,]\d+)?)\s*г/i);
  const c = num(/В\s*(\d+(?:[.,]\d+)?)\s*г/i);
  return {
    kcal: num(/(\d+(?:[.,]\d+)?)\s*ккал/i),
    name,
    macros: [p !== null ? `Б ${fmt(p, 0)}` : null, f !== null ? `Ж ${fmt(f, 0)}` : null,
      c !== null ? `В ${fmt(c, 0)}` : null].filter(Boolean).join(' · '),
    stamp: stampMatch ? stampMatch[1] : null,
  };
}

/** Which meal slots Foodwatch has already logged today. */
function eatenSlots(data) {
  const raw = data.raw(E.fwSlots);
  if (!raw || !raw.includes('|')) return null;
  const [day, list] = raw.split('|');
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) return 'сьогодні ще нічого не залоговано';
  const n = list.split(',').filter(Boolean).length;
  return n ? `залоговано слотів: ${n}` : 'сьогодні ще нічого не залоговано';
}

/**
 * Recover a meal's name and carbohydrate count.
 *
 * Foodwatch overwrites one text helper per meal, so the live state only
 * describes the latest one. The recorder history of that helper carries the
 * earlier descriptions; match each eating event to the value that was written
 * closest after it. Where no description is found the meal keeps an honest
 * timestamp and `carbs: null` rather than a guessed dish.
 */
function describeMeal(data, t, mealHistory) {
  let best = null;
  for (const row of mealHistory) {
    if (!row.s || row.s === 'unknown' || row.s === '') continue;
    const dt = row.t - t;
    if (dt < -120e3 || dt > 15 * 60e3) continue;
    if (!best || Math.abs(dt) < Math.abs(best.t - t)) best = row;
  }
  const d = new Date(t);
  const stamp = `прийом ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (!best) return { label: stamp, carbs: null };

  const txt = String(best.s);
  const carbsMatch = /В\s*(\d+(?:[.,]\d+)?)\s*г/i.exec(txt);
  const carbs = carbsMatch ? Number(String(carbsMatch[1]).replace(',', '.')) : null;
  // "05.08 21:19 · Холодник з креветкою (vecheria) — 238 ккал, Б 38г, Ж 38г, В 14г"
  const afterDot = txt.includes('·') ? txt.slice(txt.indexOf('·') + 1) : txt;
  const name = afterDot.split('—')[0].replace(/\([^)]*\)/g, '').trim();
  return { label: name || stamp, carbs: Number.isFinite(carbs) ? carbs : null };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
