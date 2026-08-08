import { performance } from 'perf_hooks';
import { createInitialState, baselineFor, TURN } from './state.js';
import { Simulation } from './core/simulation.js';
import { chooseShot } from './ai/ai-controller.js';

globalThis.performance = performance;

const s = createInitialState('ai', 'medium');
const shot = chooseShot(s);
console.log('BEST', shot);
