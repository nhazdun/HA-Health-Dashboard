import now from './now.js';
import night from './night.js';
import metabolism from './metabolism.js';
import body from './body.js';
import heart from './heart.js';
import labs from './labs.js';
import environment from './environment.js';
import behaviour from './behaviour.js';
import correlations from './correlations.js';
import trust from './trust.js';

/**
 * Ten pages, each answering exactly one question at exactly one time scale.
 * The order matches the information architecture in §3.2 of the design brief:
 * seconds at the top, quarters in the middle, the audit at the end.
 */
export const PAGES = [
  now, night, metabolism, body, heart,
  labs, environment, behaviour, correlations, trust,
];
