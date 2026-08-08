import { performance } from 'perf_hooks';
import { createInitialState, MARGIN, STRIKER_R, COIN_R, baselineFor, TURN } from './state.js';
import { Simulation } from './core/simulation.js';
import { isValidStrikerPlacement, findClearStrikerX } from './core/collision.js';

globalThis.performance = performance;

const s = createInitialState('ai', 'medium');
const queen = s.coins.find(c => c.color === 'red');
queen.active = false;
const target = s.coins.find(c => c.id === 4);
console.log('target4', target);
const pockets = [
  { x: MARGIN + 10, y: MARGIN + 10 },
  { x: 700 - MARGIN - 10, y: MARGIN + 10 },
  { x: MARGIN + 10, y: 700 - MARGIN - 10 },
  { x: 700 - MARGIN - 10, y: 700 - MARGIN - 10 },
];
const baselineY = baselineFor(TURN.P1);
for (const pocket of pockets) {
  const ux = (pocket.x - target.x) / Math.hypot(pocket.x - target.x, pocket.y - target.y);
  const uy = (pocket.y - target.y) / Math.hypot(pocket.x - target.x, pocket.y - target.y);
  const t = (baselineY - target.y) / uy;
  let sx = target.x + t * ux;
  if (isNaN(sx) || sx < MARGIN + STRIKER_R || sx > 700 - MARGIN - STRIKER_R) continue;
  if (!isValidStrikerPlacement(sx, baselineY, s.coins)) sx = findClearStrikerX(baselineY, s.coins, sx);
  const contactX = target.x - ux * (COIN_R + STRIKER_R + 0.5);
  const contactY = target.y - uy * (COIN_R + STRIKER_R + 0.5);
  const dirX = contactX - sx;
  const dirY = contactY - baselineY;
  const dirLen = Math.hypot(dirX, dirY);
  const speed = 450;
  const vx = (dirX / dirLen) * speed;
  const vy = (dirY / dirLen) * speed;
  const sim = new Simulation(s);
  sim.setStriker(sx, baselineY);
  sim.shoot(vx, vy);
  sim.runUntilSettled(5000);
  console.log('pocket', pocket.id, 'sx', sx.toFixed(1), 'v', vx.toFixed(1), vy.toFixed(1), 'pockets', sim.events.filter(e => e.type === 'pocket').length);
}
