import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow, cardHeading } from '../core/ui.js';
import { lineChart, calendarChart, scatterChart, spark } from '../charts/svg.js';
import { dayKey, resample } from '../core/ha.js';
import { loadEvents } from '../core/events.js';
import { fmt, age, percentile, mean, sd, linreg, NO_DATA } from '../core/format.js';
import { E } from '../core/registry.js';

/**
 * Page 3 — glycaemia, framed around spikes.
 *
 * A daily average hides the thing that actually does damage: the rise after a
 * meal. So the page finds every excursion above the upper target in the real
 * `sensor.glucose` series, attributes it to the meal before it, and ranks
 * dishes by how far they push glucose up — never by calories.
 *
 * Everything here is computed from the recorder. Where a dish has been eaten
 * only once the page says n=1 rather than presenting it as an established
 * property of the dish.
 */

const AGP_DAYS = 14;
const CV_DAYS = 90;
const SLOTS = 96; // 15-minute buckets across the day
const SPIKE = 7.8; // mmol/L — upper target
const LOW = 3.9;

export default {
  id: 'metab',
  label: 'Metabolism',
  title: 'Metabolism',
  question: 'What is my glucose doing, and driven by what?',
  scale: 'min · 14 d',
  dayScoped: true,

  live(ctx) {
    const cgm = ctx.sourceState('nightscout');
    if (cgm.state === 'dead') return { color: P.alert, label: 'CGM dead' };
    if (cgm.state === 'stale' || cgm.state === 'warn') return { color: P.warn, label: 'CGM has gaps' };
    return { color: P.good, label: 'CGM live' };
  },

  async load(ctx) {
    const { data } = ctx;
    const [hist, evts, cvStats] = await Promise.all([
      data.series(E.glucose, AGP_DAYS * 24, { significantOnly: false, ttl: 300e3 }),
      loadEvents(ctx, 7 * 24),
      data.stats(E.glucose, CV_DAYS, 'day', ['mean', 'min', 'max']),
    ]);

    // Foodwatch overwrites one text helper per meal. The live state describes
    // only the latest meal; the recorder holds every previous description.
    const mealHistory = data.exists(E.fwLastMeal)
      ? (await data.history(E.fwLastMeal, 7 * 24, { significantOnly: false }))[E.fwLastMeal] || []
      : [];

    const analysis = analyse(hist, ctx.state.dayOffset);
    const mealTimes = evts.events
      .filter((e) => e.kind === 'meal')
      .map((e) => ({ t: e.t, ...describeMeal(e.t, mealHistory) }));
    const meals = postprandial(hist, mealTimes, evts.sessions);

    return {
      hist, evts, mealHistory,
      cvStats: cvStats[E.glucose] || [],
      ...analysis,
      // These depend on the meal windows, so they can only be derived once the
      // postprandial cut has run — analyse() alone cannot know about meals.
      ...mealStats(meals),
      meals,
      dishes: rankDishes(meals),
      today: nutritionToday(data, mealHistory),
    };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];
    const cgm = ctx.sourceState('nightscout');
    const cover = pd.days ? pd.days.size : 0;
    const sp = pd.spikes;

    // ---------------------------------------------------------------- banner
    out.push(banner('SPIKE FOCUS',
      `A spike is a rise above ${SPIKE} mmol/L after a meal. This page finds each spike in the real `
      + 'series and links it to the meal before it. Rank a dish by its peak rise and not by its calories. '
      + (cgm.state === 'dead' || cgm.state === 'stale'
        ? `The CGM has been silent for ${age(cgm.ageMs)}, so everything below covers the last days it wrote.`
        : `The window holds ${pd.hist.length} records over ${cover} days.`),
      cgm.state === 'dead' || cgm.state === 'stale' ? P.alert : P.warn));

    // ----------------------------------------------------------------- cards
    const cards = [];
    const worst = pd.dishes[0] || null;
    const best = pd.dishes.length > 1 ? pd.dishes[pd.dishes.length - 1] : null;

    cards.push(cardHeading('Spikes', `across the ${cover} days the CGM actually covered`));
    cards.push(entityCard(ctx, {
      span: 2, size: '40px', label: 'Spikes above 7.8',
      value: sp ? sp.perDay : null,
      text: sp ? fmt(sp.perDay, 1) : NO_DATA, unit: 'per day',
      srcState: sp ? (cgm.state === 'dead' ? 'stale' : 'ok') : 'empty',
      ageText: sp ? `${sp.days} days` : NO_DATA,
      color: sp && sp.perDay > 2 ? P.alert : P.warn,
      delta: sp
        ? `${sp.total} in total over ${sp.days} days\nhighest peak ${fmt(sp.maxPeak, 1)} mmol/L`
        : '',
      deltaColor: P.alert,
      source: `Nightscout · ${cover} days of coverage`,
      emptyHint: 'nothing to compute from',
    }));

    cards.push(entityCard(ctx, {
      label: 'Largest peak rise',
      value: pd.maxRise, text: pd.maxRise === null ? NO_DATA : fmt(pd.maxRise, 1), unit: 'mmol/L',
      srcState: pd.maxRise === null ? 'empty' : 'ok',
      ageText: `${pd.meals.length} meals`,
      color: P.alert,
      delta: pd.maxRiseMeal ? pd.maxRiseMeal.label : '',
      deltaColor: P.alert,
      source: 'peak minus the pre-meal value',
      emptyHint: 'no meal window overlaps the glucose series',
    }));

    cards.push(entityCard(ctx, {
      label: 'Time above 7.8',
      value: sp ? sp.minutesAbove : null,
      text: sp ? fmt(sp.minutesAbove, 0) : NO_DATA, unit: 'min/day',
      srcState: sp ? 'ok' : 'empty',
      ageText: sp ? `${sp.days} days` : NO_DATA,
      delta: sp ? `${fmt(sp.pctAbove, 1)}% of the day` : '',
      deltaColor: sp && sp.pctAbove > 8 ? P.warn : P.good,
      source: 'Nightscout',
    }));

    cards.push(entityCard(ctx, {
      label: 'Mean time to peak',
      value: pd.meanTimeToPeak,
      text: pd.meanTimeToPeak === null ? NO_DATA : fmt(pd.meanTimeToPeak, 0), unit: 'min',
      srcState: pd.meanTimeToPeak === null ? 'empty' : 'ok',
      ageText: `${pd.meals.length} meals`,
      delta: pd.meanReturn !== null ? `return in ${fmt(pd.meanReturn, 1)} h on average` : '',
      source: 'aligned meal windows',
      emptyHint: 'no aligned meal window yet',
    }));

    cards.push(cardHeading('Dishes', 'ranked by average peak rise, with the repeat count on each'));
    cards.push(entityCard(ctx, {
      label: 'Worst dish',
      value: worst ? worst.rise : null,
      text: worst ? fmt(worst.rise, 1) : NO_DATA, unit: 'mmol/L rise', size: '22px',
      srcState: worst ? 'ok' : 'empty',
      ageText: worst ? `n ${worst.n}` : NO_DATA,
      color: P.alert,
      delta: worst ? `${worst.name}\n${dishMeta(worst)}` : '',
      deltaColor: P.alert,
      source: 'personal spike ranking',
      note: worst && worst.n < 3 ? `only ${worst.n} repeat${worst.n > 1 ? 's' : ''}` : null,
      emptyHint: 'no dish has a named meal window yet',
    }));

    cards.push(entityCard(ctx, {
      label: 'Best dish',
      value: best ? best.rise : null,
      text: best ? fmt(best.rise, 1) : NO_DATA, unit: 'mmol/L rise', size: '22px',
      srcState: best ? 'ok' : 'empty',
      ageText: best ? `n ${best.n}` : NO_DATA,
      color: P.good,
      delta: best ? `${best.name}\n${dishMeta(best)}` : '',
      deltaColor: P.good,
      source: 'personal spike ranking',
      note: best && best.n < 3 ? `only ${best.n} repeat${best.n > 1 ? 's' : ''}` : null,
      emptyHint: 'at least two distinct dishes are needed',
    }));

    const walk = pd.walkEffect;
    cards.push(entityCard(ctx, {
      label: 'Walk effect',
      value: walk ? walk.pct : null,
      text: walk ? `${walk.pct >= 0 ? '+' : '−'}${fmt(Math.abs(walk.pct), 0)}` : NO_DATA,
      unit: '% peak rise', size: '22px',
      srcState: walk ? 'ok' : 'empty',
      ageText: walk ? `${walk.withN} vs ${walk.withoutN}` : NO_DATA,
      color: walk && walk.pct < 0 ? P.good : P.warn,
      delta: walk
        ? `walk within 30 min after the meal\n${fmt(walk.withMean, 2)} vs ${fmt(walk.withoutMean, 2)} mmol/L`
        : '',
      deltaColor: walk && walk.pct < 0 ? P.good : P.warn,
      source: 'E02 · both groups from the recorder',
      emptyHint: 'needs meals both with and without a walk after',
    }));

    // ------------------------------------------------------------- nutrition
    cards.push(cardHeading('Food eaten today',
      'actual intake from Foodwatch against the Foodie plan'));
    const t = pd.today;
    const nutritionState = t.stale ? 'stale' : ctx.sourceState('foodwatch').state;
    const plan = planMacros(data);
    const weight = data.val(E.wWeight);

    cards.push(entityCard(ctx, {
      label: 'Carbs eaten', value: t.carbs, text: t.carbs === null ? NO_DATA : fmt(t.carbs, 0), unit: 'g',
      srcState: t.carbs === null ? 'empty' : nutritionState,
      ageText: t.ageText,
      ranges: { refMin: 0, refMax: 400, optMin: 90, optMax: 200 },
      delta: [
        plan.carbs ? `plan ${fmt(plan.carbs, 0)} g` : null,
        t.kcal ? `${fmt(((t.carbs * 4) / t.kcal) * 100, 0)}% of energy` : null,
      ].filter(Boolean).join(' · '),
      deltaColor: P.warn,
      source: t.source,
      note: t.note,
      emptyHint: t.emptyHint,
    }));
    cards.push(entityCard(ctx, {
      label: 'Calories eaten', value: t.kcal, text: t.kcal === null ? NO_DATA : fmt(t.kcal, 0), unit: 'kcal',
      srcState: t.kcal === null ? 'empty' : nutritionState,
      ageText: t.ageText,
      delta: plan.kcal ? `plan ${fmt(plan.kcal, 0)} kcal` : '',
      source: t.source,
      note: t.note,
      emptyHint: t.emptyHint,
    }));
    cards.push(entityCard(ctx, {
      label: 'Protein eaten', value: t.protein, text: t.protein === null ? NO_DATA : fmt(t.protein, 0), unit: 'g',
      srcState: t.protein === null ? 'empty' : nutritionState,
      ageText: t.ageText,
      ranges: { refMin: 0, refMax: 250, optMin: 110, optMax: 160 },
      delta: [
        plan.protein ? `plan ${fmt(plan.protein, 0)} g` : null,
        weight && t.protein ? `${fmt(t.protein / weight, 1)} g/kg` : null,
      ].filter(Boolean).join(' · '),
      deltaColor: weight && t.protein && t.protein / weight >= 1.4 ? P.good : P.warn,
      source: t.source,
      note: t.note,
      emptyHint: t.emptyHint,
    }));
    cards.push(entityCard(ctx, {
      label: 'Fat eaten', value: t.fat, text: t.fat === null ? NO_DATA : fmt(t.fat, 0), unit: 'g',
      srcState: t.fat === null ? 'empty' : nutritionState,
      ageText: t.ageText,
      ranges: { refMin: 0, refMax: 200, optMin: 60, optMax: 100 },
      delta: [
        plan.fat ? `plan ${fmt(plan.fat, 0)} g` : null,
        t.kcal ? `${fmt(((t.fat * 9) / t.kcal) * 100, 0)}% of energy` : null,
      ].filter(Boolean).join(' · '),
      source: t.source,
      note: t.note,
      emptyHint: t.emptyHint,
    }));

    // ------------------------------------------------------------ lab context
    const orn = ctx.sourceState('ornament');
    cards.push(cardHeading('Laboratory context',
      `drawn ${ornDate(data, 'sensor.ornament_nazariy_homa_ir')}, so read it as a slow endpoint`));
    cards.push(entityCard(ctx, {
      span: 2, size: '32px', label: 'HOMA-IR', entity: 'sensor.ornament_nazariy_homa_ir', dec: 2,
      srcState: orn.state,
      ageText: ageOfOrn(data, 'sensor.ornament_nazariy_homa_ir'),
      ranges: ornRanges(data, 'sensor.ornament_nazariy_homa_ir'),
      delta: `${ornDeltaText(data, 'sensor.ornament_nazariy_homa_ir')}\n`
        + 'high insulin resistance widens every spike',
      deltaColor: P.alert,
      source: `Ornament · ${ornDate(data, 'sensor.ornament_nazariy_homa_ir')}`,
      note: 'needs a repeat draw',
    }));
    for (const [label, id] of [
      ['HbA1c', 'sensor.ornament_nazariy_hemoglobin_a1c'],
      ['Fasting insulin', 'sensor.ornament_nazariy_insulin_fasting'],
      ['Fasting glucose · lab', 'sensor.ornament_nazariy_glucose_fasting'],
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

    out.push(h('div.hh-cards', cards));

    // ------------------------------------------------- spike detection chart
    const lastDay = pd.lastFullDay;
    out.push(panel(
      lastDay ? `Spike detection on ${lastDay.label}` : 'Spike detection',
      lastDay
        ? `Every stretch above ${SPIKE} mmol/L is shaded and each meal before one is marked. `
          + `${lastDay.label} carries ${lastDay.spikes} spike${lastDay.spikes === 1 ? '' : 's'} `
          + `and a peak of ${fmt(lastDay.peak, 1)} mmol/L. `
          + (lastDay.requested
            ? 'Short sampling gaps are bridged; a real outage stays a break.'
            : 'The day picked in the header has too little coverage to judge, so this is the most '
              + 'recent day that does.')
        : 'No day in the window has enough coverage to detect spikes.',
      lastDay ? `peak ${fmt(lastDay.peak, 1)} mmol/L` : '',
      lastDay
        ? lineChart({
          h: 250,
          yMin: 3, yMax: Math.max(11, Math.ceil(lastDay.peak + 1)),
          yTicks: [4, 6, 8, 10],
          xLabels: ['00:00', '06:00', '12:00', '18:00', '24:00'],
          bands: [{
            lo: new Array(SLOTS).fill(SPIKE),
            hi: lastDay.slots.map((v) => (v === null ? null : Math.max(SPIKE, v))),
            color: P.warn, op: 0.18,
          }],
          series: [{ pts: lastDay.slots, color: ctx.accent, w: 2 }],
          thresholds: [
            { v: SPIKE, color: P.warn, label: `spike threshold ${SPIKE}` },
            { v: LOW, color: P.ref, label: `low ${LOW}` },
          ],
          events: lastDay.mealMarks,
        })
        : emptyState('The recorder has no day with enough CGM coverage in this window.'),
    ));

    // ------------------------------------------------------- dish ranking
    const dishes = pd.dishes;
    const maxRise = dishes.length ? dishes[0].rise : 1;
    out.push(panel(
      'Dish spike ranking',
      dishes.length
        ? 'A bar shows the average peak rise for that dish. Blue means a walk followed within 30 minutes. '
          + 'Replace the top of this list first. A dish eaten once is still listed, with n=1 against it.'
        : 'A ranking needs meals whose description the recorder kept.',
      dishes.length ? `${dishes.length} dishes` : 'n = 0',
      dishes.length
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
          legendRow([
            { color: P.alert, label: 'spike, rise above 2.4 mmol/L' },
            { color: ctx.accent, label: 'no spike, no walk after the meal' },
            { color: P.ref, label: 'walk within 30 minutes after the meal' },
          ]),
          h('div.hh-ranks', dishes.slice(0, 10).map((d) => h('div.hh-rank', [
            h('span.n', { title: d.name }, d.name),
            h('div.b', h('i', {
              style: {
                width: `${Math.max(2, (d.rise / maxRise) * 100).toFixed(1)}%`,
                background: d.walked ? P.ref : (d.rise > 2.4 ? P.alert : ctx.accent),
              },
            })),
            h('span.v', `+${fmt(d.rise, 2)}  n${d.n}`),
          ]))),
          dishes.length > 10 ? h('button.hh-linkbtn', {
            type: 'button',
            onClick: () => ctx.setState({ openList: dishList(ctx, dishes) }),
          }, `View all ${dishes.length} dishes`) : null,
        ])
        : emptyState('No meal in the window carries a description the recorder kept, so nothing can be ranked.'),
    ));

    // ------------------------------------------- carbs against peak rise
    const withCarbs = pd.meals.filter((m) => Number.isFinite(m.carbs) && Number.isFinite(m.rise));
    out.push(panel(
      'Carbohydrate against peak rise',
      withCarbs.length >= 4
        ? 'Each point is one meal. The warm line fits the meals without a walk and the blue line fits the '
          + 'meals with one. The same carbohydrate load gives a lower peak after a walk.'
        : 'This needs meals where Foodwatch recorded the carbohydrate count.',
      withCarbs.length >= 4 ? `n = ${withCarbs.length}` : 'n too small',
      withCarbs.length >= 4
        ? carbScatter(ctx, withCarbs)
        : emptyState(
          `Only ${withCarbs.length} meals in the window carry a carbohydrate count. `
          + 'Without it a rise cannot be attributed to the carbohydrate load.',
        ),
    ));

    // ------------------------------------------------------- meal curves
    out.push(panel(
      'Postprandial curves aligned at t=0',
      pd.meals.length
        ? `${pd.meals.length} meals from the Foodwatch timestamps, each cut 0 to 3 h out of the glucose `
          + 'series. The label shows the peak rise and the time to the peak. A blue curve had a walk within '
          + '30 minutes.'
        : 'Curves need an overlap between the Foodwatch timestamps and the glucose series.',
      '0 to 3 h from the meal',
      pd.meals.length
        ? h('div.hh-mults', pd.meals.slice(-8).map((m) => h('div.hh-mult', [
          h('div.t', { title: m.label }, m.label),
          spark(m.pts, m.walked ? P.ref : ctx.accent),
          h('div.v', [
            h('span', `+${fmt(m.rise, 2)} at ${fmt(m.tPeak, 0)} min`),
            h('span', { style: { color: m.walked ? P.ref : ctx.accent } },
              Number.isFinite(m.carbs) ? `${fmt(m.carbs, 0)} g` : 'carbs unknown'),
          ]),
        ])))
        : emptyState('No overlap between a meal timestamp and the glucose series in this window.'),
    ));

    // -------------------------------------------------------- spike calendar
    const cal = spikeCalendar(pd.cvStats);
    out.push(panel(
      `Spike days over ${CV_DAYS} days`,
      'A filled cell is a day whose peak glucose went above the threshold. The long-term statistics keep a '
      + 'daily minimum, mean and maximum forever, but not a spike count, so this shows whether a day had '
      + 'a spike and how high it went. An empty cell is a day without CGM data.',
      `${cal.filled} days with data · ${cal.spikeDays} with a spike`,
      cal.filled
        ? calendarChart({
          values: cal.values, end: new Date(),
          scale: SPIKE_SCALE,
          legendLow: 'inside target', legendHigh: '3+ over',
          color: (v) => SPIKE_SCALE[bucketOver(v)],
          label: (v) => `peak ${fmt(v, 1)} mmol/L${v > SPIKE ? ', spike' : ''}`,
        })
        : emptyState('The long-term glucose statistics have not accumulated yet.'),
    ));

    // ------------------------------------------------------------- AGP chart
    out.push(panel(
      `AGP: percentile bands over ${AGP_DAYS} days`,
      pd.agp
        ? `The 5, 25, 50, 75 and 95 percentiles from ${pd.hist.length} real records over ${cover} days, `
          + 'grouped into 15-minute slots of the day. A wide band marks the least stable part of the day. '
          + 'Today sits on top.'
        : 'Percentiles need several days of continuous series.',
      `bands ${AGP_DAYS} d · line today`,
      pd.agp
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 240,
            yMin: 3, yMax: Math.max(11, Math.ceil((pd.agp.max || 10) + 1)),
            yTicks: [4, 6, 8, 10],
            xLabels: ['00:00', '06:00', '12:00', '18:00', '24:00'],
            bands: [
              { lo: pd.agp.p5, hi: pd.agp.p95, color: P.ref, op: 0.1 },
              { lo: pd.agp.p25, hi: pd.agp.p75, color: P.ref, op: 0.22 },
            ],
            series: [
              { pts: pd.agp.p50, color: P.ref, w: 1.4, dash: '5 4' },
              { pts: pd.todaySlots, color: ctx.accent, w: 2, dot: true },
            ],
            thresholds: [
              { v: SPIKE, color: P.warn, label: String(SPIKE) },
              { v: LOW, color: P.ref, label: String(LOW) },
            ],
          }),
          legendRow([
            { color: ctx.accent, label: 'today' },
            { color: P.ref, label: `median and bands over ${AGP_DAYS} days` },
          ]),
        ])
        : emptyState('Several days of continuous CGM series are needed for an AGP.'),
    ));

    return out;
  },
};

