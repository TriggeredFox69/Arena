import { performance } from 'perf_hooks';
import { createInitialState } from './state.js';
import { Simulation } from './core/simulation.js';
import { chooseShot } from './ai/ai-controller.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

globalThis.performance = performance;

const s = createInitialState('local', 'hard');
for (let i = 0; i < 10; i++) {
  const shot = chooseShot(s);
  const sim = new Simulation(s);
  sim.setStriker(shot.sx, shot.sy);
  sim.shoot(shot.vx, shot.vy);
  sim.runUntilSettled(4000);
  const pockets = sim.events.filter(e => e.type === 'pocket');
  const patch = resolveTurn(s, pockets);
  console.log(i, 'turn', s.turn, 'target', shot.targetId, 'score', shot.vx.toFixed(0), shot.vy.toFixed(0), 'pockets', pockets.map(p => p.color || 'striker'), 'result', patch.result, 'msg', patch.message);
  applyTurnPatch(s, patch);
  if (patch.gameOverWinner) break;
}
