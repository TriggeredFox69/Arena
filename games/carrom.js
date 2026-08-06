/* ============================================================
   ArenaX — Carrom Clash
   Realistic Carrom engine with fixed-step physics, proper rules,
   improved AI and polished rendering.
   ============================================================ */
(function () {
  'use strict';

  const TWO_PI = Math.PI * 2;
  const DEG = Math.PI / 180;

  // --- Geometry constants ---
  const SIZE = 800;
  const MARGIN = 46;
  const POCKET_RADIUS = 28;
  const COIN_RADIUS = 16;
  const STRIKER_RADIUS = 22;
  const BASELINE_OFFSET = 120;
  const BASELINE_Y_PLAYER = SIZE - BASELINE_OFFSET;
  const BASELINE_Y_AI = BASELINE_OFFSET;
  const BASELINE_WIDTH = 420;
  const BASELINE_HALF = BASELINE_WIDTH / 2;
  const FRICTION_PER_SEC = 0.45;  // exponential decay per second
  const STOP_SPEED = 0.08;
  const MAX_POWER = 24;
  const WALL_BOUNCE = 0.72;
  const COIN_RESTITUTION = 0.92;
  const STRIKER_MASS = 3;
  const COIN_MASS = 1;
  const SUB_STEPS = 8;
  const FIXED_DT = 1 / 120;  // seconds per physics sub-step

  const POCKETS = [
    { x: MARGIN, y: MARGIN },
    { x: SIZE - MARGIN, y: MARGIN },
    { x: MARGIN, y: SIZE - MARGIN },
    { x: SIZE - MARGIN, y: SIZE - MARGIN }
  ];

  const COLORS = {
    white: '#f5f0e3',
    whiteDark: '#c7bca6',
    black: '#1a1a1a',
    blackDark: '#0d0d0d',
    red: '#c82e2e',
    redDark: '#761414',
    striker: '#e8e8e8',
    strikerDark: '#9fa0a3',
    board: '#c9a06a',
    boardDark: '#8b6238',
    line: '#e8d7b4',
    pocket: '#0d0d10'
  };

  const canvas = document.getElementById('carromCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = SIZE;
  canvas.height = SIZE;

  // --- Audio ---
  let audioCtx = null;
  let audioReady = false;
  let soundOn = true;

  function ensureAudio() {
    if (audioReady || typeof window.AudioContext === 'undefined') return false;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => { audioReady = audioCtx.state === 'running'; });
      return true;
    }
    audioReady = true;
    return true;
  }

  function resumeAudio() {
    ensureAudio();
  }

  function playTone(freq, duration, type = 'sine', volume = 0.18, when = 0, ramp = true) {
    if (!soundOn || !audioCtx) return;
    const t = when || audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    if (ramp) gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    else gain.gain.setValueAtTime(0, t + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function playNoise(duration, volume = 0.22, when = 0, lowpass = 2200) {
    if (!soundOn || !audioCtx) return;
    const t = when || audioCtx.currentTime;
    const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    noise.connect(filter).connect(gain).connect(audioCtx.destination);
    noise.start(t);
    noise.stop(t + duration + 0.02);
  }

  function playStrike(power = 0.5) {
    if (!soundOn) return;
    const now = audioCtx ? audioCtx.currentTime : 0;
    const vol = 0.12 + Math.min(power / MAX_POWER, 1) * 0.18;
    playNoise(0.12, vol, now, 1800);
    playTone(180 + Math.random() * 40, 0.1, 'square', vol * 0.45, now, true);
    playTone(220 + Math.random() * 50, 0.1, 'triangle', vol * 0.35, now + 0.01, true);
  }

  function playClack(impact = 0.5) {
    if (!soundOn) return;
    const now = audioCtx ? audioCtx.currentTime : 0;
    const vol = Math.min(0.05 + impact * 0.25, 0.28);
    playNoise(0.06, vol, now, 3500);
    playTone(600 + Math.random() * 120, 0.08, 'square', vol * 0.5, now, true);
    playTone(900 + Math.random() * 150, 0.08, 'sine', vol * 0.35, now + 0.01, true);
  }

  function playSink(power = 0.5) {
    if (!soundOn) return;
    const now = audioCtx ? audioCtx.currentTime : 0;
    const vol = 0.15 + Math.min(power / MAX_POWER, 1) * 0.15;
    playNoise(0.16, vol, now, 1600);
    playTone(320, 0.12, 'sine', vol, now, true);
    playTone(240, 0.14, 'sine', vol * 0.7, now + 0.06, true);
    playTone(160, 0.16, 'sine', vol * 0.5, now + 0.12, true);
  }

  function playFoul() {
    if (!soundOn) return;
    const now = audioCtx ? audioCtx.currentTime : 0;
    playTone(180, 0.2, 'sawtooth', 0.18, now, true);
    playTone(140, 0.2, 'sawtooth', 0.14, now + 0.08, true);
  }

  function playVictory() {
    if (!soundOn) return;
    const now = audioCtx ? audioCtx.currentTime : 0;
    [523.25, 659.25, 783.99, 1046.5, 1318.5, 1046.5].forEach((f, i) => {
      playTone(f, 0.22, 'sine', 0.16, now + i * 0.1, true);
    });
  }

  window.toggleMute = function () {
    soundOn = !soundOn;
    const btn = document.getElementById('muteBtn');
    if (btn) btn.textContent = soundOn ? '🔊' : '🔇';
    ensureAudio();
  };

  // --- Texture / pre-rendering ---
  const woodTexture = createWoodTexture();
  function createWoodTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    const grad = x.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#c9a06a');
    grad.addColorStop(0.45, '#b88a2d');
    grad.addColorStop(1, '#8b6238');
    x.fillStyle = grad;
    x.fillRect(0, 0, 512, 512);
    x.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 300; i++) {
      const sx = Math.random() * 512;
      const sy = Math.random() * 512;
      const len = 80 + Math.random() * 220;
      const angle = (Math.random() - 0.5) * 0.3 + Math.PI * 0.35;
      x.beginPath();
      x.moveTo(sx, sy);
      const cp1x = sx + Math.cos(angle) * len * 0.4 + (Math.random() - 0.5) * 30;
      const cp1y = sy + Math.sin(angle) * len * 0.4 + (Math.random() - 0.5) * 30;
      const cp2x = sx + Math.cos(angle) * len * 0.8 + (Math.random() - 0.5) * 30;
      const cp2y = sy + Math.sin(angle) * len * 0.8 + (Math.random() - 0.5) * 30;
      const ex = sx + Math.cos(angle) * len;
      const ey = sy + Math.sin(angle) * len;
      x.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
      x.strokeStyle = `rgba(70, 40, 15, ${0.05 + Math.random() * 0.08})`;
      x.lineWidth = 1 + Math.random() * 2.5;
      x.stroke();
    }
    x.globalCompositeOperation = 'source-over';
    const img = x.getImageData(0, 0, 512, 512);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const noise = (Math.random() - 0.5) * 10;
      d[i] = Math.max(0, Math.min(255, d[i] + noise));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + noise));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + noise));
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  // --- Helpers ---
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function len(vx, vy) { return Math.hypot(vx, vy); }

  function makePiece(x, y, color, value, side) {
    return { x, y, vx: 0, vy: 0, r: COIN_RADIUS, color, value, side, isPocketed: false, trail: [] };
  }

  function makeStriker(side) {
    return {
      x: SIZE / 2,
      y: side === 'ai' ? BASELINE_Y_AI : BASELINE_Y_PLAYER,
      vx: 0, vy: 0,
      r: STRIKER_RADIUS,
      side,
      isPocketed: false,
      trail: []
    };
  }

  // --- Setup ---
  let coins = [];
  let striker = makeStriker('player');
  let turn = 'player';
  let scores = { player: 0, ai: 0 };
  let queenState = { pocketedBy: null, coverNeeded: false };
  let gameOver = false;
  let particles = [];
  let lastShot = { text: '—', type: 'neutral' };
  let turnSummary = null;
  let aiPreview = null;
  let aiTimer = 0;
  let shotActive = false;
  let shotResolved = false;
  let settling = false;
  let settlingTimer = 0;
  let lastTime = 0;
  let accumulator = 0;
  let pointer = { x: 0, y: 0, down: false };
  let inputMode = 'place'; // 'place' | 'aim' | 'none' | 'wait'
  let dragStart = null;
  let aimStart = null;
  let aimEnd = null;

  function setupCoins() {
    coins = [];
    coins.push(makePiece(SIZE / 2, SIZE / 2, 'red', 50, null)); // Queen
    const layers = [
      { n: 6, d: COIN_RADIUS * 2.15 },
      { n: 12, d: COIN_RADIUS * 4.3 }
    ];
    let idx = 0;
    for (const layer of layers) {
      for (let i = 0; i < layer.n; i++) {
        const angle = (i / layer.n) * TWO_PI - Math.PI / 2;
        const x = SIZE / 2 + Math.cos(angle) * layer.d;
        const y = SIZE / 2 + Math.sin(angle) * layer.d;
        const color = (idx % 2 === 0) ? 'white' : 'black';
        coins.push(makePiece(x, y, color, 10, color));
        idx++;
      }
    }
    // Ensure classic 9 white / 9 black total (besides queen)
    // Current arrangement: 6+12 = 18 => 9 each. OK.
  }

  window.resetGame = function () {
    ensureAudio();
    setupCoins();
    turn = 'player';
    scores = { player: 0, ai: 0 };
    queenState = { pocketedBy: null, coverNeeded: false };
    gameOver = false;
    particles = [];
    lastShot = { text: '—', type: 'neutral' };
    turnSummary = null;
    aiPreview = null;
    aiTimer = 0;
    shotActive = false;
    shotResolved = false;
    settling = false;
    settlingTimer = 0;
    accumulator = 0;
    inputMode = 'place';
    striker = makeStriker('player');
    updateHUD();
    hideModal();
    requestAnimationFrame(loop);
  };

  setupCoins();
  updateHUD();

  // --- Input ---
  function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function legalStrikerX(x) {
    const minX = SIZE / 2 - BASELINE_HALF + STRIKER_RADIUS;
    const maxX = SIZE / 2 + BASELINE_HALF - STRIKER_RADIUS;
    return clamp(x, minX, maxX);
  }

  function onPointerDown(e) {
    resumeAudio();
    if (gameOver || turn !== 'player' || shotActive || settling) return;
    const p = getPointerPos(e);
    pointer.x = p.x; pointer.y = p.y; pointer.down = true;
    const d = Math.hypot(p.x - striker.x, p.y - striker.y);
    if (d < striker.r * 2.5) {
      inputMode = 'aim';
      aimStart = { x: striker.x, y: striker.y };
      aimEnd = { x: p.x, y: p.y };
      dragStart = { x: p.x, y: p.y };
    } else if (inputMode === 'place') {
      dragStart = { x: p.x, y: p.y };
    }
  }

  function onPointerMove(e) {
    const p = getPointerPos(e);
    pointer.x = p.x; pointer.y = p.y;
    if (!pointer.down) return;
    if (gameOver || turn !== 'player' || shotActive || settling) return;
    if (inputMode === 'place') {
      striker.x = legalStrikerX(p.x);
      striker.y = BASELINE_Y_PLAYER;
    } else if (inputMode === 'aim') {
      aimEnd = { x: p.x, y: p.y };
    }
  }

  function onPointerUp(e) {
    pointer.down = false;
    if (gameOver || turn !== 'player' || shotActive || settling) return;
    if (inputMode === 'aim' && aimEnd && aimStart) {
      const dx = aimStart.x - aimEnd.x;
      const dy = aimStart.y - aimEnd.y;
      const dragLen = Math.hypot(dx, dy);
      if (dragLen > 6) {
        let power = Math.min(dragLen * 0.14, MAX_POWER);
        const angle = Math.atan2(dy, dx);
        striker.vx = Math.cos(angle) * power;
        striker.vy = Math.sin(angle) * power;
        shotActive = true;
        shotResolved = false;
        playStrike(power);
      }
      aimStart = null;
      aimEnd = null;
      inputMode = 'place';
    } else {
      inputMode = 'place';
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });


  // --- Input ---
  function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function legalStrikerX(x) {
    const minX = SIZE / 2 - BASELINE_HALF + STRIKER_RADIUS;
    const maxX = SIZE / 2 + BASELINE_HALF - STRIKER_RADIUS;
    return clamp(x, minX, maxX);
  }

  function onPointerDown(e) {
    resumeAudio();
    if (gameOver || turn !== 'player' || shotActive || settling) return;
    const p = getPointerPos(e);
    pointer.x = p.x; pointer.y = p.y; pointer.down = true;
    const d = Math.hypot(p.x - striker.x, p.y - striker.y);
    if (d < striker.r * 2.5) {
      inputMode = 'aim';
      aimStart = { x: striker.x, y: striker.y };
      aimEnd = { x: p.x, y: p.y };
      dragStart = { x: p.x, y: p.y };
    } else if (inputMode === 'place') {
      dragStart = { x: p.x, y: p.y };
    }
  }

  function onPointerMove(e) {
    const p = getPointerPos(e);
    pointer.x = p.x; pointer.y = p.y;
    if (!pointer.down) return;
    if (gameOver || turn !== 'player' || shotActive || settling) return;
    if (inputMode === 'place') {
      striker.x = legalStrikerX(p.x);
      striker.y = BASELINE_Y_PLAYER;
    } else if (inputMode === 'aim') {
      aimEnd = { x: p.x, y: p.y };
    }
  }

  function onPointerUp(e) {
    pointer.down = false;
    if (gameOver || turn !== 'player' || shotActive || settling) return;
    if (inputMode === 'aim' && aimEnd && aimStart) {
      const dx = aimStart.x - aimEnd.x;
      const dy = aimStart.y - aimEnd.y;
      const dragLen = Math.hypot(dx, dy);
      if (dragLen > 8) {
        const power = Math.min(dragLen * 0.12, MAX_POWER);
        const angle = Math.atan2(dy, dx);
        striker.vx = Math.cos(angle) * power;
        striker.vy = Math.sin(angle) * power;
        shotActive = true;
        shotResolved = false;
        inputMode = 'wait';
        playStrike(power);
      } else {
        inputMode = 'place';
      }
    }
    aimStart = null; aimEnd = null; dragStart = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
