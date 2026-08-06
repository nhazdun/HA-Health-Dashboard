import { h } from './dom.js';
import { P } from './tokens.js';
import { fmt } from './format.js';
import { E, padMoving } from './registry.js';

/**
 * Device controls.
 *
 * These are the only writes the card performs, and each one maps to a single
 * Home Assistant service call on an entity the user already owns. Every
 * control reads its current value and its bounds straight off the entity, so
 * the UI can never offer a speed or a sensitivity the device would reject.
 *
 * Optimistic state is deliberately avoided: after a call the control shows
 * whatever HA reports next. A slider that snapped to a value the device did
 * not accept would be exactly the kind of comfortable lie the rest of this
 * dashboard exists to prevent.
 */

export function controlPanel(ctx, items) {
  const live = items.filter(Boolean);
  if (!live.length) return null;
  return h('div', {
    style: {
      display: 'grid', gap: '14px',
      gridTemplateColumns: live.length === 1
        ? 'minmax(260px,340px)' : 'repeat(auto-fit,minmax(300px,1fr))',
    },
  }, live.map((c) => controlCard(ctx, c)));
}

function controlCard(ctx, c) {
  return h('div.hh-ctl', [
    h('div.hd', [
      h('span.t', c.title),
      h('span.s', { style: { color: c.stateColor } }, [
        h('i.hh-dot', { style: { background: c.stateColor } }),
        c.status,
      ]),
    ]),
    c.primary ? h('button.hh-ctl-btn', {
      type: 'button',
      disabled: c.primary.disabled ? '' : null,
      style: {
        background: c.primary.filled ? ctx.accent : P.surf,
        color: c.primary.filled ? '#FFFFFF' : P.ink,
        borderColor: c.primary.filled ? ctx.accent : P.rule,
        opacity: c.primary.disabled ? 0.5 : 1,
        cursor: c.primary.disabled ? 'not-allowed' : 'pointer',
      },
      onClick: c.primary.disabled ? null : c.primary.go,
    }, c.primary.label) : null,
    ...(c.sliders || []).map((s) => slider(ctx, s)),
    ...(c.steppers || []).map((s) => stepper(ctx, s)),
    c.note ? h('span.nt', c.note) : null,
  ]);
}

function slider(ctx, s) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px' } }, [
    h('div', {
      style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' },
    }, [
      h('span', { style: { fontSize: '11.5px', color: P.mut } }, s.label),
      h('span', {
        style: { fontFamily: "'Geist Mono',monospace", fontSize: '12.5px', color: P.ink },
      }, s.display),
    ]),
    h('input', {
      type: 'range',
      min: String(s.min), max: String(s.max), step: String(s.step),
      value: String(s.value ?? s.min),
      disabled: s.disabled ? '' : null,
      style: { width: '100%', opacity: s.disabled ? 0.5 : 1 },
      onChange: (ev) => s.go(Number(ev.target.value)),
    }),
  ]);
}

function stepper(ctx, s) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px' } }, [
    h('span', { style: { fontSize: '11.5px', color: P.mut } }, s.label),
    h('div.hh-step', [
      h('button', { type: 'button', onClick: () => s.go(-1) }, '−'),
      h('span', s.display),
      h('button', { type: 'button', onClick: () => s.go(1) }, '+'),
    ]),
  ]);
}

// ------------------------------------------------------------- definitions

