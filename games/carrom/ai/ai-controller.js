/* === Carrom AI — simulation-based shot planner with difficulty profiles === */

import {
  TURN, STRIKER_R, COIN_R, BOARD_SIZE, MARGIN, MAX_POWER,
  DIFFICULTY, getPlayerSide, getQueen, getActiveCoins,
  baselineFor,
} from '../state.js';
import { Simulation } from '../core/simulation.js';
import { isValidStrikerPlacement, findClearStrikerX } from '../core/collision.js';
import { cloneState } from '../state.js';

const SAMPLES = {
  [DIFFICULTY.EASY]: 160,
  [DIFFICULTY.MEDIUM]: 720,
  [DIFFICULTY.HARD]: 2200,
};

const MAX_TIME_MS = 1600;

const POCKETS = [
  { id: 0, x: MARGIN + 10, y: MARGIN + 10 },
  { id: 1, x: BOARD_SIZE - MARGIN - 10, y: MARGIN + 10 },
  { id: 2, x: MARGIN + 10, y: BOARD_SIZE - MARGIN - 10 },
  { id: 3, x: BOARD_SIZE - MARGIN - 10, y: BOARD_SIZE - MARGIN - 10 },
];

export function chooseShot(state) {
  const start = performance.now();
  const difficulty = state.difficulty || DIFFICULTY.MEDIUM;
  const aiSide = getPlayerSide(state, state.turn);
  const baselineY = baselineFor(state.turn);
  const targets = buildTargetList(state, aiSide);
  const candidates = [];

  const sampleTarget = Math.min(targets.length, 4 + Math.floor(SAMPLES[difficulty] / 28));
  const shotsPerTarget = Math.ceil(SAMPLES[difficulty] / Math.max(1, sampleTarget));

  for (const target of targets.slice(0, sampleTarget)) {
    for (let i = 0; i < shotsPerTarget; i++) {
      if (performance.now() - start > MAX_TIME_MS) break;
      const shot = generateCandidate(state, target, baselineY, difficulty, i);
      if (!shot) continue;
      const score = simulateAndScore(state, shot, aiSide, difficulty);
      if (score !== null) candidates.push({ ...shot, score });
    }
  }

  // Controlled break shots when no pocketing candidate is strong.
  if (candidates.length === 0 || candidates.every(c => c.score < 0)) {
    for (let i = 0; i < 40; i++) {
      if (performance.now() - start > MAX_TIME_MS) break;
      const shot = chooseBreakShot(state, baselineY, difficulty);
      if (!shot) continue;
      const score = simulateAndScore(state, shot, aiSide, difficulty);
      if (score !== null) candidates.push({ ...shot, score });
    }
  }

  // Absolute fallback: random legal shot in the right general direction.
  if (candidates.length === 0) {
    for (let i = 0; i < 30; i++) {
      if (performance.now() - start > MAX_TIME_MS) break;
      const shot = randomBaselineShot(state, baselineY);
      if (!shot) continue;
      const score = simulateAndScore(state, shot, aiSide, difficulty);
      if (score !== null) candidates.push({ ...shot, score });
    }
  }

  if (candidates.length === 0) {
    return randomBaselineShot(state, baselineY);
  }

  candidates.sort((a, b) => b.score - a.score);

  // Difficulty-based selection
  let pick;
  if (difficulty === DIFFICULTY.EASY) {
    const pool = candidates.slice(0, Math.max(6, Math.floor(candidates.length * 0.45)));
    pick = pool[Math.floor(Math.random() * pool.length)];
    pick.vx += (Math.random() - 0.5) * 30;
    pick.vy += (Math.random() - 0.5) * 30;
  } else if (difficulty === DIFFICULTY.MEDIUM) {
    const pool = candidates.slice(0, Math.max(4, Math.floor(candidates.length * 0.22)));
    pick = pool[Math.floor(Math.random() * pool.length)];
    pick.vx += (Math.random() - 0.5) * 10;
    pick.vy += (Math.random() - 0.5) * 10;
  } else {
    pick = candidates[0];
    pick.vx += (Math.random() - 0.5) * 3;
    pick.vy += (Math.random() - 0.5) * 3;
  }

  const speed = Math.hypot(pick.vx, pick.vy);
  if (speed > MAX_POWER) {
    const s = MAX_POWER / speed;
    pick.vx *= s; pick.vy *= s;
  }

  return { sx: pick.sx, sy: pick.sy, vx: pick.vx, vy: pick.vy, targetId: pick.targetId };
}

