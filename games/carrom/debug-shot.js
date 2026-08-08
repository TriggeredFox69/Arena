import { TURN, createInitialState, baselineFor } from './state.js';
import { Simulation } from './core/simulation.js';
import { findClearStrikerX } from './core/collision.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

const s = createInitialState('ai', 'medium');
const y = baselineFor(TURN.P1);
s.striker.x = findClearStrikerX(y, s.coins, 350);
s.striker.y = y;

// Pick the lowest own coin (closest to striker) and aim at top-left pocket
const pocket = { x: 52, y: 52 };
const ownCoin = [...s.coins]
  .filter(c => c.active && c.side === s.p1Side)
  .sort((a, b) => b.y - a.y)[0];

console.log('striker', s.striker.x, s.striker.y);
console.log('ownCoin', ownCoin.x, ownCoin.y, ownCoin.side, 'p1Side', s.p1Side);

const sim = new Simulation(s);
const dx = ownCoin.x - s.striker.x;
const dy = ownCoin.y - s.striker.y;
const d = Math.hypot(dx, dy);
sim.shoot((dx / d) * 260, (dy / d) * 260);
sim.runUntilSettled(5000);

const pockets = sim.events.filter(e => e.type === 'pocket');
console.log('pocketed', pockets);
const patch = resolveTurn(s, pockets);
console.log('patch', patch);
applyTurnPatch(s, patch);
console.log('turn', s.turn, 'scores', s.scores);
