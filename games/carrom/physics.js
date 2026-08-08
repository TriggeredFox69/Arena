/* === Carrom Physics — deterministic fixed-step simulation === */
import {
  BOARD_SIZE, MARGIN, COIN_R, STRIKER_R, POCKET_R, POCKETS,
  STRIKER_MASS, COIN_MASS, RESTITUTION, WALL_RESTITUTION,
  FRICTION, STOP_SPEED, FIXED_DT, SUB_STEPS, MAX_POWER,
} from './state.js';

// --- Integration ---
function integrateBody(b, dt) {
  b.x += b.vx * dt * 60;
  b.y += b.vy * dt * 60;
}

function applyFriction(b) {
  const speed = Math.hypot(b.vx, b.vy);
  if (speed < STOP_SPEED) {
    b.vx = 0; b.vy = 0;
    return;
  }
  const friction = FRICTION;
  b.vx *= friction;
  b.vy *= friction;
  if (Math.hypot(b.vx, b.vy) < STOP_SPEED) {
    b.vx = 0; b.vy = 0;
  }
}

// --- Cushion / Wall collision ---
function wallCollide(b) {
  const minX = MARGIN + b.r;
  const maxX = BOARD_SIZE - MARGIN - b.r;
  const minY = MARGIN + b.r;
  const maxY = BOARD_SIZE - MARGIN - b.r;

  // Check each wall
  if (b.x < minX) {
    b.x = minX;
    b.vx = Math.abs(b.vx) * WALL_RESTITUTION;
  } else if (b.x > maxX) {
    b.x = maxX;
    b.vx = -Math.abs(b.vx) * WALL_RESTITUTION;
  }

  if (b.y < minY) {
    b.y = minY;
    b.vy = Math.abs(b.vy) * WALL_RESTITUTION;
  } else if (b.y > maxY) {
    b.y = maxY;
    b.vy = -Math.abs(b.vy) * WALL_RESTITUTION;
  }
}

// --- Circle-Circle collision ---
function bodyCollision(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = a.r + b.r;

  if (dist >= minDist || dist < 0.001) return 0;

  // Normal vector
  const nx = dx / dist;
  const ny = dy / dist;

  // Relative velocity along normal
  const dvx = a.vx - b.vx;
  const dvy = a.vy - b.vy;
  const relVelN = dvx * nx + dvy * ny;

  // Only resolve if approaching
  if (relVelN <= 0) return 0;

  const totalMass = a.mass + b.mass;
  const impulse = (2 * relVelN) / totalMass * RESTITUTION;

  a.vx -= impulse * b.mass * nx;
  a.vy -= impulse * b.mass * ny;
  b.vx += impulse * a.mass * nx;
  b.vy += impulse * a.mass * ny;

  // Positional correction
  const overlap = minDist - dist;
  const correctionFactor = 0.5;
  const cx = overlap * correctionFactor * nx;
  const cy = overlap * correctionFactor * ny;
  a.x -= cx * (b.mass / totalMass);
  a.y -= cy * (b.mass / totalMass);
  b.x += cx * (a.mass / totalMass);
  b.y += cy * (a.mass / totalMass);

  return Math.abs(impulse);
}

// --- Pocket detection ---
export function isInPocket(x, y) {
  for (const p of POCKETS) {
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < POCKET_R * POCKET_R) {
      return true;
    }
  }
  return false;
}

// --- Main step ---
export function stepPhysics(state, dt) {
  const bodies = [...state.coins.filter(c => c.active), state.striker];
  if (!state.striker.active) return { maxImpact: 0, bodies };

  let maxImpact = 0;

  // Integrate
  for (const b of bodies) {
    integrateBody(b, dt);
  }

  // Wall collisions (3 passes for stack stability)
  for (let pass = 0; pass < 3; pass++) {
    for (const b of bodies) {
      wallCollide(b);
    }
  }

  // Body-body collisions (3 passes)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const impact = bodyCollision(bodies[i], bodies[j]);
        if (impact > maxImpact) maxImpact = impact;
      }
    }
  }

  // Friction
  for (const b of bodies) {
    applyFriction(b);
  }

  return { maxImpact, bodies };
}

