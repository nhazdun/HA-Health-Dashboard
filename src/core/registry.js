/**
 * The source registry: every data channel in the stack, the Home Assistant
 * entities that carry it, and the cadence it is *expected* to write at.
 *
 * Liveness is derived, never hard-coded. A source is fresh, uneven, stale or
 * dead purely as a function of `now - last_reported` against `step`. That is
 * the whole point of the "trust is a first-class citizen" rule in the brief:
 * a dead CGM must never be able to look alive again.
 */

const MIN = 60e3;
const HOUR = 3600e3;
const DAY = 86400e3;

export const SOURCES = [
  {
    key: 'nightscout',
    name: 'Nightscout',
    step: MIN,
    stepLabel: '1 хв',
    role: 'Швидкий ендпоінт',
    note: 'Глікемія з Juggluco. Вік даних читається з sensor.glucose_age — понад 15 хв означає розрив каналу.',
    entities: ['sensor.glucose', 'sensor.glucose_mgdl', 'sensor.glucose_trend'],
    ageEntity: 'sensor.glucose',
    // glucose_age is minutes-since-last-CGM-write, a better truth than last_reported
    ageOverride: { entity: 'sensor.glucose_age', scale: MIN },
  },
  {
    key: 'oura',
    // Cloud-polled: the integration refreshes on its own schedule, so the
    // honest expectation is tens of minutes, not the sensor's sample rate.
    name: 'Oura Ring',
    step: 30 * MIN,
    stepLabel: 'доба / ~30 хв',
    role: 'Ендпоінт сну й відновлення',
    note: 'Нічні метрики приходять уранці, денні — протягом дня. Це хмарний опит, не реалтайм.',
    prefix: 'sensor.oura_ring_',
  },
  {
    key: 'muse',
    name: 'Muse S',
    step: 30 * HOUR,
    stepLabel: 'доба, лаг ~20 год',
    role: 'Незалежний ЕЕГ-ендпоінт',
    note: 'Друге, фізіологічно інше джерело стадій сну. Живе, поки активна підписка.',
    prefix: 'sensor.muse_',
  },
  {
    key: 'polar',
    name: 'Polar H10',
    step: 5 * MIN,
    stepLabel: 'удар / сесія',
    role: 'Реалтайм-серце',
    note: 'Пише лише під час носіння. Поза сесією «немає даних» — це норма, а не збій.',
    prefix: 'sensor.polar_h10_',
    sessionBased: true,
    liveWhen: 'binary_sensor.polar_h10_1d6ea138_worn',
  },
  {
    key: 'withings',
    name: 'Withings',
    step: 36 * HOUR,
    stepLabel: 'зважування',
    role: 'Композиція тіла',
    note: 'Шум імпедансу ±3–5%. Одне зважування не значить нічого, потрібне ковзне.',
    prefix: 'sensor.nh_health_withings_',
    trust: 'low',
  },
  {
    key: 'kingsmith',
    name: 'KingSmith',
    step: 15 * MIN,
    stepLabel: '5 с / доба',
    role: 'Втручання: активність',
    note: 'Добові агрегати надійні, реалтайм-швидкість періодично відвалюється.',
    entities: [
      'sensor.walkingpad_current_speed', 'sensor.walkingpad_state',
      'sensor.living_room_hn_walking_pad_kroki_za_den',
      'sensor.living_room_hn_walking_pad_trivalist_za_den',
      'sensor.living_room_hn_walking_pad_vidstan_za_den',
    ],
  },
  {
    key: 'qp_bed',
    name: 'Qingping · спальня',
    step: 10 * MIN,
    stepLabel: '~5 хв',
    role: 'Конфаундер + втручання',
    note: 'PM10, шум і TVOC не мають state_class — довгострокової статистики по них немає.',
    prefix: 'sensor.cgllc_cgs2_7fc5_',
  },
  {
    key: 'qp_desk',
    name: 'Qingping · робоче',
    step: 10 * MIN,
    stepLabel: '~5 хв',
    role: 'Конфаундер',
    note: 'Друга точка для тріангуляції PM2.5.',
    prefix: 'sensor.cgllc_cgs2_554b_',
  },
  {
    key: 'dyson',
    name: 'Dyson',
    step: 10 * MIN,
    stepLabel: '~5 хв',
    role: 'Третє джерело PM + унікальні гази',
    note: 'Єдине джерело NO₂ і формальдегіду в системі.',
    prefix: 'sensor.dyson_5jb_eu_uka2805a_',
  },
  {
    key: 'hidrate',
    name: 'Hidrate Spark',
    step: 6 * HOUR,
    stepLabel: 'ковток',
    role: 'Втручання: гідратація',
    note: 'Покриття неповне — вода поза пляшкою не фіксується взагалі.',
    prefix: 'sensor.h2o00008374_',
    trust: 'low',
  },
  {
    key: 'iqos',
    name: 'IQOS',
    step: 30 * HOUR,
    stepLabel: 'доба, ручна синхронізація',
    role: 'Втручання: поведінка',
    note: 'Ручна синхронізація, таймстемпи ±15% — на межі точності для крос-кореляції з PM2.5.',
    entities: [
      'input_number.iqos_cigarettes_today',
      'sensor.c0_69_06_73_9f_d0_iqos_zatiazhki_za_den',
      'input_datetime.iqos_last_sync_date',
    ],
    trust: 'low',
  },
  {
    key: 'foodwatch',
    name: 'Foodwatch',
    step: 8 * HOUR,
    stepLabel: 'прийом їжі',
    role: 'Єдиний таймстемп їжі',
    note: 'Без нього жоден постпрандіальний AUC неможливо вирізати з ряду глюкози.',
    entities: [
      'input_datetime.foodwatch_last_eaten',
      'input_number.foodwatch_eaten_calories_total',
      'input_number.foodwatch_eaten_carbs_total',
      'input_text.foodwatch_last_meal',
    ],
  },
  {
    key: 'foodie',
    name: 'Foodie',
    step: 30 * HOUR,
    stepLabel: 'доба',
    role: 'Контекст: план раціону',
    note: 'Пайплайн «фото → БЖУ через OCR». План, а не факт.',
    entities: [
      'input_text.foodie_snidanok_1', 'input_text.foodie_snidanok_2', 'input_text.foodie_obid',
      'input_text.foodie_poludenok', 'input_text.foodie_vecheria', 'input_datetime.foodie_data_ratsionu',
    ],
  },
  {
    key: 'iphone',
    name: 'iPhone',
    step: HOUR,
    stepLabel: 'подія / доба',
    role: 'Третій лічильник кроків',
    note: 'Незалежний від Oura й доріжки лічильник — розбіжність між трьома є окремою метрикою.',
    prefix: 'sensor.iphone_anonymous_',
  },
  {
    key: 'upright',
    name: 'Upright GO 2',
    step: 30 * MIN,
    stepLabel: 'хвилини',
    role: 'Ендпоінт без гіпотези',
    note: 'Дані збираються наперед, під майбутню гіпотезу.',
    entities: [
      'sensor.upright_go_2_posture_angle',
      'sensor.nh_health_upright_go_2_slouching_time',
      'sensor.nh_health_upright_go_2_upright_time',
    ],
  },
  {
    key: 'alerts',
    name: 'Повітряні тривоги',
    step: 12 * HOUR,
    stepLabel: 'подія',
    role: "Обов'язковий конфаундер",
    note: 'Без цієї коваріати нічний провал HRV виглядає як поганий протокол.',
    prefix: 'binary_sensor.zolochivska_teritorialna_gromada_',
    eventBased: true,
  },
  {
    key: 'ornament',
    name: 'Ornament',
    step: 120 * DAY,
    stepLabel: 'квартал–рік',
    role: 'Повільний ендпоінт',
    note: '163 біомаркери з референсним і оптимальним коридором на кожному.',
    prefix: 'sensor.ornament_nazariy_',
    lagByDesign: true,
  },
  {
    key: 'macos',
    name: 'HA Companion · macOS',
    step: 30 * MIN,
    stepLabel: 'секунди',
    role: 'Втручання: факт мітингів',
    note: 'camera_in_use + frontmost_app дають ground truth зустрічей, якого не дає календар.',
    entities: [
      'binary_sensor.macbook_nh_camera_in_use',
      'binary_sensor.macbook_nh_active',
      'sensor.macbook_nh_frontmost_app',
    ],
  },
];

