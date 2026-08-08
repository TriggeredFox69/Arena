/* === Quick deterministic test harness for simulation + rules === */

import {
  TURN, PHASE, SIDE, createInitialState, cloneState, baselineFor,
  BOARD_SIZE, MARGIN, STRIKER_R, COIN_R, MAX_POWER,
} from './state.js';
import { Simulation } from './core/simulation.js';
import { isValidStrikerPlacement, findClearStrikerX } from './core/collision.js';
import { resolveTurn, applyTurnPatch } from './rules/rules-engine.js';

let failed = false;
function runTest(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${name}: ${e.message}`);
  }
}

function makeBaseState() {
  const s = createInitialState('ai', 'medium');
  s.turn = TURN.P1;
  s.p1Side = SIDE.WHITE;
  s.p2Side = SIDE.BLACK;
  s.scores = { p1: 0, p2: 0 };
  s.queenCovered = false;
  s.queenPocketedBy = null;
  s.winner = null;
  return s;
}

function placeStrikerForShot(s, coin, pocket) {
  const baselineY = baselineFor(TURN.P1);
  const uy = pocket.y - coin.y;
  if (Math.abs(uy) < 0.001) return false;
  const ux = pocket.x - coin.x;
  const t = (baselineY - coin.y) / uy;
  let sx = coin.x + t * ux;
  sx = Math.max(MARGIN + STRIKER_R + 2, Math.min(BOARD_SIZE - MARGIN - STRIKER_R - 2, sx));
  if (!isValidStrikerPlacement(sx, baselineY, s.coins)) {
    sx = findClearStrikerX(baselineY, s.coins, sx);
  }
  if (sx == null) return false;
  s.striker.x = sx;
  s.striker.y = baselineY;
  s.striker.vx = 0;
  s.striker.vy = 0;
  return true;
}

function strikerXForPocket(coin, pocket, baselineY) {
  const uy = pocket.y - coin.y;
  if (Math.abs(uy) < 0.001) return null;
  const ux = pocket.x - coin.x;
  const t = (baselineY - coin.y) / uy;
  return coin.x + t * ux;
}

function shootAligned(s, coin, pocket, speed = 520) {
  if (s.striker.x == null && !placeStrikerForShot(s, coin, pocket)) throw new Error('cannot place striker');
  const dx = pocket.x - coin.x;
  const dy = pocket.y - coin.y;
  const d = Math.hypot(dx, dy);
  // Ghost ball sits on the far side of the target from the pocket.
  const gx = coin.x - (dx / d) * (COIN_R + STRIKER_R + 0.5);
  const gy = coin.y - (dy / d) * (COIN_R + STRIKER_R + 0.5);
  const dirX = gx - s.striker.x;
  const dirY = gy - s.striker.y;
  const dirLen = Math.hypot(dirX, dirY);
  const sim = new Simulation(s);
  sim.shoot((dirX / dirLen) * speed, (dirY / dirLen) * speed);
  sim.runUntilSettled(5000);
  return sim.events.filter(e => e.type === 'pocket');
}

// ---- Physics tests ----

runTest('striker placement is clear', () => {
  const s = makeBaseState();
  const y = baselineFor(TURN.P1);
  s.striker.x = findClearStrikerX(y, s.coins, 350);
  s.striker.y = y;
  if (!s.striker.x || s.striker.x < 50 || s.striker.x > 650) throw new Error('bad striker x');
});

runTest('simulation settles after a shot', () => {
  const s = makeBaseState();
  const sim = new Simulation(s);
  sim.shoot(80, -240);
  const { settled } = sim.runUntilSettled(5000);
  if (!settled) throw new Error('did not settle');
});

runTest('simulation pockets a coin in a clear setup', () => {
  const s = makeBaseState();
  const baselineY = baselineFor(TURN.P1);
  // Only one white coin remains so the path is unobstructed.
  const target = s.coins.find(c => c.side === s.p1Side);
  for (const c of s.coins) if (c.id !== target.id) c.active = false;

  // Pick the pocket whose ghost-ball line leaves the striker on a valid baseline spot.
  const pockets = [
    { x: MARGIN + 10, y: MARGIN + 10 },
    { x: BOARD_SIZE - MARGIN - 10, y: MARGIN + 10 },
  ];
  let best = null;
  let bestPocket = null;
  let bestMargin = -Infinity;
  for (const p of pockets) {
    const sx = strikerXForPocket(target, p, baselineY);
    const margin = Math.min(sx - (MARGIN + STRIKER_R + 6), (BOARD_SIZE - MARGIN - STRIKER_R - 6) - sx);
    if (margin > bestMargin) {
      bestMargin = margin;
      best = sx;
      bestPocket = p;
    }
  }
  if (!bestPocket || bestMargin < 0) throw new Error('no reachable pocket from baseline');
  s.striker.x = best;
  s.striker.y = baselineY;
  const result = shootAligned(s, target, bestPocket, 620);
  if (!result.some(p => p.bodyType === 'coin' && p.side === s.p1Side)) {
    throw new Error('own coin was not pocketed');
  }
});

runTest('striker foul returns pocketed coins and switches turn', () => {
  const s = makeBaseState();
  s.striker.x = MARGIN + STRIKER_R + 8;
  s.striker.y = baselineFor(TURN.P1);
  const sim = new Simulation(s);
  const pocket = { x: MARGIN + 10, y: MARGIN + 10 };
  const dx = pocket.x - s.striker.x;
  const dy = pocket.y - s.striker.y;
  const d = Math.hypot(dx, dy);
  sim.shoot((dx / d) * MAX_POWER, (dy / d) * MAX_POWER);
  sim.runUntilSettled(5000);
  const pockets = sim.events.filter(e => e.type === 'pocket');
  const patch = resolveTurn(s, pockets);
  if (patch.result !== 'foul') throw new Error('expected foul');
  applyTurnPatch(s, patch);
  if (s.turn !== TURN.P2) throw new Error('turn should switch after foul');
  if (s.scores.p2 < 10) throw new Error('opponent foul bonus missing');
});

// ---- Rules tests (event injection) ----

function deactivatePocketed(s, events) {
  for (const e of events) {
    if (e.bodyType !== 'coin') continue;
    const coin = s.coins.find(c => c.id === e.bodyId);
    if (coin) coin.active = false;
  }
}

runTest('own coin pocket continues turn', () => {
  const s = makeBaseState();
  const ownCoin = s.coins.find(c => c.side === s.p1Side);
  const events = [
    { type: 'pocket', bodyType: 'coin', color: ownCoin.color, side: ownCoin.side, bodyId: ownCoin.id },
  ];
  deactivatePocketed(s, events);
  const patch = resolveTurn(s, events);
  applyTurnPatch(s, patch);
  if (patch.result !== 'continue') throw new Error('expected turn to continue');
  if (s.turn !== TURN.P1) throw new Error('turn switched unexpectedly');
  if (s.scores.p1 < 10) throw new Error('own coin score missing');
});

runTest('opponent coin pocket switches turn', () => {
  const s = makeBaseState();
  const oppCoin = s.coins.find(c => c.side === s.p2Side);
  const events = [
    { type: 'pocket', bodyType: 'coin', color: oppCoin.color, side: oppCoin.side, bodyId: oppCoin.id },
  ];
  deactivatePocketed(s, events);
  const patch = resolveTurn(s, events);
  applyTurnPatch(s, patch);
  if (patch.result !== 'switch') throw new Error('expected switch');
  if (s.turn !== TURN.P2) throw new Error('turn should switch');
  if (s.scores.p2 < 10) throw new Error('opponent score missing');
});

runTest('queen pocketed without cover returns to center', () => {
  const s = makeBaseState();
  const ownCoin = s.coins.find(c => c.side === s.p1Side);
  const oppCoin = s.coins.find(c => c.side === s.p2Side);
  const queen = s.coins.find(c => c.color === 'red');
  queen.active = false;
  const events = [
    { type: 'pocket', bodyType: 'coin', color: 'red', side: 'queen', bodyId: queen.id },
  ];
  const patch = resolveTurn(s, events);
  applyTurnPatch(s, patch);
  const queenAfter = s.coins.find(c => c.color === 'red');
  if (!queenAfter.active) throw new Error('queen should have returned');
  if (s.turn !== TURN.P2) throw new Error('turn should switch after uncovered queen');
});

runTest('queen covered by own coin in same shot', () => {
  const s = makeBaseState();
  const ownCoin = s.coins.find(c => c.side === s.p1Side);
  const queen = s.coins.find(c => c.color === 'red');
  const events = [
    { type: 'pocket', bodyType: 'coin', color: 'red', side: 'queen', bodyId: queen.id },
    { type: 'pocket', bodyType: 'coin', color: ownCoin.color, side: ownCoin.side, bodyId: ownCoin.id },
  ];
  deactivatePocketed(s, events);
  const patch = resolveTurn(s, events);
  applyTurnPatch(s, patch);
  if (!s.queenCovered) throw new Error('queen should be covered');
  if (s.scores.p1 < 20) throw new Error('queen cover bonus missing');
  if (patch.result !== 'continue') throw new Error('expected turn to continue');
});

runTest('final own coin without queen covered is a loss', () => {
  const s = makeBaseState();
  const ownCoin = s.coins.find(c => c.side === s.p1Side);
  for (const c of s.coins) if (c.id !== ownCoin.id) c.active = false;
  const events = [
    { type: 'pocket', bodyType: 'coin', color: ownCoin.color, side: ownCoin.side, bodyId: ownCoin.id },
  ];
  deactivatePocketed(s, events);
  const patch = resolveTurn(s, events);
  applyTurnPatch(s, patch);
  if (s.winner !== TURN.P2) throw new Error('expected P2 to win');
  if (s.phase !== PHASE.GAME_OVER) throw new Error('expected game over phase');
});

runTest('final own coin after queen covered is a win', () => {
  const s = makeBaseState();
  const ownCoin = s.coins.find(c => c.side === s.p1Side);
  for (const c of s.coins) if (c.id !== ownCoin.id) c.active = false;
  s.queenCovered = true;
  const events = [
    { type: 'pocket', bodyType: 'coin', color: ownCoin.color, side: ownCoin.side, bodyId: ownCoin.id },
  ];
  deactivatePocketed(s, events);
  const patch = resolveTurn(s, events);
  applyTurnPatch(s, patch);
  if (s.winner !== TURN.P1) throw new Error('expected P1 to win');
  if (s.phase !== PHASE.GAME_OVER) throw new Error('expected game over phase');
});

if (failed) {
  console.error('\nSome Carrom tests failed.');
  process.exit(1);
} else {
  console.log('\nAll Carrom tests passed.');
}
