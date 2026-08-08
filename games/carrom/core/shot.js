/* === Carrom Shot — striker placement and drag-to-shoot utilities === */

import { MAX_POWER, MIN_DRAG } from '../state.js';

const POWER_SCALE = 5.2; // logical velocity per drag pixel (tuned for board size)

export function dragToShot(striker, dragStart, dragCurrent) {
  const dx = dragStart.x - dragCurrent.x;
  const dy = dragStart.y - dragCurrent.y;
  const dist = Math.hypot(dx, dy);

  if (dist < MIN_DRAG) return null;

  const power = Math.min(dist * POWER_SCALE, MAX_POWER);
  const nx = dx / dist;
  const ny = dy / dist;

  return { vx: nx * power, vy: ny * power, power: power / MAX_POWER };
}

export function shotPower(striker, dragStart, dragCurrent) {
  const dx = dragStart.x - dragCurrent.x;
  const dy = dragStart.y - dragCurrent.y;
  const dist = Math.hypot(dx, dy);
  return Math.min(dist * POWER_SCALE, MAX_POWER) / MAX_POWER;
}

export function shotVectorFromAim(striker, targetX, targetY, powerRatio) {
  const dx = targetX - striker.x;
  const dy = targetY - striker.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return null;
  const speed = Math.max(40, powerRatio * MAX_POWER);
  return { vx: (dx / dist) * speed, vy: (dy / dist) * speed };
}
