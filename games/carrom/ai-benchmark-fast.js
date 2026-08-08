import { performance } from 'perf_hooks';
import { TURN, createInitialState, getOpponent, getPlayerSide, getActiveCoins, baselineFor } from './state.js';
import { Simulation } from './core/simulation.js';
import { chooseShot } from './ai/ai-controller.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

globalThis.performance = performance;

function playShot(state) {
  const shot = chooseShot(state);
  const sim = new Simulation(state);
  sim.setStriker(shot.sx, shot.sy);
  sim.shoot(shot.vx, shot.vy);
  sim.runUntilSettled(5000);
  const pockets = sim.events.filter(e => e.type === 'pocket');
  const patch = resolveTurn(state, pockets);
  applyTurnPatch(state, patch);
  return { shot, patch, pockets };
}

let totalShots = 0;
let totalPockets = 0;
let totalOwnPockets = 0;
let totalFouls = 0;
let gamesCompleted = 0;
const maxShotsPerGame = 80;
const games = 5;

for (let g = 0; g < games; g++) {
  const state = createInitialState('ai', 'medium');
  state.p1Side = 'white';
  state.p2Side = 'black';
  let gamePockets = 0;
  let gameShots = 0;
  for (let i = 0; i < maxShotsPerGame && state.phase !== 'over'; i++) {
    const { shot, patch, pockets } = playShot(state);
    gameShots++;
    totalShots++;
    if (pockets.length > 0) {
      totalPockets += pockets.length;
      gamePockets += pockets.length;
      totalOwnPockets += pockets.filter(p => p.bodyType === 'coin' && p.side === getPlayerSide(state, getOpponent(state.turn))).length;
    }
    if (patch.result === 'foul') totalFouls++;
  }
  if (state.phase === 'over') gamesCompleted++;
  console.log(`Game ${g + 1}: ${gameShots} shots, ${gamePockets} pockets, winner=${state.winner || 'none'}`);
}

console.log(`\nAcross ${games} games:`);
console.log(`  Total shots: ${totalShots}`);
console.log(`  Total pockets: ${totalPockets} (${(totalPockets / totalShots * 100).toFixed(1)}% per shot)`);
console.log(`  Own coins pocketed: ${totalOwnPockets}`);
console.log(`  Fouls: ${totalFouls}`);
console.log(`  Games completed: ${gamesCompleted}/${games}`);