/** Every entity a source owns, resolved against the live state machine. */
export function sourceEntities(src, data) {
  if (src.prefix) return data.byPrefix(src.prefix);
  return (src.entities || []).filter((id) => data.exists(id));
}

/**
 * Derive a source's trust state from real timing. Nothing about this is
 * hard-coded per device — change the cadence and the verdict follows.
 */
export function sourceState(src, data) {
  const ids = sourceEntities(src, data);
  if (!ids.length) return { state: 'empty', ageMs: null, ids, live: 0, total: 0 };

  const live = ids.filter((id) => {
    const s = data.st(id);
    return s && s.state !== 'unavailable' && s.state !== 'unknown';
  }).length;

  let ageMs = data.ageOfAny(ids);
  if (src.ageOverride && data.exists(src.ageOverride.entity)) {
    const v = data.val(src.ageOverride.entity);
    if (v !== null) ageMs = v * src.ageOverride.scale;
  }

  // A session-based source (a chest strap) writes only while worn. Between
  // sessions it reports nothing, and that is the expected state — not a fault.
  // This has to be decided before the "no live sensors" check, otherwise an
  // idle strap is permanently and wrongly branded dead.
  if (src.sessionBased) {
    const worn = src.liveWhen ? data.raw(src.liveWhen) === 'on' : false;
    if (!worn) return { state: 'lag', ageMs, ids, live, total: ids.length, idle: true };
  }

  if (!live) return { state: 'dead', ageMs, ids, live, total: ids.length };
  if (ageMs === null) return { state: 'empty', ageMs, ids, live, total: ids.length };
  if (src.eventBased) return { state: 'ok', ageMs, ids, live, total: ids.length };

  const r = ageMs / src.step;
  let state = r <= 1.5 ? 'ok' : r <= 3 ? 'warn' : r <= 8 ? 'stale' : 'dead';
  if (src.lagByDesign && state !== 'dead') state = 'lag';
  if (src.trust === 'low' && (state === 'ok' || state === 'warn')) state = 'low';
  return { state, ageMs, ids, live, total: ids.length };
}

