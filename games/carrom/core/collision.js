/* === Carrom Collision — deterministic low-level physics helpers === */

import {
  BOARD_SIZE, MARGIN, COIN_R, STRIKER_R, POCKET_R, POCKETS,
  STRIKER_MASS, COIN_MASS, RESTITUTION, WALL_RESTITUTION,
  DAMPING, STOP_SPEED,
} from '../state.js';

export function integrateBody(b, dt) {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

export function applyDamping(b, dt) {
  const speed = Math.hypot(b.vx, b.vy);
  if (speed < STOP_SPEED) {
    b.vx = 0;
    b.vy = 0;
    return;
  }
  const factor = Math.exp(-DAMPING * dt);
  b.vx *= factor;
  b.vy *= factor;
  if (Math.hypot(b.vx, b.vy) < STOP_SPEED) {
    b.vx = 0;
    b.vy = 0;
  }
}

export function wallCollide(b) {
  const minX = MARGIN + b.r;
  const maxX = BOARD_SIZE - MARGIN - b.r;
  const minY = MARGIN + b.r;
  const maxY = BOARD_SIZE - MARGIN - b.r;
  let impact = 0;
  let wall = null;

  if (b.x < minX) {
    b.x = minX;
    b.vx = Math.abs(b.vx) * WALL_RESTITUTION;
    impact = Math.abs(b.vx);
    wall = 'left';
  } else if (b.x > maxX) {
    b.x = maxX;
    b.vx = -Math.abs(b.vx) * WALL_RESTITUTION;
    impact = Math.abs(b.vx);
    wall = 'right';
  }

  if (b.y < minY) {
    b.y = minY;
    b.vy = Math.abs(b.vy) * WALL_RESTITUTION;
    impact = Math.max(impact, Math.abs(b.vy));
    wall = wall || 'top';
  } else if (b.y > maxY) {
    b.y = maxY;
    b.vy = -Math.abs(b.vy) * WALL_RESTITUTION;
    impact = Math.max(impact, Math.abs(b.vy));
    wall = wall || 'bottom';
  }

  return { impact, wall };
}

export function bodyCollision(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = a.r + b.r;

  if (dist >= minDist || dist < 0.001) return { impulse: 0 };

  const nx = dx / dist;
  const ny = dy / dist;

  const dvx = a.vx - b.vx;
  const dvy = a.vy - b.vy;
  const relVelN = dvx * nx + dvy * ny;

  if (relVelN <= 0) return { impulse: 0 };

  const totalMass = a.mass + b.mass;
  const j = (2 * relVelN * RESTITUTION) / totalMass;

  a.vx -= j * b.mass * nx;
  a.vy -= j * b.mass * ny;
  b.vx += j * a.mass * nx;
  b.vy += j * a.mass * ny;

  const overlap = minDist - dist;
  const correction = overlap * 0.5;
  const ratioA = b.mass / totalMass;
  const ratioB = a.mass / totalMass;

  a.x -= nx * correction * ratioA;
  a.y -= ny * correction * ratioA;
  b.x += nx * correction * ratioB;
  b.y += ny * correction * ratioB;

  return { impulse: Math.abs(j) };
}

export function isInPocket(x, y) {
  for (const p of POCKETS) {
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < POCKET_R * POCKET_R) return p;
  }
  return null;
}

export function isValidStrikerPlacement(x, y, coins) {
  if (x < MARGIN + STRIKER_R || x > BOARD_SIZE - MARGIN - STRIKER_R) return false;
  if (y < MARGIN + STRIKER_R || y > BOARD_SIZE - MARGIN - STRIKER_R) return false;

  for (const c of coins) {
    if (!c.active) continue;
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy < (STRIKER_R + c.r + 0.5) ** 2) return false;
  }
  return true;
}

export function findClearStrikerX(y, coins, preferredX) {
  const minX = MARGIN + STRIKER_R + 2;
  const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 2;

  // Try preferred position first
  if (isValidStrikerPlacement(preferredX, y, coins)) return preferredX;

  // Spiral outward looking for a clear spot
  let best = null;
  let bestDist = Infinity;
  for (let x = minX; x <= maxX; x += 4) {
    if (isValidStrikerPlacement(x, y, coins)) {
      const d = Math.abs(x - preferredX);
      if (d < bestDist) {
        bestDist = d;
        best = x;
      }
    }
  }
  return best ?? (MARGIN + BOARD_SIZE) / 2;
}