// ------------------------------------------------------------------ analysis

function analyse(hist, dayOffset) {
  const empty = {
    agp: null, todaySlots: new Array(SLOTS).fill(null), days: new Set(),
    spikes: null, maxRise: null, maxRiseMeal: null, meanTimeToPeak: null, meanReturn: null,
    lastFullDay: null, walkEffect: null,
  };
  if (!hist.length) return empty;

  const days = new Set(hist.map((p) => dayKey(p.t)));

  // group readings into 15-minute slots of the day, for AGP and for today
  const slots = Array.from({ length: SLOTS }, () => []);
  const todayKey = dayKey(Date.now());
  const todayAcc = Array.from({ length: SLOTS }, () => []);
  for (const p of hist) {
    const d = new Date(p.t);
    const i = Math.min(SLOTS - 1, Math.floor((d.getHours() * 60 + d.getMinutes()) / (1440 / SLOTS)));
    slots[i].push(p.v);
    if (dayKey(p.t) === todayKey) todayAcc[i].push(p.v);
  }
  const pct = (q) => slots.map((arr) => (arr.length < 2
    ? null : percentile([...arr].sort((a, b) => a - b), q)));
  const filledSlots = slots.filter((a) => a.length >= 2).length;
  const agp = filledSlots >= SLOTS * 0.25
    ? {
      p5: pct(0.05), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p95: pct(0.95),
      max: Math.max(...hist.map((p) => p.v)),
    }
    : null;
  const todaySlots = todayAcc.map((a) => (a.length ? mean(a) : null));

  // spike statistics over whole days only, so a partial day cannot skew the rate
  const byDay = new Map();
  for (const p of hist) {
    const k = dayKey(p.t);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(p);
  }
  let total = 0, minutesAbove = 0, dayCount = 0, maxPeak = -Infinity, totalPoints = 0;
  for (const [, rows] of byDay) {
    if (rows.length < 60) continue; // too sparse to judge a day
    dayCount++;
    rows.sort((a, b) => a.t - b.t);
    let above = false;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i].v;
      if (v > maxPeak) maxPeak = v;
      if (v > SPIKE && !above) { total++; above = true; }
      if (v <= SPIKE) above = false;
      if (v > SPIKE && i > 0) minutesAbove += Math.min(15, (rows[i].t - rows[i - 1].t) / 60000);
    }
    totalPoints += rows.length;
  }
  const spikes = dayCount
    ? {
      total, days: dayCount, perDay: total / dayCount,
      minutesAbove: minutesAbove / dayCount,
      pctAbove: (minutesAbove / dayCount / 1440) * 100,
      maxPeak: Number.isFinite(maxPeak) ? maxPeak : null,
      points: totalPoints,
    }
    : null;

  return { ...empty, agp, todaySlots, days, spikes, lastFullDay: pickDay(byDay, dayOffset) };
}

