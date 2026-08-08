// ==========================================
// 8 Ball Pool - Game Engine
// Physics, Cue Stick, AI, Multiplayer
// ==========================================

class Ball {
    constructor(x, y, radius, color, number, isStripe = false) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = radius;
        this.color = color;
        this.number = number;
        this.isStripe = isStripe;
        this.isPocketed = false;
        this.mass = 1;
        this.friction = 0.976;
        this.STOP_SPEED = 0.4;
    }

    update() {
        if (this.isPocketed) return;

        this.x += this.vx;
        this.y += this.vy;

        this.vx *= this.friction;
        this.vy *= this.friction;

        if (Math.abs(this.vx) < this.STOP_SPEED) this.vx = 0;
        if (Math.abs(this.vy) < this.STOP_SPEED) this.vy = 0;
    }

    isMoving() {
        return Math.abs(this.vx) > this.STOP_SPEED || Math.abs(this.vy) > this.STOP_SPEED;
    }

    draw(ctx) {
        if (this.isPocketed) return;

        const r = this.radius;
        const hx = this.x - r * 0.32;   // highlight offset (light from top-left)
        const hy = this.y - r * 0.32;

        ctx.save();

        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 3;

        // ---- Base ball fill ----
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);

        if (this.number === 0) {
            // Cue ball: plain white with soft shading
            const g = ctx.createRadialGradient(hx, hy, 0, this.x, this.y, r);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.65, '#f5f5f5');
            g.addColorStop(0.9, '#e0e0e0');
            g.addColorStop(1, '#bfbfbf');
            ctx.fillStyle = g;
            ctx.fill();
        } else if (!this.isStripe) {
            // Solid ball: whole ball coloured
            const g = ctx.createRadialGradient(hx, hy, 0, this.x, this.y, r);
            g.addColorStop(0, this.lightenColor(this.color, 60));
            g.addColorStop(0.5, this.color);
            g.addColorStop(1, this.darkenColor(this.color, 42));
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = this.darkenColor(this.color, 58);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else {
            // Stripe ball: white base, coloured band across the middle
            const g = ctx.createRadialGradient(hx, hy, 0, this.x, this.y, r);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.7, '#f2f2f2');
            g.addColorStop(1, '#c0c0c0');
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = '#9a9a9a';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.save();
            ctx.beginPath();
            ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
            ctx.clip();
            const bandGrad = ctx.createLinearGradient(0, this.y - r * 0.55, 0, this.y + r * 0.55);
            bandGrad.addColorStop(0, this.lightenColor(this.color, 30));
            bandGrad.addColorStop(0.5, this.color);
            bandGrad.addColorStop(1, this.darkenColor(this.color, 35));
            ctx.fillStyle = bandGrad;
            ctx.fillRect(this.x - r, this.y - r * 0.55, r * 2, r * 1.1);
            ctx.restore();
        }

        // ---- Number disc ----
        if (this.number !== 0) {
            ctx.shadowColor = 'transparent';
            const cr = r * 0.58;
            ctx.beginPath();
            ctx.arc(this.x, this.y, cr, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#333';
            ctx.font = `bold ${r * 0.72}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.number, this.x, this.y);
        }

        // ---- Specular highlight: makes every ball look glossy / 3D ----
        ctx.shadowColor = 'transparent';
        ctx.beginPath();
        ctx.ellipse(hx - r * 0.22, hy - r * 0.28, r * 0.3, r * 0.2, -0.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(hx - r * 0.45, hy - r * 0.5, r * 0.16, r * 0.1, -0.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fill();

        // ---- 8-ball: bright rim + glow so it never blends into the dark felt ----
        if (this.number === 8) {
            ctx.shadowColor = 'rgba(255,255,255,0.55)';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(this.x, this.y, r - 1.5, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.restore();
    }

    lightenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, (num >> 16) + amt);
        const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
        const B = Math.min(255, (num & 0x0000FF) + amt);
        return `rgb(${R}, ${G}, ${B})`;
    }

    darkenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max(0, (num >> 16) - amt);
        const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
        const B = Math.max(0, (num & 0x0000FF) - amt);
        return `rgb(${R}, ${G}, ${B})`;
    }
}

class PoolGame {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.tableWidth = 1000;
        this.tableHeight = 500;
        this.canvas.width = this.tableWidth;
        this.canvas.height = this.tableHeight;

        this.ballRadius = 12;
        this.pocketRadius = 22;
        this.cushionMargin = 30;

        this.balls = [];
        this.cueBall = null;
        this.pockets = [];

        this.gameMode = null;
        this.currentPlayer = 1;
        this.player1Type = null;
        this.player2Type = null;
        this.aiDifficulty = 'medium';
        this.lastShooter = null;

        // Aiming
        this.aimAngle = Math.PI;          // pointing left by default
        this.aimPower = 0;
        this.maxPower = 36;
        this.charging = false;
        this.chargeDirection = 1;
        this.cuePullback = 0;             // pixels cue is pulled back
        this.cueStrike = 0;               // strike animation offset (0-1)
        this.cueStriking = false;
        this.isShooting = false;          // balls are moving, waiting to settle

        // Spin (english): spinX = left(-1)/right(+1), spinY = follow(+1)/draw(-1)

        this.firstBallType = null;
        this.gameStarted = false;
        this.gameOver = false;
        this.turnTimeLimit = 30;
        this.turnTimeLeft = this.turnTimeLimit;
        this.turnTimerRunning = false;
        this.lastTurnTick = null;
        this.turnResolved = false;
        this.awaitingAITurn = false;
        this.aiShotScheduled = false;
        this.tableSettling = false;

        // --- 8-ball rule / shot-tracking state ---
        this.breakShot = true;          // true until the break is complete
        this.shotActive = false;        // true while a shot's balls are in motion
        this.shotPocketed = [];         // balls pocketed on the current shot
        this.firstHitBall = null;       // first ball the cue ball contacted
        this.anyCushion = false;        // whether any ball hit a cushion this shot
        this.player1Pocketed = [];      // ball numbers pocketed by player 1
        this.player2Pocketed = [];      // ball numbers pocketed by player 2
        this.ballInHand = false;        // true when the shooter must place the cue ball

        this.cushionBounce = 0.78;
        this.MAX_SPEED = 45;

        this.entryFee = 1;
        this.winAmount = 2;
        this.gameStartedWithBet = false;

        this.audioCtx = null;
        this.soundOn = localStorage.getItem('pool_sound') !== 'off';
        this.lastCollisionSoundAt = 0;
        this.lastCushionSoundAt = 0;
        this.chargeSoundOsc = null;
        this.chargeSoundGain = null;
        this.masterVolume = 1.55;

        this.initPockets();
        this.initBalls();
        this.setupEventListeners();
        this.updateSoundButton();
        this.gameLoop();
    }

    ensureAudio() {
        if (this.audioCtx) return this.audioCtx;
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return this.audioCtx;
    }

    beep(freq, dur, type = 'sine', vol = 0.08, when = 0) {
        if (!this.soundOn) return;
        try {
            const ctx = this.ensureAudio();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = type;
            o.frequency.value = freq;
            g.gain.setValueAtTime(vol * this.masterVolume, ctx.currentTime + when);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur);
            o.connect(g); g.connect(ctx.destination);
            o.start(ctx.currentTime + when);
            o.stop(ctx.currentTime + when + dur);
        } catch (e) {}
    }

    startChargeSound() {
        if (!this.soundOn || this.chargeSoundOsc) return;
        try {
            const ctx = this.ensureAudio();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'triangle';
            o.frequency.value = 170;
            g.gain.setValueAtTime(0.0001, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.010 * this.masterVolume, ctx.currentTime + 0.04);
            o.connect(g); g.connect(ctx.destination);
            o.start();
            this.chargeSoundOsc = o;
            this.chargeSoundGain = g;
        } catch (e) {}
    }

    updateChargeSound() {
        if (!this.soundOn || !this.chargeSoundOsc || !this.chargeSoundGain) return;
        try {
            const ctx = this.ensureAudio();
            const powerNorm = Math.max(0, Math.min(1, this.aimPower / 100));
            this.chargeSoundOsc.frequency.setTargetAtTime(170 + powerNorm * 95, ctx.currentTime, 0.045);
            this.chargeSoundGain.gain.setTargetAtTime((0.008 + powerNorm * 0.014) * this.masterVolume, ctx.currentTime, 0.05);
        } catch (e) {}
    }

    stopChargeSound() {
        if (!this.chargeSoundOsc || !this.chargeSoundGain) return;
        try {
            const ctx = this.ensureAudio();
            this.chargeSoundGain.gain.cancelScheduledValues(ctx.currentTime);
            this.chargeSoundGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.045);
            const osc = this.chargeSoundOsc;
            setTimeout(() => {
                try { osc.stop(); } catch (e) {}
            }, 120);
        } catch (e) {}
        this.chargeSoundOsc = null;
        this.chargeSoundGain = null;
    }

    playPoolSound(kind, intensity = 1) {
        const i = Math.max(0.25, Math.min(2, intensity));
        switch (kind) {
            case 'shot':
                this.beep(150 + 90 * i, 0.045, 'square', 0.095 * i);
                this.beep(86 + 24 * i, 0.16, 'triangle', 0.08, 0.015);
                this.beep(520 + 120 * i, 0.035, 'sine', 0.04, 0.01);
                break;
            case 'ballHit':
                this.beep(360 + 120 * i, 0.03, 'square', 0.05 * i);
                this.beep(620 + 80 * i, 0.018, 'triangle', 0.022 * i, 0.01);
                break;
            case 'cushion':
                this.beep(170 + 50 * i, 0.05, 'triangle', 0.04 * i);
                this.beep(115 + 24 * i, 0.08, 'sine', 0.028 * i, 0.015);
                break;
            case 'pocket':
                this.beep(240, 0.045, 'triangle', 0.08);
                this.beep(150, 0.16, 'sine', 0.07, 0.02);
                this.beep(90, 0.12, 'triangle', 0.05, 0.05);
                break;
            case 'scratch':
                this.beep(220, 0.09, 'sawtooth', 0.09);
                this.beep(140, 0.14, 'square', 0.075, 0.03);
                this.beep(90, 0.18, 'triangle', 0.07, 0.08);
                break;
            case 'foul':
                this.beep(190, 0.08, 'square', 0.075);
                this.beep(130, 0.16, 'square', 0.07, 0.05);
                this.beep(95, 0.18, 'triangle', 0.05, 0.12);
                break;
            case 'assign':
                this.beep(460, 0.05, 'triangle', 0.06);
                this.beep(680, 0.06, 'triangle', 0.06, 0.045);
                this.beep(900, 0.08, 'triangle', 0.05, 0.09);
                break;
            case 'place':
                this.beep(560, 0.03, 'sine', 0.05);
                break;
            case 'turn':
                this.beep(420, 0.04, 'sine', 0.04);
                break;
            case 'win':
                [392, 523, 659, 784, 988].forEach((f, idx) => this.beep(f, 0.2, 'triangle', 0.085, idx * 0.09));
                break;
            case 'lose':
                [349, 262, 196, 147].forEach((f, idx) => this.beep(f, 0.2, 'triangle', 0.08, idx * 0.1));
                break;
            case 'ui':
                this.beep(620, 0.03, 'sine', 0.038);
                break;
        }
    }

    updateSoundButton() {
        const btn = document.getElementById('poolSoundBtn');
        if (btn) btn.textContent = this.soundOn ? '🔊' : '🔇';
    }

    toggleSound() {
        this.soundOn = !this.soundOn;
        localStorage.setItem('pool_sound', this.soundOn ? 'on' : 'off');
        this.updateSoundButton();
        if (this.soundOn) this.playPoolSound('ui');
    }

    initPockets() {
        const m = this.cushionMargin - 6;
        this.pockets = [
            { x: m, y: m },
            { x: this.tableWidth / 2, y: m },
            { x: this.tableWidth - m, y: m },
            { x: m, y: this.tableHeight - m },
            { x: this.tableWidth / 2, y: this.tableHeight - m },
            { x: this.tableWidth - m, y: this.tableHeight - m }
        ];
    }

    initBalls() {
        this.balls = [];

        this.cueBall = new Ball(this.tableWidth * 0.22, this.tableHeight / 2, this.ballRadius, '#ffffff', 0);
        this.balls.push(this.cueBall);

        const colors = this.ballColors();

        const startX = this.tableWidth * 0.66;
        const startY = this.tableHeight / 2;
        const spacing = this.ballRadius * 2.02;

        let ballIndex = 0;
        outer:
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col <= row; col++) {
                if (ballIndex >= 15) break outer;

                const x = startX + row * spacing * 0.866;
                const y = startY + (col - row / 2) * spacing;

                const ballNumber = ballIndex + 1;
                const isStripe = ballNumber > 8 && ballNumber < 15;

                const ball = new Ball(x, y, this.ballRadius, colors[ballIndex], ballNumber, isStripe);
                this.balls.push(ball);

                ballIndex++;
            }
        }
    }

    setupEventListeners() {
        const stop = (e) => e.preventDefault();

        // Mouse controls
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('contextmenu', stop);

        // Touch controls (mobile)
        this.canvas.addEventListener('touchstart', (e) => { stop(e); this.handleMouseDown(e); }, { passive: false });
        this.canvas.addEventListener('touchmove', (e) => { stop(e); this.handleMouseMove(e); }, { passive: false });
        this.canvas.addEventListener('touchend', (e) => { stop(e); this.handleMouseUp(e); }, { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => { stop(e); this.handleMouseUp(e); }, { passive: false });

        document.getElementById('resetBtn').addEventListener('click', () => { this.playPoolSound('ui'); this.resetGame(); });
        document.getElementById('quitBtn').addEventListener('click', () => { this.playPoolSound('ui'); this.quitGame(); });
        const soundBtn = document.getElementById('poolSoundBtn');
        if (soundBtn) soundBtn.addEventListener('click', () => this.toggleSound());

        // Orientation prompt for portrait mobile
        this.updateOrientation();
        window.addEventListener('resize', () => this.updateOrientation());
        window.addEventListener('orientationchange', () => this.updateOrientation());
    }

    updateOrientation() {
        const overlay = document.getElementById('rotateOverlay');
        if (!overlay) return;
        const portrait = window.innerHeight > window.innerWidth;
        const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
        const touchDevice = (navigator.maxTouchPoints > 0) || ('ontouchstart' in window) || coarse;
        const small = window.innerWidth < 1024;
        overlay.classList.toggle('show', portrait && touchDevice && small);
    }

    // Shared ball colour palette (index 0 = 1-ball ... index 14 = 8-ball)
    ballColors() {
        return [
            // 1-7 solids
            '#FFC107', '#3B82F6', '#E31837', '#8B5CF6', '#F26522', '#22C55E', '#B45309',
            // 8-ball (black)
            '#111111',
            // 9-15 stripes
            '#FFC107', '#3B82F6', '#E31837', '#8B5CF6', '#F26522', '#22C55E', '#B45309'
        ];
    }

    getBallColor(number) {
        if (number <= 0) return '#ffffff';
        return this.ballColors()[number - 1] || '#ffffff';
    }

    // ========== Mouse Controls ==========

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.tableWidth / rect.width;
        const scaleY = this.tableHeight / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    handleMouseMove(e) {
        const pos = this.getMousePos(e);

        // Ball in hand: ghost cue ball follows the cursor
        if (this.ballInHand) {
            this.placementPos = pos;
            return;
        }

        if (!this.canAim() || this.cueBall.isPocketed) return;

        const dx = pos.x - this.cueBall.x;
        const dy = pos.y - this.cueBall.y;

        if (Math.abs(dx) + Math.abs(dy) > 3) {
            this.aimAngle = Math.atan2(dy, dx);
        }
    }

    handleMouseDown(e) {
        const isTouch = 'touches' in e;
        if (!isTouch && e.button !== 0) return;

        // Ball in hand: click to place the cue ball
        if (this.ballInHand) {
            this.placeCueBallAt(this.placementPos || this.getMousePos(e));
            return;
        }

        if (!this.canAim() || this.cueBall.isPocketed) return;

        this.charging = true;
        this.aimPower = 5;
        this.chargeDirection = 1;
        this.startChargeSound();
        this.updateChargeSound();
    }

    handleMouseUp(e) {
        const isTouch = 'touches' in e;
        if (!isTouch && e.button !== 0) return;
        if (!this.charging) return;

        this.charging = false;
        this.stopChargeSound();
        this.shoot();
    }

    updatePowerBar() {
        const power = Math.max(0, Math.min(100, this.aimPower));   // hard clamp 0-100
        const fill = document.getElementById('powerFill');
        const pct = document.getElementById('powerPercentage');
        if (fill) fill.style.height = power + '%';    // vertical meter
        if (pct) pct.textContent = Math.round(power) + '%';
    }

    shoot() {
        const power = (this.aimPower / 100) * this.maxPower;
        if (power < 1.5) { this.aimPower = 0; this.stopChargeSound(); return; }

        this._pendingShot = { angle: this.aimAngle, power: power };
        this.cueStriking = true;
        this.cueStrike = 0;
        this._shotFired = false;
        this.aimPower = 0;
        this.updatePowerBar();
    }

    fireShot() {
        if (!this._pendingShot) return;
        const s = this._pendingShot;
        this._pendingShot = null;
        this.cueStriking = false;
        this.cueStrike = 1;
        this.isShooting = true;
        this.lastShooter = this.currentPlayer;
        this.playPoolSound('shot', Math.max(0.4, s.power / this.maxPower));

        // Begin shot-tracking for rule evaluation
        this.shotActive = true;
        this.shotPocketed = [];
        this.firstHitBall = null;
        this.anyCushion = false;

        this.cueBall.vx = Math.cos(s.angle) * s.power;
        this.cueBall.vy = Math.sin(s.angle) * s.power;
    }

    // ========== Input Guards ==========

    canAim() {
        if (this.gameOver) return false;
        if (this.cueBall.isPocketed) return false;
        if (this.isShooting) return false;
        if (this.cueStriking) return false;
        if (this.awaitingAITurn) return false;

        for (let ball of this.balls) {
            if (ball.isMoving()) return false;
        }

        if (this.gameMode === 'ai' && this.currentPlayer === 2) return false;

        return true;
    }

    // ========== Physics ==========

    update(dt) {
        // Update balls with friction scaled by dt.
        // 6 substeps keeps fast balls from tunnelling through each other
        // (max speed ~45px/frame would otherwise move >1 ball-width per step).
        const steps = 6;
        for (let s = 0; s < steps; s++) {
            for (let ball of this.balls) {
                if (ball.isPocketed) continue;
                // Ball in hand: the ghost cue ball must not move or touch anything
                if (this.ballInHand && ball === this.cueBall) continue;
                ball.x += ball.vx / steps;
                ball.y += ball.vy / steps;
                // Friction is applied per substep, so scale it by the substep duration.
                const fr = Math.pow(ball.friction, (dt / steps) / (1000 / 60));
                ball.vx *= fr;
                ball.vy *= fr;
                if (Math.abs(ball.vx) < ball.STOP_SPEED) ball.vx = 0;
                if (Math.abs(ball.vy) < ball.STOP_SPEED) ball.vy = 0;

            }
            this.checkCollisions();
            this.checkCushions();
            this.checkPockets();
        }

        this.checkSettleState();
        this.manageAITurn();
    }

    checkCollisions() {
        for (let i = 0; i < this.balls.length; i++) {
            for (let j = i + 1; j < this.balls.length; j++) {
                const b1 = this.balls[i];
                const b2 = this.balls[j];
                if (b1.isPocketed || b2.isPocketed) continue;
                // Ball in hand: ghost cue ball must not knock balls around
                if (this.ballInHand && (b1 === this.cueBall || b2 === this.cueBall)) continue;

                const dx = b2.x - b1.x;
                const dy = b2.y - b1.y;
                const distSq = dx * dx + dy * dy;
                const minDist = b1.radius + b2.radius;

                if (distSq < minDist * minDist && distSq > 0) {
                    this.resolveBallCollision(b1, b2, Math.sqrt(distSq));
                }
            }
        }
    }

    resolveBallCollision(b1, b2, distance) {
        const dx = b2.x - b1.x;
        const dy = b2.y - b1.y;
        const nx = dx / distance;
        const ny = dy / distance;

        const overlap = (b1.radius + b2.radius) - distance;
        b1.x -= nx * overlap * 0.5;
        b1.y -= ny * overlap * 0.5;
        b2.x += nx * overlap * 0.5;
        b2.y += ny * overlap * 0.5;

        // Track the first ball the cue ball contacts (for foul rules)
        if (this.shotActive && !this.firstHitBall) {
            if (b1 === this.cueBall) this.firstHitBall = b2;
            else if (b2 === this.cueBall) this.firstHitBall = b1;
        }

        const rvx = b2.vx - b1.vx;
        const rvy = b2.vy - b1.vy;
        const velAlongNormal = rvx * nx + rvy * ny;

        if (velAlongNormal > 0) return;

        const restitution = 0.92;
        const impulse = (-(1 + restitution) * velAlongNormal) / (1 / b1.mass + 1 / b2.mass);

        b1.vx -= impulse * nx / b1.mass;
        b1.vy -= impulse * ny / b1.mass;
        b2.vx += impulse * nx / b2.mass;
        b2.vy += impulse * ny / b2.mass;

        const hitPower = Math.abs(velAlongNormal);
        const now = performance.now();
        if (hitPower > 1.2 && now - this.lastCollisionSoundAt > 35) {
            this.lastCollisionSoundAt = now;
            this.playPoolSound('ballHit', hitPower / 12);
        }
    }

    // True if a ball is within the pocket's capture zone (so it can roll into it)
    isNearPocket(ball) {
        for (const p of this.pockets) {
            if (Math.hypot(ball.x - p.x, ball.y - p.y) < this.pocketRadius + 22) return true;
        }
        return false;
    }

    checkCushions() {
        const m = this.cushionMargin;
        for (let ball of this.balls) {
            if (ball.isPocketed) continue;
            // Ball in hand: ghost cue ball is not on the table yet
            if (this.ballInHand && ball === this.cueBall) continue;

            // Don't bounce balls that are rolling into a pocket mouth
            if (this.isNearPocket(ball)) continue;

            const r = ball.radius;
            const kick = 0;
            if (ball.x - r < m) {
                const speed = Math.abs(ball.vx);
                ball.x = m + r; ball.vx = Math.abs(ball.vx) * this.cushionBounce; ball.vy += kick; this.anyCushion = true;
                const now = performance.now();
                if (speed > 1.8 && now - this.lastCushionSoundAt > 45) { this.lastCushionSoundAt = now; this.playPoolSound('cushion', speed / 12); }
            }
            else if (ball.x + r > this.tableWidth - m) {
                const speed = Math.abs(ball.vx);
                ball.x = this.tableWidth - m - r; ball.vx = -Math.abs(ball.vx) * this.cushionBounce; ball.vy += kick; this.anyCushion = true;
                const now = performance.now();
                if (speed > 1.8 && now - this.lastCushionSoundAt > 45) { this.lastCushionSoundAt = now; this.playPoolSound('cushion', speed / 12); }
            }
            if (ball.y - r < m) {
                const speed = Math.abs(ball.vy);
                ball.y = m + r; ball.vy = Math.abs(ball.vy) * this.cushionBounce; ball.vx += kick; this.anyCushion = true;
                const now = performance.now();
                if (speed > 1.8 && now - this.lastCushionSoundAt > 45) { this.lastCushionSoundAt = now; this.playPoolSound('cushion', speed / 12); }
            }
            else if (ball.y + r > this.tableHeight - m) {
                const speed = Math.abs(ball.vy);
                ball.y = this.tableHeight - m - r; ball.vy = -Math.abs(ball.vy) * this.cushionBounce; ball.vx += kick; this.anyCushion = true;
                const now = performance.now();
                if (speed > 1.8 && now - this.lastCushionSoundAt > 45) { this.lastCushionSoundAt = now; this.playPoolSound('cushion', speed / 12); }
            }
        }
    }

    checkPockets() {
        for (let ball of this.balls) {
            if (ball.isPocketed) continue;
            // Ball in hand: ghost cue ball must not be pocketed while dragging
            if (this.ballInHand && ball === this.cueBall) continue;

            for (let pocket of this.pockets) {
                const dx = pocket.x - ball.x;
                const dy = pocket.y - ball.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < this.pocketRadius) {
                    this.pocketBall(ball);
                    break;
                } else if (dist < this.pocketRadius + 22) {
                    // Capture zone: steer the ball into the pocket mouth.
                    // Moderate strength — good aim pots reliably, sloppy aim misses.
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const depth = (this.pocketRadius + 22 - dist) / 22;
                    const speed = Math.hypot(ball.vx, ball.vy);
                    const pull = depth * (2.5 + speed * 0.09);
                    ball.x += nx * pull;
                    ball.y += ny * pull;
                    const blend = Math.min(0.7, 0.28 + depth * 0.45);
                    const targetSpeed = Math.max(speed, 1.5);
                    ball.vx = nx * targetSpeed * blend + ball.vx * (1 - blend);
                    ball.vy = ny * targetSpeed * blend + ball.vy * (1 - blend);
                }
            }
        }
    }

    pocketBall(ball) {
        ball.isPocketed = true;
        ball.vx = 0;
        ball.vy = 0;

        if (this.shotActive) this.shotPocketed.push(ball);

        if (ball === this.cueBall) {
            this.playPoolSound('scratch');
            this.showMessage('Scratch! Cue ball pocketed');
        } else {
            this.playPoolSound('pocket');
            this.showMessage(`Ball ${ball.number} pocketed!`);
        }
    }

    anyBallMoving() {
        return this.balls.some(b => b.isMoving());
    }

    // ========== Turn Management ==========

    checkSettleState() {
        if (this.gameOver) return;
        if (!this.gameStarted) return;

        const moving = this.anyBallMoving();
        const settling = this.tableSettling;

        if (!moving && settling) {
            // Just settled
            this.tableSettling = false;
            this.isShooting = false;
            this.turnResolved = false;
            this.handleTurnEnd();
        } else if (moving && !settling) {
            this.tableSettling = true;
        }
    }

    handleTurnEnd() {
        if (this.gameOver || this.turnResolved) return;
        this.turnResolved = true;
        this.shotActive = false;
        this.breakShot = false;

        const shooter = this.lastShooter || this.currentPlayer;
        this.currentPlayer = shooter;
        const opp = this.opponentOf(shooter);
        const cuePocketed = this.cueBall.isPocketed;

        // ---- 8-ball pocketed this shot -> win/loss ----
        const eight = this.shotPocketed.find(b => b.number === 8);
        if (eight) {
            const cleared = this.getPlayerBallsRemaining(shooter) === 0;
            if (cleared && !cuePocketed) {
                this.showMessage('8-ball sunk! You win! 🎉');
                this.endGame(shooter);
            } else {
                this.showMessage(cleared ? 'Scratch on the 8-ball — you lose!' : '8-ball pocketed too early — you lose!');
                this.endGame(opp);
            }
            this.updatePlayerBalls();
            this.renderPocketedBalls();
            return;
        }

        const pocketed = this.shotPocketed.filter(b => b.number !== 0 && b.number !== 8);

        // ---- group assignment on the first legal pocket ----
        const assigningFirstType = this.firstBallType === null && pocketed.length > 0 && !cuePocketed;
        if (assigningFirstType) {
            this.assignBallType(pocketed[0]);
        }

        const type = shooter === 1 ? this.player1Type : this.player2Type;

        // On the first scoring shot, the shooter legally owns that first potted group.
        // Treat it as their own-pocket result immediately so AI and player both keep turn.
        let pocketedOwn = assigningFirstType;

        // ---- foul detection ----
        let foul = false;
        let foulMsg = '';
        const clearedGroup = type && this.getPlayerBallsRemaining(shooter) === 0;
        if (cuePocketed) { foul = true; foulMsg = 'Scratch!'; }
        else if (this.firstHitBall && this.firstHitBall.number === 8 && type && !clearedGroup) { foul = true; foulMsg = 'Hit the 8-ball first!'; }
        else if (type && this.firstHitBall && !this.isMatching(this.firstHitBall, type)) { foul = true; foulMsg = 'Hit the wrong ball first!'; }
        else if (type && pocketed.length === 0 && !this.anyCushion) { foul = true; foulMsg = 'No cushion, no pocket!'; }

        for (const b of pocketed) if (this.isMatching(b, type)) pocketedOwn = true;

        if (foul) {
            this.playPoolSound('foul');
            this.showMessage(`${foulMsg} Foul on ${shooter === 1 ? 'Player 1' : 'Player 2'} — ball in hand!`);
        }

        // ---- ball in hand for the opponent on ANY foul (not just a scratch) ----
        if (foul || cuePocketed) {
            this.setBallInHandFor(opp);
        } else {
            this.cueBall.isPocketed = false;
        }

        // ---- continuation: keep the turn if a legal shot pocketed own ball.
        // After the first scoring shot, `pocketedOwn` is forced true for that shooter,
        // so AI and player both correctly retain the table.
        const keepTurn = !foul && pocketedOwn;
        if (!keepTurn) {
            this.currentPlayer = opp;
            this.updatePlayerCards();
        }

        this.currentPlayer = keepTurn ? shooter : opp;
        this.updatePlayerCards();
        if (!foul && !keepTurn) this.playPoolSound('turn');
        this.startTurnTimer();
        this.updatePlayerBalls();
        this.renderPocketedBalls();
    }

    opponentOf(player) {
        return player === 1 ? 2 : 1;
    }

    isMatching(ball, group) {
        if (!group) return false;
        if (ball.number === 0 || ball.number === 8) return false;
        if (group === 'solids') return !ball.isStripe;
        if (group === 'stripes') return ball.isStripe;
        return false;
    }

    // Ball-in-hand: place the cue ball after a foul/scratch
    setBallInHandFor(player) {
        this.ballInHand = true;
        this.cueBall.isPocketed = false;
        this.cueBall.vx = 0;
        this.cueBall.vy = 0;
        this.placementPos = null;
        this.isShooting = false;

        if (this.gameMode === 'ai' && player === 2) {
            this.placeCueBallAt(this.randomFreeSpot());
            this.ballInHand = false;
        } else {
            this.showMessage('Ball in hand — click on the table to place the cue ball');
        }
    }

    randomFreeSpot() {
        // Prefer the kitchen/baulk side so AI never places the cue ball near pockets.
        const pad = this.cushionMargin + this.ballRadius;
        const kitchenMinX = pad;
        const kitchenMaxX = this.tableWidth * 0.38;
        const kitchenMinY = pad + this.ballRadius;
        const kitchenMaxY = this.tableHeight - pad - this.ballRadius;
        const pocketSafe = this.pocketRadius + this.ballRadius + 40;

        for (let tries = 0; tries < 120; tries++) {
            const x = kitchenMinX + Math.random() * Math.max(10, (kitchenMaxX - kitchenMinX));
            const y = kitchenMinY + Math.random() * Math.max(10, (kitchenMaxY - kitchenMinY));
            if (this.pockets.some(p => Math.hypot(p.x - x, p.y - y) < pocketSafe)) continue;
            let free = true;
            for (const b of this.balls) {
                if (b === this.cueBall || b.isPocketed) continue;
                if (Math.hypot(b.x - x, b.y - y) < this.ballRadius * 2 + 8) { free = false; break; }
            }
            if (free) return { x, y };
        }

        return { x: this.tableWidth * 0.22, y: this.tableHeight / 2 };
    }

    placeCueBallAt(pos) {
        if (!pos) return;
        const pad = this.cushionMargin + this.ballRadius;
        const x = Math.max(pad, Math.min(this.tableWidth - pad, pos.x));
        const y = Math.max(pad, Math.min(this.tableHeight - pad, pos.y));
        for (const b of this.balls) {
            if (b === this.cueBall || b.isPocketed) continue;
            if (Math.hypot(b.x - x, b.y - y) < this.ballRadius * 2) return;
        }
        this.cueBall.x = x;
        this.cueBall.y = y;
        this.cueBall.isPocketed = false;
        this.ballInHand = false;
        this.isShooting = false;
        this.playPoolSound('place');
    }

    endTurn() {
        this.currentPlayer = this.opponentOf(this.currentPlayer);
        this.updatePlayerCards();
    }

    manageAITurn() {
        if (this.gameOver) return;
        if (this.gameMode !== 'ai') return;
        if (this.currentPlayer !== 2) return;
        if (this.awaitingAITurn) return;
        if (this.aiShotScheduled) return;
        if (this.isShooting) return;
        if (this.anyBallMoving()) return;
        if (this.cueBall.isPocketed) return;

        // Small delay so it feels natural
        this.awaitingAITurn = true;
        setTimeout(() => {
            this.awaitingAITurn = false;
            this.aiShoot();
        }, 700);
    }

    placeCueBall() {
        this.cueBall.isPocketed = false;
        this.cueBall.x = this.tableWidth * 0.22;
        this.cueBall.y = this.tableHeight / 2;
        this.cueBall.vx = 0;
        this.cueBall.vy = 0;
        this.isShooting = false;
        this.ballInHand = false;
        this.endTurn();
    }

    // ========== Rules ==========

    assignBallType(ball) {
        if (this.firstBallType !== null || ball.number === 8) return;

        this.firstBallType = ball.isStripe ? 'stripes' : 'solids';

        if (this.currentPlayer === 1) {
            this.player1Type = this.firstBallType;
            this.player2Type = this.firstBallType === 'solids' ? 'stripes' : 'solids';
        } else {
            this.player2Type = this.firstBallType;
            this.player1Type = this.firstBallType === 'solids' ? 'stripes' : 'solids';
        }

        document.getElementById('player1Type').textContent = this.player1Type === 'solids' ? 'Solids' : 'Stripes';
        document.getElementById('player2Type').textContent = this.player2Type === 'solids' ? 'Solids' : 'Stripes';
        this.playPoolSound('assign');
        this.showMessage(`Groups decided — Player 1: ${document.getElementById('player1Type').textContent}, Player 2: ${document.getElementById('player2Type').textContent}`);
        this.updatePlayerBalls();
        this.renderPocketedBalls();
    }

    getPlayerBallsRemaining(player) {
        const type = player === 1 ? this.player1Type : this.player2Type;
        if (!type) return 7;

        let count = 0;
        for (let ball of this.balls) {
            if (ball.number === 0 || ball.number === 8) continue;
            const ballType = ball.isStripe ? 'stripes' : 'solids';
            if (ballType === type && !ball.isPocketed) count++;
        }
        return count;
    }

    updatePlayerBalls() {
        const p1Wrap = document.getElementById('player1Balls');
        const p2Wrap = document.getElementById('player2Balls');
        if (!p1Wrap || !p2Wrap) return;

        const renderRack = (player, wrap) => {
            const type = player === 1 ? this.player1Type : this.player2Type;
            wrap.innerHTML = '';

            if (!type) {
                const txt = document.createElement('span');
                txt.style.color = '#9a9a9a';
                txt.style.fontSize = '12px';
                txt.textContent = 'Yet to decide';
                wrap.appendChild(txt);
                return;
            }

            const nums = type === 'solids' ? [1,2,3,4,5,6,7] : [9,10,11,12,13,14,15];
            for (const n of nums) {
                const b = this.balls.find(ball => ball.number === n);
                if (!b || b.isPocketed) continue;
                wrap.appendChild(this.makePlayerCardBall(n));
            }

            const eight = this.balls.find(ball => ball.number === 8);
            if (eight && !eight.isPocketed) {
                wrap.appendChild(this.makePlayerCardBall(8));
            }
        };

        renderRack(1, p1Wrap);
        renderRack(2, p2Wrap);
    }

    // Fill the two tubes with each player's pocketed balls (solid/stripe look)
    renderPocketedBalls() {
        const p1Type = this.player1Type;
        const p2Type = this.player2Type;
        const t1 = document.getElementById('player1Tube');
        const t2 = document.getElementById('player2Tube');
        if (!t1 || !t2) return;
        t1.innerHTML = '';
        t2.innerHTML = '';

        if (!p1Type && !p2Type) return;

        for (const b of this.balls) {
            if (b.number === 0 || b.number === 8 || !b.isPocketed) continue;
            const g = b.isStripe ? 'stripes' : 'solids';
            if (g === p1Type) t1.appendChild(this.makeBallDot(b.number));
            if (g === p2Type) t2.appendChild(this.makeBallDot(b.number));
        }
    }

    makeBallDot(number) {
        const d = document.createElement('div');
        d.className = 'pocketed-ball';
        const c = this.getBallColor(number);
        if (number > 8 && number < 15) {
            // Stripe: white base, coloured band, white number
            d.style.background = `linear-gradient(#eee 0%, #eee 30%, ${c} 30%, ${c} 70%, #eee 70%, #eee 100%)`;
            d.textContent = number;
        } else {
            // Solid: coloured ball, white number disc
            d.style.background = c;
            const span = document.createElement('span');
            span.className = 'pocketed-num';
            span.textContent = number;
            d.appendChild(span);
        }
        return d;
    }

    makePlayerCardBall(number) {
        const d = document.createElement('div');
        const isStripe = number > 8 && number < 16;
        const cls = number === 8 ? 'eight' : (isStripe ? 'stripe' : 'solid');
        d.className = `player-card-ball ${cls}`;
        d.dataset.num = String(number);
        d.style.setProperty('--ball-color', this.getBallColor(number));
        return d;
    }

    handleEightBall() {
        const currentType = this.currentPlayer === 1 ? this.player1Type : this.player2Type;
        const remaining = this.getPlayerBallsRemaining(this.currentPlayer);
        const winner = remaining === 0 ? this.currentPlayer : (this.currentPlayer === 1 ? 2 : 1);
        this.endGame(winner);
    }

    updatePlayerCards() {
        document.getElementById('player1Card').classList.toggle('active', this.currentPlayer === 1);
        document.getElementById('player2Card').classList.toggle('active', this.currentPlayer === 2);
    }

    startTurnTimer() {
        this.turnTimeLeft = this.turnTimeLimit;
        this.turnTimerRunning = true;
        this.lastTurnTick = performance.now();
        this.updateTurnTimerUI();
    }

    stopTurnTimer() {
        this.turnTimerRunning = false;
        this.updateTurnTimerUI();
    }

    updateTurnTimerUI() {
        const p1 = document.getElementById('player1Timer');
        const p2 = document.getElementById('player2Timer');
        if (!p1 || !p2) return;

        p1.textContent = this.currentPlayer === 1 ? `${Math.ceil(this.turnTimeLeft)}s` : '30s';
        p2.textContent = this.currentPlayer === 2 ? `${Math.ceil(this.turnTimeLeft)}s` : '30s';
        p1.classList.toggle('low', this.currentPlayer === 1 && this.turnTimeLeft <= 8);
        p2.classList.toggle('low', this.currentPlayer === 2 && this.turnTimeLeft <= 8);
    }

    // ========== AI ==========

    aiShoot() {
        if (this.gameOver) return;
        if (this.cueBall.isPocketed) return;

        const targets = this.getAITargetBalls();
        if (targets.length === 0) return;

        // Pick the best clear shot to a pocket
        const shot = this.findBestShot(targets);
        const target = shot.target;
        const pocket = shot.pocket;

        // Aim: cue ball should hit the GHOST-BALL CENTRE (2 radii from the target,
        // on the side opposite the pocket) so the target travels straight toward it.
        const tdx = (pocket.x - target.x) / (Math.hypot(pocket.x - target.x, pocket.y - target.y) || 1);
        const tdy = (pocket.y - target.y) / (Math.hypot(pocket.x - target.x, pocket.y - target.y) || 1);
        const contactR = target.radius + this.cueBall.radius;
        const ghostX = target.x - tdx * contactR;
        const ghostY = target.y - tdy * contactR;

        let aimAngle = Math.atan2(ghostY - this.cueBall.y, ghostX - this.cueBall.x);

        const targetPotChance = { easy: 0.30, medium: 0.70, hard: 0.90 }[this.aiDifficulty] || 0.70;
        const aiWillPot = Math.random() < targetPotChance;

        const accuracyErr = {
            easy: 0.34, medium: 0.09, hard: 0.01
        }[this.aiDifficulty] || 0.09;
        aimAngle += (Math.random() - 0.5) * 2 * accuracyErr;

        // Power scaled by shot length, with difficulty-aware consistency.
        const shootDist = Math.hypot(ghostX - this.cueBall.x, ghostY - this.cueBall.y);
        const targetDist = Math.hypot(pocket.x - target.x, pocket.y - target.y);
        const powerPct = Math.min(0.98, Math.max(0.62, 0.62 + (shootDist + targetDist) / 1500));
        let finalPower = Math.min(this.MAX_SPEED, powerPct * this.maxPower);
        const displayPower = Math.max(28, Math.min(100, Math.round((finalPower / this.maxPower) * 100)));

        // Show AI aiming briefly (draw cue) then shoot
        if (!aiWillPot) {
            aimAngle += (Math.random() - 0.5) * 0.45;
            finalPower *= 0.9 + Math.random() * 0.18;
        } else if (this.aiDifficulty === 'hard') {
            finalPower *= 0.98;
        }

        this.aimAngle = aimAngle;
        this.aimPower = 0;
        this.aiAiming = {
            angle: aimAngle,
            until: performance.now() + 1400,
            power: displayPower,
            startedAt: performance.now()
        };
        this.aiShotScheduled = true;

        setTimeout(() => {
            if (this.gameOver) return;
            this.aiShotScheduled = false;
            this.isShooting = true;
            this.stopTurnTimer();
            this.lastShooter = this.currentPlayer;
            this.shotActive = true;
            this.shotPocketed = [];
            this.firstHitBall = null;
            this.anyCushion = false;
            this.cueBall.vx = Math.cos(aimAngle) * finalPower;
            this.cueBall.vy = Math.sin(aimAngle) * finalPower;
            this.aimPower = 0;
            this.updatePowerBar();
        }, 1400);
    }

    // Evaluate every (target, pocket) pair and return the best clear shot.
    findBestShot(targets) {
        let best = null;
        let bestScore = -Infinity;

        for (const target of targets) {
            for (const pocket of this.pockets) {
                const score = this.evaluateShot(target, pocket);
                if (score > bestScore) {
                    bestScore = score;
                    best = { target, pocket };
                }
            }
        }

        // Fallback: no perfectly clear shot — difficulty affects how stubbornly
        // the AI insists on a good line versus settling for a rough attempt.
        if (!best && this.aiDifficulty === 'hard') {
            best = this.findStrategicShot(targets);
        }

        // Fallback: no perfectly clear shot — pick the LEAST-BAD shot (best
        // alignment + shortest distance, penalised for blockers) so the AI at
        // least plays its best available option instead of a blind shot.
        if (!best) {
            let best2 = null;
            let bestScore2 = -Infinity;
            for (const target of targets) {
                for (const pocket of this.pockets) {
                    const score = this.evaluateShotRelaxed(target, pocket);
                    if (score > bestScore2) {
                        bestScore2 = score;
                        best2 = { target, pocket };
                    }
                }
            }
            if (best2) return best2;

            // Absolute fallback: nearest target toward its nearest pocket
            let nearest = targets[0];
            let nd = Infinity;
            for (const t of targets) {
                const d = Math.hypot(t.x - this.cueBall.x, t.y - this.cueBall.y);
                if (d < nd) { nd = d; nearest = t; }
            }
            let np = this.pockets[0];
            let pd = Infinity;
            for (const p of this.pockets) {
                const d = Math.hypot(p.x - nearest.x, p.y - nearest.y);
                if (d < pd) { pd = d; np = p; }
            }
            return { target: nearest, pocket: np };
        }

        return best;
    }

    findStrategicShot(targets) {
        let best = null;
        let bestScore = -Infinity;
        for (const target of targets) {
            for (const pocket of this.pockets) {
                const score = this.evaluateShotRelaxed(target, pocket) + 12;
                if (score > bestScore) {
                    bestScore = score;
                    best = { target, pocket };
                }
            }
        }
        return best;
    }

    // Score how good it is to pot `target` into `pocket`.
    // Rewards shots that are CLEAR, CLOSE, and ALIGNED (near head-on), because
    // steep cut shots graze the ball and rarely pot. Returns -Infinity if blocked.
    evaluateShot(target, pocket) {
        const tdx = pocket.x - target.x;
        const tdy = pocket.y - target.y;
        const tl = Math.hypot(tdx, tdy) || 1;
        const nx = tdx / tl;
        const ny = tdy / tl;

        // Ghost-ball centre: where the cue ball must be at impact
        const contactR = target.radius + this.cueBall.radius;
        const ghostX = target.x - nx * contactR;
        const ghostY = target.y - ny * contactR;

        // Target-to-pocket line must be truly clear (2 radii of room, or the
        // target clips a ball and deflects off the pocket mouth)
        if (this.segmentBlocked(target.x, target.y, pocket.x, pocket.y, [target], 2.1)) return -Infinity;
        // Cue-to-ghost line must be truly clear
        if (this.segmentBlocked(this.cueBall.x, this.cueBall.y, ghostX, ghostY, [this.cueBall, target], 2.1)) return -Infinity;

        // Alignment: how closely the cue-ball path matches the contact direction.
        // 1 = dead-on hit (full energy transfer), 0 = full cut (grazing, weak).
        let cueDx = ghostX - this.cueBall.x;
        let cueDy = ghostY - this.cueBall.y;
        const cueLen = Math.hypot(cueDx, cueDy) || 1;
        cueDx /= cueLen;
        cueDy /= cueLen;
        const align = Math.abs(cueDx * nx + cueDy * ny);

        // Reject shots that are too much of a cut (they almost never pot)
        if (align < 0.45) return -Infinity;

        const targetDist = Math.hypot(pocket.x - target.x, pocket.y - target.y);
        const shootDist = Math.hypot(ghostX - this.cueBall.x, ghostY - this.cueBall.y);

        // Prefer highly-aligned, close shots
        return align * 300 - targetDist - 0.5 * shootDist;
    }

    // Looser scoring used only when no clean shot exists — penalises blockers
    // instead of rejecting them, so the AI plays its least-bad option.
    evaluateShotRelaxed(target, pocket) {
        const tdx = pocket.x - target.x;
        const tdy = pocket.y - target.y;
        const tl = Math.hypot(tdx, tdy) || 1;
        const nx = tdx / tl;
        const ny = tdy / tl;
        const contactR = target.radius + this.cueBall.radius;
        const ghostX = target.x - nx * contactR;
        const ghostY = target.y - ny * contactR;

        let cueDx = ghostX - this.cueBall.x;
        let cueDy = ghostY - this.cueBall.y;
        const cueLen = Math.hypot(cueDx, cueDy) || 1;
        cueDx /= cueLen;
        cueDy /= cueLen;
        const align = Math.abs(cueDx * nx + cueDy * ny);

        let score = align * 200 - Math.hypot(pocket.x - target.x, pocket.y - target.y);
        if (this.segmentBlocked(target.x, target.y, pocket.x, pocket.y, [target], 1.0)) score -= 300;
        if (this.segmentBlocked(this.cueBall.x, this.cueBall.y, ghostX, ghostY, [this.cueBall, target], 1.0)) score -= 300;
        return score;
    }

    distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = x1 + t * dx;
        const cy = y1 + t * dy;
        return Math.hypot(px - cx, py - cy);
    }

    segmentBlocked(x1, y1, x2, y2, ignores, tolerance = 1.7) {
        for (const b of this.balls) {
            if (b.isPocketed) continue;
            if (ignores && ignores.includes(b)) continue;
            const d = this.distanceToSegment(b.x, b.y, x1, y1, x2, y2);
            if (d < b.radius * tolerance) return true;
        }
        return false;
    }

    getAITargetBalls() {
        const type = this.player2Type;
        if (!type) {
            return this.balls.filter(b => b.number > 0 && b.number < 8 && !b.isPocketed);
        }
        // If the AI has cleared its group, go for the 8-ball
        if (this.getPlayerBallsRemaining(2) === 0) {
            const eight = this.balls.find(b => b.number === 8 && !b.isPocketed);
            return eight ? [eight] : [];
        }
        return this.balls.filter(ball => {
            if (ball.number === 0 || ball.number === 8 || ball.isPocketed) return false;
            const ballType = ball.isStripe ? 'stripes' : 'solids';
            return ballType === type;
        });
    }

    // ========== Drawing ==========

    draw() {
        this.ctx.clearRect(0, 0, this.tableWidth, this.tableHeight);

        this.drawWoodFrame();
        this.drawTableFelt();
        this.drawBalls();
        this.drawPockets();

        // Ball in hand: show a placement ring instead of the aim line / cue
        if (this.ballInHand) {
            this.drawBallInHandRing();
            return;
        }

        if (this.canAim()) {
            this.drawAimLine();
        }

        if (this.aiAiming && performance.now() < this.aiAiming.until) {
            const prev = this.aimAngle;
            this.aimAngle = this.aiAiming.angle;
            this.drawAimLine();
            this.drawCueStick();
            this.aimAngle = prev;
        }

        // Show the cue stick while aiming AND while striking (so it visibly hits the ball)
        if (this.canAim() || this.cueStriking) {
            this.drawCueStick();
        }
    }

    drawBallInHandRing() {
        if (!this.cueBall) return;
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255,215,130,0.9)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([6, 6]);
        this.ctx.beginPath();
        this.ctx.arc(this.cueBall.x, this.cueBall.y, this.ballRadius + 5, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        this.ctx.fillStyle = 'rgba(255,215,130,0.25)';
        this.ctx.beginPath();
        this.ctx.arc(this.cueBall.x, this.cueBall.y, this.ballRadius + 12, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
    }

    drawWoodFrame() {
        const frameWidth = 26;
        const outer = this.ctx.createLinearGradient(0, 0, 0, this.tableHeight);
        outer.addColorStop(0, '#6b3a1f');
        outer.addColorStop(0.5, '#8a4a2a');
        outer.addColorStop(1, '#5a3018');
        this.ctx.fillStyle = outer;
        this.ctx.fillRect(0, 0, this.tableWidth, this.tableHeight);

        // Wood grain lines
        this.ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i < 30; i++) {
            const y = (i / 30) * this.tableHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.quadraticCurveTo(this.tableWidth / 2, y + 6, this.tableWidth, y - 3);
            this.ctx.stroke();
        }

        // Inner shadow
        this.ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        this.ctx.lineWidth = frameWidth;
        this.ctx.strokeRect(0, 0, this.tableWidth, this.tableHeight);

        // Inner bezel
        this.ctx.strokeStyle = '#c9a06a';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(frameWidth / 2, frameWidth / 2, this.tableWidth - frameWidth, this.tableHeight - frameWidth);
    }

    drawTableFelt() {
        const m = this.cushionMargin;
        const gradient = this.ctx.createRadialGradient(
            this.tableWidth / 2, this.tableHeight / 2, 50,
            this.tableWidth / 2, this.tableHeight / 2, 700
        );
        gradient.addColorStop(0, '#11663b');
        gradient.addColorStop(1, '#0a3d25');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(m, m, this.tableWidth - 2 * m, this.tableHeight - 2 * m);

        // Felt texture
        this.ctx.fillStyle = 'rgba(255,255,255,0.03)';
        for (let i = 0; i < 120; i++) {
            const x = m + Math.random() * (this.tableWidth - 2 * m);
            const y = m + Math.random() * (this.tableHeight - 2 * m);
            this.ctx.beginPath();
            this.ctx.arc(x, y, 1.2, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Baulk line
        this.ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        this.ctx.lineWidth = 2;
        const baulkX = m + (this.tableWidth - 2 * m) * 0.22;
        this.ctx.beginPath();
        this.ctx.moveTo(baulkX, m);
        this.ctx.lineTo(baulkX, this.tableHeight - m);
        this.ctx.stroke();

        // Head spot
        this.ctx.fillStyle = 'rgba(255,255,255,0.2)';
        this.ctx.beginPath();
        this.ctx.arc(baulkX, this.tableHeight / 2, 3, 0, Math.PI * 2);
        this.ctx.fill();
    }

    drawPockets() {
        const m = this.cushionMargin - 6;
        const cornerR = this.pocketRadius + 8;

        const drawPocket = (x, y, r) => {
            const grad = this.ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, '#000');
            grad.addColorStop(0.6, '#1a1a1a');
            grad.addColorStop(1, '#0a0a0a');
            this.ctx.beginPath();
            this.ctx.arc(x, y, r, 0, Math.PI * 2);
            this.ctx.fillStyle = grad;
            this.ctx.fill();
            // Metal rim
            this.ctx.strokeStyle = 'rgba(255,215,130,0.5)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        };

        const mid = this.tableWidth / 2;
        drawPocket(m, m, this.pocketRadius + 6);
        drawPocket(mid, m, this.pocketRadius - 3);
        drawPocket(this.tableWidth - m, m, this.pocketRadius + 6);
        drawPocket(m, this.tableHeight - m, this.pocketRadius + 6);
        drawPocket(mid, this.tableHeight - m, this.pocketRadius - 3);
        drawPocket(this.tableWidth - m, this.tableHeight - m, this.pocketRadius + 6);
    }

    drawBalls() {
        for (let ball of this.balls) {
            if (ball !== this.cueBall) ball.draw(this.ctx);
        }
        this.cueBall.draw(this.ctx);
    }

    drawAimLine() {
        if (!this.cueBall || this.cueBall.isPocketed) return;

        const cx = this.cueBall.x;
        const cy = this.cueBall.y;
        const dirX = Math.cos(this.aimAngle);
        const dirY = Math.sin(this.aimAngle);

        this.ctx.save();

        // ---- Raycast: find the first ball the cue ball would hit ----
        let hit = null;
        let hitT = Infinity;
        for (let b of this.balls) {
            if (b === this.cueBall || b.isPocketed) continue;

            const ox = b.x - cx;
            const oy = b.y - cy;
            const proj = ox * dirX + oy * dirY;
            if (proj <= 0) continue;                 // behind the cue ball

            const perp2 = ox * ox + oy * oy - proj * proj;
            const R = this.ballRadius + b.radius;    // center-to-center distance at contact
            if (perp2 > R * R) continue;             // won't reach this ball

            let t = proj - Math.sqrt(R * R - perp2);
            if (t < 0) t = 0;
            if (t < hitT) { hitT = t; hit = b; }
        }

        // ---- Cue ball straight path (always drawn) ----
        const startX = cx + dirX * this.ballRadius;
        const startY = cy + dirY * this.ballRadius;

        // ---- Wrong-target detection: turns the guide red when aiming at a ball
        //      that is not yours to shoot (opponent's ball / 8-ball too early) ----
        const shooterType = this.currentPlayer === 1 ? this.player1Type : this.player2Type;
        let wrongTarget = false;
        if (hit) {
            if (hit.number === 8) {
                wrongTarget = !shooterType || this.getPlayerBallsRemaining(this.currentPlayer) > 0;
            } else {
                wrongTarget = !!shooterType && !this.isMatching(hit, shooterType);
            }
        }

        const C_PATH = wrongTarget ? 'rgba(239,68,68,0.8)'  : 'rgba(255,215,130,0.65)';
        const C_GHOST = wrongTarget ? 'rgba(255,110,110,0.95)' : 'rgba(255,215,130,0.9)';
        const C_TARGET = wrongTarget ? 'rgba(255,80,80,0.95)' : 'rgba(255,255,255,0.85)';
        const C_DEFLECT = wrongTarget ? 'rgba(255,110,110,0.5)' : 'rgba(255,200,120,0.45)';

        let pathEndX, pathEndY;

        if (hit) {
            // Impact point = where the cue ball's centre lands at contact (ghost ball)
            const ghostX = cx + dirX * hitT;
            const ghostY = cy + dirY * hitT;

            // 1) Straight cue path up to the ghost ball
            this.ctx.strokeStyle = C_PATH;
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([14, 9]);
            this.ctx.lineDashOffset = -(performance.now() / 40) % 23;
            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            this.ctx.lineTo(ghostX, ghostY);
            this.ctx.stroke();

            // 2) Ghost-ball outline at the impact point
            this.ctx.setLineDash([]);
            this.ctx.strokeStyle = C_GHOST;
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.arc(ghostX, ghostY, this.ballRadius, 0, Math.PI * 2);
            this.ctx.stroke();

            // 3) Target direction: the target ball travels away along the line of centres
            let nx = hit.x - ghostX;
            let ny = hit.y - ghostY;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;

            const tStartX = hit.x + nx * hit.radius;
            const tStartY = hit.y + ny * hit.radius;
            const tLen = 210;
            const tEndX = tStartX + nx * tLen;
            const tEndY = tStartY + ny * tLen;

            // Target path — bends away from the cue line (this creates the "curve")
            this.ctx.strokeStyle = C_TARGET;
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([10, 7]);
            this.ctx.beginPath();
            this.ctx.moveTo(tStartX, tStartY);
            this.ctx.lineTo(tEndX, tEndY);
            this.ctx.stroke();

            // Small arrowhead on the target path
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = C_TARGET;
            this.ctx.beginPath();
            this.ctx.arc(tEndX, tEndY, 3, 0, Math.PI * 2);
            this.ctx.fill();

            // 4) Cue-ball deflection: perpendicular to the contact line, dimmer/shorter
            const px = -ny;
            const py = nx;
            const pLen = 70;
            this.ctx.strokeStyle = C_DEFLECT;
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([6, 6]);
            this.ctx.beginPath();
            this.ctx.moveTo(ghostX, ghostY);
            this.ctx.lineTo(ghostX + px * pLen, ghostY + py * pLen);
            this.ctx.stroke();

            pathEndX = ghostX;
            pathEndY = ghostY;
        } else {
            // No ball ahead: straight line out across the table with a target ring
            const len = 460;
            const ex = startX + dirX * len;
            const ey = startY + dirY * len;

            this.ctx.strokeStyle = 'rgba(255,215,130,0.6)';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([14, 9]);
            this.ctx.lineDashOffset = -(performance.now() / 40) % 23;
            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            this.ctx.lineTo(ex, ey);
            this.ctx.stroke();

            this.ctx.setLineDash([]);
            this.ctx.strokeStyle = 'rgba(255,215,130,0.75)';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(ex, ey, 6, 0, Math.PI * 2);
            this.ctx.stroke();

            pathEndX = ex;
            pathEndY = ey;
        }

        // A short solid core at the ball for a crisp starting read
        this.ctx.setLineDash([]);
        this.ctx.strokeStyle = 'rgba(255,240,190,0.9)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + dirX * (this.ballRadius * 3), cy + dirY * (this.ballRadius * 3));
        this.ctx.stroke();

        this.ctx.restore();
    }

    drawCueStick() {
        if (!this.cueBall || this.cueBall.isPocketed) return;

        // Compute pull-back based on power
        const pullBack = (this.aimPower / 100) * 90;
        const baseGap = this.cueStriking
            ? Math.max(-2, 26 - this.cueStrike * 28)
            : 22 + pullBack;

        const tipX = this.cueBall.x - Math.cos(this.aimAngle) * (this.ballRadius + baseGap);
        const tipY = this.cueBall.y - Math.sin(this.aimAngle) * (this.ballRadius + baseGap);

        const stickLength = 260;
        const buttX = tipX - Math.cos(this.aimAngle) * stickLength;
        const buttY = tipY - Math.sin(this.aimAngle) * stickLength;

        // Shadow
        this.ctx.save();
        this.ctx.shadowColor = 'rgba(0,0,0,0.4)';
        this.ctx.shadowBlur = 6;
        this.ctx.shadowOffsetX = 3;
        this.ctx.shadowOffsetY = 3;

        this.ctx.save();
        this.ctx.translate(this.cueBall.x, this.cueBall.y);
        this.ctx.rotate(this.aimAngle);
        // The stick extends backwards from the tip
        this.ctx.translate(-baseGap - this.ballRadius, 0);

        // Shaft (front, lighter wood)
        const shaftGrad = this.ctx.createLinearGradient(0, -4, 0, 4);
        shaftGrad.addColorStop(0, '#e8c98a');
        shaftGrad.addColorStop(0.5, '#d9b06a');
        shaftGrad.addColorStop(1, '#c49a58');
        this.ctx.fillStyle = shaftGrad;
        this.ctx.beginPath();
        this.ctx.moveTo(0, -3);
        this.ctx.lineTo(-130, -4.5);
        this.ctx.lineTo(-130, 4.5);
        this.ctx.lineTo(0, 3);
        this.ctx.closePath();
        this.ctx.fill();

        // Butt (back, dark)
        const buttGrad = this.ctx.createLinearGradient(0, -5, 0, 5);
        buttGrad.addColorStop(0, '#3a2410');
        buttGrad.addColorStop(0.5, '#4a2f18');
        buttGrad.addColorStop(1, '#2a1a0c');
        this.ctx.fillStyle = buttGrad;
        this.ctx.beginPath();
        this.ctx.moveTo(-130, -4.5);
        this.ctx.lineTo(-255, -5);
        this.ctx.lineTo(-255, 5);
        this.ctx.lineTo(-130, 4.5);
        this.ctx.closePath();
        this.ctx.fill();

        // Brass ferrule
        this.ctx.fillStyle = '#d8a530';
        this.ctx.fillRect(-2, -3.5, 6, 7);

        // Blue leather tip
        this.ctx.fillStyle = '#2a6db5';
        this.ctx.fillRect(-6, -3, 6, 6);

        // Wrap on butt
        this.ctx.strokeStyle = '#5a4a3a';
        this.ctx.lineWidth = 0.5;
        for (let i = 0; i < 8; i++) {
            const wx = -145 - i * 11;
            this.ctx.beginPath();
            this.ctx.moveTo(wx, -5);
            this.ctx.lineTo(wx, 5);
            this.ctx.stroke();
        }

        this.ctx.restore();
        this.ctx.restore();
    }

    showMessage(text) {
        const el = document.getElementById('gameMessage');
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(this._msgTimer);
        this._msgTimer = setTimeout(() => el.classList.remove('show'), 1800);
    }

    async endGame(winner) {
        this.gameOver = true;

        // When GameCommon is active it handles payout + result screen
        if (window.gameCommon && window.gameCommon.started) {
            const won = winner === 1;
            this.playPoolSound(won ? 'win' : 'lose');
            window.gameCommon.showResult(won, won
                ? 'You cleared the table — victory!'
                : (this.gameMode === 'ai' ? 'The AI won this round.' : 'Player 2 wins the match.'));
            return;
        }

        const modal = document.getElementById('gameOverModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalMessage = document.getElementById('modalMessage');
        const modalIcon = document.getElementById('modalIcon');
        const modalStats = document.getElementById('modalStats');
        let statsHTML = '';

        if (winner === 1) {
            this.playPoolSound('win');
            modalIcon.textContent = '🏆';
            modalTitle.textContent = 'Victory!';
            modalMessage.textContent = 'Congratulations! You won the game!';

            if (this.gameStartedWithBet && arenaX.isLoggedIn()) {
                const result = await arenaX.endGame('8 Ball Pool', true, this.winAmount, {
                    mode: this.gameMode, difficulty: this.aiDifficulty
                });
                if (result.success) {
                    statsHTML = `
                        <div style="margin: 20px 0;">
                            <div style="color: #4ade80; font-size: 28px; font-weight: 700; margin-bottom: 10px;">+${this.winAmount} Coins Won! 🎉</div>
                            <div style="color: var(--light-gray);">New Balance: <span style="color: var(--gold); font-weight: 700;">${result.balance} coins</span></div>
                        </div>`;
                    arenaX.updateBalanceDisplay();
                } else {
                    statsHTML = `<div style="color: #ef4444;">Error updating balance.</div>`;
                }
            }
        } else {
            this.playPoolSound('lose');
            modalIcon.textContent = '😔';
            modalTitle.textContent = 'Game Over';
            modalMessage.textContent = this.gameMode === 'ai' ? 'AI won this round!' : 'Player 2 wins!';

            if (this.gameStartedWithBet && arenaX.isLoggedIn()) {
                const result = await arenaX.endGame('8 Ball Pool', false, 0, {
                    mode: this.gameMode, difficulty: this.aiDifficulty
                });
                statsHTML = `
                    <div style="margin: 20px 0; color: var(--light-gray);">
                        <div style="font-size: 18px; margin-bottom: 10px;">Better luck next time!</div>
                        <div>Entry fee: <span style="color: #ef4444;">-${this.entryFee} coin</span></div>
                    </div>`;
            }
        }

        modalStats.innerHTML = statsHTML;
        modal.classList.remove('hidden');
    }

    resetGame() {
        this.gameOver = false;
        this.firstBallType = null;
        this.player1Type = null;
        this.player2Type = null;
        this.currentPlayer = 1;
        this.gameStarted = false;
        this.gameStartedWithBet = false;
        this.isShooting = false;
        this.tableSettling = false;
        this.turnResolved = false;
        this.awaitingAITurn = false;
        this.aiShotScheduled = false;
        this.charging = false;
        this.cueStriking = false;
        this._pendingShot = null;
        this._shotFired = false;
        this.aimPower = 0;
        this.aimAngle = Math.PI;

        // Reset rule state
        this.breakShot = true;
        this.shotActive = false;
        this.shotPocketed = [];
        this.firstHitBall = null;
        this.anyCushion = false;
        this.player1Pocketed = [];
        this.player2Pocketed = [];
        this.ballInHand = false;
        this.placementPos = null;
        this.stopChargeSound();

        this.initBalls();
        this.updatePlayerCards();
        document.getElementById('player1Type').textContent = 'Yet to decide';
        document.getElementById('player2Type').textContent = 'Yet to decide';
        this.updatePlayerBalls();
        this.renderPocketedBalls();

        document.getElementById('gameBoard').classList.add('hidden');
        document.getElementById('modeSelection').classList.remove('hidden');
    }

    quitGame() {
        window.location.href = '../index.html';
    }

    gameLoop() {
        const now = performance.now();
        const dt = this.lastFrame ? Math.min(50, now - this.lastFrame) : 16.6;
        this.lastFrame = now;

        // Auto-charge power while holding: fills up and holds at max (no reset).
        if (this.charging) {
            this.aimPower = Math.min(100, this.aimPower + 1.2);
            this.updatePowerBar();
            this.updateChargeSound();
        }

        if (this.aiAiming && now < this.aiAiming.until) {
            const total = Math.max(1, this.aiAiming.until - this.aiAiming.startedAt);
            const progress = Math.min(1, Math.max(0, (now - this.aiAiming.startedAt) / total));
            this.aimPower = (this.aiAiming.power || 0) * progress;
            this.updatePowerBar();
        }

        if (this.turnTimerRunning && !this.gameOver && this.gameStarted && !this.isShooting && !this.cueStriking && !this.aiShotScheduled) {
            const elapsed = (now - (this.lastTurnTick || now)) / 1000;
            this.lastTurnTick = now;
            this.turnTimeLeft = Math.max(0, this.turnTimeLeft - elapsed);
            this.updateTurnTimerUI();
            if (this.turnTimeLeft <= 0) {
                this.turnTimerRunning = false;
                this.playPoolSound('foul');
                this.showMessage(`Time foul! ${this.currentPlayer === 1 ? 'Player 1' : 'Player 2'} ran out of time.`);
                const shooter = this.currentPlayer;
                const opp = this.opponentOf(shooter);
                this.currentPlayer = opp;
                this.setBallInHandFor(opp);
                this.updatePlayerCards();
                this.startTurnTimer();
            }
        }

        // Cue strike animation: pull the stick forward until it hits the ball
        if (this.cueStriking) {
            this.cueStrike = Math.min(1, this.cueStrike + dt / 80);
            if (this.cueStrike >= 0.92 && !this._shotFired) {
                this._shotFired = true;
                this.fireShot();
            }
        }

        // Ball in hand: ghost cue ball follows the cursor
        if (this.ballInHand && this.placementPos) {
            const pad = this.cushionMargin + this.ballRadius;
            this.cueBall.x = Math.max(pad, Math.min(this.tableWidth - pad, this.placementPos.x));
            this.cueBall.y = Math.max(pad, Math.min(this.tableHeight - pad, this.placementPos.y));
        }

        this.update(dt);
        this.draw();
        requestAnimationFrame(() => this.gameLoop());
    }

    async startGame(mode, difficulty = 'medium') {
        this.gameMode = mode;
        this.aiDifficulty = difficulty;

        this.playPoolSound('ui');
        if (window.gameCommon && window.gameCommon.getWager && window.gameCommon.getWager() > 0) {
            // GameCommon already locked the wager before the mode screen opened —
            // it owns the wallet transaction and the payout.
            this.entryFee = window.gameCommon.getWager();
            this.winAmount = this.entryFee * 2;
            this.gameStartedWithBet = false;
        } else if (arenaX.isLoggedIn()) {
            const result = await arenaX.startGame('8 Ball Pool');
            if (!result.success) {
                arenaX.showNotification(result.message, 'error');
                return;
            }
            this.gameStartedWithBet = true;
            arenaX.showNotification(`Game started! Entry fee: ${this.entryFee} coin`, 'success');
            arenaX.updateBalanceDisplay();
        } else {
            this.gameStartedWithBet = false;
            arenaX.showNotification('Playing in practice mode. Login to win coins!', 'error');
        }

        this.gameStarted = true;
        this.startTurnTimer();
        if (window.gameCommon && window.gameCommon.startGamePlay) window.gameCommon.startGamePlay();

        document.getElementById('modeSelection').classList.add('hidden');
        document.getElementById('gameBoard').classList.remove('hidden');

        document.getElementById('player2Name').textContent =
            mode === 'ai' ? `AI (${difficulty})` : 'Player 2';

        this.updatePlayerCards();
    }
}

let game;

document.addEventListener('DOMContentLoaded', () => {
    game = new PoolGame('poolCanvas');

    const difficultySelect = document.getElementById('aiDifficulty');
    document.querySelectorAll('.difficulty-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            game.playPoolSound('ui');
            document.querySelectorAll('.difficulty-pill').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            difficultySelect.value = btn.dataset.difficulty;
        });
    });
    difficultySelect.addEventListener('change', () => {
        game.playPoolSound('ui');
        document.querySelectorAll('.difficulty-pill').forEach(p => p.classList.toggle('active', p.dataset.difficulty === difficultySelect.value));
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            game.playPoolSound('ui');
            const mode = btn.dataset.mode;
            const difficulty = document.getElementById('aiDifficulty').value;
            game.startGame(mode, difficulty);
        });
    });

    document.getElementById('playAgainBtn').addEventListener('click', () => {
        game.playPoolSound('ui');
        document.getElementById('gameOverModal').classList.add('hidden');
        game.resetGame();
    });

    document.getElementById('backToMenuBtn').addEventListener('click', () => {
        window.location.href = '../index.html';
    });

    if (arenaX.isLoggedIn()) arenaX.updateBalanceDisplay();
});
