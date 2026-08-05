import { h } from '../core/dom.js';
import { P, ST } from '../core/tokens.js';
import { panel, banner, emptyState, legendRow } from '../core/ui.js';
import { laneChart, scatterChart } from '../charts/svg.js';
import { dayKey } from '../core/ha.js';
import { fmt, age, mean, sd } from '../core/format.js';
import { SOURCES, sourceState, sourceEntities, E } from '../core/registry.js';

/**
 * Page 10 — can I believe what I just looked at?
 *
 * Everything on this page is derived: liveness from `last_reported` against
 * each source's declared cadence, coverage from the recorder, warnings from
 * conditions that are true right now. Nothing is a hard-coded verdict, which
 * is the only way a fixed channel can ever go green again.
 */

const COVER_DAYS = 30;

export default {
  id: 'trust',
  label: 'Довіра до даних',
  title: 'Довіра до даних',
  question: 'Чи можна вірити тому, що я щойно бачив?',
  scale: 'аудит',

  live(ctx) {
    const warn = buildWarnings(ctx).length;
    if (!warn) return { color: P.good, label: 'застережень немає' };
    return { color: warn > 3 ? P.alert : P.warn, label: `${warn} застережень` };
  },

  async load(ctx) {
    const { data } = ctx;
    const probes = SOURCES.map((src) => {
      const ids = sourceEntities(src, data);
      // one representative entity per source is enough to see the gaps
      return { src, id: ids.find((x) => data.val(x) !== null) || ids[0] };
    }).filter((p) => p.id);

    const coverage = {};
    await Promise.all(probes.map(async ({ src, id }) => {
      const rows = await data.stats(id, COVER_DAYS, 'day', ['mean', 'max']);
      coverage[src.key] = new Set((rows[id] || [])
        .filter((r) => Number.isFinite(r.mean ?? r.max))
        .map((r) => dayKey(r.t)));
    }));

    const [ouraAwake, museAwake] = await Promise.all([
      data.exists(E.ouraAwake) ? data.daily(E.ouraAwake, 60, 'max') : new Map(),
      data.exists(E.museAwake) ? data.daily(E.museAwake, 60, 'max') : new Map(),
    ]);
    const bland = [];
    for (const [k, o] of ouraAwake) {
      const m = museAwake.get(k);
      if (Number.isFinite(o) && Number.isFinite(m)) bland.push({ k, o, m });
    }

    return { coverage, bland, probes };
  },

  render(ctx, pd) {
    const { data } = ctx;
    const out = [];

    out.push(banner('ГОЛОВНИЙ ПАТЕРН',
      'Мертвий CGM три доби показував число, і воно виглядало живим. Саме тому кожна метрика в системі '
      + 'несе свій вік і стан, а недовірені значення приглушені й не беруть участі в агрегатах. '
      + 'Усі вердикти на цій сторінці обчислені зараз із last_reported, а не записані наперед.',
      P.alert));

    // ------------------------------------------------------ liveness matrix
    const rows = SOURCES.map((src) => {
      const st = sourceState(src, data);
      return { src, st };
    });
    const dead = rows.filter((r) => r.st.state === 'dead' || r.st.state === 'empty').length;

    out.push(h('div.hh-table', [
      h('div.hh-th', [
        h('span', 'Джерело'), h('span', 'Останнє оновлення'),
        h('span', 'Очікуваний крок'), h('span', 'Стан'),
      ]),
      ...rows.map(({ src, st }) => {
        const meta = ST[st.state] || ST.ok;
        return h('div.hh-tr', [
          h('span.s', [h('i.hh-dot', { style: { background: meta.c, width: '7px', height: '7px' } }), src.name]),
          h('span.m', { style: { color: meta.c } }, st.ageMs === null ? '—' : age(st.ageMs)),
          h('span.m', { style: { color: P.off } }, src.stepLabel),
          h('span.n', [
            h('b', { style: { color: meta.c, fontWeight: '500' } }, meta.l),
            ' · ',
            st.total ? `${st.live}/${st.total} сенсорів віддають значення. ` : '',
            src.note,
          ]),
        ]);
      }),
    ]));

    // ------------------------------------------------------------- coverage
    const lanes = SOURCES.map((src) => {
      const days = pd.coverage[src.key];
      if (!days) return null;
      const segs = [];
      let runStart = null;
      for (let i = 0; i < COVER_DAYS; i++) {
        const k = dayKey(Date.now() - (COVER_DAYS - 1 - i) * 86400e3);
        const has = days.has(k);
        if (has && runStart === null) runStart = i;
        if (!has && runStart !== null) {
          segs.push([runStart / COVER_DAYS, i / COVER_DAYS]);
          runStart = null;
        }
      }
      if (runStart !== null) segs.push([runStart / COVER_DAYS, 1]);
      const pct = Math.round((days.size / COVER_DAYS) * 100);
      return {
        label: src.name,
        segs,
        color: ST[sourceState(src, data).state].c,
        note: `${pct}% діб`,
      };
    }).filter(Boolean);

    out.push(panel(
      `Покриття за ${COVER_DAYS} днів`,
      'Одна смуга на джерело, дірки лишені видимими. Смуга будується з довгострокової статистики: '
      + 'доба присутня тоді, коли recorder має для неї хоч одне агреговане значення. '
      + 'Джерела без state_class (шум, TVOC, PM10) сюди не потрапляють — у них немає довгої статистики.',
      'дірки підписані',
      lanes.length
        ? laneChart({ lanes, labelWidth: 150, noteWidth: 70, rowH: 24, xLabels: [`−${COVER_DAYS} д`, '−20', '−10', 'сьогодні'] })
        : emptyState('Довгострокова статистика ще не накопичилась для жодного джерела.'),
    ));

    // -------------------------------------------------------- Bland–Altman
    const bland = pd.bland || [];
    out.push(panel(
      'Bland–Altman: Oura проти Muse за часом неспання',
      bland.length >= 5
        ? `Не «яке джерело праве», а наскільки і в який бік вони розходяться. ${bland.length} спільних ночей. `
          + 'Систематичне зміщення означає, що акселерометр рахує рух як неспання. '
          + 'Смуги — ±1.96 SD різниці.'
        : 'Потрібні ночі, коли обидва пристрої писали одночасно.',
      bland.length >= 5 ? `n = ${bland.length}` : 'n замалий',
      bland.length >= 5
        ? (() => {
          const diffs = bland.map((r) => r.o - r.m);
          const avgs = bland.map((r) => (r.o + r.m) / 2);
          const bias = mean(diffs);
          const s = sd(diffs) || 0;
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            scatterChart({
              w: 940, h: 260,
              pts: bland.map((r, i) => ({
                x: avgs[i], y: diffs[i], c: ctx.accent,
                title: `${r.k} · Oura ${fmt(r.o, 0)} / Muse ${fmt(r.m, 0)}`,
              })),
              xMin: Math.min(...avgs) * 0.9, xMax: Math.max(...avgs) * 1.1,
              yMin: Math.min(...diffs, bias - 2 * s) * 1.15,
              yMax: Math.max(...diffs, bias + 2 * s) * 1.15,
              xLabel: 'середнє двох джерел, хвилин неспання',
              hlines: [
                { v: bias, label: `зміщення ${bias >= 0 ? '+' : ''}${fmt(bias, 0)} хв`, color: P.self, dash: '6 3' },
                { v: bias + 1.96 * s, label: '+1.96 SD', color: P.ref },
                { v: bias - 1.96 * s, label: '−1.96 SD', color: P.ref },
              ],
            }),
            legendRow([{ color: ctx.accent, label: 'одна ніч = одна точка' }]),
          ]);
        })()
        : emptyState(
          `Спільних ночей із обома джерелами: ${bland.length}. Для E12 потрібно 30. `
          + 'Поки одне з джерел мовчить, узгодженість перевірити нічим.',
        ),
    ));

    // ------------------------------------------------------- disagreements
    const disagree = buildDisagreements(ctx);
    if (disagree.length) {
      out.push(panel(
        'Розбіжність джерел',
        'Там, де дві незалежні системи міряють одну величину, різниця між ними — окрема метрика. '
        + 'Вона показується, а не ховається за усередненням.',
        `${disagree.length} пар`,
        h('div.hh-warns', disagree.map((d) => h('div.hh-warn', {
          style: { borderLeft: `3px solid ${d.color}` },
        }, [
          h('b', d.title),
          h('span.b', d.body),
          h('span.a', { style: { color: d.color } }, d.action),
        ]))),
      ));
    }

    // ------------------------------------------------------------ warnings
    const warnings = buildWarnings(ctx);
    out.push(panel(
      'Активні застереження',
      warnings.length
        ? 'Кожне з них істинне просто зараз і зникне саме, коли причина зникне.'
        : 'Жодної активної проблеми в стеку не виявлено.',
      `${warnings.length} активних · ${dead} джерел мовчать`,
      warnings.length
        ? h('div.hh-warns', warnings.map((w) => h('div.hh-warn', {
          style: { borderLeft: `3px solid ${w.color}` },
        }, [
          h('b', w.title),
          h('span.b', w.body),
          h('span.a', { style: { color: w.color } }, w.action),
        ])))
        : emptyState('Усі джерела в межах очікуваної свіжості, одиниці узгоджені, підписки активні.'),
    ));

    return out;
  },
};

