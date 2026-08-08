/* === Carrom Game — standalone + hostable controller === */

import {
  PHASE, TURN, GAME_MODE, DIFFICULTY, BOARD_SIZE, MARGIN, STRIKER_R,
  createInitialState, cloneState, getOpponent, getPlayerSide,
  baselineFor,
} from '../state.js';
import { Simulation } from '../core/simulation.js';
import { dragToShot, shotPower } from '../core/shot.js';
import { isValidStrikerPlacement, findClearStrikerX } from '../core/collision.js';
import { resolveTurn, applyTurnPatch } from '../rules/rules-engine.js';
import { chooseShot } from '../ai/ai-controller.js';
import { Renderer } from '../render/renderer.js';
import { AudioManager } from '../audio/audio-manager.js';

function mapHostMode(mode) {
  if (mode === GAME_MODE.AI || mode === 'ai') return GAME_MODE.AI;
  if (mode === GAME_MODE.LOCAL || mode === 'local' || mode === 'pvp') return GAME_MODE.LOCAL;
  return GAME_MODE.AI;
}

export class CarromGame {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = options;
    this.renderer = new Renderer(canvas);
    this.audio = new AudioManager();
    this.audio.init();

    this.state = null;
    this.sim = null;
    this.eventIndex = 0;

    this.running = false;
    this.rafId = null;
    this.lastTime = 0;
    this.aiTimer = 0;
    this.aiTimeouts = [];
    this.lastStateChange = 0;