/**
 * The day the header navigator points at. If that day has too little coverage
 * to judge, fall back to the most recent day that does — and the chart title
 * names whichever day it ended up drawing, so the two never disagree.
 */
function pickDay(byDay, dayOffset) {
  const wanted = dayKey(Date.now() - (dayOffset || 0) * 86400e3);
  const keys = [...byDay.keys()].sort().reverse();
  const ordered = byDay.has(wanted) ? [wanted, ...keys.filter((k) => k !== wanted)] : keys;
  for (const k of ordered) {
    const rows = byDay.get(k).slice().sort((a, b) => a.t - b.t);
    if (rows.length < 60) continue;
    const start = new Date(rows[0].t); start.setHours(0, 0, 0, 0);
    const slots = resample(rows, SLOTS, start.getTime(), start.getTime() + 86400e3, { bridgeMinutes: 45 });
    let spikes = 0, above = false;
    for (const p of rows) {
      if (p.v > SPIKE && !above) { spikes++; above = true; }
      if (p.v <= SPIKE) above = false;
    }
    return {
      key: k, label: k, slots, spikes,
      requested: k === wanted,
      peak: Math.max(...rows.map((p) => p.v)),
      mealMarks: [],
    };
  }
  return null;
}

/**
 * Cut a 0–3 h window out of the glucose series after each meal timestamp and
 * measure the excursion: rise above the pre-meal baseline, time to the peak
 * and whether a treadmill session started within 30 minutes.
 */
