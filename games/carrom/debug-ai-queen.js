import { performance } from 'perf_hooks';
import { createInitialState, MARGIN, STRIKER_R, COIN_R, baselineFor, TURN } from './state.js';
import { Simulation } from './core/simulation.js';
import { chooseShot } from './ai/ai-controller.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

globalThis.performance = performance;

const s = createInitialState('ai', 'medium');
// Only leave queen active
for (const c of s.coins) if (c.color !== 'red') c.active = false;
const shot = chooseShot(s);
console.log('shot', shot);
const sim = new Simulation(s);
sim.setStriker(shot.sx, shot.sy);
sim.shoot(shot.vx, shot.vy);
sim.runUntilSettled(5000);
const pockets = sim.events.filter(e => e.type === 'pocket');
console.log('pocketed', pockets);
const patch = resolveTurn(s, pockets);
console.log('patch', patch);
