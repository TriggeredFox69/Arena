/* === Carrom Renderer — premium layered 2D rendering === */
import {
  BOARD_SIZE, MARGIN, PLAY_AREA, COIN_R, STRIKER_R, POCKET_R, POCKETS,
  TURN, getPlayerSide,
} from './state.js';

// --- Cached textures ---
let boardTexture = null;
let boardTextureCanvas = null;

// --- Create procedural wood texture ---
export function createWoodTexture() {
  if (boardTexture) return boardTexture;

  const size = BOARD_SIZE;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const c = cv.getContext('2d');

  // Base wood color
  c.fillStyle = '#c4945a';
  c.fillRect(0, 0, size, size);

  // Grain lines
  c.globalAlpha = 0.15;
  for (let i = 0; i < 200; i++) {
    const y = Math.random() * size;
    const w = size * 0.3 + Math.random() * size * 0.7;
    const x = (size - w) / 2;
    c.strokeStyle = Math.random() < 0.5 ? '#8b5e3c' : '#dbb47a';
    c.lineWidth = 1 + Math.random() * 3;
    c.beginPath();
    c.moveTo(x, y);
    for (let j = 1; j <= 20; j++) {
      c.lineTo(
        x + (w / 20) * j,
        y + (Math.random() - 0.5) * 8
      );
    }
    c.stroke();
  }
  c.globalAlpha = 1;

  // Darker edges
  const edgeGrad = c.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.55);
  edgeGrad.addColorStop(0, 'rgba(0,0,0,0)');
  edgeGrad.addColorStop(1, 'rgba(0,0,0,0.25)');
  c.fillStyle = edgeGrad;
  c.fillRect(0, 0, size, size);

  boardTextureCanvas = cv;
  boardTexture = cv;
  return boardTexture;
}