export function postprandial(hist, mealTimes, sessions) {
  const out = [];
  for (const meal of mealTimes) {
    const t0 = meal.t;
    const win = hist.filter((p) => p.t >= t0 - 10 * 60e3 && p.t <= t0 + 3 * 3600e3);
    if (win.length < 6) continue;
    const pre = win.filter((p) => p.t <= t0 + 5 * 60e3).map((p) => p.v);
    const base = pre.length ? mean(pre) : win[0].v;

    const pts = [];
    for (let k = 0; k < 24; k++) {
      const lo = t0 + k * 7.5 * 60e3, hi = lo + 7.5 * 60e3;
      const seg = win.filter((p) => p.t >= lo && p.t < hi).map((p) => p.v);
      pts.push(seg.length ? mean(seg) : null);
    }

    let peak = -Infinity, peakAt = t0;
    for (const p of win) {
      if (p.t < t0) continue;
      if (p.v > peak) { peak = p.v; peakAt = p.t; }
    }
    if (!Number.isFinite(peak)) continue;

    // when glucose comes back within 0.3 of baseline
    const returned = win.find((p) => p.t > peakAt && p.v <= base + 0.3);
    const walked = (sessions || []).some(([a]) => a >= t0 - 5 * 60e3 && a <= t0 + 30 * 60e3);

    out.push({
      label: meal.label || 'meal',
      dish: meal.dish || null,
      carbs: meal.carbs ?? null,
      pts,
      base,
      peak,
      rise: peak - base,
      tPeak: (peakAt - t0) / 60000,
      returnH: returned ? (returned.t - t0) / 3600e3 : null,
      walked,
      spike: peak > SPIKE,
      t: t0,
    });
  }
  return out;
}