// ------------------------------------------------------------------ helpers

/** Conditions that are true right now — recomputed on every paint. */
function buildWarnings(ctx) {
  const { data } = ctx;
  const out = [];

  const cgm = ctx.sourceState('nightscout');
  if (cgm.state === 'dead' || cgm.state === 'stale') {
    const mins = data.val(E.glucoseAge);
    out.push({
      title: `CGM мовчить ${age(cgm.ageMs)}`,
      body: `glucose_age ${fmt(mins, 0)} хв проти порогу 15 хв. Juggluco не пише в Nightscout. `
        + 'Усі метаболічні висновки заморожені.',
      action: 'перезапустити Juggluco → перевірити age = 0',
      color: P.alert,
    });
  }

  const subDays = data.val(E.museSubDays);
  if (subDays !== null && subDays <= 3) {
    out.push({
      title: `Підписка Muse — ${fmt(subDays, 0)} дн.`,
      body: 'На нулі незалежний ЕЕГ-канал зникає, і E12 (Bland–Altman проти Oura) втрачає друге джерело.',
      action: 'продовжити до закінчення',
      color: subDays <= 1 ? P.alert : P.warn,
    });
  }

  const battery = data.raw(E.bodyScanBattery);
  if (battery && /low|критич/i.test(battery)) {
    out.push({
      title: 'Батарея Body Scan розряджена',
      body: 'Сегментний аналіз і ЕКГ недоступні. Композиція далі міряється, але на базовому імпедансі ±3–5%.',
      action: 'зарядити перед наступним блоком E23',
      color: P.warn,
    });
  }

  const polar = ctx.sourceState('polar');
  const padRunning = data.raw(E.padState) === 'running';
  if (padRunning && data.raw(E.polarStreaming) === 'off' && data.raw(E.polarWorn) === 'on') {
    out.push({
      title: 'BLE-конфлікт: H10 ↔ доріжка',
      body: 'Доріжка працює, ремінь вдягнений, але потік даних зупинений. Спільна сесія ламає реалтайм.',
      action: 'рознести в часі або додати другий адаптер',
      color: P.warn,
    });
  } else if (polar.state === 'dead') {
    out.push({
      title: 'Polar H10 не віддає жодного значення',
      body: 'Усі сенсори ременя порожні. Ранковий протокол HRV (E20, E22) виконати нічим.',
      action: 'перевірити батарею й BLE-зʼєднання',
      color: P.warn,
    });
  }

  const mac = ctx.sourceState('macos');
  if (mac.state === 'dead' || mac.state === 'empty') {
    out.push({
      title: 'Сенсори macOS вимкнені',
      body: 'camera_in_use і frontmost_app недоступні — немає ground truth зустрічей, лишається тільки план у календарі.',
      action: 'увімкнути сенсори → розблокує E27',
      color: P.alert,
    });
  }

  // unit sanity: a pressure of ~14.6 is psi, not hPa
  const pressure = data.val(E.phonePressure);
  const pUnit = (data.unit(E.phonePressure) || '').toLowerCase();
  if (pressure !== null && pressure < 100 && !pUnit.includes('psi')) {
    out.push({
      title: 'Неправильна одиниця тиску',
      body: `iPhone віддає ${fmt(pressure, 3)} з одиницею «${data.unit(E.phonePressure) || '—'}» — `
        + `це psi, тобто ${fmt(pressure * 68.9476, 0)} гПа. Графік має правильну форму й неправильні числа.`,
      action: 'виправити unit_of_measurement у customize.yaml',
      color: P.warn,
    });
  }

  const wPwv = data.val(E.wPwv);
  const wUnit = (data.unit(E.wPwv) || '').toLowerCase();
  if (wPwv !== null && wPwv > 10 && !wUnit.includes('m/s')) {
    out.push({
      title: 'ШПХ Withings у неправильних одиницях',
      body: `Значення ${fmt(wPwv, 2)} «${data.unit(E.wPwv) || '—'}» — це mph, тобто `
        + `${fmt(wPwv * 0.44704, 2)} м/с. Сторінка «Серце» конвертує його на льоту, у HA воно лишається сирим.`,
      action: 'виправити unit_of_measurement у customize.yaml',
      color: P.warn,
    });
  }

  const orn = data.raw(E.ornLastReport);
  if (orn) {
    const months = (Date.now() - new Date(orn).getTime()) / (30.44 * 86400e3);
    if (months > 11) {
      out.push({
        title: `Основна панель ${Math.round(months)} міс тому`,
        body: 'Швидкі маркери (ГГТ, ТГ, сечова, вітD) за рік втручань могли зрушити, але перевірити нічим.',
        action: 'записатись на повторний забір — це E31',
        color: P.warn,
      });
    }
  }

  const iqosSync = data.raw(E.iqosSync);
  if (iqosSync) {
    const d = (Date.now() - new Date(iqosSync).getTime()) / 86400e3;
    if (d > 2) {
      out.push({
        title: `IQOS не синхронізований ${Math.round(d)} дн.`,
        body: 'Лічильник стиків оновлюється вручну. Поки синхронізації немає, добові значення заморожені, '
          + 'а крос-кореляція з PM2.5 (E29) працює на застарілих таймстемпах.',
        action: 'синхронізувати пристрій',
        color: P.warn,
      });
    }
  }

  const hidrate = ctx.sourceState('hidrate');
  if (hidrate.state === 'dead' || hidrate.state === 'empty') {
    out.push({
      title: 'Hidrate Spark поза звʼязком',
      body: 'Жоден сенсор пляшки не віддає значень. Гідратація сьогодні не виміряна взагалі — '
        + 'це «немає даних», а не «0 мл».',
      action: 'перевірити BLE-проксі пляшки',
      color: P.warn,
    });
  }

  return out;
}

