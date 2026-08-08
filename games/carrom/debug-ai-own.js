import { performance } from 'perf_hooks';
import { createInitialState } from './state.js';
import { Simulation } from './core/simulation.js';
import { chooseShot } from './ai/ai-controller.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

globalThis.performance = performance;

const s = createInitialState('ai', 'medium');
const queen = s.coins.find(c => c.color === 'red');
queen.active = false; // force AI to target own coins
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
applyTurnPatch(s, patch);
console.log('turn', s.turn, 'scores', s.scores, 'msg', s.lastShotMessage);
