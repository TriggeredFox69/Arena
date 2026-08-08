import { performance } from 'perf_hooks';
import { createInitialState, baselineFor, TURN } from './state.js';
import { Simulation } from './core/simulation.js';
import { chooseShot } from './ai/ai-controller.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

globalThis.performance = performance;

const s = createInitialState('ai', 'medium');
console.log('p1Side', s.p1Side, 'turn', s.turn, 'baseline', baselineFor(TURN.P1));
const shot = chooseShot(s);
console.log('shot', shot);
const target = s.coins.find(c => c.id === shot.targetId);
console.log('target coin', target);
const sim = new Simulation(s);
sim.setStriker(shot.sx, shot.sy);
sim.shoot(shot.vx, shot.vy);
sim.runUntilSettled(5000);
const pockets = sim.events.filter(e => e.type === 'pocket');
console.log('pockets', pockets);