/** Everything that can only be known once the meal windows have been cut. */
function mealStats(meals) {
  if (!meals.length) {
    return { maxRise: null, maxRiseMeal: null, meanTimeToPeak: null, meanReturn: null, walkEffect: null };
  }
  const top = meals.reduce((a, b) => (b.rise > a.rise ? b : a));
  const peaks = meals.map((m) => m.tPeak).filter(Number.isFinite);
  const returns = meals.map((m) => m.returnH).filter(Number.isFinite);

  // The walk effect needs both arms; with only one the comparison is meaningless.
  const withWalk = meals.filter((m) => m.walked).map((m) => m.rise);
  const without = meals.filter((m) => !m.walked).map((m) => m.rise);
  let walkEffect = null;
  if (withWalk.length >= 2 && without.length >= 2) {
    const a = mean(withWalk), b = mean(without);
    walkEffect = {
      withMean: a, withoutMean: b,
      withN: withWalk.length, withoutN: without.length,
      pct: b ? ((a - b) / b) * 100 : 0,
    };
  }

  return {
    maxRise: top.rise,
    maxRiseMeal: top,
    meanTimeToPeak: peaks.length ? mean(peaks) : null,
    meanReturn: returns.length ? mean(returns) : null,
    walkEffect,
  };
}

/** Aggregate meals into dishes, averaging repeats of the same name. */
function rankDishes(meals) {
  const groups = new Map();
  for (const m of meals) {
    if (!m.dish) continue;
    const key = m.dish.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: m.dish, rises: [], carbs: [], walks: 0, n: 0 });
    const g = groups.get(key);
    g.rises.push(m.rise);
    if (Number.isFinite(m.carbs)) g.carbs.push(m.carbs);
    if (m.walked) g.walks++;
    g.n++;
  }
  return [...groups.values()]
    .map((g) => ({
      name: g.name,
      rise: mean(g.rises),
      carbs: g.carbs.length ? mean(g.carbs) : null,
      n: g.n,
      walked: g.walks > g.n / 2,
      walkShare: g.n ? g.walks / g.n : 0,
    }))
    .sort((a, b) => b.rise - a.rise);
}

