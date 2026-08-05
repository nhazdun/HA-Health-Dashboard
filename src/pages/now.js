import { h } from '../core/dom.js';
import { P } from '../core/tokens.js';
import { entityCard, panel, banner, emptyState, legendRow } from '../core/ui.js';
import { lineChart, spark } from '../charts/svg.js';
import { resample } from '../core/ha.js';
import { loadEvents, eventsFor } from '../core/events.js';
import { controlPanel, nowControls } from '../core/controls.js';
import { fmt, age, hhmm, clockOf } from '../core/format.js';
import { E } from '../core/registry.js';

/** Page 1 — the realtime cockpit. Only channels that move faster than a minute. */

const HOURS = 6;

export default {
  id: 'now',
  label: 'Зараз',
  title: 'Зараз',
  question: 'Що з моїм тілом у цю хвилину?',
  scale: 'с · хв',

  live(ctx) {
    const cgm = ctx.sourceState('nightscout');
    const polar = ctx.sourceState('polar');
    if (cgm.state === 'dead') return { color: P.alert, label: 'канал глюкози мертвий' };
    if (cgm.state === 'stale') return { color: P.warn, label: 'глюкоза відстає' };
    if (polar.idle) return { color: P.ref, label: 'H10 не вдягнений' };
    return { color: P.good, label: 'усі швидкі канали живі' };
  },

  async load(ctx) {
    const { data } = ctx;
    const [glu, hr, pmBed, pmDesk, pmDyson, evts] = await Promise.all([
      data.series(E.glucose, HOURS, { significantOnly: false }),
      data.series(E.polarHr, HOURS, { significantOnly: false }),
      data.series(E.bedPm25, HOURS),
      data.series(E.deskPm25, HOURS),
      data.series(E.dysonPm25, HOURS),
      loadEvents(ctx, HOURS),
    ]);
    let hrSeries = hr;
    if (hrSeries.length < 3) {
      // The chest strap only writes while worn — fall back to the ring.
      hrSeries = await data.series(E.ouraHr, HOURS, { significantOnly: false });
    }
    return { glu, hr: hrSeries, hrFromRing: hr.length < 3, pmBed, pmDesk, pmDyson, evts };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const now = Date.now();
    const start = now - HOURS * 3600e3;
    const cgm = ctx.sourceState('nightscout');
    const out = [];

    // ---------------------------------------------------------------- banner
    const gAgeMin = data.val(E.glucoseAge);
    if (cgm.state === 'dead' || cgm.state === 'stale') {
      out.push(banner('МЕРТВИЙ КАНАЛ',
        `CGM не пише ${age(cgm.ageMs)} (glucose_age ${fmt(gAgeMin, 0)} хв проти порогу 15 хв). `
        + 'Число на екрані — останній кадр перед розривом, і воно виключене з усіх агрегатів цієї сторінки.',
        P.alert));
    } else if (cgm.state === 'warn') {
      out.push(banner('КАНАЛ НЕРІВНОМІРНИЙ',
        `Останній запис CGM ${age(cgm.ageMs)} тому при кроці 1 хв. Крива нижче має розриви — це пропуски, а не нулі.`,
        P.warn));
    }

    // --------------------------------------------------------------- controls
    const controls = controlPanel(ctx, nowControls(ctx));
    if (controls) out.push(controls);

    // ----------------------------------------------------------------- cards
    const cards = [];
    const gluDead = cgm.state === 'dead' || cgm.state === 'stale';
    const gluPts = pd.glu.map((p) => p.v);
    const trend = data.raw(E.glucoseTrend);

    cards.push(entityCard(ctx, {
      span: 2, size: '44px', label: 'Глюкоза · CGM', entity: E.glucose, dec: 1,
      srcState: gluDead ? 'dead' : cgm.state,
      ageText: gAgeMin !== null ? `${fmt(gAgeMin, 0)} хв` : age(cgm.ageMs),
      delta: `тренд ${trend || '—'}\n${pd.glu.length} точок за ${HOURS} год`,
      deltaColor: gluDead ? P.alert : P.good,
      spark: spark(gluPts.slice(-72), gluDead ? P.off : ctx.accent, gluDead),
      ranges: { optMin: 3.9, optMax: 7.8 },
      source: 'Nightscout · крок 1 хв',
      note: gluDead ? 'Juggluco відвалився' : null,
    }));

    const hrEnt = data.raw(E.polarHr) !== null ? E.polarHr : E.ouraHr;
    const hrMax = data.val(E.hrMax) || 186;
    const hrVal = data.val(hrEnt);
    cards.push(entityCard(ctx, {
      label: hrEnt === E.polarHr ? 'Пульс · Polar H10' : 'Пульс · Oura (H10 не вдягнений)',
      entity: hrEnt, dec: 0, unit: 'уд/хв',
      srcState: hrEnt === E.polarHr ? ctx.sourceState('polar').state : 'lag',
      delta: hrVal ? `зона ${zone(hrVal, hrMax)} · ${fmt((hrVal / hrMax) * 100, 0)}% HRmax` : '',
      deltaColor: hrVal && hrVal / hrMax > 0.7 ? P.warn : P.good,
      spark: spark(pd.hr.slice(-90).map((p) => p.v), ctx.accent),
      source: hrEnt === E.polarHr ? 'Polar H10 · удар' : 'Oura Ring · PPG',
    }));

    cards.push(entityCard(ctx, {
      label: 'RMSSD зараз', entity: E.polarRmssd, dec: 0, unit: 'мс',
      srcState: ctx.sourceState('polar').state,
      emptyHint: 'H10 не передає — надягніть ремінь',
      source: 'Polar H10 · RR-інтервали',
      ranges: { optMin: 40, optMax: 90 },
    }));

    const lastEaten = parseDt(data.raw(E.fwLastEaten));
    const sinceMeal = lastEaten ? (now - lastEaten.getTime()) / 60000 : null;
    cards.push(entityCard(ctx, {
      label: 'Від останнього прийому їжі',
      value: sinceMeal, text: sinceMeal === null ? '—' : hhmm(sinceMeal), unit: 'год',
      srcState: sinceMeal === null ? 'empty' : sinceMeal > 16 * 60 ? 'stale' : 'ok',
      ageText: lastEaten ? clockOf(lastEaten) : '—',
      delta: (data.raw(E.fwLastMeal) || '').slice(0, 70),
      source: 'Foodwatch · єдиний таймстемп їжі',
      entity: E.fwLastEaten,
    }));

    const padTime = data.val(E.padTimeDay);
    const padRunning = data.raw(E.padBelt) === 'on' || data.raw(E.padState) === 'running';
    cards.push(entityCard(ctx, {
      label: 'Доріжка сьогодні', entity: E.padTimeDay, dec: 2, unit: 'год',
      srcState: ctx.sourceState('kingsmith').state,
      delta: `${fmt(data.val(E.padStepsDay), 0)} кроків · ${fmt(data.val(E.padDistDay), 2)} км\n`
        + `швидкість ${fmt(data.val(E.padSpeed), 1)} км/год`,
      deltaColor: padRunning ? P.good : (padTime > 0.5 ? P.good : P.off),
      source: 'KingSmith · 5 с',
    }));

    const slouch = data.val(E.slouchTime), upright = data.val(E.uprightTime);
    const slouchPct = slouch !== null && upright !== null && slouch + upright > 0
      ? (slouch / (slouch + upright)) * 100 : null;
    cards.push(entityCard(ctx, {
      label: 'Кут постави', entity: E.postureAngle, dec: 1, unit: '°',
      srcState: ctx.sourceState('upright').state,
      delta: slouchPct === null ? '' : `${fmt(slouchPct, 1)}% дня згорблено`,
      deltaColor: slouchPct > 30 ? P.warn : P.good,
      source: 'Upright GO 2',
    }));

    // Named by room, not by device: the bedroom carries two sensors, the
    // living room one, and that asymmetry is the point.
    [
      ['PM2.5 · спальня', E.bedPm25, 'Qingping 7fc5 · спальня', 'qp_bed'],
      ['PM2.5 · вітальня', E.deskPm25, 'Qingping 554b · робоче місце', 'qp_desk'],
      ['PM2.5 · спальня, Dyson', E.dysonPm25, 'Dyson лазер · спальня', 'dyson'],
    ].forEach(([label, id, src, key]) => {
      const v = data.val(id);
      cards.push(entityCard(ctx, {
        label, entity: id, dec: 0, unit: 'мкг/м³',
        srcState: ctx.sourceState(key).state,
        ranges: { refMin: 0, refMax: 15, optMin: 0, optMax: 5 },
        delta: v === null ? '' : v > 15 ? 'вище референсу' : v > 5 ? 'вище оптимуму' : 'в оптимумі',
        deltaColor: v > 15 ? P.alert : v > 5 ? P.warn : P.good,
        source: src,
      }));
    });

    const water = data.val(E.waterToday);
    cards.push(entityCard(ctx, {
      label: 'Вода сьогодні', entity: E.waterToday, dec: 0, unit: 'мл',
      srcState: ctx.sourceState('hidrate').state,
      ranges: { refMin: 0, refMax: 3000, optMin: 2000, optMax: 3000 },
      delta: water === null ? '' : `${fmt(data.val(E.sipsToday), 0)} ковтків · ${fmt((water / 2500) * 100, 0)}% цілі`,
      deltaColor: water !== null && water < 2000 ? P.warn : P.good,
      source: 'Hidrate Spark · покриття неповне',
      emptyHint: 'пляшка не на звʼязку',
    }));

    const alertOn = data.byPrefix(E.alertPrefix).filter((id) => data.raw(id) === 'on');
    cards.push(entityCard(ctx, {
      label: 'Повітряна тривога', value: 1, text: alertOn.length ? 'активна' : 'немає', size: '20px',
      unit: '', color: alertOn.length ? P.alert : P.good, srcState: 'ok',
      entity: data.byPrefix(E.alertPrefix)[0],
      delta: 'коваріата для HRV і сну',
      deltaColor: alertOn.length ? P.alert : P.off,
      source: 'Золочівська громада',
      note: alertOn.length ? alertOn.map((i) => i.split('_').pop()).join(', ') : 'спокійно',
      noteColor: alertOn.length ? P.alert : P.good,
    }));

    cards.push(entityCard(ctx, {
      label: 'IQOS сьогодні', entity: E.iqosToday, dec: 0, unit: 'стиків',
      srcState: ctx.sourceState('iqos').state,
      ranges: { refMin: 0, refMax: 46, optMin: 0, optMax: 0 },
      delta: `затяжок ${fmt(data.val(E.iqosPuffs), 0)} · ціль 0`,
      deltaColor: P.warn,
      source: 'IQOS · ручна синхронізація ±15%',
    }));

    out.push(h('div.hh-cards', cards));

    // ---------------------------------------------------------------- charts
    const gluRes = resample(pd.glu, 120, start, now);
    const gluVals = gluRes.filter(Number.isFinite);
    out.push(panel(
      `Глюкоза за ${HOURS} годин`,
      pd.glu.length
        ? `${pd.glu.length} записів із recorder’а. Розриви на кривій — це реальні пропуски каналу, `
          + 'вони не заповнюються нулями. Вертикальні пунктири — прийоми їжі та IQOS.'
        : 'Recorder не віддав жодної точки за це вікно.',
      'мммоль/л · події',
      pd.glu.length >= 2
        ? lineChart({
          h: 240,
          yMin: Math.min(3.5, Math.floor(Math.min(...gluVals) - 0.5)),
          yMax: Math.max(9, Math.ceil(Math.max(...gluVals) + 0.5)),
          yTicks: [4, 6, 8, 10],
          xLabels: axisLabels(start, now, 5),
          series: [{ pts: gluRes, color: gluDead ? P.off : ctx.accent, w: 2, dot: !gluDead, dash: gluDead ? '4 4' : null }],
          thresholds: [
            { v: 7.8, color: P.warn, label: '7.8 верх діапазону' },
            { v: 3.9, color: P.ref, label: '3.9 низ' },
          ],
          events: eventsFor(pd.evts, start, now, ctx),
          showEvents: ctx.state.annotations,
        })
        : emptyState('Немає даних глюкози за це вікно. Перевірте, чи Juggluco пише в Nightscout.'),
    ));

    const hrRes = resample(pd.hr, 120, start, now);
    out.push(panel(
      pd.hrFromRing ? 'Пульс за 6 годин · Oura (H10 поза сесією)' : 'Пульс за 6 годин · Polar H10',
      pd.hrFromRing
        ? 'Нагрудний ремінь пише тільки під час носіння, тому тут ряд Oura. Це різні протоколи — '
          + 'вони ніколи не усереднюються між собою.'
        : 'Реалтайм із ременя, крок — удар серця.',
      'уд/хв',
      pd.hr.length >= 2
        ? lineChart({
          h: 200,
          yMin: 40, yMax: Math.max(120, Math.ceil((Math.max(...pd.hr.map((p) => p.v)) + 10) / 10) * 10),
          yTicks: [50, 70, 90, 110],
          xLabels: axisLabels(start, now, 5),
          series: [{ pts: hrRes, color: pd.hrFromRing ? P.ref : ctx.accent, w: 1.7, fill: true, dot: true }],
          thresholds: [{ v: hrMax * 0.7, color: P.warn, label: '70% HRmax' }],
          events: eventsFor(pd.evts, start, now, ctx, ['alert', 'iqos']),
          showEvents: ctx.state.annotations,
        })
        : emptyState('Ані H10, ані Oura не дали ряду пульсу за останні 6 годин.'),
    ));

    const anyPm = pd.pmBed.length || pd.pmDesk.length || pd.pmDyson.length;
    out.push(panel(
      'PM2.5 в обох кімнатах',
      'Дві кімнати, три прилади: у спальні стоять Qingping і Dyson, у вітальні — лише Qingping. '
      + 'Розходження двох приладів у спальні — це окрема метрика, а не шум, який треба сховати; '
      + 'пік у вітальні підтвердити нічим.',
      'спальня · вітальня · спальня Dyson',
      anyPm
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
          lineChart({
            h: 200, yMin: 0,
            yMax: Math.max(20, Math.ceil(Math.max(
              1, ...[...pd.pmBed, ...pd.pmDesk, ...pd.pmDyson].map((p) => p.v),
            ) * 1.15)),
            yTicks: [0, 10, 20, 30],
            xLabels: axisLabels(start, now, 5),
            series: [
              { pts: resample(pd.pmBed, 90, start, now), color: ctx.accent, w: 1.6 },
              { pts: resample(pd.pmDesk, 90, start, now), color: P.olive, w: 1.6 },
              { pts: resample(pd.pmDyson, 90, start, now), color: P.ref, w: 1.6 },
            ],
            thresholds: [
              { v: 15, color: P.warn, label: 'референс 15' },
              { v: 5, color: P.good, label: 'оптимум 5' },
            ],
            events: eventsFor(pd.evts, start, now, ctx, ['iqos']),
            showEvents: ctx.state.annotations,
          }),
          legendRow([
            { color: ctx.accent, label: 'спальня · Qingping 7fc5' },
            { color: P.olive, label: 'вітальня · Qingping 554b' },
            { color: P.ref, label: 'спальня · Dyson лазер' },
          ]),
        ])
        : emptyState('Жоден з трьох сенсорів не віддав ряд PM2.5.'),
    ));

    return out;
  },
};

function zone(hr, hrMax) {
  const p = hr / hrMax;
  return p < 0.6 ? 1 : p < 0.7 ? 2 : p < 0.8 ? 3 : p < 0.9 ? 4 : 5;
}

function parseDt(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(+d) ? null : d;
}

export function axisLabels(start, end, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(start + ((end - start) * i) / (n - 1));
    out.push(String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'));
  }
  return out;
}