function buildTargetList(state, aiSide) {
  const own = getActiveCoins(state.coins).filter(c => c.side === aiSide);
  const queen = getQueen(state.coins);
  const targets = [...own];

  if (queen && queen.active && !state.queenCovered) {
    // Only chase the queen when we have a realistic chance to cover it.
    if (own.length <= 3) {
      targets.unshift(queen);
    }
  }
  return targets;
}

function generateCandidate(state, target, baselineY, difficulty, index) {
  // Rotate starting pocket by index so we explore all pockets.
  const pocket = POCKETS[(index + Math.floor(Math.random() * 4)) % 4];

  const dx = pocket.x - target.x;
  const dy = pocket.y - target.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return null;

  const ux = dx / dist;
  const uy = dy / dist;

  // Striker must sit on the line through target and pocket, on the far side of the target.
  if (Math.abs(uy) < 0.001) return null;
  const t = (baselineY - target.y) / uy;
  if (t > -0.1) return null;
  const idealSx = target.x + t * ux;

  const minX = MARGIN + STRIKER_R + 4;
  const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 4;

  // If the geometric striker position is off the baseline, this pocket is unreachable
  // with a direct shot; don't waste simulations on a misaligned cue line.
  if (idealSx < minX || idealSx > maxX) return null;

  let sx = idealSx;

  // Controlled placement noise for lower difficulties.
  if (difficulty === DIFFICULTY.EASY) sx += (Math.random() - 0.5) * 70;
  else if (difficulty === DIFFICULTY.MEDIUM) sx += (Math.random() - 0.5) * 24;
  else sx += (Math.random() - 0.5) * 6;

  const clamped = Math.max(minX, Math.min(maxX, sx));
  // For harder levels, reject noisy placements that hit the baseline edge; for easy,
  // keep the clamped (intentionally imperfect) placement so it still attempts the shot.
  if (difficulty !== DIFFICULTY.EASY && clamped !== sx) return null;
  sx = clamped;

  if (!isValidStrikerPlacement(sx, baselineY, state.coins)) {
    sx = findClearStrikerX(baselineY, state.coins, sx);
    if (sx === null) return null;
  }

  // Ghost-ball position: striker center at impact.
  const gx = target.x - ux * (target.r + STRIKER_R + 0.5);
  const gy = target.y - uy * (target.r + STRIKER_R + 0.5);

  // Reject if the cue path to the ghost ball or the target path to the pocket is blocked.
  if (pathBlocked(sx, baselineY, gx, gy, STRIKER_R + 1.2, target.id, state.coins)) return null;
  if (pathBlocked(target.x, target.y, pocket.x, pocket.y, COIN_R + 1.2, target.id, state.coins)) return null;

  const dirX = gx - sx;
  const dirY = gy - baselineY;
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen < 1) return null;

  let nx = dirX / dirLen;
  let ny = dirY / dirLen;

  // Aiming noise
  let noise = 0;
  if (difficulty === DIFFICULTY.EASY) noise = (Math.random() - 0.5) * 0.14;
  else if (difficulty === DIFFICULTY.MEDIUM) noise = (Math.random() - 0.5) * 0.05;
  else noise = (Math.random() - 0.5) * 0.015;
  if (noise !== 0) {
    const angle = Math.atan2(ny, nx) + noise;
    nx = Math.cos(angle);
    ny = Math.sin(angle);
  }

  // Power tuned to striker-to-target distance; vary speed across attempts.
  const targetDist = Math.hypot(sx - target.x, baselineY - target.y);
  const baseSpeed = Math.max(320, 260 + targetDist * 1.25);
  const speedFactor = 1.0 + (index % 9) * 0.055;
  const speed = Math.min(MAX_POWER * 0.95, baseSpeed * speedFactor);

  return { sx, sy: baselineY, vx: nx * speed, vy: ny * speed, targetId: target.id };
}

function pathBlocked(x1, y1, x2, y2, radius, ignoreId, coins) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return false;
  for (const c of coins) {
    if (!c.active || c.id === ignoreId) continue;
    const fx = c.x - x1;
    const fy = c.y - y1;
    let t = (fx * dx + fy * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    const r = c.r + radius;
    if ((c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy) < r * r) return true;
  }
  return false;
}