function dishMeta(d) {
  const bits = [];
  if (Number.isFinite(d.carbs)) bits.push(`${fmt(d.carbs, 0)} g carbs`);
  bits.push(d.walked ? 'walk after' : 'no walk');
  return bits.join(', ');
}

function dishList(ctx, dishes) {
  return {
    title: 'Dish spike ranking, all dishes',
    note: 'Every dish the recorder kept a description for. The peak rise is the average climb from the '
      + 'pre-meal value to the peak. A dish with n=1 has been eaten once, so treat it as a single '
      + 'observation and not as a property of the dish.',
    columns: [
      { key: 'rank', label: '#', width: '30px', mono: true },
      { key: 'name', label: 'Dish', width: '1fr' },
      { key: 'rise', label: 'Peak rise', width: '82px', align: 'right' },
      { key: 'carbs', label: 'Carbs', width: '70px', align: 'right' },
      { key: 'n', label: 'n', width: '40px', align: 'right' },
      { key: 'walk', label: 'Walk after', width: '90px', align: 'right' },
    ],
    rows: dishes.map((d, i) => ({
      rank: i + 1,
      name: d.name,
      rise: `+${fmt(d.rise, 2)}`,
      riseColor: d.walked ? P.ref : (d.rise > 2.4 ? P.alert : ctx.accent),
      carbs: Number.isFinite(d.carbs) ? `${fmt(d.carbs, 0)} g` : NO_DATA,
      n: d.n,
      walk: d.walked ? 'yes' : 'no',
      walkColor: d.walked ? P.ref : P.off,
    })),
  };
}

