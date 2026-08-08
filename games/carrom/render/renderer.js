/* === Carrom Renderer — premium Canvas2D board, pieces, and VFX === */

import {
  BOARD_SIZE, MARGIN, PLAY_AREA, COIN_R, STRIKER_R, POCKET_R, POCKETS,
  BASELINE_OFFSET, TURN, getPlayerSide,
} from '../state.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.boardTexture = null;
    this.particles = [];
    this.cssSize = 0;
  }

  resize() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const maxDim = Math.min(wrap.clientWidth, wrap.clientHeight, 900);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssSize = maxDim;
    this.canvas.style.width = `${maxDim}px`;
    this.canvas.style.height = `${maxDim}px`;
    this.canvas.width = Math.floor(maxDim * dpr);
    this.canvas.height = Math.floor(maxDim * dpr);
    this.dpr = dpr;
    this.boardTexture = null; // regenerate at new size if needed
  }

  _createBoardTexture() {
    const size = BOARD_SIZE;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');

    // Outer frame
    ctx.fillStyle = '#120a06';
    ctx.fillRect(0, 0, size, size);

    // Wood base
    ctx.fillStyle = '#c79b5e';
    ctx.fillRect(MARGIN - 6, MARGIN - 6, PLAY_AREA + 12, PLAY_AREA + 12);

    // Wood grain
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 280; i++) {
      const y = Math.random() * (PLAY_AREA + 20) + MARGIN - 10;
      const w = Math.random() * PLAY_AREA * 0.6 + PLAY_AREA * 0.2;
      const x = (size - w) / 2 + (Math.random() - 0.5) * 40;
      ctx.strokeStyle = Math.random() < 0.5 ? '#7a4e2a' : '#e6c88a';
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 1; j <= 24; j++) {
        ctx.lineTo(x + (w / 24) * j, y + (Math.random() - 0.5) * 6);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Frame bevel
    ctx.strokeStyle = '#2a1a0e';
    ctx.lineWidth = 8;
    ctx.strokeRect(MARGIN - 4, MARGIN - 4, PLAY_AREA + 8, PLAY_AREA + 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(MARGIN, MARGIN, PLAY_AREA, PLAY_AREA);

    // Play surface
    ctx.fillStyle = 'rgba(230,205,165,0.06)';
    ctx.fillRect(MARGIN, MARGIN, PLAY_AREA, PLAY_AREA);

    // Corner pockets
    for (const p of POCKETS) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, POCKET_R + 6);
      g.addColorStop(0, '#080503');
      g.addColorStop(0.65, '#1a0f08');
      g.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_R + 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_R + 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Center circle and cross
    const cx = size / 2;
    const cy = size / 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.stroke();

    // Diagonal pocket lines converging at the center (queen sits on the intersection)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    for (const p of POCKETS) {
      const angle = Math.atan2(cy - p.y, cx - p.x);
      const startDist = 58;
      const endDist = 22;
      const sx = p.x + Math.cos(angle) * startDist;
      const sy = p.y + Math.sin(angle) * startDist;
      const ex = cx - Math.cos(angle) * endDist;
      const ey = cy - Math.sin(angle) * endDist;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }

    // Baselines (foul/rebaseline lines) — vivid red dashed lines near each border
    const base1 = MARGIN + BASELINE_OFFSET;
    const base2 = size - MARGIN - BASELINE_OFFSET;
    const lineInset = 26;
    ctx.save();
    ctx.setLineDash([10, 7]);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(220, 45, 65, 0.92)';
    ctx.shadowColor = 'rgba(220, 45, 65, 0.55)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(MARGIN + lineInset, base1);
    ctx.lineTo(size - MARGIN - lineInset, base1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(MARGIN + lineInset, base2);
    ctx.lineTo(size - MARGIN - lineInset, base2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // White inner highlight for contrast against dark wood grain
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(MARGIN + lineInset, base1 + 1);
    ctx.lineTo(size - MARGIN - lineInset, base1 + 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(MARGIN + lineInset, base2 - 1);
    ctx.lineTo(size - MARGIN - lineInset, base2 - 1);
    ctx.stroke();
    ctx.restore();

    // Corner arcs
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (const p of POCKETS) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 55, 0, Math.PI * 2);
      ctx.stroke();
    }

    return c;
  }

  draw(state) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const size = this.cssSize || this.canvas.clientWidth;
    const scale = size / BOARD_SIZE;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.scale(scale, scale);
    const offsetX = (size / scale - BOARD_SIZE) / 2;
    const offsetY = (size / scale - BOARD_SIZE) / 2;
    ctx.translate(offsetX, offsetY);

    // Shake
    const shake = state.shakeAmount || 0;
    if (shake > 0.1) {
      ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
    }

    // Board
    if (!this.boardTexture) this.boardTexture = this._createBoardTexture();
    ctx.drawImage(this.boardTexture, 0, 0, BOARD_SIZE, BOARD_SIZE);

    // Guides
    if (state.phase !== 'over') {
      this._drawPlacementGuide(ctx, state);
      this._drawAimGuide(ctx, state);
      this._drawAiPreview(ctx, state);
    }

    // Coins
    const currentSide = state.turn ? getPlayerSide(state, state.turn) : null;
    for (const coin of state.coins) {
      if (!coin.active) continue;
      const highlight = state.mode === 'local' && coin.side === currentSide;
      this._drawCoin(ctx, coin, highlight);
    }

    // Striker
    if (state.striker.active) {
      this._drawStriker(ctx, state.striker, state);
    }

    // Pocketed summary dots
    this._drawPocketedSummary(ctx, state);

    // Particles
    this._drawParticles(ctx);

    // Vignette / lighting overlay
    const grad = ctx.createRadialGradient(BOARD_SIZE / 2, BOARD_SIZE / 2, BOARD_SIZE * 0.35, BOARD_SIZE / 2, BOARD_SIZE / 2, BOARD_SIZE * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);

    ctx.restore();
  }

  _drawCoin(ctx, coin, highlight) {
    ctx.save();

    let base, rim, shine, specWeight;
    if (coin.color === 'white') {
      base = '#f5f0e2'; rim = '#d4cab0'; shine = '#ffffff'; specWeight = 0.45;
    } else if (coin.color === 'black') {
      base = '#2a2a2a'; rim = '#151515'; shine = '#555555'; specWeight = 0.18;
    } else { // red queen
      base = '#d44050'; rim = '#8a1a26'; shine = '#ff6b7a'; specWeight = 0.35;
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.arc(coin.x + 2, coin.y + 2, coin.r, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const g = ctx.createRadialGradient(
      coin.x - coin.r * 0.35, coin.y - coin.r * 0.35, coin.r * 0.1,
      coin.x, coin.y, coin.r
    );
    g.addColorStop(0, shine);
    g.addColorStop(0.55, base);
    g.addColorStop(1, rim);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, coin.r, 0, Math.PI * 2);
    ctx.fill();

    // Rim stroke
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, coin.r - 1, 0, Math.PI * 2);
    ctx.stroke();

    // Shine overlay
    const sg = ctx.createRadialGradient(
      coin.x - coin.r * 0.4, coin.y - coin.r * 0.45, 0,
      coin.x, coin.y, coin.r
    );
    sg.addColorStop(0, `rgba(255,255,255,${specWeight})`);
    sg.addColorStop(0.45, `rgba(255,255,255,${specWeight * 0.2})`);
    sg.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, coin.r, 0, Math.PI * 2);
    ctx.fill();

    if (highlight) {
      ctx.strokeStyle = 'rgba(232,188,79,0.65)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(coin.x, coin.y, coin.r + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawStriker(ctx, striker, state) {
    ctx.save();

    const isPlayerTurn = state.turn === striker.side && state.inputEnabled && !state.aiThinking;
    if (isPlayerTurn) {
      ctx.shadowColor = 'rgba(232,188,79,0.55)';
      ctx.shadowBlur = 14;
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.arc(striker.x + 2, striker.y + 2, striker.r, 0, Math.PI * 2);
    ctx.fill();

    const g = ctx.createRadialGradient(
      striker.x - striker.r * 0.3, striker.y - striker.r * 0.3, striker.r * 0.05,
      striker.x, striker.y, striker.r
    );
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, '#e8e4d8');
    g.addColorStop(0.7, '#c8b898');
    g.addColorStop(1, '#8a7a5a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(striker.x, striker.y, striker.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#b89a50';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(striker.x, striker.y, striker.r * 0.65, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#8a6a30';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(striker.x, striker.y, striker.r * 0.38, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#8a7a5a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(striker.x, striker.y, striker.r - 1, 0, Math.PI * 2);
    ctx.stroke();

    // Shine
    const sg = ctx.createRadialGradient(
      striker.x - striker.r * 0.35, striker.y - striker.r * 0.38, 0,
      striker.x, striker.y, striker.r
    );
    sg.addColorStop(0, 'rgba(255,255,255,0.42)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    sg.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(striker.x, striker.y, striker.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawAimGuide(ctx, state) {
    if (!state.dragStart || !state.dragCurrent || state.phase !== 'aim') return;
    if (!state.inputEnabled) return;

    const sx = state.striker.x;
    const sy = state.striker.y;
    const dx = state.dragStart.x - state.dragCurrent.x;
    const dy = state.dragStart.y - state.dragCurrent.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 5) return;

    const power = Math.min(dist * 5.2, 340);
    const nx = dx / dist;
    const ny = dy / dist;
    const lineLen = 220 + power * 0.4;

    ctx.save();
    ctx.setLineDash([7, 10]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + nx * lineLen, sy + ny * lineLen);
    ctx.stroke();
    ctx.setLineDash([]);

    // Power arc
    ctx.strokeStyle = `rgba(232,188,79,${0.5 + 0.4 * (power / 340)})`;
    ctx.lineWidth = 3.5;
    const angle = Math.atan2(-ny, nx);
    const ratio = power / 340;
    ctx.beginPath();
    ctx.arc(sx, sy, 36, angle - Math.PI * ratio * 0.75, angle + Math.PI * ratio * 0.75);
    ctx.stroke();

    // Power label
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(ratio * 100)}%`, sx + nx * 52, sy + ny * 52);
    ctx.restore();
  }

  _drawPlacementGuide(ctx, state) {
    if (state.phase !== 'place' || state.aiThinking) return;
    const baselineY = state.turn === TURN.P1
      ? BOARD_SIZE - MARGIN - BASELINE_OFFSET
      : MARGIN + BASELINE_OFFSET;

    ctx.save();
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = 'rgba(232,188,79,0.75)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(MARGIN + 24, baselineY);
    ctx.lineTo(BOARD_SIZE - MARGIN - 24, baselineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ghost striker at current x
    const x = state.striker.x;
    const y = baselineY;
    const valid = true; // placement handler already clamps; optional future validation
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = valid ? '#e8bc4f' : '#ff5e5e';
    ctx.beginPath();
    ctx.arc(x, y, STRIKER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  _drawAiPreview(ctx, state) {
    if (!state.aiPreview) return;
    const { sx, sy, vx, vy } = state.aiPreview;
    ctx.save();
    ctx.setLineDash([5, 7]);
    ctx.strokeStyle = 'rgba(255,150,80,0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + vx * 8, sy + vy * 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawPocketedSummary(ctx, state) {
    const p1Pocketed = state.coins.filter(c => !c.active && c.side === state.p1Side).length;
    const p2Pocketed = state.coins.filter(c => !c.active && c.side === state.p2Side).length;
    const gap = 8;
    const r = 4.5;
    const y = MARGIN - 12;

    ctx.save();
    for (let i = 0; i < p1Pocketed; i++) {
      ctx.fillStyle = state.p1Side === 'white' ? '#f5f0e2' : '#2a2a2a';
      ctx.beginPath();
      ctx.arc(BOARD_SIZE - MARGIN - 18 - i * gap, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    for (let i = 0; i < p2Pocketed; i++) {
      ctx.fillStyle = state.p2Side === 'white' ? '#f5f0e2' : '#2a2a2a';
      ctx.beginPath();
      ctx.arc(MARGIN + 18 + i * gap, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  spawnParticles(x, y, color, count, spread = 2.5) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 3.5;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed * spread,
        vy: Math.sin(angle) * speed * spread,
        life: 0.35 + Math.random() * 0.55,
        maxLife: 0.9,
        color,
        r: 1.6 + Math.random() * 2.4,
      });
    }
  }

  spawnSparkle(x, y, color) {
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.8,
        color,
        r: 1.2 + Math.random() * 1.5,
      });
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.life -= dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  _drawParticles(ctx) {
    ctx.save();
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
