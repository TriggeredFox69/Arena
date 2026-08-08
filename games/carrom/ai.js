/* === Carrom AI — simulation-based shot selection === */
import {
  BOARD_SIZE, MARGIN, PLAY_AREA, BASELINE_Y, POCKETS,
  STRIKER_R, MAX_POWER, DIFFICULTY,
  getPlayerSide, getActiveCoins, getPlayerCoins, getQueen,
} from './state.js';
import { cloneSimState, simulateShot, isValidStrikerPlacement } from './physics.js';

// Direction bias for AI to prefer shooting downward
const AI_BASELINE_Y = BOARD_SIZE - BASELINE_Y;

/**
 * Main AI entry — choose best shot for current state
 */
export function chooseAIShot(state) {
  const difficulty = state.difficulty || DIFFICULTY.MEDIUM;
  const aiSide = getPlayerSide(state, state.turn);
  const targetCoins = state.coins.filter(c => c.active && c.side === aiSide);
  const queen = getQueen(state.coins);
  const allActive = getActiveCoins(state.coins);

  // Include queen if not yet covered
  const targets = [...targetCoins];
  if (queen && queen.active && !state.queenCovered) {
    targets.push(queen);
  }

  // Sample count based on difficulty
  const sampleCounts = {
    [DIFFICULTY.EASY]: 40,
    [DIFFICULTY.MEDIUM]: 200,
    [DIFFICULTY.HARD]: 600,
  };
  const numSamples = sampleCounts[difficulty] || 200;

  const candidates = [];

  // Generate candidate shots
  for (let i = 0; i < numSamples; i++) {
    const shot = generateCandidate(state, targets, allActive, aiSide, difficulty, i);
    if (!shot) continue;

    // Simulate
    const sim = cloneSimState(state);
    sim.striker.x = shot.sx;
    sim.striker.y = AI_BASELINE_Y;

    const { pocketed } = simulateShot(sim, shot.vx, shot.vy);

    // Score
    const score = evaluateOutcome(pocketed, aiSide, state, shot);
    candidates.push({ ...shot, score, pocketed });
  }

  if (candidates.length === 0) {
    return randomShot(state, allActive);
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // For easy/medium, pick from top contenders with some randomness
  if (difficulty === DIFFICULTY.EASY) {
    const top = candidates.slice(0, Math.max(3, candidates.length / 3));
    const pick = top[Math.floor(Math.random() * top.length)];
    return { sx: pick.sx, sy: pick.sy, vx: pick.vx, vy: pick.vy };
  }

  if (difficulty === DIFFICULTY.MEDIUM) {
    const top = candidates.slice(0, Math.max(5, candidates.length / 5));
    const pick = top[Math.floor(Math.random() * top.length)];
    return { sx: pick.sx, sy: pick.sy, vx: pick.vx, vy: pick.vy };
  }

  // Hard: pick best
  const best = candidates[0];
  return { sx: best.sx, sy: best.sy, vx: best.vx, vy: best.vy };
}

function generateCandidate(state, targets, allActive, aiSide, difficulty, index) {
  // Striker x position along baseline
  const minX = MARGIN + STRIKER_R + 10;
  const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 10;

  let sx, sy, targetCoin;

  if (targets.length > 0 && (difficulty === DIFFICULTY.HARD || Math.random() < 0.7 || index % 3 !== 0)) {
    // Targeted shot
    targetCoin = targets[Math.floor(Math.random() * targets.length)];

    // Find a pocket to aim toward
    const pocket = POCKETS[Math.floor(Math.random() * POCKETS.length)];

    // Aim line: from the coin toward the pocket
    const dx = pocket.x - targetCoin.x;
    const dy = pocket.y - targetCoin.y;
    const dist = Math.hypot(dx, dy);
    const nx = dx / dist;
    const ny = dy / dist;

    // Striker should be behind the coin (opposite direction from pocket)
    const behindX = targetCoin.x - nx * (targetCoin.r + STRIKER_R + 2);
    const behindY = targetCoin.y - ny * (targetCoin.r + STRIKER_R + 2);

    // Find intersection with baseline
    // Line from behind position to coin, intersect with baseline y
    const shotDx = targetCoin.x - behindX;
    const shotDy = targetCoin.y - behindY;
    if (Math.abs(shotDy) < 0.01) {
      sx = Math.random() * (maxX - minX) + minX;
    } else {
      const t = (AI_BASELINE_Y - behindY) / shotDy;
      sx = behindX + shotDx * t;
    }
    sx = Math.max(minX, Math.min(maxX, sx));

    // Add noise for lower difficulties
    if (difficulty === DIFFICULTY.EASY) {
      sx += (Math.random() - 0.5) * 60;
      sx = Math.max(minX, Math.min(maxX, sx));
    } else if (difficulty === DIFFICULTY.MEDIUM) {
      sx += (Math.random() - 0.5) * 20;
      sx = Math.max(minX, Math.min(maxX, sx));
    }

    sy = AI_BASELINE_Y;

    // Verify placement is valid
    if (!isValidStrikerPlacement(sx, sy, state.coins)) {
      // Try to find a valid nearby position
      let found = false;
      for (let tries = 0; tries < 20; tries++) {
        const testX = minX + Math.random() * (maxX - minX);
        if (isValidStrikerPlacement(testX, sy, state.coins)) {
          sx = testX;
          found = true;
          break;
        }
      }
      if (!found) return null;
    }

    // Compute shot direction from striker to coin
    const svx = targetCoin.x - sx;
    const svy = targetCoin.y - sy;
    const sdist = Math.hypot(svx, svy);
    let power = Math.min(sdist * 0.15, MAX_POWER);

    // Power variation
    power *= 0.8 + Math.random() * 0.4;

    // Difficulty aiming noise
    let aimNoise = 0;
    if (difficulty === DIFFICULTY.EASY) aimNoise = (Math.random() - 0.5) * 0.3;
    else if (difficulty === DIFFICULTY.MEDIUM) aimNoise = (Math.random() - 0.5) * 0.1;

    const snx = svx / sdist + aimNoise;
    const sny = svy / sdist + aimNoise;
    const snorm = Math.hypot(snx, sny);

    const vx = snx / snorm * power;
    const vy = sny / snorm * power;

    return { sx, sy, vx, vy, targetId: targetCoin.id };
  } else {
    // Random shot
    sx = minX + Math.random() * (maxX - minX);
    sy = AI_BASELINE_Y;

    if (!isValidStrikerPlacement(sx, sy, state.coins)) return null;

    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const power = 5 + Math.random() * (MAX_POWER - 5);
    const vx = Math.cos(angle) * power;
    const vy = Math.sin(angle) * power;

    return { sx, sy, vx, vy, targetId: null };
  }
}

function evaluateOutcome(pocketed, aiSide, state, shot) {
  let score = 0;
  const opponentSide = aiSide === 'white' ? 'black' : 'white';

  for (const p of pocketed) {
    if (p.type === 'striker') {
      score -= 30;  // heavily penalize striker fouls
      continue;
    }

    if (p.color === 'red') {
      score += 25;  // queen
      continue;
    }

    if (p.side === aiSide) {
      score += 15;  // own coin — good
    } else {
      score -= 8;   // opponent coin — bad
    }
  }

  // Bonus for having any pocketed coins (successful shot)
  if (pocketed.some(p => p.type === 'coin' && p.side === aiSide)) {
    score += 10;
  }

  // Penalty for no pocket
  if (pocketed.length === 0) {
    score -= 5;
  }

  // Prefer downward shots (natural carrom play)
  if (shot.vy < 0) score += 2;

  return score;
}

function randomShot(state, allActive) {
  const minX = MARGIN + STRIKER_R + 10;
  const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 10;

  let sx;
  for (let tries = 0; tries < 50; tries++) {
    sx = minX + Math.random() * (maxX - minX);
    if (isValidStrikerPlacement(sx, AI_BASELINE_Y, state.coins)) break;
  }

  const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
  const power = 6 + Math.random() * (MAX_POWER - 6);
  const vx = Math.cos(angle) * power;
  const vy = Math.sin(angle) * power;

  return { sx: minX + Math.random() * (maxX - minX), sy: AI_BASELINE_Y, vx, vy };
}
