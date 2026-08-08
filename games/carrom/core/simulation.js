/* === Carrom Simulation — deterministic fixed-step physics engine === */

import { FIXED_DT, SUB_STEPS, STOP_SPEED, COIN_MASS, STRIKER_MASS } from '../state.js';
import {
  integrateBody, applyDamping, wallCollide, bodyCollision, isInPocket,
} from './collision.js';

function deepCopyBody(b) {
  return { ...b };
}

export class Simulation {
  constructor(state) {
    this.state = state;
    this.events = [];
    this.stepCount = 0;
  }

  resetEvents() {
    this.events = [];
  }

  get bodies() {
    return [...this.state.coins.filter(c => c.active), this.state.striker];
  }

  setStriker(x, y) {
    this.state.striker.x = x;
    this.state.striker.y = y;
    this.state.striker.vx = 0;
    this.state.striker.vy = 0;
  }

  shoot(vx, vy) {
    this.state.striker.vx = vx;
    this.state.striker.vy = vy;
    this.state.striker.active = true;
  }

  step(dt) {
    let maxImpact = 0;
    const bodies = this.bodies;

    for (const b of bodies) {
      integrateBody(b, dt);
    }

    // Wall collisions
    for (let pass = 0; pass < 3; pass++) {
      for (const b of bodies) {
        const { impact, wall } = wallCollide(b);
        if (impact > 0) {
          maxImpact = Math.max(maxImpact, impact);
          this.events.push({ type: 'cushion', bodyId: b.id, wall, impact });
        }
      }
    }

    // Body collisions
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const { impulse } = bodyCollision(bodies[i], bodies[j]);
          if (impulse > 0) {
            maxImpact = Math.max(maxImpact, impulse);
            this.events.push({
              type: 'collision',
              aId: bodies[i].id,
              bId: bodies[j].id,
              impulse,
            });
          }
        }
      }
    }

    // Friction
    for (const b of bodies) {
      applyDamping(b, dt);
    }

    // Pockets checked inline
    this._checkPockets();

    this.stepCount++;
    return maxImpact;
  }

  substep(accumulator) {
    let acc = accumulator;
    let steps = 0;
    let totalImpact = 0;
    while (acc >= FIXED_DT && steps < SUB_STEPS) {
      const impact = this.step(FIXED_DT);
      totalImpact = Math.max(totalImpact, impact);
      acc -= FIXED_DT;
      steps++;
    }
    return { remainingAcc: acc, totalImpact, steps };
  }

  _checkPockets() {
    for (const coin of this.state.coins) {
      if (!coin.active) continue;
      const pocket = isInPocket(coin.x, coin.y);
      if (pocket) {
        coin.active = false;
        this.events.push({
          type: 'pocket',
          bodyId: coin.id,
          bodyType: 'coin',
          color: coin.color,
          side: coin.side,
          pocketId: pocket.id,
          x: coin.x,
          y: coin.y,
        });
      }
    }

    if (this.state.striker.active) {
      const pocket = isInPocket(this.state.striker.x, this.state.striker.y);
      if (pocket) {
        this.state.striker.active = false;
        this.events.push({
          type: 'pocket',
          bodyId: 'striker',
          bodyType: 'striker',
          pocketId: pocket.id,
          x: this.state.striker.x,
          y: this.state.striker.y,
        });
      }
    }
  }

  isSettled() {
    return this.bodies.every(b => Math.hypot(b.vx, b.vy) < STOP_SPEED * 1.2);
  }

  runUntilSettled(maxSteps = 4000) {
    this.resetEvents();
    let steps = 0;
    while (steps < maxSteps) {
      this.step(FIXED_DT);
      if (this.isSettled()) break;
      steps++;
    }
    return { steps, settled: steps < maxSteps };
  }
}

export function createSnapshot(state) {
  return {
    coins: state.coins.map(deepCopyBody),
    striker: deepCopyBody(state.striker),
  };
}

export function restoreSnapshot(state, snapshot) {
  state.coins = snapshot.coins.map(deepCopyBody);
  state.striker = deepCopyBody(snapshot.striker);
}