/** Entity groups used across pages, kept in one place so ids are not scattered. */
export const E = {
  glucose: 'sensor.glucose',
  glucoseAge: 'sensor.glucose_age',
  glucoseTrend: 'sensor.glucose_trend',

  ouraHr: 'sensor.oura_ring_current_heart_rate',
  ouraHrMin: 'sensor.oura_ring_minimum_heart_rate',
  ouraHrMax: 'sensor.oura_ring_maximum_heart_rate',
  ouraHrAvg: 'sensor.oura_ring_average_heart_rate',
  ouraSleepHrv: 'sensor.oura_ring_average_sleep_hrv',
  ouraSleepHr: 'sensor.oura_ring_average_sleep_heart_rate',
  ouraLowestHr: 'sensor.oura_ring_lowest_sleep_heart_rate',
  ouraTotalSleep: 'sensor.oura_ring_total_sleep_duration',
  ouraDeep: 'sensor.oura_ring_deep_sleep_duration',
  ouraDeepPct: 'sensor.oura_ring_deep_sleep_percentage',
  ouraRem: 'sensor.oura_ring_rem_sleep_duration',
  ouraRemPct: 'sensor.oura_ring_rem_sleep_percentage',
  ouraLight: 'sensor.oura_ring_light_sleep_duration',
  ouraAwake: 'sensor.oura_ring_awake_time',
  ouraEff: 'sensor.oura_ring_sleep_efficiency',
  ouraLatency: 'sensor.oura_ring_sleep_latency',
  ouraInBed: 'sensor.oura_ring_time_in_bed',
  ouraBedStart: 'sensor.oura_ring_bedtime_start',
  ouraBedEnd: 'sensor.oura_ring_bedtime_end',
  ouraSpo2: 'sensor.oura_ring_spo2_average',
  ouraBdi: 'sensor.oura_ring_breathing_disturbance_index',
  ouraPwv: 'sensor.oura_ring_pulse_wave_velocity',
  ouraCvAge: 'sensor.oura_ring_cardiovascular_age',
  ouraHrvBalance: 'sensor.oura_ring_hrv_balance_score',
  ouraSteps: 'sensor.oura_ring_steps',
  ouraTemp: 'sensor.oura_ring_temperature_deviation',
  ouraRegularity: 'sensor.oura_ring_sleep_regularity_score',
  ouraReadiness: 'sensor.oura_ring_readiness_score',
  ouraSleepScore: 'sensor.oura_ring_sleep_score',
  ouraActive: 'sensor.oura_ring_active_calories',
  ouraTotalCal: 'sensor.oura_ring_total_calories',

  museDeep: 'sensor.muse_deep_sleep',
  museDeepPct: 'sensor.muse_deep_sleep_percentage',
  museRem: 'sensor.muse_rem_sleep',
  museLight: 'sensor.muse_light_sleep',
  museAwake: 'sensor.muse_awake_time',
  museAsleep: 'sensor.muse_time_asleep',
  museInBed: 'sensor.muse_time_in_bed',
  museStart: 'sensor.muse_sleep_start',
  museEnd: 'sensor.muse_sleep_end',
  museApf: 'sensor.muse_alpha_peak_frequency',
  museApfBase: 'sensor.muse_alpha_peak_lifetime_average',
  museSpindles: 'sensor.muse_sleep_spindles',
  museIntensity: 'sensor.muse_deep_sleep_intensity',
  museScore: 'sensor.muse_sleep_score',
  museSubDays: 'sensor.muse_subscription_days_remaining',
  museSubActive: 'binary_sensor.muse_subscription_active',

  polarHr: 'sensor.polar_h10_1d6ea138_heart_rate',
  polarRmssd: 'sensor.polar_h10_1d6ea138_hrv_rmssd',
  polarSdnn: 'sensor.polar_h10_1d6ea138_hrv_sdnn',
  polarResp: 'sensor.polar_h10_1d6ea138_respiration_rate',
  polarWorn: 'binary_sensor.polar_h10_1d6ea138_worn',
  polarStreaming: 'binary_sensor.polar_h10_1d6ea138_streaming',
  hrMax: 'input_number.maksimalnii_puls',

  wFat: 'sensor.nh_health_withings_fat_ratio',
  wMuscle: 'sensor.nh_health_withings_muscle_mass',
  wWeight: 'sensor.nh_health_withings_weight',
  wFatMass: 'sensor.nh_health_withings_fat_mass',
  wFatFree: 'sensor.nh_health_withings_fat_free_mass',
  wBone: 'sensor.nh_health_withings_bone_mass',
  wPwv: 'sensor.nh_health_withings_pulse_wave_velocity',
  wPulse: 'sensor.nh_health_withings_heart_pulse',
  wVascAge: 'sensor.nh_health_withings_vascular_age',
  wVisceral: 'sensor.nh_health_withings_visceral_fat_index',
  bodyScanBattery: 'sensor.body_scan_battery',

  padSpeed: 'sensor.walkingpad_current_speed',
  padState: 'sensor.walkingpad_state',
  padStepsDay: 'sensor.living_room_hn_walking_pad_kroki_za_den',
  padTimeDay: 'sensor.living_room_hn_walking_pad_trivalist_za_den',
  padDistDay: 'sensor.living_room_hn_walking_pad_vidstan_za_den',
  padBelt: 'switch.walkingpad_belt',
  padSpeedSet: 'number.walkingpad_speed',
  padConnected: 'binary_sensor.walkingpad_connected',

  bedTemp: 'sensor.cgllc_cgs2_7fc5_temperature',
  bedCo2: 'sensor.cgllc_cgs2_7fc5_co2_density',
  bedPm25: 'sensor.cgllc_cgs2_7fc5_pm25_density',
  bedPm10: 'sensor.cgllc_cgs2_7fc5_pm10_density',
  bedNoise: 'sensor.cgllc_cgs2_7fc5_noise_decibel',
  bedHum: 'sensor.cgllc_cgs2_7fc5_relative_humidity',
  bedTvoc: 'sensor.cgllc_cgs2_7fc5_tvoc_density',

  deskTemp: 'sensor.cgllc_cgs2_554b_temperature',
  deskCo2: 'sensor.cgllc_cgs2_554b_co2_density',
  deskPm25: 'sensor.cgllc_cgs2_554b_pm25_density',
  deskPm10: 'sensor.cgllc_cgs2_554b_pm10_density',
  deskNoise: 'sensor.cgllc_cgs2_554b_noise_decibel',
  deskTvoc: 'sensor.cgllc_cgs2_554b_tvoc_density',
  deskHum: 'sensor.cgllc_cgs2_554b_relative_humidity',

  dysonPm25: 'sensor.dyson_5jb_eu_uka2805a_pm2_5',
  dysonPm10: 'sensor.dyson_5jb_eu_uka2805a_pm10',
  dysonNo2: 'sensor.dyson_5jb_eu_uka2805a_no2',
  dysonHcho: 'sensor.dyson_5jb_eu_uka2805a_hcho',
  dysonVoc: 'sensor.dyson_5jb_eu_uka2805a_voc',
  dysonAqi: 'sensor.dyson_5jb_eu_uka2805a_indoor_aqi_15_min',
  dysonAqiIdx: 'sensor.dyson_5jb_eu_uka2805a_air_quality_index',
  dysonOutdoor: 'sensor.dyson_5jb_eu_uka2805a_outdoor_aqi',
  dysonDominant: 'sensor.dyson_5jb_eu_uka2805a_dominant_pollutant',
  dysonTemp: 'sensor.dyson_5jb_eu_uka2805a_temperature',
  dysonHumidity: 'sensor.dyson_5jb_eu_uka2805a_humidity',
  dysonFilter: 'sensor.dyson_5jb_eu_uka2805a_hepa_filter_life',
  dysonNextClean: 'sensor.dyson_5jb_eu_uka2805a_duration',

  waterToday: 'sensor.h2o00008374_water_today',
  sipsToday: 'sensor.h2o00008374_sips_today',
  refillsToday: 'sensor.h2o00008374_refills_today',
  bottleFill: 'sensor.h2o00008374_current_fill_percent',
  lastSip: 'sensor.h2o00008374_last_sip_time',

  iqosToday: 'input_number.iqos_cigarettes_today',
  iqosPuffs: 'sensor.c0_69_06_73_9f_d0_iqos_zatiazhki_za_den',
  iqosSync: 'input_datetime.iqos_last_sync_date',
  iqosLock: 'button.iqos_iluma_i_prime_lock',

  fwLastEaten: 'input_datetime.foodwatch_last_eaten',
  fwLastMeal: 'input_text.foodwatch_last_meal',
  fwKcal: 'input_number.foodwatch_eaten_calories_total',
  fwCarbs: 'input_number.foodwatch_eaten_carbs_total',
  fwProtein: 'input_number.foodwatch_eaten_protein_total',
  fwFat: 'input_number.foodwatch_eaten_fat_total',
  fwSlots: 'input_text.foodwatch_eaten_slots',

  foodieDate: 'input_datetime.foodie_data_ratsionu',
  foodieMeals: [
    'input_text.foodie_snidanok_1', 'input_text.foodie_snidanok_2', 'input_text.foodie_obid',
    'input_text.foodie_poludenok', 'input_text.foodie_vecheria',
  ],

  phoneSteps: 'sensor.iphone_anonymous_steps',
  phoneDistance: 'sensor.iphone_anonymous_distance',
  phonePressure: 'sensor.iphone_anonymous_pressure',
  phoneActivity: 'sensor.iphone_anonymous_activity',
  phoneFloors: 'sensor.iphone_anonymous_floors_ascended',

  postureAngle: 'sensor.upright_go_2_posture_angle',
  slouchTime: 'sensor.nh_health_upright_go_2_slouching_time',
  uprightTime: 'sensor.nh_health_upright_go_2_upright_time',
  slouching: 'binary_sensor.upright_go_2_slouching',
  movement: 'sensor.nh_health_upright_go_2_movement',
  postureCalibrate: 'button.upright_go_2_calibrate',
  postureSensitivity: 'number.upright_go_2_posture_sensitivity',
  vibrationDelay: 'number.upright_go_2_vibration_delay',
  postureMode: 'select.nh_health_upright_go_2_mode',
  sleepButton: 'input_button.sleep',

  camera: 'binary_sensor.macbook_nh_camera_in_use',
  frontApp: 'sensor.macbook_nh_frontmost_app',
  macActive: 'binary_sensor.macbook_nh_active',

  ornPrefix: 'sensor.ornament_nazariy_',
  ornLastReport: 'sensor.ornament_nazariy_last_lab_report',
  ornAbnormal: 'sensor.ornament_nazariy_abnormal_biomarkers',
  ornTracked: 'sensor.ornament_nazariy_biomarkers_tracked',

  alertPrefix: 'binary_sensor.zolochivska_teritorialna_gromada_',
  period: 'input_select.health_dashboard_period',
  sleepAnchor: 'input_datetime.sleep_anchor',
};

/**
 * Non-lab entities that are excluded from the "biomarker" registry on the Labs
 * page — they are integration bookkeeping, not measurements.
 */
export const ORNAMENT_META = new Set([
  'sensor.ornament_nazariy_last_lab_report',
  'sensor.ornament_nazariy_last_laboratory',
  'sensor.ornament_nazariy_abnormal_biomarkers',
  'sensor.ornament_nazariy_biomarkers_tracked',
]);