    this._onResize = this.resize.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);

    window.addEventListener('resize', this._onResize);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    this.resize();

    if (options.savedState) {
      this.resumeState(options.savedState);
    }
  }

  // ---- Host-facing lifecycle ----

  get turn() {
    return this.state?.turn === TURN.P2 ? 2 : 1;
  }

  get mode() {
    return this.options.mode || this.state?.mode;
  }

  start() {
    if (!this.state) {
      const mode = mapHostMode(this.options.mode);
      const difficulty = this.options.difficulty || DIFFICULTY.MEDIUM;
      this.startNew(mode, difficulty);
    }
    // Re-measure now that the game screen is visible; fixes 0-size canvas on launch.
    this.resize();
    if (!this.running) {
      this.running = true;
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(t => this.loop(t));
    }
  }

  startNew(mode, difficulty) {
    const humanSide = this.options.humanColor === 'b' ? 'black' : 'white';
    this.state = createInitialState(mode, difficulty, { humanSide });
    this.state.options = {
      mode,
      difficulty,
      wager: this.options.wager || 0,
    };
    this._resetStrikerForTurn();
    this.state.phase = PHASE.PLACE_STRIKER;
    this.state.inputEnabled = true;
    this.state.aiThinking = false;
  }

  resumeState(savedState) {
    let raw = typeof savedState === 'string' ? JSON.parse(savedState) : savedState;
    this.state = cloneState(raw);
    this.state.options = {
      mode: this.state.mode,
      difficulty: this.state.difficulty,
      wager: this.options.wager || this.state.options?.wager || 0,
    };
    this.state.phase = PHASE.PLACE_STRIKER;
    this.state.inputEnabled = (this.state.mode === GAME_MODE.LOCAL) || (this.state.turn === TURN.P1);
    this.state.aiThinking = false;
    this.state.aiPreview = null;
    this.state.dragStart = null;
    this.state.dragCurrent = null;
    this.state.accumulator = 0;
    this.state.settlingTimer = 0;
    this.state.shakeAmount = 0;
    this.state.eventLog = [];
    this._resetStrikerForTurn();
  }

  serialize() {
    if (!this.state) return null;
    const clean = cloneState(this.state);
    clean.options = {
      mode: clean.mode,
      difficulty: clean.difficulty,
      wager: this.options.wager || clean.options?.wager || 0,
    };
    return clean;
  }

  destroy() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.aiTimeouts.forEach(id => clearTimeout(id));
    this.aiTimeouts = [];

    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);

    this.state = null;
    this.sim = null;
  }

  // ---- Loop ----

  loop(timestamp) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(t => this.loop(t));

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;

    if (!this.state) {
      this.renderer.draw({});
      return;
    }

    if (this.state.phase === PHASE.GAME_OVER) {
      this.renderer.draw(this.state);
      return;
    }

    // AI turn handling
    if (this.state.phase === PHASE.PLACE_STRIKER &&
        this.state.mode === GAME_MODE.AI &&
        this.state.turn === TURN.P2 &&
        !this.state.aiThinking) {
      this.aiTimer += dt;
      if (this.aiTimer > 0.55) {
        this.aiTimer = 0;
        this._runAI();
      }
    }

    // Physics
    if (this.state.phase === PHASE.SHOT_ACTIVE) {
      if (!this.sim) this.sim = new Simulation(this.state);
      const { remainingAcc, totalImpact } = this.sim.substep(this.state.accumulator + dt);
      this.state.accumulator = remainingAcc;

      if (totalImpact > 2.0) {
        this.state.shakeAmount = Math.min(this.state.shakeAmount + totalImpact * 0.5, 8);
      }

      this._processEvents();

      if (this.sim.isSettled()) {
        this.state.settlingTimer += dt;
        if (this.state.settlingTimer >= 0.28) {
          this._finishShot();
        }
      } else {
        this.state.settlingTimer = 0;
      }
    }

    // VFX / particles
    this.renderer.updateParticles(dt);

    // Shake decay
    this.state.shakeAmount *= 0.88;
    if (this.state.shakeAmount < 0.1) this.state.shakeAmount = 0;

    this.renderer.draw(this.state);
    this._emitStateChangeThrottled();
  }

  // ---- Input ----

  resize() {
    this.renderer.resize();
    if (this.state) this.renderer.draw(this.state);
  }

  _canInteract() {
    return this.state &&
      this.state.phase !== PHASE.GAME_OVER &&
      this.state.inputEnabled &&
      !this.state.aiThinking;
  }

  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = BOARD_SIZE / rect.width;
    return {
      x: (e.clientX - rect.left) * scale,
      y: (e.clientY - rect.top) * scale,
    };
  }

  _handlePointerDown(e) {
    if (!this._canInteract()) return;
    if (this.state.turn === TURN.P2 && this.state.mode === GAME_MODE.AI) return;

    const pos = this._canvasPos(e);
    const sx = this.state.striker.x;
    const sy = this.state.striker.y;
    const dist = Math.hypot(pos.x - sx, pos.y - sy);

    if (dist < this.state.striker.r * 3.5) {
      this.state.dragStart = { x: pos.x, y: pos.y };
      this.state.dragCurrent = { x: pos.x, y: pos.y };
      this.state.phase = PHASE.AIMING;
      this.audio.playAim();
      return;
    }

    if (this.state.phase === PHASE.PLACE_STRIKER) {
      this._placeStriker(pos);
    }
  }

  _handlePointerMove(e) {
    if (!this.state) return;
    const pos = this._canvasPos(e);

    if (this.state.phase === PHASE.PLACE_STRIKER && this._canInteract()) {
      this._placeStriker(pos);
    }

    if (this.state.dragStart) {
      this.state.dragCurrent = pos;
    }
  }

  _handlePointerUp(e) {
    if (!this.state || !this.state.dragStart) return;

    const shot = dragToShot(this.state.striker, this.state.dragStart, this.state.dragCurrent);
    this.state.dragStart = null;
    this.state.dragCurrent = null;

    if (shot) {
      this._shoot(shot.vx, shot.vy, shot.power);
    } else {
      this.state.phase = PHASE.PLACE_STRIKER;
    }
  }

  _placeStriker(pos) {
    const baselineY = baselineFor(this.state.turn);
    const minX = MARGIN + STRIKER_R + 3;
    const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 3;
    let x = Math.max(minX, Math.min(maxX, pos.x));
    x = findClearStrikerX(baselineY, this.state.coins, x);

    this.state.striker.x = x;
    this.state.striker.y = baselineY;
    this.state.striker.vx = 0;
    this.state.striker.vy = 0;
  }

  _shoot(vx, vy, powerRatio) {
    this.state.striker.vx = vx;
    this.state.striker.vy = vy;
    this.state.striker.active = true;
    this.state.phase = PHASE.SHOT_ACTIVE;
    this.state.inputEnabled = false;
    this.state.shotResolved = false;
    this.state.settlingTimer = 0;
    this.state.accumulator = 0;
    this.state.shakeAmount = 0;
    this.state.shotCount++;
    this.state.eventLog = [];
    this.sim = new Simulation(this.state);
    this.eventIndex = 0;
    this.audio.playStrikerHit(powerRatio || 0.5);
  }

  // ---- AI ----

  _runAI() {
    if (!this.state || this.state.phase !== PHASE.PLACE_STRIKER) return;
    this.state.aiThinking = true;
    this.state.inputEnabled = false;

    const thinkId = setTimeout(() => {
      if (!this.state || this.state.phase !== PHASE.PLACE_STRIKER) return;
      const shot = chooseShot(this.state);
      this.state.aiPreview = { sx: shot.sx, sy: shot.sy, vx: shot.vx, vy: shot.vy };
      this.state.striker.x = shot.sx;
      this.state.striker.y = shot.sy;

      const shootId = setTimeout(() => {
        if (!this.state || this.state.phase !== PHASE.PLACE_STRIKER) return;
        this.state.aiPreview = null;
        this._shoot(shot.vx, shot.vy, Math.hypot(shot.vx, shot.vy) / 340);
        this.state.aiThinking = false;
      }, 620);
      this.aiTimeouts.push(shootId);
    }, 60);
    this.aiTimeouts.push(thinkId);
  }

  // ---- Rules / resolution ----

  _processEvents() {
    if (!this.sim) return;
    const events = this.sim.events;
    let maxCoinImpulse = 0;
    let maxWallImpulse = 0;
    let strikerHitImpulse = 0;

    for (let i = this.eventIndex; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'collision') {
        if (ev.impulse > maxCoinImpulse) maxCoinImpulse = ev.impulse;
        if (ev.impulse > 1.2) {
          const a = this._findBody(ev.aId);
          const b = this._findBody(ev.bId);
          if (a && b) {
            this.renderer.spawnSparkle((a.x + b.x) / 2, (a.y + b.y) / 2, 'rgba(255,255,200,0.8)');
          }
        }
        if (ev.aId === 'striker' || ev.bId === 'striker') {
          if (ev.impulse > strikerHitImpulse) strikerHitImpulse = ev.impulse;
        }
      } else if (ev.type === 'cushion') {
        if (ev.impact > maxWallImpulse) maxWallImpulse = ev.impact;
      } else if (ev.type === 'pocket') {
        this._onPocketEvent(ev);
      }
    }
    this.eventIndex = events.length;

    if (strikerHitImpulse > 0) this.audio.playStrikerHit(Math.min(strikerHitImpulse / 8, 1));
    else if (maxCoinImpulse > 0.5) this.audio.playCoinHit(Math.min(maxCoinImpulse / 6, 1));
    if (maxWallImpulse > 1.5) this.audio.playWallHit();
  }

  _findBody(id) {
    if (id === 'striker') return this.state.striker;
    return this.state.coins.find(c => c.id === id);
  }

  _onPocketEvent(ev) {
    const pocket = { x: ev.x, y: ev.y };
    if (ev.bodyType === 'coin') {
      if (ev.color === 'red') {
        this.audio.playQueen();
        this.renderer.spawnSparkle(pocket.x, pocket.y, '#ffcf4d');
      } else {
        this.audio.playPocket();
      }
      const color = ev.color === 'white' ? '#f5f0e2' : ev.color === 'black' ? '#2a2a2a' : '#ff5e6e';
      this.renderer.spawnParticles(pocket.x, pocket.y, color, 14);
    } else if (ev.bodyType === 'striker') {
      this.audio.playFoul();
      this.renderer.spawnParticles(pocket.x, pocket.y, '#e8bc4f', 22, 3.5);
    }
  }

  _finishShot() {
    if (!this.sim) return;
    const pocketEvents = this.sim.events.filter(e => e.type === 'pocket');
    const patch = resolveTurn(this.state, pocketEvents);
    applyTurnPatch(this.state, patch);

    this.sim = null;
    this.eventIndex = 0;

    if (patch.result === 'foul') {
      this.audio.playFoul();
    }

    if (patch.gameOverWinner) {
      this._onGameOver(patch.gameOverWinner);
      return;
    }

    this._resetStrikerForTurn();
    this.state.phase = PHASE.PLACE_STRIKER;
    this.state.inputEnabled = (this.state.mode === GAME_MODE.LOCAL) || (this.state.turn === TURN.P1);
    this.state.aiThinking = false;
    this.state.dragStart = null;
    this.state.dragCurrent = null;
    this._emitStateChangeThrottled();
  }

  _resetStrikerForTurn() {
    const baselineY = baselineFor(this.state.turn);
    const x = findClearStrikerX(baselineY, this.state.coins, BOARD_SIZE / 2);
    this.state.striker.x = x;
    this.state.striker.y = baselineY;
    this.state.striker.vx = 0;
    this.state.striker.vy = 0;
    this.state.striker.active = true;
    this.state.striker.side = this.state.turn;
  }

  _onGameOver(winner) {
    this.state.phase = PHASE.GAME_OVER;
    this.state.inputEnabled = false;
    this.state.winner = winner;

    const userWon = winner === TURN.P1;
    const payload = {
      userWon,
      pot: (this.options.wager || 0) * 2,
      game: 'Carrom Clash',
      winner: winner === TURN.P1 ? 'p1' : 'p2',
      scores: { ...this.state.scores },
    };

    if (userWon) this.audio.playWin();
    else this.audio.playLoss();

    if (typeof this.options.onGameOver === 'function') {
      this.options.onGameOver(payload);
    }
    this._emitStateChangeThrottled();
  }

  _emitStateChangeThrottled() {
    if (typeof this.options.onStateChange !== 'function') return;
    const now = performance.now();
    if (now - this.lastStateChange < 500) return;
    this.lastStateChange = now;
    try { this.options.onStateChange(this.state); } catch (e) { /* ignore */ }
  }

  // ---- Helpers for shell ----

  getState() {
    return this.state;
  }

  setMute(value) {
    return this.audio.setMute(value);
  }

  toggleMute() {
    return this.audio.toggleMute();
  }
}
