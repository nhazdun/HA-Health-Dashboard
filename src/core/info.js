/**
 * One plain-language explanation per metric, keyed by card label.
 *
 * The dashboard assumes nothing about what the reader already knows. A card
 * shows a number; this says what the number is and why it is on the page. The
 * text appears as a tooltip next to the label and in full inside the card
 * detail modal.
 */
export const INFO = {
  // ---- Now
  'Glucose · CGM': 'Blood glucose from the continuous sensor. The step is 1 minute. This is the main metabolic endpoint.',
  'Heart rate · Polar H10': 'Heart rate from the chest strap. The strap reads every beat, so the delay is under one second.',
  'Heart rate · Oura (H10 not worn)': 'Heart rate from the ring. The ring samples far less often than the chest strap, so treat it as a trend and not a beat-by-beat reading.',
  'RMSSD now': 'Short-term heart rate variability over the last 5 minutes. A higher value shows better parasympathetic recovery.',
  'Since last meal': 'Time from the last logged meal. This counter opens the window for a postprandial glucose curve.',
  'Treadmill today': 'Walk time on the treadmill today. The treadmill counts the steps that the ring does not see.',
  'Posture angle': 'How far the upper back leans from vertical. A value above 10° counts as a slouch.',
  'PM2.5 · bedroom': 'Fine dust in the bedroom air. Particles under 2.5 µm reach the lungs and the blood.',
  'PM2.5 · living room': 'Fine dust at the desk. Compare it with the bedroom to find the source of a peak.',
  'PM2.5 · bedroom, Dyson': 'Fine dust from the laser sensor. It confirms or rejects a peak that the Qingping node reports.',
  'Water today': 'Water from the bottle today. The bottle does not record water from other cups.',
  'Air raid alert': 'An active alert for this district. Use it as a covariate for HRV, sleep and glucose.',
  'IQOS today': 'Sticks used today. The count comes from a manual sync, so the timestamps are ±15%.',

  // ---- Night
  'Total sleep': 'Total time asleep for the night. This is the strongest predictor of the morning fasting glucose.',
  'Deep sleep': 'Time in slow-wave sleep. The body repairs tissue and releases growth hormone in this stage.',
  'Deep, %': 'Share of slow-wave sleep in the total sleep time.',
  REM: 'Time in REM sleep. Alcohol and late screen time both reduce it.',
  'REM, %': 'Share of REM sleep in the total sleep time.',
  Efficiency: 'Share of the time in bed that you spent asleep.',
  Latency: 'Time from lights out to sleep onset. It tests every wind-down protocol.',
  'Lowest HR': 'Lowest heart rate during the night. This is the cleanest marker of night recovery.',
  'Deep sleep · EEG': 'Slow-wave sleep from the EEG headband. It measures delta activity and not movement.',
  'Alpha peak': 'Your individual alpha frequency. It tracks cognitive efficiency against your own baseline.',
  'Bedroom temperature': 'Air temperature in the bedroom. The optimum for slow-wave sleep is 17°C to 19°C.',
  'Muse subscription': 'Days left on the headband subscription. At zero the EEG channel stops.',

  // ---- Metabolism
  'Spikes above 7.8': 'Number of postprandial rises above 7.8 mmol/L in the window. A spike is what damages vessels, not the daily average.',
  'Largest peak rise': 'Highest rise from the pre-meal value to the peak, across the logged meals.',
  'Time above 7.8': 'Total time with glucose above the upper target of 7.8 mmol/L.',
  'Mean time to peak': 'Average time from the meal to the glucose peak. A late peak points to fat and protein in the dish.',
  'Worst dish': 'Dish with the highest average peak rise across its repeats.',
  'Best dish': 'Dish with the lowest average peak rise across its repeats.',
  'Walk effect': 'Average change in peak rise when a walk follows the meal within 30 minutes.',
  'HOMA-IR': 'Insulin resistance index. The formula is fasting glucose times fasting insulin divided by 22.5.',
  'Fasting insulin': 'How much insulin the body needs to hold glucose at a normal level.',
  HbA1c: 'Glycated haemoglobin. It shows the average glucose over the last 8 to 12 weeks.',
  'Fasting glucose · lab': 'A single fasting measurement from the laboratory panel. The CGM covers the rest of the day.',
  'TIR 3.9–7.8': 'Share of the day with glucose inside the target range of 3.9 to 7.8 mmol/L.',
  'Mean glucose': 'Average glucose over the window. It hides spikes, so read it together with the spike count.',
  'Variability CV': 'Coefficient of variation. Below 36% the glucose line is considered stable.',
  'Calories eaten': 'Energy actually eaten today. The actual value drives the glucose response, not the plan.',
  'Carbs eaten': 'Carbohydrate actually eaten today. This is the independent variable for the postprandial rise.',
  'Protein eaten': 'Protein actually eaten today. The target is 1.6 g to 2.0 g per kg of body mass.',
  'Fat eaten': 'Fat actually eaten today.',
  'Last meal': 'Energy and macros of the last logged meal, with its timestamp.',
  'Highest-carb item': 'The single item with the most carbohydrate in the plan. It sets the largest glucose peak.',
  'Plan vs actual': 'Difference between the planned menu and the food that you ate.',

  // ---- Body
  'Body fat · 7-day rolling': 'Body fat from bioimpedance, as a 7-day rolling mean. The raw noise is ±3–5%.',
  'Muscle mass': 'Muscle mass from bioimpedance. It must rise while body fat falls.',
  Weight: 'Body mass from the scale. Weight alone says little during a recomposition.',
  BMI: 'Body mass index. It uses only height and weight, so it ignores the muscle share.',
  'Fat-free mass': 'Muscle, bone and water together.',
  'Fat mass': 'Absolute mass of body fat, in kilograms.',
  'Segmental analysis': 'Fat and muscle per body part. It needs a charged Body Scan.',
  'Grip strength': 'Best of three grip attempts. Strength rises before body composition changes.',

  // ---- Heart
  'Nocturnal dipping ratio': 'Drop of blood pressure at night against the day. A drop under 10% is a risk.',
  'HRV during sleep': 'Heart rate variability across the night. It falls after alcohol, IQOS and alerts.',
  'RMSSD, morning': 'Heart rate variability from a 5-minute seated protocol. It is more sensitive than the nightly value.',
  'Lowest HR asleep': 'Lowest heart rate during sleep, from the ring.',
  'PWV · Oura': 'Pulse wave velocity. It shows arterial stiffness and it is a long-term endpoint.',
  'Cardiovascular age': 'Age estimate from pulse wave velocity and heart rate. Compare it with the real age.',
  'Atherogenic index': 'Integral lipid risk. The formula is total cholesterol minus HDL, divided by HDL.',
  ApoB: 'Number of atherogenic particles. It is more precise than LDL cholesterol.',
  'LDL cholesterol': 'Cholesterol carried by low-density particles. It drives plaque formation.',
  Triglycerides: 'Fat circulating in the blood. It rises with excess carbohydrate and alcohol.',
  'Nocturnal SpO₂': 'Blood oxygen saturation across the night. It screens for apnoea.',

  // ---- Environment
  Temperature: 'Air temperature in this room.',
  'CO₂': 'Carbon dioxide in the air. Above 800 ppm sleep fragments and focus drops.',
  'PM2.5 · Qingping': 'Fine dust from the Qingping node in the bedroom.',
  'PM2.5 · Dyson': 'Fine dust from the Dyson laser sensor. It is the second opinion for the bedroom.',
  'PM2.5': 'Fine dust in this room. One device only, so a peak stays unconfirmed.',
  PM10: 'Coarse dust in this room.',
  'NO₂': 'Nitrogen dioxide from gas burners and street traffic. Only the Dyson unit measures it.',
  Formaldehyde: 'Formaldehyde from furniture and finishes. The WHO limit is 0.1 mg/m³ over 30 minutes.',
  Noise: 'Sound level in this room. The WHO night limit is 30 dB.',
  Humidity: 'Relative humidity. Below 40% or above 60% the airways get irritated.',
  TVOC: 'Volatile organic compounds on the vendor scale. Compare the value only with itself.',
  'NO₂ · formaldehyde': 'Gas channels for this room. No Dyson unit here, so there is no measurement.',
  'AQI, 15 min': 'Air quality index over a 15 minute window. It is smoother than the instant value.',
  'HEPA life': 'Life left in the HEPA filter.',
  'Melanopic EDI': 'Light dose that drives the circadian clock. The sensor is not installed yet.',

  // ---- Behaviour
  'IQOS per day': 'Sticks per day. This is the main behavioural metric and the target is zero.',
  'Steps · Oura': 'Steps counted by the ring. It reads arm movement, so it misses treadmill walking.',
  'Steps · iPhone': 'Steps counted by the phone. It only counts while the phone is on you.',
  'Screen time': 'Screen time today. For sleep latency you need the 2 hours before bed and not the daily total.',
  Water: 'Water from the bottle today.',
  'Time slouched': 'Share of the tracked day with the back above the slouch threshold.',
  Movement: 'Movement state from the posture sensor. It is a proxy for sedentary time.',
  'Meetings, ground truth': 'True meeting time from the laptop. The sensors are off, so only the calendar plan remains.',
};

export const infoFor = (label) => INFO[label] || '';
