import { createInitialState, baselineFor, TURN, MARGIN, BOARD_SIZE, STRIKER_R, COIN_R } from './state.js';
import { Simulation } from './core/simulation.js';
import { isValidStrikerPlacement, findClearStrikerX } from './core/collision.js';

const s = createInitialState('ai', 'medium');
const targetId = s.coins.find(c => c.color === 'white' && c.y > 400 && c.y < 460).id;
for (const c of s.coins) if (c.id !== targetId) c.active = false;
const target = s.coins.find(c => c.id === targetId);
const pocket = { x: MARGIN + 10, y: MARGIN + 10 };
const baselineY = baselineFor(TURN.P1);
let sx = target.x + (baselineY - target.y) / (pocket.y - target.y) * (pocket.x - target.x);
if (!isValidStrikerPlacement(sx, baselineY, s.coins)) sx = findClearStrikerX(baselineY, s.coins, sx);
const dx = target.x - pocket.x;
const dy = target.y - pocket.y;
const d = Math.hypot(dx, dy);
const gx = target.x + (dx / d) * (COIN_R + STRIKER_R + 0.5);
const gy = target.y + (dy / d) * (COIN_R + STRIKER_R + 0.5);
const dirX = gx - sx;
const dirY = gy - baselineY;
const dirLen = Math.hypot(dirX, dirY);
const speed = 320;
const vx = (dirX / dirLen) * speed;
const vy = (dirY / dirLen) * speed;
console.log('target', target.x.toFixed(2), target.y.toFixed(2), 'striker', sx.toFixed(2), baselineY.toFixed(2));
console.log('ghost', gx.toFixed(2), gy.toFixed(2), 'v', vx.toFixed(2), vy.toFixed(2));

const sim = new Simulation(s);
sim.setStriker(sx, baselineY);
sim.shoot(vx, vy);
// run but log every 100 steps
for (let i = 0; i < 2000; i++) {
  sim.step(1/120);
  if (i % 120 === 0 || sim.events.length > 0) {
    const st = sim.state.striker;
    console.log(`step ${i} striker ${st.x.toFixed(1)},${st.y.toFixed(1)} v ${st.vx.toFixed(1)},${st.vy.toFixed(1)} target ${target.x.toFixed(1)},${target.y.toFixed(1)} v ${target.vx.toFixed(1)},${target.vy.toFixed(1)}`);
  }
  if (sim.isSettled()) break;
}
console.log('events', sim.events);
console.log('final coin active', target.active, target.x.toFixed(1), target.y.toFixed(1));