function carbScatter(ctx, meals) {
  const withWalk = meals.filter((m) => m.walked);
  const without = meals.filter((m) => !m.walked);
  const xs = meals.map((m) => m.carbs), ys = meals.map((m) => m.rise);
  const xMax = Math.max(...xs) * 1.15 || 70;
  const yMax = Math.max(...ys) * 1.2 || 4;
  const reg = [];
  const rw = without.length >= 3 ? linreg(without.map((m) => m.carbs), without.map((m) => m.rise)) : null;
  const rww = withWalk.length >= 3 ? linreg(withWalk.map((m) => m.carbs), withWalk.map((m) => m.rise)) : null;
  if (rw) reg.push({ ...rw, color: ctx.accent });
  if (rww) reg.push({ ...rww, color: P.ref });

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
    scatterChart({
      w: 940, h: 260,
      xMin: 0, xMax,
      yMin: 0, yMax,
      xLabel: 'carbohydrate per meal, g',
      pts: meals.map((m) => ({
        x: m.carbs, y: m.rise, r: 3.6,
        c: m.walked ? P.ref : ctx.accent,
        title: `${m.label} · ${fmt(m.carbs, 0)} g → +${fmt(m.rise, 2)} mmol/L`,
      })),
      reg,
      hlines: [{ v: 2.4, label: 'spike level from a 5.4 baseline', color: P.warn, dash: '5 4' }],
    }),
    legendRow([
      { color: ctx.accent, label: `no walk after the meal (n ${without.length})` },
      { color: P.ref, label: `walk within 30 min (n ${withWalk.length})` },
    ]),
  ]);
}

const SPIKE_SCALE = ['#EAF2EC', '#CFE4D6', '#E8CE96', '#DFA45C', '#BE3A2B'];

/** How far a day's peak went past the target, bucketed for the calendar. */
function bucketOver(peak) {
  const over = peak - SPIKE;
  if (over <= -1) return 0;
  if (over <= 0) return 1;
  if (over <= 1) return 2;
  if (over <= 3) return 3;
  return 4;
}

/** One value per day: the day's peak glucose, or null where the CGM was silent. */
function spikeCalendar(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (Number.isFinite(r.max)) byDay.set(dayKey(r.t), r.max);
  }
  const values = [];
  let filled = 0, spikeDays = 0;
  for (let i = 0; i < CV_DAYS; i++) {
    const t = Date.now() - (CV_DAYS - 1 - i) * 86400e3;
    const v = byDay.get(dayKey(t));
    if (v === undefined) { values.push(null); continue; }
    filled++;
    if (v > SPIKE) spikeDays++;
    values.push(v);
  }
  return { values, filled, spikeDays };
}

// ---------------------------------------------------------------- nutrition

/**
 * Today's intake.
 *
 * The Foodwatch `*_total` helpers are running counters that are not reset per
 * day, so reading them directly reports the sum of every meal ever logged.
 * Instead sum the meals the recorder actually holds for today, parsed out of
 * the meal-text helper. If nothing was logged today the page says so rather
 * than showing yesterday's numbers as if they were current.
 */
