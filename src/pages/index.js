import now from './now.js';
import day from './day.js';
import night from './night.js';
import metabolism from './metabolism.js';
import body from './body.js';
import heart from './heart.js';
import labs from './labs.js';
import environment from './environment.js';
import behaviour from './behaviour.js';
import correlations from './correlations.js';
import trust from './trust.js';
import targets from './targets.js';

/**
 * Twelve pages, each answering exactly one question at exactly one time scale.
 * The order follows the information architecture in the design brief: seconds
 * at the top, quarters in the middle, the audit and the targets at the end.
 */
export const PAGES = [
  now, day, night, metabolism, body, heart,
  labs, environment, behaviour, correlations, trust, targets,
];