/** Treadmill and posture-sensor controls for the Now page. */
export function nowControls(ctx) {
  const { data } = ctx;
  const out = [];

  if (data.exists(E.padBelt) || data.exists(E.padSpeedSet)) {
    const running = data.raw(E.padBelt) === 'on' || padMoving(data.raw(E.padState));
    const b = data.bounds(E.padSpeedSet, { min: 0.5, max: 6, step: 0.1, unit: 'km/h' });
    const setSpeed = data.val(E.padSpeedSet);
    const current = data.val(E.padSpeed);
    const connected = data.raw(E.padConnected) !== 'off';
    out.push({
      title: 'Treadmill · KingSmith',
      status: !connected ? 'not connected'
        : running ? `running at ${fmt(current ?? setSpeed, 1)} ${b.unit}` : 'stopped',
      stateColor: !connected ? P.off : running ? P.good : P.off,
      primary: {
        label: running ? 'Stop' : 'Start',
        filled: !running,
        disabled: !connected,
        go: () => data.toggle(E.padBelt, !running),
      },
      sliders: data.exists(E.padSpeedSet) ? [{
        label: 'Speed',
        display: `${fmt(setSpeed, 1)} ${b.unit}`,
        min: b.min, max: b.max, step: b.step, value: setSpeed ?? b.min,
        disabled: !connected,
        go: (v) => data.setNumber(E.padSpeedSet, v),
      }] : [],
      note: connected ? null : 'The device is offline, so a command will not reach it.',
    });
  }

  if (data.exists(E.postureCalibrate) || data.exists(E.postureSensitivity)) {
    const mode = data.raw(E.postureMode);
    const slouching = data.raw(E.slouching) === 'on';
    const sens = data.bounds(E.postureSensitivity, { min: 1, max: 6, step: 1 });
    const delay = data.bounds(E.vibrationDelay, { min: 0, max: 255, step: 1, unit: 's' });
    const delayVal = data.val(E.vibrationDelay);
    out.push({
      title: 'Upright GO 2',
      status: mode ? (slouching ? `${mode} · slouching` : `${mode} · upright`) : 'not tracking',
      stateColor: !mode ? P.off : slouching ? P.warn : P.good,
      primary: data.exists(E.postureCalibrate) ? {
        label: 'Calibrate posture',
        filled: false,
        go: () => data.press(E.postureCalibrate),
      } : null,
      sliders: data.exists(E.postureSensitivity) ? [{
        label: 'Posture sensitivity',
        display: String(fmt(data.val(E.postureSensitivity), 0)),
        min: sens.min, max: sens.max, step: sens.step, value: data.val(E.postureSensitivity),
        go: (v) => data.setNumber(E.postureSensitivity, v),
      }] : [],
      steppers: data.exists(E.vibrationDelay) ? [{
        label: 'Vibration delay',
        display: `${fmt(delayVal, 0)} ${delay.unit || 's'}`,
        go: (d) => data.setNumber(E.vibrationDelay, (delayVal ?? 0) + d * (delay.step || 1)),
      }] : [],
      note: 'Calibration sets the zero point. Hold your back straight as you press it.',
    });
  }

  return out;
}

/** Sleep-session control for the Night page. */
export function sleepControls(ctx) {
  const { data } = ctx;
  if (!data.exists(E.sleepButton) && !data.exists(E.sleepAnchor)) return [];

  const anchorRaw = data.raw(E.sleepAnchor);
  const anchor = anchorRaw ? new Date(String(anchorRaw).replace(' ', 'T')) : null;
  const anchorMs = anchor && !Number.isNaN(+anchor) ? anchor.getTime() : null;
  // an anchor is "this session" only while it is recent and in the past
  const sinceMin = anchorMs !== null ? (Date.now() - anchorMs) / 60000 : null;
  const active = sinceMin !== null && sinceMin > 0 && sinceMin < 16 * 60;

  return [{
    title: 'Sleep session',
    status: active
      ? `started ${Math.floor(sinceMin / 60)}:${String(Math.floor(sinceMin % 60)).padStart(2, '0')} ago`
      : 'not started',
    stateColor: active ? P.ref : P.off,
    primary: {
      label: active ? 'Update anchor' : 'Start sleep',
      filled: !active,
      go: async () => {
        if (data.exists(E.sleepButton)) await data.press(E.sleepButton);
        else await data.setDateTimeNow(E.sleepAnchor);
      },
    },
    note: data.exists(E.sleepButton)
      ? 'This presses input_button.sleep, the same anchor the bedroom automations use.'
      : 'This writes the current time into the sleep anchor.',
  }];
}
