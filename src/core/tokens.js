/**
 * Design tokens lifted from the Claude Design source `Health Hub Light.dc.html`
 * and the shadcn/studio bundle it imports (`colors_and_type.css`).
 *
 * The rule that governs every chart in the brief: *own data is always warm,
 * external/reference data is always cold*. Keep it when adding series.
 */

export const P = {
  bg: '#FAFAFA',
  surf: '#FFFFFF',
  s2: '#F1F1F3',
  s3: '#F4F4F5',
  rule: '#E4E4E7',
  ruleSoft: '#EFEFF1',
  ink: '#18181B',
  ink2: '#3F3F46',
  ink3: '#52525B',
  mut: '#71717A',
  off: '#A1A1AA',
  faint: '#C7C7CC',

  self: '#B45309', // own measurements — warm axis
  ref: '#3B6398', // reference / population / second source — cold axis
  good: '#2E7D5B',
  warn: '#B7791F',
  alert: '#BE3A2B',
  inactive: '#A1A1AA',

  // sleep-stage ramp, cold→warm as the stage gets shallower
  stage: { deep: '#3B6398', rem: '#8FB1D2', light: '#D6DAE0', awake: '#D08479' },
  band: '#CBD9E8',
  bandOpt: '#7FA3C9',
  olive: '#8A6D1F',
};

export const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
export const SANS = "'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Per-state visual treatment. Mandated by §3.4 of the design brief. */
export const ST = {
  ok: { c: P.good, l: 'fresh' },
  warn: { c: P.warn, l: 'uneven' },
  low: { c: P.warn, l: 'low trust' },
  lag: { c: P.ref, l: 'lag by design' },
  stale: { c: P.warn, l: 'stale' },
  dead: { c: P.alert, l: 'dead' },
  empty: { c: P.off, l: 'no data' },
};

