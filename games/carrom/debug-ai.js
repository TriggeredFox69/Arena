import { performance } from 'perf_hooks';
import { TURN, createInitialState, baselineFor } from './state.js';
import { Simulation } from './core/simulation.js';
import { chooseShot } from './ai/ai-controller.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

globalThis.performance = performance;

const s = createInitialState('ai', 'medium');
const shot = chooseShot(s);
console.log('shot', shot);
const sim = new Simulation(s);
sim.setStriker(shot.sx, shot.sy);
sim.runUntilSettled(5000);
const pockets = sim.events.filter(e => e.type === 'pocket');
console.log('pocketed', pockets);
const patch = resolveTurn(s, pockets);
console.log('patch', patch);
applyTurnPatch(s, patch);
console.log('turn', s.turn, 'scores', s.scores, 'msg', s.lastShotMessage);
