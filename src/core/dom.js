const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'line', 'text', 'tspan', 'polyline',
  'polygon', 'ellipse', 'defs', 'clipPath', 'linearGradient', 'stop', 'title',
]);

const ATTR_ALIAS = {
  className: 'class',
  htmlFor: 'for',
  strokeWidth: 'stroke-width',
  strokeDasharray: 'stroke-dasharray',
  strokeLinejoin: 'stroke-linejoin',
  strokeLinecap: 'stroke-linecap',
  textAnchor: 'text-anchor',
  fontSize: 'font-size',
  fontFamily: 'font-family',
  fontWeight: 'font-weight',
  dominantBaseline: 'dominant-baseline',
  viewBox: 'viewBox',
  clipPath: 'clip-path',
  preserveAspectRatio: 'preserveAspectRatio',
  gradientUnits: 'gradientUnits',
  stopColor: 'stop-color',
  stopOpacity: 'stop-opacity',
  fillOpacity: 'fill-opacity',
  strokeOpacity: 'stroke-opacity',
};

/**
 * Minimal hyperscript over real DOM nodes. Text always goes through
 * `textContent`, so Ukrainian entity names and lab values can never be parsed
 * as markup.
 *
 *   h('div.hh-card', {style: {gap: '4px'}}, [h('span', 'text')])
 *
 * The tag accepts an optional `.class.list` suffix.
 */
export function h(tag, props, children) {
  // Anything that is itself renderable is a child, not a props bag. Without the
  // Node check a single chart element passed as the second argument would be
  // read as attributes and silently dropped.
  if (props instanceof Node
    || Array.isArray(props)
    || typeof props === 'string'
    || typeof props === 'number'
    || props === null
    || props === undefined) {
    children = props;
    props = null;
  }
  const [name, ...classes] = String(tag).split('.');
  const el = SVG_TAGS.has(name)
    ? document.createElementNS(SVG_NS, name)
    : document.createElement(name || 'div');
  if (classes.length) el.setAttribute('class', classes.join(' '));

  if (props) {
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v === null || v === undefined || v === false) continue;
      if (key === 'style' && typeof v === 'object') {
        for (const k of Object.keys(v)) if (v[k] != null) el.style.setProperty(hyphen(k), String(v[k]));
      } else if (key.startsWith('on') && typeof v === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), v);
      } else if (key === 'class' || key === 'className') {
        el.setAttribute('class', [el.getAttribute('class'), v].filter(Boolean).join(' '));
      } else if (key === 'text') {
        el.textContent = String(v);
      } else if (key === 'value' && 'value' in el) {
        el.value = v;
      } else {
        el.setAttribute(ATTR_ALIAS[key] || hyphen(key), v === true ? '' : String(v));
      }
    }
  }
  append(el, children);
  return el;
}

function hyphen(k) {
  return /[A-Z]/.test(k) && !k.startsWith('--') ? k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()) : k;
}

function append(el, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(el, c);
  } else if (child instanceof Node) {
    el.appendChild(child);
  } else {
    el.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}
