/* === Carrom Audio — procedural Web Audio sound engine === */

let audioCtx = null;
let muted = false;

function ensureCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      // Audio not available
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function isMuted() { return muted; }

export function toggleMute() {
  muted = !muted;
  return muted;
}

export function setMute(val) {
  muted = val;
}

// --- Sound primitives ---
function playTone(freq, duration, type, volume, decay) {
  if (muted) return;
  const ctx = ensureCtx();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type || 'sine';
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(volume || 0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (decay || duration || 0.1));

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + (decay || duration || 0.1));
}

function playNoise(duration, volume, filterFreq) {
  if (muted) return;
  const ctx = ensureCtx();
  if (!ctx) return;

  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq || 800;
  filter.Q.value = 0.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume || 0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

// --- Game sound effects ---
export function playStrikerHit(power) {
  const vol = Math.min(0.08 + power * 0.01, 0.25);
  playNoise(0.12, vol, 500);
  playTone(120, 0.08, 'triangle', vol * 0.6);
}

export function playCoinHit(impact) {
  const vol = Math.min(0.05 + impact * 0.01, 0.2);
  playTone(800 + Math.random() * 400, 0.06, 'square', vol * 0.5, 0.05);
  playNoise(0.06, vol * 0.7, 1200);
}

export function playWallHit() {
  playTone(200, 0.05, 'sine', 0.08, 0.04);
  playNoise(0.04, 0.06, 400);
}

export function playPocket(success) {
  if (success) {
    // Pleasant pocket drop
    playTone(600, 0.08, 'sine', 0.12);
    setTimeout(() => playTone(900, 0.1, 'sine', 0.1), 60);
  } else {
    // Negative pocket (foul)
    playTone(200, 0.15, 'sawtooth', 0.1, 0.12);
    playTone(100, 0.2, 'triangle', 0.12, 0.18);
  }
}

export function playFoul() {
  playTone(150, 0.25, 'sawtooth', 0.12, 0.2);
  playTone(100, 0.3, 'triangle', 0.1, 0.25);
  setTimeout(() => {
    playNoise(0.2, 0.08, 300);
  }, 150);
}

export function playWin() {
  if (muted) return;
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => {
    setTimeout(() => {
      playTone(n, 0.3, 'sine', 0.15, 0.25);
    }, i * 120);
  });
}

export function playLoss() {
  if (muted) return;
  const notes = [400, 350, 300, 250];
  notes.forEach((n, i) => {
    setTimeout(() => {
      playTone(n, 0.3, 'triangle', 0.12, 0.25);
    }, i * 150);
  });
}

export function playQueenDrop() {
  playTone(800, 0.1, 'sine', 0.15);
  setTimeout(() => playTone(1000, 0.12, 'sine', 0.12), 50);
  setTimeout(() => playTone(1200, 0.15, 'sine', 0.1), 100);
}

export function playAimGrab() {
  playTone(500, 0.03, 'sine', 0.04);
}

export function playUITap() {
  playTone(700, 0.04, 'sine', 0.05);
}