// --- Draw entire board ---
export function drawBoard(ctx) {
  const size = BOARD_SIZE;

  // Outer frame
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(0, 0, size, size);

  // Wood texture
  const tex = createWoodTexture();
  ctx.drawImage(tex, 0, 0, size, size);

  // Inner frame bevel
  ctx.strokeStyle = '#2a1a0a';
  ctx.lineWidth = 8;
  ctx.strokeRect(MARGIN - 4, MARGIN - 4, PLAY_AREA + 8, PLAY_AREA + 8);

  // Play surface overlay
  ctx.fillStyle = 'rgba(220,190,150,0.08)';
  ctx.fillRect(MARGIN, MARGIN, PLAY_AREA, PLAY_AREA);

  // Playing surface border
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(MARGIN, MARGIN, PLAY_AREA, PLAY_AREA);

  // Corner pockets
  for (const p of POCKETS) {
    const pocketGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, POCKET_R);
    pocketGrad.addColorStop(0, '#0a0505');
    pocketGrad.addColorStop(0.6, '#1a0f08');
    pocketGrad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = pocketGrad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, POCKET_R + 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center circle
  const cx = size / 2;
  const cy = size / 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 28, 0, Math.PI * 2);
  ctx.stroke();

  // Baseline markings (dashed)
  ctx.setLineDash([4, 8]);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  const baselineY1 = MARGIN + PLAY_AREA * 0.25;
  const baselineY2 = BOARD_SIZE - MARGIN - PLAY_AREA * 0.25;
  ctx.beginPath();
  ctx.moveTo(MARGIN + 20, baselineY1);
  ctx.lineTo(BOARD_SIZE - MARGIN - 20, baselineY1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(MARGIN + 20, baselineY2);
  ctx.lineTo(BOARD_SIZE - MARGIN - 20, baselineY2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// --- Draw a coin with 3D shading ---
export function drawCoin(ctx, coin, highlight) {
  ctx.save();

  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.arc(coin.x + 2, coin.y + 2, coin.r, 0, Math.PI * 2);
  ctx.fill();

  let baseColor, rimColor;
  if (coin.color === 'white') { baseColor = '#f5f0e0'; rimColor = '#d4cbb0'; }
  else if (coin.color === 'black') { baseColor = '#3a3a3a'; rimColor = '#1a1a1a'; }
  else if (coin.color === 'red') { baseColor = '#d44050'; rimColor = '#8b1520'; }
  else { baseColor = '#888'; rimColor = '#555'; }

  // Body gradient
  const hiColor = coin.color === 'white' ? '#ffffff' : coin.color === 'black' ? '#555' : coin.color === 'red' ? '#ff6070' : '#aaa';
  const bodyGrad = ctx.createRadialGradient(coin.x - coin.r * 0.3, coin.y - coin.r * 0.3, coin.r * 0.1, coin.x, coin.y, coin.r);
  bodyGrad.addColorStop(0, hiColor);
  bodyGrad.addColorStop(0.7, baseColor);
  bodyGrad.addColorStop(1, rimColor);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.arc(coin.x, coin.y, coin.r, 0, Math.PI * 2);
  ctx.fill();

  // Rim
  ctx.strokeStyle = rimColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(coin.x, coin.y, coin.r - 1, 0, Math.PI * 2);
  ctx.stroke();

  // Specular
  if (coin.color !== 'black') {
    const specGrad = ctx.createRadialGradient(coin.x - coin.r * 0.35, coin.y - coin.r * 0.4, 0, coin.x, coin.y, coin.r);
    specGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
    specGrad.addColorStop(0.4, 'rgba(255,255,255,0.08)');
    specGrad.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = specGrad;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, coin.r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const specGrad = ctx.createRadialGradient(coin.x - coin.r * 0.3, coin.y - coin.r * 0.35, 0, coin.x, coin.y, coin.r);
    specGrad.addColorStop(0, 'rgba(255,255,255,0.12)');
    specGrad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = specGrad;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, coin.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Highlight ring for player's coins
  if (highlight) {
    ctx.strokeStyle = 'rgba(232,188,79,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, coin.r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

// --- Draw striker ---
export function drawStriker(ctx, striker, state) {
  ctx.save();

  if (state.turn === striker.side && !state.aiThinking) {
    ctx.shadowColor = 'rgba(232,188,79,0.5)';
    ctx.shadowBlur = 12;
  }

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.arc(striker.x + 2, striker.y + 2, striker.r, 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createRadialGradient(striker.x - striker.r * 0.3, striker.y - striker.r * 0.3, striker.r * 0.05, striker.x, striker.y, striker.r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.3, '#e8e4d8');
  grad.addColorStop(0.7, '#c8b898');
  grad.addColorStop(1, '#8a7a5a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(striker.x, striker.y, striker.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#b89a50';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(striker.x, striker.y, striker.r * 0.65, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#8a6a30';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(striker.x, striker.y, striker.r * 0.4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#8a7a5a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(striker.x, striker.y, striker.r - 1, 0, Math.PI * 2);
  ctx.stroke();

  const specGrad = ctx.createRadialGradient(striker.x - striker.r * 0.35, striker.y - striker.r * 0.38, 0, striker.x, striker.y, striker.r);
  specGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
  specGrad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  specGrad.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = specGrad;
  ctx.beginPath();
  ctx.arc(striker.x, striker.y, striker.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// --- Draw aim guide ---
export function drawAim(ctx, state) {
  if (!state.dragStart || !state.dragCurrent) return;
  if (!state.inputEnabled) return;

  const sx = state.striker.x;
  const sy = state.striker.y;
  const dx = state.dragStart.x - state.dragCurrent.x;
  const dy = state.dragStart.y - state.dragCurrent.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 5) return;

  const power = Math.min(dist * 0.18, 28);
  const nx = dx / dist;
  const ny = dy / dist;

  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + nx * 200, sy + ny * 200);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(232,188,79,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const angle = Math.atan2(-ny, nx);
  const powerRatio = Math.min(power / 28, 1);
  ctx.arc(sx, sy, 30, angle - Math.PI * powerRatio * 0.7, angle + Math.PI * powerRatio * 0.7);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(power / 28 * 100) + '%', sx + nx * 45, sy + ny * 45);

  ctx.restore();
}

// --- Draw AI shot preview ---
export function drawAiPreview(ctx, state) {
  if (!state.aiPreview) return;
  const { sx, sy, vx, vy } = state.aiPreview;

  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = 'rgba(255,150,80,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + vx * 8, sy + vy * 8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// --- Draw striker placement guide ---
export function drawPlacementGuide(ctx, state) {
  if (state.phase !== 'place') return;
  if (state.turn === TURN.P2 && state.mode === 'ai' && state.aiThinking) return;

  const baselineY = state.turn === TURN.P1 ?
    BOARD_SIZE - (MARGIN + PLAY_AREA * 0.25) :
    MARGIN + PLAY_AREA * 0.25;

  ctx.save();
  ctx.setLineDash([8, 4]);
  ctx.strokeStyle = 'rgba(232,188,79,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN + 10, baselineY);
  ctx.lineTo(BOARD_SIZE - MARGIN - 10, baselineY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#e8bc4f';
  ctx.beginPath();
  ctx.arc(state.striker.x, baselineY, STRIKER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

// --- Particles ---
export function spawnParticles(state, x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.3 + Math.random() * 0.5,
      maxLife: 0.5,
      color,
      r: 1.5 + Math.random() * 2.5,
    });
  }
}

export function updateParticles(particles, dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    p.life -= dt;
    p.vx *= 0.95;
    p.vy *= 0.95;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

export function drawParticles(ctx, particles) {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// --- Screen shake ---
export function applyShake(ctx, amount) {
  if (amount < 0.1) return;
  const sx = (Math.random() - 0.5) * amount * 2;
  const sy = (Math.random() - 0.5) * amount * 2;
  ctx.translate(sx, sy);
}
