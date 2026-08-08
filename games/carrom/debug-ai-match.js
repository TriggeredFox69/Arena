import { performance } from 'perf_hooks';
import { createInitialState, TURN, baselineFor } from './state.js';
import { Simulation } from './core/simulation.js';
import { chooseShot } from './ai/ai-controller.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

globalThis.performance = performance;

function runMatch(difficulty, maxShots = 40) {
  const s = createInitialState('local', difficulty);
  let shots = 0;
  let totalPockets = 0;
  while (shots < maxShots && !s.winner) {
    const shot = chooseShot(s);
    const sim = new Simulation(s);
    sim.setStriker(shot.sx, shot.sy);
    sim.shoot(shot.vx, shot.vy);
    sim.runUntilSettled(4000);
    const pockets = sim.events.filter(e => e.type === 'pocket');
    totalPockets += pockets.filter(p => p.bodyType === 'coin').length;
    const patch = resolveTurn(s, pockets);
    applyTurnPatch(s, patch);
    if (patch.gameOverWinner) break;
    shots++;
  }
  return { shots, totalPockets, winner: s.winner, scores: s.scores };
}

for (const diff of ['easy', 'medium', 'hard']) {
  const r = runMatch(diff, 60);
  console.log(diff, 'shots', r.shots, 'coins pocketed', r.totalPockets, 'winner', r.winner, 'scores', r.scores);
}