function nutritionToday(data, mealHistory) {
  const todayKey = dayKey(Date.now());
  const meals = distinctMeals(mealHistory).filter((m) => dayKey(m.t) === todayKey);

  if (meals.length) {
    const sum = (key) => {
      const vals = meals.map((m) => m[key]).filter(Number.isFinite);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    const last = meals[meals.length - 1];
    return {
      kcal: sum('kcal'), carbs: sum('carbs'), protein: sum('protein'), fat: sum('fat'),
      meals: meals.length,
      ageText: age(Date.now() - last.t),
      source: `Foodwatch · ${meals.length} meal${meals.length === 1 ? '' : 's'} today`,
      note: null,
      stale: false,
      emptyHint: null,
    };
  }

  // Nothing logged today. Say that instead of reporting the running totals.
  const slots = data.raw(E.fwSlots) || '';
  const slotDay = slots.includes('|') ? slots.split('|')[0] : null;
  return {
    kcal: null, carbs: null, protein: null, fat: null, meals: 0,
    ageText: slotDay || NO_DATA,
    source: 'Foodwatch · per meal',
    note: 'the running totals are not per day',
    stale: true,
    emptyHint: slotDay && slotDay !== todayKey
      ? `nothing logged today. The last logged day is ${slotDay}`
      : 'nothing logged today yet',
  };
}

/** Every distinct meal the recorder kept, newest last. */
function distinctMeals(mealHistory) {
  const out = [];
  let prev = null;
  for (const row of mealHistory) {
    const txt = row.s;
    if (!txt || txt === 'unknown' || txt === '' || txt === prev) continue;
    prev = txt;
    out.push({ t: row.t, ...parseMealText(txt) });
  }
  return out;
}

/** "05.08 21:19 · Dish name (slot) — 238 kcal, Б 38г, Ж 38г, В 14г" */
function parseMealText(txt) {
  const num = (re) => {
    const m = re.exec(txt);
    return m ? Number(String(m[1]).replace(',', '.')) : null;
  };
  const afterDot = txt.includes('·') ? txt.slice(txt.indexOf('·') + 1) : txt;
  const dish = afterDot.split('—')[0].replace(/\([^)]*\)/g, '').trim();
  return {
    dish: dish || null,
    kcal: num(/(\d+(?:[.,]\d+)?)\s*(?:ккал|kcal)/i),
    protein: num(/(?:Б|P)\s*(\d+(?:[.,]\d+)?)\s*(?:г|g)/i),
    fat: num(/(?:Ж|F)\s*(\d+(?:[.,]\d+)?)\s*(?:г|g)/i),
    carbs: num(/(?:В|C)\s*(\d+(?:[.,]\d+)?)\s*(?:г|g)/i),
    raw: txt,
  };
}

/**
 * Recover a meal's name and macros by matching the eating event to the meal
 * description the recorder holds closest after it. Where no description is
 * found the meal keeps an honest timestamp and no macros.
 */
function describeMeal(t, mealHistory) {
  let best = null;
  for (const row of mealHistory) {
    if (!row.s || row.s === 'unknown' || row.s === '') continue;
    const dt = row.t - t;
    if (dt < -120e3 || dt > 15 * 60e3) continue;
    if (!best || Math.abs(dt) < Math.abs(best.t - t)) best = row;
  }
  const d = new Date(t);
  const stamp = `meal ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (!best) return { label: stamp, dish: null, carbs: null };
  const parsed = parseMealText(String(best.s));
  return { label: parsed.dish || stamp, dish: parsed.dish, carbs: parsed.carbs };
}

/** Sum the Foodie plan for the day out of its five free-text slots. */
function planMacros(data) {
  const out = { kcal: null, protein: null, fat: null, carbs: null, top: null };
  const add = (key, v) => { if (Number.isFinite(v)) out[key] = (out[key] ?? 0) + v; };
  for (const id of E.foodieMeals) {
    const txt = data.raw(id);
    if (!txt) continue;
    const m = parseMealText(txt);
    add('kcal', m.kcal); add('protein', m.protein); add('fat', m.fat); add('carbs', m.carbs);
    if (Number.isFinite(m.carbs) && (!out.top || m.carbs > out.top.carbs)) {
      out.top = { carbs: m.carbs, name: m.dish || txt.split('—')[0].trim() };
    }
  }
  return out;
}

// ------------------------------------------------------------ Ornament bits

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
  if (r.refMax !== null) lines.push(`reference up to ${fmt(r.refMax)}`);
  if (r.optMax !== null) lines.push(`optimum up to ${fmt(r.optMax)}`);
  const prev = data.attr(id, 'previous_value');
  const v = data.val(id);
  if (prev !== undefined && prev !== null && v !== null) {
    lines.push(`previous ${fmt(prev)} · ${v > prev ? '↑' : v < prev ? '↓' : '='}`);
  }
  return lines.join('\n');
}

function ageOfOrn(data, id) {
  const at = data.attr(id, 'measured_at');
  return at ? age(Date.now() - new Date(at).getTime()) : NO_DATA;
}

function ornDate(data, id) {
  const at = data.attr(id, 'measured_at');
  return at ? String(at).slice(0, 10) : 'date unknown';
}

export { sd };
