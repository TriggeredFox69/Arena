// ==========================================
// ArenaX Game Common — Shared features for every game
// Wager entry, balance, timer, pause, sound, fullscreen,
// rules, invite link, exit confirmation, result modal
// ==========================================

(function () {
  'use strict';

  const GAME_NAMES = {
    carrom: 'Carrom Clash',
    ludo: 'Ludo Stars',
    '8ball-pool': '8 Ball Pool',
    pool: '8 Ball Pool',
    'Glow-hockey': 'Glow Hockey',
    glowhockey: 'Glow Hockey',
    chess: 'Chess Royale',
    checkers: 'Checkers Clash'
  };

  class GameCommon {
    constructor(options = {}) {
      this.gameKey = options.gameKey || this.inferGameKey();
      this.gameName = options.gameName || GAME_NAMES[this.gameKey] || 'ArenaX Game';
      this.onPause = options.onPause || (() => {});
      this.onResume = options.onResume || (() => {});
      this.onExit = options.onExit || (() => { window.location.href = '../index.html'; });
      this.onStart = options.onStart || (() => {});
      this.rulesHTML = options.rulesHTML || this.defaultRules();
      this.timerSeconds = options.timerSeconds || 0; // 0 = match timer, per-turn handled by game
      this.turnTimeLimit = options.turnTimeLimit || 30;
      this.onTurnTimeout = options.onTurnTimeout || null;

      this.wager = null;
      this.balanceBefore = 0;
      this.matchTimer = 0;
      this.turnTimer = this.turnTimeLimit;
      this.timerInterval = null;
      this.turnTimerInterval = null;
      this.paused = false;
      this.started = false;
      this.soundKey = `gx_sound_${this.gameKey}`;
      this.soundOn = localStorage.getItem(this.soundKey) !== 'off';

      this.injectStyles();
      this.injectMarkup();
      this.bindGlobalEvents();
      this.updateSoundButton();
    }

    inferGameKey() {
      const path = window.location.pathname;
      const file = path.substring(path.lastIndexOf('/') + 1).replace('.html', '');
      if (GAME_NAMES[file]) return file;
      if (file === '8ball-pool') return '8ball-pool';
      if (file === 'Glow-hockey') return 'Glow-hockey';
      return 'game';
    }

    defaultRules() {
      return `<p>Compete head-to-head. The winner takes the pot (wager × 2). Minimum wager <strong>5 AX</strong>, maximum <strong>1000 AX</strong>.</p>`;
    }

    /* ---------- Styles ---------- */
    injectStyles() {
      if (document.getElementById('game-common-styles')) return;
      const css = document.createElement('style');
      css.id = 'game-common-styles';
      css.textContent = `
        .gx-overlay-backdrop{position:fixed;inset:0;background:rgba(6,6,10,0.88);backdrop-filter:blur(10px);z-index:10000;display:none;place-items:center;padding:20px;}
        .gx-overlay-backdrop.show{display:grid;}
        .gx-overlay{max-width:420px;width:100%;background:linear-gradient(145deg,#16161f,#0d0d12);border:1px solid rgba(232,188,79,0.22);border-radius:22px;padding:28px 26px;box-shadow:0 24px 70px rgba(0,0,0,0.55);color:#f5f1e8;font-family:Inter,system-ui,sans-serif;}
        .gx-overlay h2{margin:0 0 8px;font-family:Orbitron,monospace;font-size:22px;color:#e8bc4f;text-align:center;}
        .gx-overlay p{color:#b5aa94;font-size:14px;line-height:1.55;text-align:center;margin:0 0 18px;}
        .gx-balance-row{display:flex;align-items:center;justify-content:center;gap:8px;background:rgba(232,188,79,0.09);border:1px solid rgba(232,188,79,0.18);border-radius:12px;padding:10px 16px;margin-bottom:18px;}
        .gx-balance-row .gx-coin{color:#e8bc4f;font-size:18px;}
        .gx-balance-row .gx-value{font-family:Orbitron,monospace;font-size:18px;font-weight:800;color:#fff;}
        .gx-balance-row .gx-label{color:#b5aa94;font-size:13px;}
        .gx-wager-input{width:100%;padding:14px 16px;font-size:28px;font-weight:800;text-align:center;background:#0a0a0f;border:1px solid rgba(255,255,255,0.12);border-radius:14px;color:#fff;outline:none;margin-bottom:8px;font-family:Orbitron,monospace;}
        .gx-wager-input:focus{border-color:#e8bc4f;}
        .gx-range-hint{text-align:center;color:#7a6f5e;font-size:12px;margin-bottom:18px;}
        .gx-error{color:#ff5e5e;font-size:13px;text-align:center;min-height:20px;margin-bottom:10px;}
        .gx-btn-row{display:flex;gap:10px;}
        .gx-btn{flex:1;padding:13px 16px;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;transition:transform .1s,filter .1s;}
        .gx-btn:active{transform:scale(.96);}
        .gx-btn-primary{background:linear-gradient(135deg,#fff6c0,#e8bc4f,#a8781c);color:#1a1200;}
        .gx-btn-secondary{background:rgba(255,255,255,0.06);color:#f5f1e8;border:1px solid rgba(255,255,255,0.12);}
        .gx-toolbar{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:8px;background:rgba(18,18,28,0.92);border:1px solid rgba(232,188,79,0.18);border-radius:999px;padding:6px 8px;box-shadow:0 10px 30px rgba(0,0,0,0.4);backdrop-filter:blur(10px);}
        .gx-toolbar-btn{width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.05);color:#f5f1e8;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;transition:all .15s;}
        .gx-toolbar-btn:hover{background:rgba(232,188,79,0.15);border-color:rgba(232,188,79,0.35);}
        .gx-toolbar-btn.active{background:rgba(232,188,79,0.2);color:#e8bc4f;border-color:rgba(232,188,79,0.4);}
        .gx-toolbar-sep{width:1px;height:24px;background:rgba(255,255,255,0.1);}
        .gx-pot{display:flex;align-items:center;gap:6px;padding:0 12px;font-family:Orbitron,monospace;font-size:14px;font-weight:700;color:#e8bc4f;white-space:nowrap;}
        .gx-timer{font-family:Orbitron,monospace;font-size:14px;font-weight:700;color:#fff;min-width:46px;text-align:center;}
        .gx-timer.low{color:#ff5e5e;animation:pulse 1s infinite;}
        .gx-balance-chip{display:flex;align-items:center;gap:6px;padding:0 12px;font-size:13px;color:#b5aa94;white-space:nowrap;}
        .gx-balance-chip strong{color:#fff;font-family:Orbitron,monospace;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
        .gx-rules-body{max-height:60vh;overflow:auto;text-align:left;padding-right:8px;}
        .gx-rules-body h3{color:#e8bc4f;font-size:15px;margin:14px 0 6px;}
        .gx-rules-body p{color:#b5aa94;font-size:13px;line-height:1.55;margin:0 0 10px;}
        .gx-invite-box{display:flex;gap:8px;margin-top:10px;}
        .gx-invite-box input{flex:1;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#0a0a0f;color:#fff;font-size:13px;}
        .gx-copy-hint{text-align:center;color:#4de694;font-size:13px;margin-top:10px;min-height:20px;}
        @media (max-width:600px){.gx-toolbar{top:auto;bottom:14px;flex-wrap:wrap;justify-content:center;max-width:96vw;}.gx-pot,.gx-balance-chip{font-size:12px;padding:0 8px;}.gx-toolbar-btn{width:34px;height:34px;font-size:15px;}}
      `;
      document.head.appendChild(css);
    }

    /* ---------- Markup ---------- */
    injectMarkup() {
      if (document.getElementById('gx-toolbar')) return;

      const toolbar = document.createElement('div');
      toolbar.id = 'gx-toolbar';
      toolbar.className = 'gx-toolbar';
      toolbar.innerHTML = `
        <div class="gx-pot" title="Winner takes all">🏆 <span id="gx-pot">0 AX</span></div>
        <div class="gx-toolbar-sep"></div>
        <div class="gx-timer" id="gx-timer">00:00</div>
        <div class="gx-toolbar-sep"></div>
        <div class="gx-balance-chip">🪙 <strong id="gx-balance">0</strong> <span>AX</span></div>
        <div class="gx-toolbar-sep"></div>
        <button class="gx-toolbar-btn" id="gx-btn-sound" title="Toggle sound">🔊</button>
        <button class="gx-toolbar-btn" id="gx-btn-pause" title="Pause game">⏸</button>
        <button class="gx-toolbar-btn" id="gx-btn-rules" title="Rules">📜</button>
        <button class="gx-toolbar-btn" id="gx-btn-invite" title="Invite friend">🔗</button>
        <button class="gx-toolbar-btn" id="gx-btn-fullscreen" title="Fullscreen">⛶</button>
        <button class="gx-toolbar-btn" id="gx-btn-exit" title="Exit to lobby">🚪</button>
      `;
      document.body.appendChild(toolbar);

      const backdrop = document.createElement('div');
      backdrop.id = 'gx-backdrop';
      backdrop.className = 'gx-overlay-backdrop';
      backdrop.innerHTML = `<div class="gx-overlay" id="gx-overlay"></div>`;
      document.body.appendChild(backdrop);
    }

    bindGlobalEvents() {
      document.getElementById('gx-btn-sound')?.addEventListener('click', () => this.toggleSound());
      document.getElementById('gx-btn-pause')?.addEventListener('click', () => this.togglePause());
      document.getElementById('gx-btn-rules')?.addEventListener('click', () => this.showRules());
      document.getElementById('gx-btn-invite')?.addEventListener('click', () => this.showInvite());
      document.getElementById('gx-btn-fullscreen')?.addEventListener('click', () => this.toggleFullscreen());
      document.getElementById('gx-btn-exit')?.addEventListener('click', () => this.confirmExit());
      document.getElementById('gx-backdrop')?.addEventListener('click', (e) => {
        if (e.target.id === 'gx-backdrop' && this.paused) this.togglePause();
      });
      document.addEventListener('keydown', (e) => {
        const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
        if (e.key === 'Escape') {
          if (document.getElementById('gx-backdrop')?.classList.contains('show')) {
            // Wager entry / confirm cannot be dismissed — a wager is required to play
            if (!this.started) return;
            if (this.paused) this.togglePause();
            else this.hideOverlay();
          } else {
            this.togglePause();
          }
        }
        if (!typing && e.key.toLowerCase() === 'f') this.toggleFullscreen();
      });
    }

    /* ---------- Wager flow ---------- */
    init() {
      this.updateBalanceDisplay();
      const wager = this.readWager();
      if (wager) {
        this.promptStart(wager);
      } else {
        this.showWagerEntry();
      }
    }

    readWager() {
      if (this.wager) return this.wager;
      const params = new URLSearchParams(window.location.search);
      const fromUrl = parseInt(params.get('wager'), 10);
      if (!Number.isNaN(fromUrl) && fromUrl > 0) {
        this.wager = fromUrl;
        return this.wager;
      }
      const fromStore = parseInt(localStorage.getItem('gx_pending_wager'), 10);
      if (!Number.isNaN(fromStore) && fromStore > 0) {
        this.wager = fromStore;
        localStorage.removeItem('gx_pending_wager');
        return this.wager;
      }
      return null;
    }

    showWagerEntry() {
      const balance = window.arenaX ? window.arenaX.getBalance() : 0;
      this.setOverlayContent(`
        <h2>Place Your Wager</h2>
        <p>${this.gameName}<br>Enter an amount between 5 and 1000 AX coins.</p>
        <div class="gx-balance-row">
          <span class="gx-coin">🪙</span>
          <span class="gx-label">Balance:</span>
          <span class="gx-value" id="gx-entry-balance">${balance.toLocaleString()}</span>
          <span class="gx-label">AX</span>
        </div>
        <input type="number" class="gx-wager-input" id="gx-wager-input" value="10" min="5" max="1000" step="1" placeholder="Wager">
        <div class="gx-range-hint">Min 5 AX · Max 1000 AX</div>
        <div class="gx-error" id="gx-wager-error"></div>
        <div class="gx-btn-row">
          <button class="gx-btn gx-btn-secondary" id="gx-cancel-wager">Back</button>
          <button class="gx-btn gx-btn-primary" id="gx-confirm-wager">Start Game</button>
        </div>
      `);
      this.showOverlay();

      const input = document.getElementById('gx-wager-input');
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.trySetWager(); });
      document.getElementById('gx-confirm-wager')?.addEventListener('click', () => this.trySetWager());
      document.getElementById('gx-cancel-wager')?.addEventListener('click', () => this.onExit());
    }

    trySetWager() {
      const raw = document.getElementById('gx-wager-input')?.value || '';
      const amount = parseInt(raw, 10);
      const errorEl = document.getElementById('gx-wager-error');
      if (Number.isNaN(amount) || amount < 5 || amount > 1000) {
        if (errorEl) errorEl.textContent = 'Enter a wager between 5 and 1000 AX.';
        return;
      }
      this.wager = amount;
      this.promptStart(amount);
    }

    promptStart(amount) {
      const balance = window.arenaX ? window.arenaX.getBalance() : 0;
      if (balance < amount) {
        this.setOverlayContent(`
          <h2>Insufficient Balance</h2>
          <p>You need <strong>${amount.toLocaleString()} AX</strong> to play.<br>Your balance is <strong>${balance.toLocaleString()} AX</strong>.</p>
          <div class="gx-btn-row">
            <button class="gx-btn gx-btn-secondary" onclick="window.location.href='../index.html#wallet'">Back</button>
            <button class="gx-btn gx-btn-primary" onclick="window.location.href='../index.html#wallet'">Deposit</button>
          </div>
        `);
        this.showOverlay();
        return;
      }

      this.setOverlayContent(`
        <h2>Confirm Wager</h2>
        <p>You're about to wager <strong style="color:#e8bc4f">${amount.toLocaleString()} AX</strong> on ${this.gameName}.<br>Winner takes <strong style="color:#4de694">${(amount * 2).toLocaleString()} AX</strong>.</p>
        <div class="gx-balance-row">
          <span class="gx-coin">🪙</span>
          <span class="gx-label">Balance:</span>
          <span class="gx-value">${balance.toLocaleString()}</span>
          <span class="gx-label">AX</span>
        </div>
        <div class="gx-error" id="gx-start-error"></div>
        <div class="gx-btn-row">
          <button class="gx-btn gx-btn-secondary" id="gx-change-wager">Change</button>
          <button class="gx-btn gx-btn-primary" id="gx-start-game">Lock & Play</button>
        </div>
      `);
      this.showOverlay();
      document.getElementById('gx-change-wager')?.addEventListener('click', () => this.showWagerEntry());
      document.getElementById('gx-start-game')?.addEventListener('click', () => this.lockAndStart());
    }

    lockAndStart() {
      const result = this.lockWager();
      if (!result) return;
      this.startGamePlay();
      this.onStart(result);
    }

    lockWager() {
      if (!window.arenaX) {
        this.setOverlayContent(`
          <h2>Wallet Not Loaded</h2>
          <p>Please make sure you are logged in and app.js is loaded.</p>
          <div class="gx-btn-row"><button class="gx-btn gx-btn-secondary" onclick="window.location.href='../index.html'">Back</button></div>
        `);
        this.showOverlay();
        return null;
      }

      const result = window.arenaX.startGame(this.gameName, this.wager);
      if (!result.success) {
        const err = document.getElementById('gx-start-error');
        if (err) err.textContent = result.message;
        return null;
      }

      this.balanceBefore = result.balance + (result.wager || this.wager);
      this.updateBalanceDisplay();
      this.updatePotDisplay();
      this.hideOverlay();
      window.arenaX.showNotification(`Locked ${this.wager.toLocaleString()} AX. Winner takes ${(this.wager * 2).toLocaleString()} AX!`, 'success');
      return result;
    }

    startGamePlay() {
      if (this.started) return;
      this.started = true;
      this.startMatchTimer();
      this.startTurnTimer();
    }

    updatePotDisplay() {
      const el = document.getElementById('gx-pot');
      if (el) el.textContent = `${(this.wager * 2).toLocaleString()} AX`;
    }

    updateBalanceDisplay() {
      const balance = window.arenaX ? window.arenaX.getBalance() : 0;
      const el = document.getElementById('gx-balance');
      if (el) el.textContent = balance.toLocaleString();
      window.arenaX?.updateBalanceDisplay();
    }

    /* ---------- Timer ---------- */
    startMatchTimer() {
      this.stopMatchTimer();
      this.matchTimer = 0;
      this.timerInterval = setInterval(() => {
        if (this.paused) return;
        this.matchTimer++;
        this.renderMatchTimer();
      }, 1000);
    }
    stopMatchTimer() { if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } }

    renderMatchTimer() {
      const el = document.getElementById('gx-timer');
      if (!el) return;
      const m = Math.floor(this.matchTimer / 60).toString().padStart(2, '0');
      const s = (this.matchTimer % 60).toString().padStart(2, '0');
      el.textContent = `${m}:${s}`;
    }

    startTurnTimer() {
      this.stopTurnTimer();
      this.turnTimer = this.turnTimeLimit;
      this.turnTimerInterval = setInterval(() => {
        if (this.paused) return;
        this.turnTimer--;
        if (this.turnTimer <= 0) {
          this.turnTimer = 0;
          if (typeof this.onTurnTimeout === 'function') this.onTurnTimeout();
        }
      }, 1000);
    }
    stopTurnTimer() { if (this.turnTimerInterval) { clearInterval(this.turnTimerInterval); this.turnTimerInterval = null; } }
    resetTurnTimer() { if (this.started) this.startTurnTimer(); }

    /* ---------- Pause ---------- */
    togglePause() {
      if (!this.started) return;
      this.paused = !this.paused;
      const btn = document.getElementById('gx-btn-pause');
      if (btn) btn.textContent = this.paused ? '▶' : '⏸';
      if (this.paused) {
        this.setOverlayContent(`
          <h2>Paused</h2>
          <p>Take a break. Press resume when you're ready.</p>
          <div class="gx-btn-row">
            <button class="gx-btn gx-btn-secondary" id="gx-pause-exit">Exit</button>
            <button class="gx-btn gx-btn-primary" id="gx-pause-resume">Resume</button>
          </div>
        `);
        this.showOverlay();
        document.getElementById('gx-pause-resume')?.addEventListener('click', () => this.togglePause());
        document.getElementById('gx-pause-exit')?.addEventListener('click', () => this.confirmExit());
        this.onPause();
      } else {
        this.hideOverlay();
        this.onResume();
      }
    }

    /* ---------- Sound ---------- */
    toggleSound() {
      this.soundOn = !this.soundOn;
      localStorage.setItem(this.soundKey, this.soundOn ? 'on' : 'off');
      this.updateSoundButton();
      this.playUiClick();
    }

    updateSoundButton() {
      const btn = document.getElementById('gx-btn-sound');
      if (btn) btn.textContent = this.soundOn ? '🔊' : '🔇';
    }

    isSoundOn() { return this.soundOn; }

    playUiClick() {
      if (!this.soundOn) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 620;
        g.gain.setValueAtTime(0.04, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.08);
      } catch (e) {}
    }

    playWin() {
      if (!this.soundOn) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [392, 523, 659, 784, 988].forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = f;
          g.gain.setValueAtTime(0.06, ctx.currentTime + i * 0.09);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.09 + 0.25);
          o.connect(g); g.connect(ctx.destination);
          o.start(ctx.currentTime + i * 0.09);
          o.stop(ctx.currentTime + i * 0.09 + 0.25);
        });
      } catch (e) {}
    }

    playLoss() {
      if (!this.soundOn) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [349, 262, 196, 147].forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = f;
          g.gain.setValueAtTime(0.06, ctx.currentTime + i * 0.11);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.11 + 0.25);
          o.connect(g); g.connect(ctx.destination);
          o.start(ctx.currentTime + i * 0.11);
          o.stop(ctx.currentTime + i * 0.11 + 0.25);
        });
      } catch (e) {}
    }

    /* ---------- Rules ---------- */
    showRules() {
      const wasPaused = this.paused;
      if (this.started && !wasPaused) this.paused = true;
      this.setOverlayContent(`
        <h2>How to Play</h2>
        <div class="gx-rules-body">${this.rulesHTML}</div>
        <div class="gx-btn-row" style="margin-top:18px;">
          <button class="gx-btn gx-btn-primary" id="gx-rules-close">Got it</button>
        </div>
      `);
      this.showOverlay();
      document.getElementById('gx-rules-close')?.addEventListener('click', () => {
        this.hideOverlay();
        if (!wasPaused) this.paused = false;
      });
    }

    /* ---------- Invite ---------- */
    showInvite() {
      const code = this.generateInviteCode();
      const url = `${window.location.origin}${window.location.pathname}?wager=${this.wager || 10}&room=${code}`;
      const wasPaused = this.paused;
      if (this.started && !wasPaused) this.paused = true;
      this.setOverlayContent(`
        <h2>Invite Friend</h2>
        <p>Share this room link so your friend can join the same wager.</p>
        <div class="gx-invite-box">
          <input type="text" id="gx-invite-url" value="${url}" readonly>
          <button class="gx-btn gx-btn-primary" id="gx-copy-link">Copy</button>
        </div>
        <div class="gx-copy-hint" id="gx-copy-hint"></div>
        <div class="gx-btn-row" style="margin-top:8px;">
          <button class="gx-btn gx-btn-secondary" id="gx-invite-close">Close</button>
        </div>
      `);
      this.showOverlay();
      document.getElementById('gx-copy-link')?.addEventListener('click', () => this.copyInviteUrl());
      document.getElementById('gx-invite-close')?.addEventListener('click', () => {
        this.hideOverlay();
        if (!wasPaused) this.paused = false;
      });
    }

    generateInviteCode() {
      return 'RM' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    copyInviteUrl() {
      const input = document.getElementById('gx-invite-url');
      if (!input) return;
      input.select();
      try {
        navigator.clipboard.writeText(input.value).then(() => {
          const hint = document.getElementById('gx-copy-hint');
          if (hint) hint.textContent = 'Copied to clipboard!';
        });
      } catch (e) {
        document.execCommand('copy');
        const hint = document.getElementById('gx-copy-hint');
        if (hint) hint.textContent = 'Copied to clipboard!';
      }
    }

    /* ---------- Fullscreen ---------- */
    toggleFullscreen() {
      const doc = document.documentElement;
      if (!document.fullscreenElement) {
        doc.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    }

    /* ---------- Exit ---------- */
    confirmExit() {
      const wasPaused = this.paused;
      if (this.started && !wasPaused) this.paused = true;
      this.setOverlayContent(`
        <h2>Leave Game?</h2>
        <p>Your current wager will be forfeited if you exit now.</p>
        <div class="gx-btn-row">
          <button class="gx-btn gx-btn-secondary" id="gx-stay-game">Stay</button>
          <button class="gx-btn gx-btn-primary gx-btn-danger" style="background:rgba(255,94,94,0.18);color:#ff5e5e;border:1px solid rgba(255,94,94,0.3);" id="gx-leave-game">Leave</button>
        </div>
      `);
      this.showOverlay();
      document.getElementById('gx-stay-game')?.addEventListener('click', () => {
        this.hideOverlay();
        if (!wasPaused) this.paused = false;
      });
      document.getElementById('gx-leave-game')?.addEventListener('click', () => {
        this.stopMatchTimer();
        this.stopTurnTimer();
        this.onExit();
      });
    }

    /* ---------- Result ---------- */
    showResult(won, detailsHTML = '', isDraw = false) {
      this.stopMatchTimer();
      this.stopTurnTimer();
      const winAmount = isDraw ? (this.wager || 0) : (won ? (this.wager || 0) * 2 : 0);
      // Draw refunds the wager (credited via the win path so the balance is restored)
      const result = window.arenaX ? window.arenaX.endGame(this.gameName, won || isDraw, winAmount, this.wager) : { balance: 0 };
      this.updateBalanceDisplay();

      if (isDraw) this.playUiClick(); else if (won) this.playWin(); else this.playLoss();

      this.setOverlayContent(`
        <h2>${isDraw ? '🤝 Draw' : (won ? '🏆 Victory!' : '😔 Defeat')}</h2>
        <p style="font-size:16px;color:${isDraw ? '#e8bc4f' : (won ? '#4de694' : '#ff5e5e')};font-weight:700;">
          ${isDraw ? `Wager refunded: +${(this.wager || 0).toLocaleString()} AX` : (won ? `+${winAmount.toLocaleString()} AX` : `-${(this.wager || 0).toLocaleString()} AX`)}
        </p>
        ${detailsHTML ? `<div style="margin:14px 0;text-align:left;background:rgba(255,255,255,0.04);padding:12px;border-radius:12px;color:#b5aa94;font-size:13px;">${detailsHTML}</div>` : ''}
        <div class="gx-balance-row" style="margin-top:8px;">
          <span class="gx-label">New balance:</span>
          <span class="gx-value">${(result.balance ?? 0).toLocaleString()}</span>
          <span class="gx-label">AX</span>
        </div>
        <div class="gx-btn-row" style="margin-top:18px;">
          <button class="gx-btn gx-btn-secondary" onclick="window.location.href='../index.html'">Lobby</button>
          <button class="gx-btn gx-btn-primary" id="gx-rematch-btn">Rematch</button>
        </div>
      `);
      this.showOverlay();
      document.getElementById('gx-rematch-btn')?.addEventListener('click', () => {
        this.hideOverlay();
        this.paused = false;
        window.location.reload();
      });
    }

    /* ---------- Overlay helpers ---------- */
    setOverlayContent(html) {
      const overlay = document.getElementById('gx-overlay');
      if (overlay) overlay.innerHTML = html;
    }

    showOverlay() {
      document.getElementById('gx-backdrop')?.classList.add('show');
    }

    hideOverlay() {
      document.getElementById('gx-backdrop')?.classList.remove('show');
    }

    /* ---------- Public game hooks ---------- */
    setTurnActive(isActive) {
      // Games may call this to reset turn timer when turn changes
      if (isActive) this.resetTurnTimer();
    }

    getWager() { return this.wager || 0; }
    getPot() { return (this.wager || 0) * 2; }
  }

  window.GameCommon = GameCommon;
})();