function chooseBreakShot(state, baselineY, difficulty) {
  const minX = MARGIN + STRIKER_R + 6;
  const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 6;
  let sx;
  for (let tries = 0; tries < 50; tries++) {
    sx = minX + Math.random() * (maxX - minX);
    if (isValidStrikerPlacement(sx, baselineY, state.coins)) break;
    sx = null;
  }
  if (sx === null) return null;

  const coins = getActiveCoins(state.coins).filter(c => c.side !== 'queen');
  const cx = coins.reduce((sum, c) => sum + c.x, 0) / Math.max(1, coins.length);
  const cy = coins.reduce((sum, c) => sum + c.y, 0) / Math.max(1, coins.length);

  // Aim from striker toward a point slightly behind the coin centroid so the striker
  // penetrates the pack rather than glancing off the front row.
  const towardCenter = baselineY > BOARD_SIZE / 2 ? -1 : 1;
  let aimX = cx + (Math.random() - 0.5) * 70;
  let aimY = cy + towardCenter * 28;

  let dx = aimX - sx;
  let dy = aimY - baselineY;
  const d = Math.hypot(dx, dy);
  if (d < 1) {
    dx = 0; dy = baselineY > BOARD_SIZE / 2 ? -1 : 1;
  }

  // Add controlled scatter.
  let angle = Math.atan2(dy, dx);
  const spread = difficulty === DIFFICULTY.EASY ? 0.3 : difficulty === DIFFICULTY.MEDIUM ? 0.16 : 0.08;
  angle += (Math.random() - 0.5) * spread;

  const distToCenter = Math.hypot(sx - BOARD_SIZE / 2, baselineY - BOARD_SIZE / 2);
  const breakSpeed = 520 + distToCenter * 1.25;
  const speed = Math.min(MAX_POWER * 0.96, breakSpeed);

  return {
    sx,
    sy: baselineY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    targetId: null,
  };
}

function randomBaselineShot(state, baselineY) {
  const minX = MARGIN + STRIKER_R + 6;
  const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 6;
  let sx;
  for (let tries = 0; tries < 50; tries++) {
    sx = minX + Math.random() * (maxX - minX);
    if (isValidStrikerPlacement(sx, baselineY, state.coins)) break;
  }
  // Aim toward the opposite half of the board.
  const towardCenter = baselineY > BOARD_SIZE / 2 ? -1 : 1;
  const angle = (Math.PI / 2) * towardCenter + (Math.random() - 0.5) * 0.8;
  const speed = 340 + Math.random() * 200;
  return { sx, sy: baselineY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

function simulateAndScore(state, shot, aiSide, difficulty) {
  const simState = cloneState(state);
  const sim = new Simulation(simState);
  sim.setStriker(shot.sx, shot.sy);
  sim.shoot(shot.vx, shot.vy);
  sim.runUntilSettled(4000);
  const pocketed = sim.events.filter(e => e.type === 'pocket');
  if (pocketed.length === 0 && shot.targetId == null) {
    // Break shots that hit nothing are not useful; skip scoring them to save selection.
    return -50;
  }
  return evaluateShot(pocketed, aiSide, state, shot, difficulty);
}

function evaluateShot(pocketed, aiSide, state, shot, difficulty) {
  let score = 0;
  let ownPocketed = 0;
  let oppPocketed = 0;
  let queenPocketed = false;
  let strikerFoul = false;

  for (const p of pocketed) {
    if (p.bodyType === 'striker') {
      strikerFoul = true;
      score -= 140;
      continue;
    }
    if (p.color === 'red') {
      queenPocketed = true;
      score += 45;
      continue;
    }
    if (p.side === aiSide) {
      ownPocketed++;
      score += 40;
    } else {
      oppPocketed++;
      score -= 22;
    }
  }

  if (strikerFoul) return score;

  if (ownPocketed > 0) {
    score += 28;
    if (queenPocketed && !state.queenCovered) score += 45;
  }

  if (queenPocketed && ownPocketed === 0 && !state.queenCovered) {
    score -= 70;
  }

  if (oppPocketed > 0) score -= oppPocketed * 14;
  if (ownPocketed > 0 && oppPocketed === 0) score += 22;

  // Slight preference for natural forward play.
  const forward = baselineFor(state.turn) > BOARD_SIZE / 2 ? shot.vy < 0 : shot.vy > 0;
  if (forward) score += 5;

  if (difficulty === DIFFICULTY.HARD) {
    const ownRemaining = state.coins.filter(c => c.active && c.side === aiSide).length;
    score += (ownPocketed / Math.max(1, ownRemaining)) * 16;
  }

  if (pocketed.length === 0) score -= 8;

  return score;
}