/** Pairs of independent sources measuring the same quantity. */
function buildDisagreements(ctx) {
  const { data } = ctx;
  const out = [];

  const ouraPwv = data.val(E.ouraPwv);
  const wPwvRaw = data.val(E.wPwv);
  if (ouraPwv !== null && wPwvRaw !== null) {
    const wPwv = /mph/i.test(data.unit(E.wPwv) || '') ? wPwvRaw * 0.44704 : wPwvRaw;
    const d = Math.abs(ouraPwv - wPwv);
    out.push({
      title: 'ШПХ: Oura ↔ Withings',
      body: `${fmt(ouraPwv, 2)} проти ${fmt(wPwv, 2)} м/с, різниця ${fmt(d, 2)}. `
        + (d < 1 ? 'Два незалежні прилади зійшлися — величині можна вірити.'
          : 'Розбіжність понад метр на секунду — обидва значення орієнтовні.'),
      action: d < 1 ? 'згода джерел' : 'потрібне третє джерело',
      color: d < 1 ? P.good : P.warn,
    });
  }

  const steps = [
    ['доріжка', data.val(E.padStepsDay)],
    ['Oura', data.val(E.ouraSteps)],
    ['iPhone', data.val(E.phoneSteps)],
  ].filter(([, v]) => v !== null);
  if (steps.length >= 2) {
    const vs = steps.map(([, v]) => v);
    const spread = Math.max(...vs) - Math.min(...vs);
    out.push({
      title: 'Три лічильники кроків',
      body: steps.map(([k, v]) => `${k} ${fmt(v, 0)}`).join(' · ')
        + `. Розкид ${fmt(spread, 0)} кроків — вони міряють різні речі й не зводяться в одне число.`,
      action: 'жоден не є «правильним»',
      color: spread > 3000 ? P.warn : P.ref,
    });
  }

  const pm = [
    ['спальня', data.val(E.bedPm25)],
    ['робоче', data.val(E.deskPm25)],
    ['Dyson', data.val(E.dysonPm25)],
  ].filter(([, v]) => v !== null);
  if (pm.length >= 2) {
    const vs = pm.map(([, v]) => v);
    const spread = Math.max(...vs) - Math.min(...vs);
    out.push({
      title: 'Три сенсори PM2.5',
      body: pm.map(([k, v]) => `${k} ${fmt(v, 0)}`).join(' · ')
        + `. Розкид ${fmt(spread, 0)} мкг/м³ — це і є сигнал про локальність джерела.`,
      action: spread > 8 ? 'локальне джерело поруч з одним із сенсорів' : 'прилади сходяться',
      color: spread > 8 ? P.warn : P.good,
    });
  }

  const ouraAwake = data.val(E.ouraAwake);
  const museAwake = data.val(E.museAwake);
  if (ouraAwake !== null && museAwake !== null) {
    out.push({
      title: 'Неспання: Oura ↔ Muse',
      body: `Oura ${fmt(ouraAwake, 0)} хв, Muse ${fmt(museAwake, 0)} хв. `
        + 'Акселерометр рахує рух, ЕЕГ бачить кору — це не помилка одного з них.',
      action: 'канали лишаються окремими',
      color: P.ref,
    });
  }

  return out;
}