export const CSS = `
:host{display:block;font-family:${SANS};color:${P.ink};background:${P.bg};
  -webkit-font-smoothing:antialiased;--hh-accent:${P.self};
  /* Home Assistant's app toolbar is fixed above the panel, so anything sticky
     has to start below it or it scrolls underneath. Outside HA the variable is
     undefined and the offset collapses to zero. */
  --hh-top:var(--header-height,0px)}
*{box-sizing:border-box}
.hh-root{display:flex;min-height:calc(100vh - var(--hh-top));background:${P.bg}}

/* ---------- sidebar ---------- */
.hh-aside{width:248px;flex:0 0 248px;background:${P.surf};border-right:1px dashed ${P.rule};
  padding:22px 14px;display:flex;flex-direction:column;gap:20px;position:sticky;
  top:var(--hh-top);height:calc(100vh - var(--hh-top));overflow-y:auto}
.hh-brand{display:flex;flex-direction:column;gap:5px;padding:0 8px}
.hh-brand b{font-size:15px;font-weight:600;letter-spacing:-.015em}
.hh-brand span{font-size:11px;color:${P.mut};font-family:${MONO}}
.hh-nav{display:flex;flex-direction:column;gap:1px}
.hh-navbtn{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;
  border:none;border-radius:8px;padding:9px 11px;cursor:pointer;color:${P.ink3};font-family:inherit;
  font-size:13px;transition:background .15s}
.hh-navbtn:hover{background:${P.s3}}
.hh-navbtn[aria-current="page"]{background:${P.s3};color:${P.ink};font-weight:600}
.hh-navbtn .n{font-family:${MONO};font-size:10px;color:${P.off};width:14px}
.hh-navbtn .l{flex:1}
.hh-navbtn .s{font-family:${MONO};font-size:9px;color:${P.faint}}
.hh-navbtn[aria-current="page"] .s{color:${P.mut}}
.hh-asidefoot{margin-top:auto;display:flex;flex-direction:column;gap:12px;padding:14px 10px 0;
  border-top:1px dashed ${P.rule}}
.hh-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;background:${P.surf};
  border:1px solid ${P.rule};border-radius:8px;padding:8px 11px;cursor:pointer;color:${P.ink};
  font-family:inherit;font-size:12px;box-shadow:0 1px 2px rgba(120,60,50,.05)}
.hh-toggle:hover{background:${P.s3}}
.hh-note{font-size:10.5px;line-height:1.55;color:${P.off}}

/* ---------- header ---------- */
.hh-main{flex:1;min-width:0;display:flex;flex-direction:column}
.hh-head{position:sticky;top:var(--hh-top);z-index:20;background:rgba(255,255,255,.92);
  backdrop-filter:blur(8px);border-bottom:1px dashed ${P.rule};padding:18px 28px;display:flex;
  align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
.hh-head h1{margin:0;font-size:21px;font-weight:600;letter-spacing:-.02em}
.hh-head .q{font-size:12.5px;color:${P.mut}}
.hh-pills{display:flex;align-items:center;gap:8px;font-family:${MONO};font-size:10.5px}
.hh-pill{padding:5px 10px;border:1px solid ${P.rule};border-radius:999px;color:${P.mut};
  background:${P.surf};display:flex;align-items:center;gap:6px;white-space:nowrap}
.hh-dot{width:6px;height:6px;border-radius:50%;flex:0 0 6px}
.hh-sect{padding:24px 28px 64px;display:flex;flex-direction:column;gap:22px}

/* ---------- banner ---------- */
.hh-banner{display:flex;align-items:flex-start;gap:14px;background:${P.surf};border:1px solid ${P.rule};
  border-radius:12px;padding:14px 18px;box-shadow:0 1px 2px rgba(120,60,50,.05)}
.hh-banner .tag{font-family:${MONO};font-size:10px;letter-spacing:.05em;padding-top:2px;white-space:nowrap}
.hh-banner .txt{font-size:12.5px;color:${P.ink2};line-height:1.55}

/* ---------- cards ---------- */
.hh-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:14px}
.hh-card{background:${P.surf};border:1px solid ${P.rule};border-radius:14px;padding:15px 17px 13px;
  display:flex;flex-direction:column;gap:9px;box-shadow:0 1px 3px rgba(120,60,50,.06)}
.hh-card.span2{grid-column:span 2}
.hh-card .top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.hh-card .lab{display:flex;align-items:center;gap:6px;font-size:11.5px;color:${P.mut};line-height:1.35}
.hh-info{flex:0 0 14px;width:14px;height:14px;border:1px solid #D4D4D8;border-radius:50%;color:${P.off};
  font-family:${MONO};font-size:9.5px;line-height:12px;text-align:center;cursor:help}
.hh-info:hover{border-color:${P.mut};color:${P.ink2}}
.hh-card .age{display:flex;align-items:center;gap:5px;font-family:${MONO};font-size:10px;color:${P.off};
  white-space:nowrap}
.hh-card .mid{display:flex;align-items:flex-end;justify-content:space-between;gap:10px}
.hh-card .val{display:flex;align-items:baseline;gap:5px}
.hh-card .num{font-family:${MONO};font-variant-numeric:tabular-nums;font-weight:500;letter-spacing:-.03em}
.hh-card .unit{font-size:11px;color:${P.off}}
.hh-card .delta{font-family:${MONO};font-size:10.5px;text-align:right;line-height:1.35;white-space:pre-line}
.hh-card .foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;
  color:${P.off};font-family:${MONO};border-top:1px dashed ${P.ruleSoft};padding-top:8px}
.hh-card .foot .src{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hh-card .foot .st{white-space:nowrap}
.hh-card.is-dead .num{text-decoration:line-through;color:${P.off}}
.hh-card.is-dead{opacity:.62}
.hh-card.is-low{opacity:.84}
.hh-card.is-low .num{background-image:repeating-linear-gradient(135deg,transparent 0 5px,rgba(183,121,31,.14) 5px 7px)}

/* dual range bar */
.hh-bar{position:relative;height:16px;margin-top:2px}
.hh-bar i{position:absolute;display:block}
.hh-bar .track{top:6px;left:0;right:0;height:3px;background:${P.s2};border-radius:2px}
.hh-bar .ref{top:6px;height:3px;background:${P.band};border-radius:2px}
.hh-bar .opt{top:4px;height:7px;background:${P.bandOpt};border-radius:2px}
.hh-bar .mark{top:0;width:2px;height:15px;border-radius:1px;box-shadow:0 0 0 2px ${P.surf}}

.hh-card.is-clickable{cursor:pointer;transition:border-color .15s}
.hh-card.is-clickable:hover{border-color:${P.off}}
.hh-card.is-clickable:focus-visible{outline:2px solid ${P.self};outline-offset:2px}

/* ---------- device controls ---------- */
.hh-ctl{background:${P.surf};border:1px solid ${P.rule};border-radius:14px;padding:15px 17px;
  display:flex;flex-direction:column;gap:12px;box-shadow:0 1px 3px rgba(120,60,50,.06)}
.hh-ctl .hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.hh-ctl .hd .t{font-size:12.5px;font-weight:600}
.hh-ctl .hd .s{display:flex;align-items:center;gap:6px;font-family:${MONO};font-size:10.5px;
  white-space:nowrap}
.hh-ctl .nt{font-size:10.5px;line-height:1.5;color:${P.off}}
.hh-ctl input[type=range]{accent-color:var(--hh-accent)}
.hh-ctl-btn{border:1px solid ${P.rule};border-radius:8px;padding:9px 15px;font-family:inherit;
  font-size:12.5px;font-weight:500;cursor:pointer;align-self:flex-start;
  box-shadow:0 1px 2px rgba(120,60,50,.06);transition:opacity .15s}
.hh-ctl-btn:hover:not(:disabled){opacity:.88}
.hh-step{display:flex;align-items:center;justify-content:space-between;background:${P.bg};
  border:1px solid ${P.rule};border-radius:9px;padding:5px 6px}
.hh-step span{font-family:${MONO};font-size:12.5px;color:${P.ink}}
.hh-step button{background:${P.surf};border:1px solid ${P.rule};border-radius:7px;width:32px;height:28px;
  cursor:pointer;color:${P.ink2};font-size:15px;line-height:1}
.hh-step button:hover{border-color:${P.off}}

/* ---------- card detail modal ---------- */
.hh-modal{width:min(620px,94vw);max-height:88vh;overflow-y:auto;background:${P.surf};
  border:1px solid ${P.rule};border-radius:16px;padding:26px 28px;display:flex;flex-direction:column;
  gap:18px;box-shadow:0 12px 40px rgba(120,60,50,.14)}
.hh-modal .dh{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.hh-modal .dh b{font-size:18px;font-weight:600;letter-spacing:-.02em}
.hh-modal .info{font-size:12.5px;line-height:1.55;color:${P.ink2};max-width:62ch;padding-top:4px}

/* ---------- list modal ---------- */
.hh-listmodal{width:min(760px,95vw);max-height:88vh;overflow-y:auto;background:${P.surf};
  border:1px solid ${P.rule};border-radius:16px;padding:26px 28px;display:flex;flex-direction:column;
  gap:16px;box-shadow:0 12px 40px rgba(120,60,50,.14)}
.hh-listmodal .note{font-size:12px;color:${P.mut};line-height:1.55;max-width:64ch}
.hh-lhead,.hh-lrow{display:grid;gap:12px;align-items:center}
.hh-lhead{padding:0 2px 8px;border-bottom:1px solid ${P.rule};font-size:10.5px;color:${P.mut}}
.hh-lrow{padding:7px 2px;border-bottom:1px solid ${P.s3}}
.hh-lrow .nm{font-size:12.5px;color:${P.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hh-lrow .m,.hh-lhead .m{font-family:${MONO};font-size:11.5px;text-align:right}
.hh-linkbtn{align-self:flex-start;background:${P.surf};border:1px solid ${P.rule};border-radius:8px;
  padding:8px 14px;font-family:inherit;font-size:12px;color:${P.ink};cursor:pointer}
.hh-linkbtn:hover{border-color:${P.off};background:${P.s3}}

/* ---------- room switcher ---------- */
.hh-rooms{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.hh-seg{display:flex;align-items:center;gap:2px;background:${P.surf};border:1px solid ${P.rule};
  border-radius:10px;padding:3px;box-shadow:0 1px 2px rgba(120,60,50,.05)}
.hh-seg button{background:transparent;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;
  font-family:inherit;font-size:12.5px;color:${P.mut}}
.hh-seg button:hover{background:${P.s3}}
.hh-seg button[aria-pressed="true"]{background:${P.s3};color:${P.ink};font-weight:600}
.hh-roomnote{font-size:11.5px;line-height:1.55;color:${P.mut};max-width:70ch}

/* ---------- chart panel ---------- */
.hh-panel{background:${P.surf};border:1px solid ${P.rule};border-radius:14px;padding:18px 20px 16px;
  display:flex;flex-direction:column;gap:14px;box-shadow:0 1px 3px rgba(120,60,50,.06)}
.hh-panel .ph{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
.hh-panel .pt{font-size:13.5px;font-weight:600;letter-spacing:-.01em}
.hh-panel .pn{font-size:11.5px;color:${P.mut};line-height:1.5;max-width:78ch}
.hh-panel .pl{font-family:${MONO};font-size:10px;color:${P.off}}
.hh-empty{height:190px;display:flex;align-items:center;justify-content:center;background:${P.bg};
  border:1px dashed ${P.rule};border-radius:10px;color:${P.off};font-size:12px;text-align:center;padding:20px;
  line-height:1.5}
svg{display:block;width:100%;overflow:visible}

/* ---------- labs ---------- */
.hh-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hh-chip{background:${P.surf};border:1px solid ${P.rule};color:${P.mut};border-radius:999px;padding:6px 13px;
  font-family:inherit;font-size:11.5px;cursor:pointer;display:flex;align-items:center;gap:7px}
.hh-chip:hover{border-color:${P.off}}
.hh-chip[aria-pressed="true"]{background:${P.s3};border-color:${P.off};color:${P.ink}}
.hh-chip .n{font-family:${MONO};font-size:10px;opacity:.65}
.hh-group{background:${P.surf};border:1px solid ${P.rule};border-radius:14px;overflow:hidden;
  box-shadow:0 1px 3px rgba(120,60,50,.06)}
.hh-gh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:12px 18px;
  background:${P.bg};border-bottom:1px solid ${P.rule}}
.hh-gh b{font-size:12.5px;font-weight:600}
.hh-gh span{font-family:${MONO};font-size:10px;color:${P.off}}
.hh-row{display:grid;grid-template-columns:minmax(150px,1.4fr) 110px minmax(160px,1.6fr) 96px;
  align-items:center;gap:16px;padding:9px 18px;border-bottom:1px solid ${P.s3};cursor:pointer;
  background:none;border-left:0;border-right:0;border-top:0;width:100%;text-align:left;font-family:inherit}
.hh-row:hover{background:${P.bg}}
.hh-row .nm{display:flex;flex-direction:column;gap:2px;min-width:0}
.hh-row .nm b{font-size:12.5px;font-weight:400;color:${P.ink};overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.hh-row .nm span{font-family:${MONO};font-size:9.5px;color:${P.off};overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.hh-row .v{text-align:right;font-family:${MONO};font-variant-numeric:tabular-nums;font-size:13px}
.hh-row .v em{font-style:normal;font-size:9.5px;color:${P.off};margin-left:4px}
.hh-row .st{text-align:right;font-size:10px;font-family:${MONO}}

/* ---------- drawer ---------- */
.hh-scrim{position:fixed;inset:0;z-index:60;background:rgba(24,24,27,.32);display:flex;
  align-items:stretch;justify-content:flex-end}
/* the lab drawer slides in from the edge; the card modal sits centred */
.hh-scrim.is-centred{align-items:center;justify-content:center;padding:32px}
.hh-drawer{width:min(560px,94vw);background:${P.surf};border-left:1px solid ${P.rule};padding:26px;
  overflow-y:auto;display:flex;flex-direction:column;gap:18px}
.hh-drawer .dh{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.hh-drawer .dh b{font-size:19px;font-weight:600;letter-spacing:-.02em}
.hh-drawer .dh span{font-size:11.5px;color:${P.mut}}
.hh-x{background:${P.surf};border:1px solid ${P.rule};border-radius:8px;color:${P.mut};width:30px;height:30px;
  cursor:pointer;font-size:14px;flex:0 0 30px}
.hh-x:hover{background:${P.s3};color:${P.ink}}
.hh-dval{display:flex;align-items:flex-end;gap:10px}
.hh-dval b{font-family:${MONO};font-size:38px;font-weight:500;letter-spacing:-.035em}
.hh-dval .u{font-size:13px;color:${P.off};padding-bottom:7px}
.hh-dval .s{margin-left:auto;font-family:${MONO};font-size:11px;padding-bottom:8px}
.hh-ddesc{font-size:12.5px;line-height:1.6;color:${P.ink2}}
.hh-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.hh-fact{background:${P.bg};border:1px solid ${P.ruleSoft};border-radius:10px;padding:10px 12px;
  display:flex;flex-direction:column;gap:3px}
.hh-fact .k{font-size:10.5px;color:${P.mut}}
.hh-fact .v{font-family:${MONO};font-size:12.5px}
.hh-eid{font-family:${MONO};font-size:10px;color:${P.off};word-break:break-all;
  border-top:1px dashed ${P.rule};padding-top:12px}

/* ---------- trust ---------- */
.hh-table{background:${P.surf};border:1px solid ${P.rule};border-radius:14px;overflow:hidden;
  box-shadow:0 1px 3px rgba(120,60,50,.06)}
.hh-th,.hh-tr{display:grid;grid-template-columns:1.4fr .9fr .9fr 2fr;gap:14px;padding:11px 18px}
.hh-th{background:${P.bg};border-bottom:1px solid ${P.rule};font-size:10.5px;color:${P.mut}}
.hh-tr{align-items:center;border-bottom:1px solid ${P.s3}}
.hh-tr .s{display:flex;align-items:center;gap:8px;font-size:12.5px}
.hh-tr .m{font-family:${MONO};font-size:11.5px}
.hh-tr .n{font-size:11.5px;color:${P.mut};line-height:1.5}
.hh-warns{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.hh-warn{background:${P.surf};border:1px solid ${P.rule};border-radius:12px;padding:14px 16px;
  display:flex;flex-direction:column;gap:7px;box-shadow:0 1px 3px rgba(120,60,50,.06)}
.hh-warn b{font-size:12.5px;font-weight:600}
.hh-warn .b{font-size:11.5px;line-height:1.55;color:${P.mut}}
.hh-warn .a{font-family:${MONO};font-size:10px}

/* ---------- correlations ---------- */
.hh-corr{display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:20px;align-items:start}
.hh-lag{display:flex;align-items:center;gap:14px}
.hh-lag input[type=range]{width:220px;accent-color:var(--hh-accent)}
.hh-lag .v{font-family:${MONO};font-size:14px;width:54px;text-align:right}
.hh-exps{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:14px}
.hh-exp{background:${P.surf};border:1px solid ${P.rule};border-radius:12px;padding:14px 16px;
  display:flex;flex-direction:column;gap:10px;box-shadow:0 1px 3px rgba(120,60,50,.06)}
.hh-exp .id{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-family:${MONO};
  font-size:11px}
.hh-exp .h{font-size:12px;line-height:1.5;color:${P.ink2}}
.hh-prog{height:4px;background:${P.s2};border-radius:2px;overflow:hidden}
.hh-prog i{display:block;height:4px;border-radius:2px}
.hh-exp .n{font-family:${MONO};font-size:10px;color:${P.off}}

/* ---------- small multiples / misc ---------- */
.hh-mults{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.hh-mult{display:flex;flex-direction:column;gap:6px;background:${P.bg};border:1px solid ${P.ruleSoft};
  border-radius:10px;padding:10px 11px}
.hh-mult .t{font-size:10.5px;line-height:1.35;height:28px;overflow:hidden}
.hh-mult .v{display:flex;justify-content:space-between;font-family:${MONO};font-size:9.5px;color:${P.off}}
.hh-ranks{display:flex;flex-direction:column;gap:8px}
.hh-rank{display:grid;grid-template-columns:minmax(120px,210px) 1fr 54px;gap:14px;align-items:center}
.hh-rank .n{font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hh-rank .b{height:12px;background:${P.s2};border-radius:3px;overflow:hidden}
.hh-rank .b i{display:block;height:12px;border-radius:3px}
.hh-rank .v{font-family:${MONO};font-size:11px;color:${P.mut};text-align:right}
.hh-scatterwarn{font-size:11px;line-height:1.55;color:${P.mut};border-top:1px dashed ${P.ruleSoft};
  padding-top:10px}

@media (max-width:1100px){.hh-corr{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
@media (max-width:860px){
  .hh-root{flex-direction:column}
  .hh-aside{width:100%;flex:none;height:auto;position:static;border-right:none;
    border-bottom:1px dashed ${P.rule}}
  .hh-nav{flex-direction:row;flex-wrap:wrap}
  .hh-navbtn{width:auto}
  .hh-navbtn .s,.hh-navbtn .n{display:none}
  .hh-sect,.hh-head{padding-left:16px;padding-right:16px}
  .hh-card.span2{grid-column:span 1}
  .hh-row{grid-template-columns:1fr 92px;grid-row-gap:6px}
  .hh-row .rb{grid-column:1/3}
  .hh-th,.hh-tr{grid-template-columns:1fr 1fr}
  .hh-rank{grid-template-columns:1fr 54px}
  .hh-rank .b{grid-column:1/3}
}
`;