// --- Full substep processing ---
export function processSubsteps(state, accumulator, onPocket) {
  let acc = accumulator;
  let steps = 0;
  let totalImpact = 0;

  while (acc >= FIXED_DT && steps < SUB_STEPS) {
    const { maxImpact } = stepPhysics(state, FIXED_DT);
    totalImpact = Math.max(totalImpact, maxImpact);
    acc -= FIXED_DT;
    steps++;
  }

  // Pocket detection after all substeps
  checkPockets(state, onPocket);

  return { remainingAcc: acc > FIXED_DT ? FIXED_DT : acc, totalImpact };
}

function checkPockets(state, onPocket) {
  // Check coins
  for (const coin of state.coins) {
    if (!coin.active) continue;
    if (isInPocket(coin.x, coin.y)) {
      coin.active = false;
      if (onPocket) onPocket('coin', coin);
    }
  }

  // Check striker
  if (state.striker.active && isInPocket(state.striker.x, state.striker.y)) {
    state.striker.active = false;
    if (onPocket) onPocket('striker', state.striker);
  }
}

// --- Check if all moving bodies have stopped ---
export function allStopped(state) {
  const bodies = [...state.coins.filter(c => c.active), state.striker];
  return bodies.every(b => Math.hypot(b.vx, b.vy) < STOP_SPEED * 1.5);
}

// --- Apply shot velocity to striker ---
export function applyShot(striker, dragStart, dragCurrent) {
  const dx = dragStart.x - dragCurrent.x;
  const dy = dragStart.y - dragCurrent.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 5) return false;

  const power = Math.min(dist * 0.18, MAX_POWER);
  const nx = dx / dist;
  const ny = dy / dist;

  striker.vx = nx * power;
  striker.vy = ny * power;
  return true;
}

// --- Validate striker placement ---
export function isValidStrikerPlacement(x, y, coins) {
  // Must be on the play area
  if (x < MARGIN + STRIKER_R || x > BOARD_SIZE - MARGIN - STRIKER_R) return false;
  if (y < MARGIN + STRIKER_R || y > BOARD_SIZE - MARGIN - STRIKER_R) return false;

  // Must not overlap any active coin
  for (const c of coins) {
    if (!c.active) continue;
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy < (STRIKER_R + COIN_R) * (STRIKER_R + COIN_R)) return false;
  }

  return true;
}

// --- Clone state for AI simulation ---
export function cloneSimState(state) {
  return {
    coins: state.coins.map(c => ({ ...c })),
    striker: { ...state.striker },
  };
}

// --- Simulate a shot to completion and return result ---
export function simulateShot(simState, strikerVx, strikerVy) {
  simState.striker.vx = strikerVx;
  simState.striker.vy = strikerVy;
  simState.striker.active = true;

  const pocketed = [];
  let settled = false;
  let simSteps = 0;
  const maxSteps = 3000; // safety

  while (!settled && simSteps < maxSteps) {
    simSteps++;
    const bodies = [...simState.coins.filter(c => c.active), simState.striker];

    // Integrate
    for (const b of bodies) {
      b.x += b.vx * FIXED_DT * 60;
      b.y += b.vy * FIXED_DT * 60;
    }

    // Wall
    for (let p = 0; p < 2; p++) {
      for (const b of bodies) wallCollide(b);
    }

    // Body collisions
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          bodyCollision(bodies[i], bodies[j]);
        }
      }
    }

    // Friction
    for (const b of bodies) applyFriction(b);

    // Check pockets
    for (const coin of simState.coins) {
      if (!coin.active) continue;
      if (isInPocket(coin.x, coin.y)) {
        coin.active = false;
        pocketed.push({ type: 'coin', color: coin.color, side: coin.side });
      }
    }
    if (simState.striker.active && isInPocket(simState.striker.x, simState.striker.y)) {
      simState.striker.active = false;
      pocketed.push({ type: 'striker' });
    }

    // Check settlement
    const allBods = [...simState.coins.filter(c => c.active), simState.striker];
    if (allBods.every(b => Math.hypot(b.vx, b.vy) < STOP_SPEED * 1.5)) {
      settled = true;
    }
  }

  return { pocketed, settled: settled || simSteps >= maxSteps };
}
