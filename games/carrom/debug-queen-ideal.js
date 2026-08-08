import { createInitialState, baselineFor, TURN, BOARD_SIZE, MARGIN, STRIKER_R, COIN_R } from './state.js';
import { Simulation } from './core/simulation.js';
import { isValidStrikerPlacement, findClearStrikerX } from './core/collision.js';

const s = createInitialState('ai', 'medium');
for (const c of s.coins) if (c.color !== 'red') c.active = false;
const queen = s.coins.find(c => c.color === 'red');
const pocket = { x: BOARD_SIZE - MARGIN - 10, y: MARGIN + 10 };
const baselineY = baselineFor(TURN.P1);
const dx = pocket.x - queen.x;
const dy = pocket.y - queen.y;
const dist = Math.hypot(dx, dy);
const ux = dx / dist;
const uy = dy / dist;
const t = (baselineY - queen.y) / uy;
let sx = queen.x + t * ux;
if (!isValidStrikerPlacement(sx, baselineY, s.coins)) sx = findClearStrikerX(baselineY, s.coins, sx);
console.log('baselineY', baselineY, 'sx', sx, 'queen', queen.x, queen.y, 't', t);
const gx = queen.x - ux * (COIN_R + STRIKER_R + 0.5);
const gy = queen.y - uy * (COIN_R + STRIKER_R + 0.5);
const dirX = gx - sx;
const dirY = gy - baselineY;
const dirLen = Math.hypot(dirX, dirY);
for (const speed of [400, 500, 600, 700, 800]) {
  const sim = new Simulation(s);
  sim.setStriker(sx, baselineY);
  sim.shoot((dirX / dirLen) * speed, (dirY / dirLen) * speed);
  sim.runUntilSettled(5000);
  const p = sim.events.filter(e => e.type === 'pocket');
  console.log('speed', speed, 'pockets', p.length, p.map(e => e.color));
}
