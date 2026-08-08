import { createInitialState, baselineFor, TURN, MARGIN, BOARD_SIZE, STRIKER_R, COIN_R } from './state.js';
import { Simulation } from './core/simulation.js';
import { isValidStrikerPlacement, findClearStrikerX } from './core/collision.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

const s = createInitialState('ai', 'medium');
// deactivate all coins except an outer white coin
const targetId = s.coins.find(c => c.color === 'white' && c.y > 400 && c.y < 460).id;
for (const c of s.coins) if (c.id !== targetId) c.active = false;
const target = s.coins.find(c => c.id === targetId);
const pocket = { x: MARGIN + 10, y: MARGIN + 10 };
const baselineY = baselineFor(TURN.P1);
// line through target to pocket: param t where y = target.y + t*(pocket.y-target.y) => y=baseline => t=(baselineY-target.y)/(pocket.y-target.y)
const uy = pocket.y - target.y;
const ux = pocket.x - target.x;
const t = (baselineY - target.y) / uy;
let sx = target.x + t * ux;
console.log('target', target.x, target.y, 'sx', sx, 'baselineY', baselineY);
if (!isValidStrikerPlacement(sx, baselineY, s.coins)) {
  sx = findClearStrikerX(baselineY, s.coins, sx);
}
console.log('clear sx', sx);
// ghost-ball position: striker center at impact should be target + (r_t + r_s) * unit(pocket->target)
const dx = target.x - pocket.x;
const dy = target.y - pocket.y;
const d = Math.hypot(dx, dy);
const gx = target.x + (dx / d) * (COIN_R + STRIKER_R + 0.5);
const gy = target.y + (dy / d) * (COIN_R + STRIKER_R + 0.5);
const dirX = gx - sx;
const dirY = gy - baselineY;
const dirLen = Math.hypot(dirX, dirY);
const speed = 280;
const vx = (dirX / dirLen) * speed;
const vy = (dirY / dirLen) * speed;
console.log('aim', sx, baselineY, vx, vy, 'ghost', gx, gy);
const sim = new Simulation(s);
sim.setStriker(sx, baselineY);
sim.shoot(vx, vy);
sim.runUntilSettled(5000);
console.log('events', sim.events.filter(e => e.type === 'pocket'));
