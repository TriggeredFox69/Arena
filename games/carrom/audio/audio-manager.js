/* === Carrom Audio Manager — asset-backed with procedural fallbacks === */

const MUTE_KEY = 'carrom_muted';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem(MUTE_KEY) === 'true';
    this.buffers = new Map();
    this.assetUrls = {
      striker: 'assets/audio/carrom/striker.mp3',
      coin: 'assets/audio/carrom/coin.mp3',
      wall: 'assets/audio/carrom/wall.mp3',
      pocket: 'assets/audio/carrom/pocket.mp3',
      foul: 'assets/audio/carrom/foul.mp3',
      queen: 'assets/audio/carrom/queen.mp3',
      win: 'assets/audio/carrom/win.mp3',
      loss: 'assets/audio/carrom/loss.mp3',
      ui: 'assets/audio/carrom/ui.mp3',
    };
  }

  async init() {
    await this._ensureContext();
    if (this.ctx) {
      await this._loadAssets();
    }
  }

  isMuted() {
    return this.muted;
  }

  setMute(value) {
    this.muted = value;
    localStorage.setItem(MUTE_KEY, value ? 'true' : 'false');
    return this.muted;
  }

  toggleMute() {
    return this.setMute(!this.muted);
  }

  async _ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      // Audio unavailable
    }
  }

  async _loadAssets() {
    const entries = Object.entries(this.assetUrls);
    await Promise.all(entries.map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(data);
        this.buffers.set(name, buffer);
      } catch (e) {
        // Asset missing or decode failed — fall back to synthesis
      }
    }));
  }

  _playBuffer(name, volume = 1) {
    if (this.muted || !this.ctx) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return false;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + buffer.duration + 0.05);
    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
    return true;
  }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // --- Synthesis primitives ---

  _noise(duration, volume, filterFreq = 800, q = 0.5) {
    if (this.muted || !this.ctx) return;
    const sr = this.ctx.sampleRate;
    const samples = Math.floor(sr * duration);
    const buffer = this.ctx.createBuffer(1, samples, sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this._now());
    gain.gain.exponentialRampToValueAtTime(0.001, this._now() + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }

  _tone(freq, duration, type = 'sine', volume = 0.15, decay = null) {
    if (this.muted || !this.ctx) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (decay || duration));
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + (decay || duration));
  }

  _chord(notes, duration, volume = 0.12, type = 'sine') {
    notes.forEach((freq, i) => {
      setTimeout(() => this._tone(freq, duration, type, volume, duration * 1.2), i * 70);
    });
  }

  // --- Game events ---

  playStrikerHit(power = 0.5) {
    if (this._playBuffer('striker', 0.7 + power * 0.3)) return;
    const vol = Math.min(0.06 + power * 0.04, 0.22);
    this._noise(0.1, vol, 450, 0.4);
    this._tone(130, 0.08, 'triangle', vol * 0.5, 0.08);
  }

  playCoinHit(impact = 1) {
    if (this._playBuffer('coin', 0.6 + impact * 0.2)) return;
    const vol = Math.min(0.04 + impact * 0.015, 0.18);
    const freq = 700 + Math.random() * 500;
    this._tone(freq, 0.06, 'sine', vol, 0.05);
    this._noise(0.05, vol * 0.8, 1400, 0.6);
  }

  playWallHit() {
    if (this._playBuffer('wall', 0.7)) return;
    this._tone(220, 0.05, 'sine', 0.08, 0.04);
    this._noise(0.04, 0.05, 350, 0.4);
  }

  playPocket() {
    if (this._playBuffer('pocket', 0.75)) return;
    const t = this._now();
    [620, 880, 1100].forEach((freq, i) => {
      setTimeout(() => this._tone(freq, 0.1, 'sine', 0.1, 0.12), i * 45);
    });
  }

  playFoul() {
    if (this._playBuffer('foul', 0.8)) return;
    this._tone(160, 0.25, 'sawtooth', 0.12, 0.22);
    this._tone(110, 0.3, 'triangle', 0.1, 0.28);
    setTimeout(() => this._noise(0.18, 0.07, 280, 0.3), 140);
  }

  playQueen() {
    if (this._playBuffer('queen', 0.8)) return;
    this._tone(880, 0.12, 'sine', 0.14, 0.12);
    setTimeout(() => this._tone(1100, 0.14, 'sine', 0.12, 0.14), 60);
    setTimeout(() => this._tone(1320, 0.16, 'sine', 0.1, 0.16), 120);
  }

  playWin() {
    if (this.muted) return;
    if (this._playBuffer('win', 0.8)) return;
    this._chord([523, 659, 784, 1047], 0.35, 0.14, 'sine');
  }

  playLoss() {
    if (this.muted) return;
    if (this._playBuffer('loss', 0.8)) return;
    this._chord([392, 330, 294, 247], 0.4, 0.12, 'triangle');
  }

  playAim() {
    if (this._playBuffer('ui', 0.35)) return;
    this._tone(520, 0.035, 'sine', 0.035, 0.035);
  }

  playUi() {
    if (this._playBuffer('ui', 0.4)) return;
    this._tone(720, 0.045, 'sine', 0.045, 0.045);
  }
}
