import { h, clear } from './core/dom.js';
import { CSS, P, ST } from './core/tokens.js';
import { HaData } from './core/ha.js';
import { SOURCES, sourceState, E } from './core/registry.js';
import { cardDetail, loadCardSeries } from './core/card-detail.js';
import { listModal } from './core/list-modal.js';
import { PAGES } from './pages/index.js';

const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

/**
 * <health-hub-card> — a ten-page analytical health console.
 *
 * Design source: Claude Design project "Health Hub Light".
 * Data source: live Home Assistant state plus the recorder read APIs.
 *
 * The card never mutates the recorder. Every number on screen is read from
 * `hass.states` or from `history/history_during_period` /
 * `recorder/statistics_during_period`. The only writes are ordinary service
 * calls behind the explicit device controls on the Now and Night pages.
 */
class HealthHubCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = new HaData();
    this.state = {
      page: 'now',
      annotations: true,
      labFilter: 'opt',
      labQuery: '',
      open: null,
      openCard: null,
      openList: null,
      room: 'bed',
      lag: 0,
      cell: [0, 3],
      corrWindow: 45,
      tick: 0,
    };
    this._pageData = {};
    this._loading = false;
    this._loadedFor = null;
    this._raf = null;
    this._lastPaint = 0;
  }

  setConfig(config) {
    this._config = config || {};
    if (this._config.page) this.state.page = this._config.page;
  }

  static getConfigElement() { return document.createElement('health-hub-card-editor'); }

  static getStubConfig() { return { type: 'custom:health-hub-card' }; }

  getCardSize() { return 20; }

  set hass(hass) {
    this.data.setHass(hass);
    if (!this._mounted) this._mount();
    this._schedulePaint();
  }

  connectedCallback() {
    if (!this._mounted && this.data.hass) this._mount();
    this._timer = window.setInterval(() => {
      this.state.tick++;
      this._schedulePaint();
    }, 1000);
    this._onKey = (ev) => {
      if (ev.key !== 'Escape') return;
      if (this.state.openList) this.setState({ openList: null });
      else if (this.state.openCard) this.setState({ openCard: null });
      else if (this.state.open) this.setState({ open: null });
    };
    window.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    if (this._timer) window.clearInterval(this._timer);
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._onKey) window.removeEventListener('keydown', this._onKey);
  }

  _mount() {
    this._mounted = true;
    const style = document.createElement('style');
    style.textContent = CSS;
    this.shadowRoot.appendChild(style);
    this._root = h('div.hh-root');
    this.shadowRoot.appendChild(this._root);
    this._load();
  }

  setState(patch) {
    const pageChanged = patch.page && patch.page !== this.state.page;
    const cardOpened = 'openCard' in patch && patch.openCard
      && patch.openCard.key !== (this.state.openCard && this.state.openCard.key);
    Object.assign(this.state, patch);
    if (pageChanged) {
      this.state.open = null;
      this.state.openCard = null;
      this.state.openList = null;
      this._loadedFor = null;
      this._load();
    }
    if (cardOpened) this._loadCardSeries();
    if (patch.room !== undefined && !pageChanged) {
      this._loadedFor = null;
      this._load();
    }
    this._schedulePaint(true);
  }

  /** Pull the recorder series behind whichever card the user just opened. */
  async _loadCardSeries() {
    const detail = this.state.openCard;
    this._pageData.__cardSeries = undefined;
    this._schedulePaint(true);
    const result = await loadCardSeries(this.ctx, detail);
    if (this.state.openCard && this.state.openCard.key === detail.key) {
      this._pageData.__cardSeries = result;
      this._schedulePaint(true);
    }
  }

  get ctx() {
    return {
      data: this.data,
      state: this.state,
      pageData: this._pageData,
      setState: (p) => this.setState(p),
      accent: (this._config && this._config.accent) || P.self,
      sourceState: (key) => {
        const src = SOURCES.find((s) => s.key === key);
        return src ? sourceState(src, this.data) : { state: 'empty', ageMs: null };
      },
      source: (key) => SOURCES.find((s) => s.key === key),
      E,
    };
  }

  async _load() {
    const page = PAGES.find((p) => p.id === this.state.page);
    if (!page || !page.load) { this._loadedFor = this.state.page; return; }
    const forPage = this.state.page;
    this._loading = true;
    this._schedulePaint(true);
    try {
      const result = await page.load(this.ctx);
      if (this.state.page === forPage) this._pageData[forPage] = result || {};
    } catch (err) {
      console.warn('[health-hub] page load failed', forPage, err);
      if (this.state.page === forPage) this._pageData[forPage] = { error: String(err) };
    } finally {
      if (this.state.page === forPage) {
        this._loading = false;
        this._loadedFor = forPage;
        this._schedulePaint(true);
      }
    }
  }

  _schedulePaint(force) {
    if (!this._mounted) return;
    // The header clock ticks every second; heavier repaints are coalesced.
    const now = Date.now();
    if (!force && now - this._lastPaint < 900) return;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._lastPaint = Date.now();
      try {
        this._paint();
      } catch (err) {
        console.error('[health-hub] render failed', err);
        clear(this._root).appendChild(h('div', {
          style: { padding: '24px', fontFamily: 'monospace', fontSize: '12px', color: P.alert },
        }, 'health-hub: render failed — ' + String(err && err.message ? err.message : err)));
      }
    });
  }

  _paint() {
    const ctx = this.ctx;
    const page = PAGES.find((p) => p.id === this.state.page) || PAGES[0];
    const pageData = this._pageData[page.id];
    const ready = this._loadedFor === page.id && !this._loading;

    clear(this._root);
    this._root.appendChild(this._aside(ctx, page));

    const body = ready && pageData
      ? page.render(ctx, pageData)
      : [h('div.hh-empty', { style: { height: '160px' } }, 'Reading the recorder…')];

    this._root.appendChild(h('div.hh-main', [
      this._header(ctx, page),
      h('div.hh-sect', body),
    ]));

    if (this.state.open && page.drawer) {
      const drawer = page.drawer(ctx, this.state.open, pageData || {});
      if (drawer) this._root.appendChild(drawer);
    }
    if (this.state.openCard) {
      this._root.appendChild(cardDetail(ctx, this.state.openCard));
    }
    if (this.state.openList) {
      this._root.appendChild(listModal(ctx, this.state.openList));
    }
  }

  _aside(ctx, page) {
    return h('aside.hh-aside', [
      h('div.hh-brand', [h('b', 'Health Stack')]),
      h('nav.hh-nav', PAGES.map((p, i) => h('button.hh-navbtn', {
        type: 'button',
        'aria-current': p.id === page.id ? 'page' : null,
        onClick: () => this.setState({ page: p.id }),
      }, [
        h('span.n', String(i + 1).padStart(2, '0')),
        h('span.l', p.label),
        h('span.s', p.scale),
      ]))),
      h('div.hh-asidefoot', [
        h('div.hh-note', {
          style: { fontFamily: "'Geist Mono',monospace", fontSize: '9.5px', opacity: 0.75 },
        }, `health-hub v${VERSION}`),
      ]),
    ]);
  }

  _header(ctx, page) {
    const live = page.live ? page.live(ctx) : { color: P.good, label: 'ok' };
    return h('header.hh-head', [
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, [
        h('h1', page.title),
        h('span.q', page.question),
      ]),
      h('div.hh-pills', [
        h('span.hh-pill', { style: { whiteSpace: 'nowrap' } }, `scale: ${page.scale}`),
        h('span.hh-pill', { style: { color: live.color } }, [
          h('i.hh-dot', { style: { background: live.color } }),
          live.label,
        ]),
      ]),
    ]);
  }
}

if (!customElements.get('health-hub-card')) {
  customElements.define('health-hub-card', HealthHubCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'health-hub-card')) {
  window.customCards.push({
    type: 'health-hub-card',
    name: 'Health Hub',
    description: 'A ten-page analytical health console driven by live Home Assistant data',
    preview: false,
  });
}

console.info(
  `%c HEALTH-HUB %c v${VERSION} `,
  `background:${P.self};color:#fff;font-weight:600;border-radius:3px 0 0 3px;padding:2px 6px`,
  `background:${P.ref};color:#fff;border-radius:0 3px 3px 0;padding:2px 6px`,
);

export { ST };
