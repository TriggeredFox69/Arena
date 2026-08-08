import { TURN, SIDE, createInitialState, baselineFor, BOARD_SIZE, MARGIN, STRIKER_R, COIN_R } from './state.js';
import { Simulation } from './core/simulation.js';

const s = createInitialState('ai', 'medium');
s.turn = TURN.P1; s.p1Side = SIDE.WHITE; s.p2Side = SIDE.BLACK;
const ownCoins = s.coins.filter(c => c.side === s.p1Side);
for (let i = 2; i < ownCoins.length; i++) ownCoins[i].active = false;
const target = ownCoins[0];
const pocket = { x: MARGIN + 10, y: MARGIN + 10 };
const baselineY = baselineFor(TURN.P1);
const uy = pocket.y - target.y;
const ux = pocket.x - target.x;
const t = (baselineY - target.y) / uy;
let sx = target.x + t * ux;
s.striker.x = sx; s.striker.y = baselineY;
const dx = target.x - pocket.x;
const dy = target.y - pocket.y;
const d = Math.hypot(dx, dy);
const gx = target.x + (dx / d) * (COIN_R + STRIKER_R + 0.5);
const gy = target.y + (dy / d) * (COIN_R + STRIKER_R + 0.5);
const dirX = gx - sx;
const dirY = gy - baselineY;
const dirLen = Math.hypot(dirX, dirY);
const sim = new Simulation(s);
sim.shoot((dirX / dirLen) * 520, (dirY / dirLen) * 520);
for (let i = 0; i < 300; i++) {
  sim.step(1/120);
  const ev = sim.events[sim.events.length - 1];
  if (ev && ev.type === 'collision') {
    console.log('collision at step', i, 'between', ev.aId, ev.bId);
    console.log('target', target.x, target.y);
    console.log('striker', s.striker.x, s.striker.y);
    console.log('dist', Math.hypot(s.striker.x - target.x, s.striker.y - target.y));
    break;
  }
}
