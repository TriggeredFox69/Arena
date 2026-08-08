var CarromGameModule = (() => {
  // games/carrom/state.js
  var PHASE = {
    MENU: "menu",
    PLACE_STRIKER: "place",
    AIMING: "aim",
    SHOT_ACTIVE: "shot",
    SETTLING: "settle",
    RESOLVING: "resolve",
    GAME_OVER: "over"
  };
  var TURN = { P1: "p1", P2: "p2" };
  var SIDE = { WHITE: "white", BLACK: "black" };
  var GAME_MODE = { AI: "ai", LOCAL: "local", PVP: "pvp" };
  var DIFFICULTY = { EASY: "easy", MEDIUM: "medium", HARD: "hard" };
  var BOARD_SIZE = 700;
  var MARGIN = 42;
  var PLAY_AREA = BOARD_SIZE - MARGIN * 2;
  var COIN_R = 16;
  var STRIKER_R = 21;
  var POCKET_R = 26;
  var BASELINE_OFFSET = PLAY_AREA * 0.09;
  var STRIKER_MASS = 4;
  var COIN_MASS = 1;
  var RESTITUTION = 0.92;
  var WALL_RESTITUTION = 0.72;
  var DAMPING = 1.1;
  var STOP_SPEED = 1.2;
  var MAX_POWER = 720;
  var WIN_SCORE = 200;
  var COIN_VALUE = { black: 10, white: 20, red: 50 };
  var FIXED_DT = 1 / 120;
  var SUB_STEPS = 8;
  var MIN_DRAG = 10;
  var POCKETS = [
    { id: 0, x: MARGIN + 10, y: MARGIN + 10 },
    { id: 1, x: BOARD_SIZE - MARGIN - 10, y: MARGIN + 10 },
    { id: 2, x: MARGIN + 10, y: BOARD_SIZE - MARGIN - 10 },
    { id: 3, x: BOARD_SIZE - MARGIN - 10, y: BOARD_SIZE - MARGIN - 10 }
  ];
  function baselineY(player) {
    return player === TURN.P1 ? BOARD_SIZE - MARGIN - BASELINE_OFFSET : MARGIN + BASELINE_OFFSET;
  }
  function makeCoins() {
    const cx = BOARD_SIZE / 2;
    const cy = BOARD_SIZE / 2;
    const gap = COIN_R * 2 + 4;
    const coins = [];
    let id = 0;
    coins.push({
      id: id++,
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      r: COIN_R,
      color: "red",
      side: "queen",
      mass: COIN_MASS,
      active: true
    });
    const innerCount = 6;
    for (let i = 0; i < innerCount; i++) {
      const angle = i * 2 * Math.PI / innerCount;
      coins.push({
        id: id++,
        x: cx + Math.cos(angle) * gap,
        y: cy + Math.sin(angle) * gap,
        vx: 0,
        vy: 0,
        r: COIN_R,
        color: i % 2 === 0 ? SIDE.BLACK : SIDE.WHITE,
        side: i % 2 === 0 ? SIDE.BLACK : SIDE.WHITE,
        mass: COIN_MASS,
        active: true
      });
    }
    const outerCount = 12;
    for (let i = 0; i < outerCount; i++) {
      const angle = Math.PI / 12 + i * 2 * Math.PI / outerCount;
      coins.push({
        id: id++,
        x: cx + Math.cos(angle) * (gap * 2),
        y: cy + Math.sin(angle) * (gap * 2),
        vx: 0,
        vy: 0,
        r: COIN_R,
        color: i % 2 === 0 ? SIDE.WHITE : SIDE.BLACK,
        side: i % 2 === 0 ? SIDE.WHITE : SIDE.BLACK,
        mass: COIN_MASS,
        active: true
      });
    }
    return coins;
  }
  function getQueen(coins) {
    return coins.find((c) => c.color === "red");
  }
  function createInitialState(mode, difficulty, options = {}) {
    const coins = makeCoins();
    let p1Side = SIDE.WHITE;
    if (mode === GAME_MODE.LOCAL) {
      p1Side = SIDE.WHITE;
    } else if (options.humanSide === "black") {
      p1Side = SIDE.BLACK;
    } else if (options.humanSide === "white") {
      p1Side = SIDE.WHITE;
    } else {
      p1Side = Math.random() < 0.5 ? SIDE.WHITE : SIDE.BLACK;
    }
    const p2Side = p1Side === SIDE.WHITE ? SIDE.BLACK : SIDE.WHITE;
    return {
      mode: mode || GAME_MODE.AI,
      difficulty: difficulty || DIFFICULTY.MEDIUM,
      phase: PHASE.PLACE_STRIKER,
      turn: TURN.P1,
      p1Side,
      p2Side,
      coins,
      striker: {
        x: BOARD_SIZE / 2,
        y: baselineY(TURN.P1),
        vx: 0,
        vy: 0,
        r: STRIKER_R,
        side: TURN.P1,
        mass: STRIKER_MASS,
        active: true
      },
      scores: { p1: 0, p2: 0 },
      coinsPocketed: { p1: 0, p2: 0 },
      queenPocketedBy: null,
      queenCovered: false,
      lastShotResult: null,
      lastShotMessage: "",
      lastPots: [],
      shotCount: 0,
      shotResolved: true,
      winner: null,
      dragStart: null,
      dragCurrent: null,
      inputEnabled: true,
      aiThinking: false,
      aiPreview: null,
      particles: [],
      shakeAmount: 0,
      accumulator: 0,
      settlingTimer: 0,
      eventLog: [],
      commands: [],
      options
    };
  }
  function getPlayerSide(state, player) {
    return player === TURN.P1 ? state.p1Side : state.p2Side;
  }
  function getOpponent(player) {
    return player === TURN.P1 ? TURN.P2 : TURN.P1;
  }
  function getActiveCoins(coins) {
    return coins.filter((c) => c.active);
  }
  function baselineFor(player) {
    return baselineY(player);
  }
  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  // games/carrom/core/collision.js
  function integrateBody(b, dt) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  function applyDamping(b, dt) {
    const speed = Math.hypot(b.vx, b.vy);
    if (speed < STOP_SPEED) {
      b.vx = 0;
      b.vy = 0;
      return;
    }
    const factor = Math.exp(-DAMPING * dt);
    b.vx *= factor;
    b.vy *= factor;
    if (Math.hypot(b.vx, b.vy) < STOP_SPEED) {
      b.vx = 0;
      b.vy = 0;
    }
  }
  function wallCollide(b) {
    const minX = MARGIN + b.r;
    const maxX = BOARD_SIZE - MARGIN - b.r;
    const minY = MARGIN + b.r;
    const maxY = BOARD_SIZE - MARGIN - b.r;
    let impact = 0;
    let wall = null;
    if (b.x < minX) {
      b.x = minX;
      b.vx = Math.abs(b.vx) * WALL_RESTITUTION;
      impact = Math.abs(b.vx);
      wall = "left";
    } else if (b.x > maxX) {
      b.x = maxX;
      b.vx = -Math.abs(b.vx) * WALL_RESTITUTION;
      impact = Math.abs(b.vx);
      wall = "right";
    }
    if (b.y < minY) {
      b.y = minY;
      b.vy = Math.abs(b.vy) * WALL_RESTITUTION;
      impact = Math.max(impact, Math.abs(b.vy));
      wall = wall || "top";
    } else if (b.y > maxY) {
      b.y = maxY;
      b.vy = -Math.abs(b.vy) * WALL_RESTITUTION;
      impact = Math.max(impact, Math.abs(b.vy));
      wall = wall || "bottom";
    }
    return { impact, wall };
  }
  function bodyCollision(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const minDist = a.r + b.r;
    if (dist >= minDist || dist < 1e-3) return { impulse: 0 };
    const nx = dx / dist;
    const ny = dy / dist;
    const dvx = a.vx - b.vx;
    const dvy = a.vy - b.vy;
    const relVelN = dvx * nx + dvy * ny;
    if (relVelN <= 0) return { impulse: 0 };
    const totalMass = a.mass + b.mass;
    const j = 2 * relVelN * RESTITUTION / totalMass;
    a.vx -= j * b.mass * nx;
    a.vy -= j * b.mass * ny;
    b.vx += j * a.mass * nx;
    b.vy += j * a.mass * ny;
    const overlap = minDist - dist;
    const correction = overlap * 0.5;
    const ratioA = b.mass / totalMass;
    const ratioB = a.mass / totalMass;
    a.x -= nx * correction * ratioA;
    a.y -= ny * correction * ratioA;
    b.x += nx * correction * ratioB;
    b.y += ny * correction * ratioB;
    return { impulse: Math.abs(j) };
  }
  function isInPocket(x, y) {
    for (const p of POCKETS) {
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy < POCKET_R * POCKET_R) return p;
    }
    return null;
  }
  function isValidStrikerPlacement(x, y, coins) {
    if (x < MARGIN + STRIKER_R || x > BOARD_SIZE - MARGIN - STRIKER_R) return false;
    if (y < MARGIN + STRIKER_R || y > BOARD_SIZE - MARGIN - STRIKER_R) return false;
    for (const c of coins) {
      if (!c.active) continue;
      const dx = x - c.x;
      const dy = y - c.y;
      if (dx * dx + dy * dy < (STRIKER_R + c.r + 0.5) ** 2) return false;
    }
    return true;
  }
  function findClearStrikerX(y, coins, preferredX) {
    const minX = MARGIN + STRIKER_R + 2;
    const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 2;
    if (isValidStrikerPlacement(preferredX, y, coins)) return preferredX;
    let best = null;
    let bestDist = Infinity;
    for (let x = minX; x <= maxX; x += 4) {
      if (isValidStrikerPlacement(x, y, coins)) {
        const d = Math.abs(x - preferredX);
        if (d < bestDist) {
          bestDist = d;
          best = x;
        }
      }
    }
    return best ?? (MARGIN + BOARD_SIZE) / 2;
  }

  // games/carrom/core/simulation.js
  var Simulation = class {
    constructor(state) {
      this.state = state;
      this.events = [];
      this.stepCount = 0;
    }
    resetEvents() {
      this.events = [];
    }
    get bodies() {
      return [...this.state.coins.filter((c) => c.active), this.state.striker];
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
      for (let pass = 0; pass < 3; pass++) {
        for (const b of bodies) {
          const { impact, wall } = wallCollide(b);
          if (impact > 0) {
            maxImpact = Math.max(maxImpact, impact);
            this.events.push({ type: "cushion", bodyId: b.id, wall, impact });
          }
        }
      }
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) {
            const { impulse } = bodyCollision(bodies[i], bodies[j]);
            if (impulse > 0) {
              maxImpact = Math.max(maxImpact, impulse);
              this.events.push({
                type: "collision",
                aId: bodies[i].id,
                bId: bodies[j].id,
                impulse
              });
            }
          }
        }
      }
      for (const b of bodies) {
        applyDamping(b, dt);
      }
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
            type: "pocket",
            bodyId: coin.id,
            bodyType: "coin",
            color: coin.color,
            side: coin.side,
            pocketId: pocket.id,
            x: coin.x,
            y: coin.y
          });
        }
      }
      if (this.state.striker.active) {
        const pocket = isInPocket(this.state.striker.x, this.state.striker.y);
        if (pocket) {
          this.state.striker.active = false;
          this.events.push({
            type: "pocket",
            bodyId: "striker",
            bodyType: "striker",
            pocketId: pocket.id,
            x: this.state.striker.x,
            y: this.state.striker.y
          });
        }
      }
    }
    isSettled() {
      return this.bodies.every((b) => Math.hypot(b.vx, b.vy) < STOP_SPEED * 1.2);
    }
    runUntilSettled(maxSteps = 4e3) {
      this.resetEvents();
      let steps = 0;
      while (steps < maxSteps) {
        this.step(FIXED_DT);
        if (this.isSettled()) break;
        steps++;
      }
      return { steps, settled: steps < maxSteps };
    }
  };

  // games/carrom/core/shot.js
  var POWER_SCALE = 5.2;
  function dragToShot(striker, dragStart, dragCurrent) {
    const dx = dragStart.x - dragCurrent.x;
    const dy = dragStart.y - dragCurrent.y;
    const dist = Math.hypot(dx, dy);
    if (dist < MIN_DRAG) return null;
    const power = Math.min(dist * POWER_SCALE, MAX_POWER);
    const nx = dx / dist;
    const ny = dy / dist;
    return { vx: nx * power, vy: ny * power, power: power / MAX_POWER };
  }

  // games/carrom/rules/rules-engine.js
  function findClearReturnPosition(state, body) {
    const cx = BOARD_SIZE / 2;
    const cy = BOARD_SIZE / 2;
    const step = 3;
    const maxRadius = 160;
    for (let r = 0; r <= maxRadius; r += step) {
      const checks = r === 0 ? 1 : Math.max(4, Math.floor(2 * Math.PI * r / (body.r * 2.5)));
      for (let i = 0; i < checks; i++) {
        const angle = i / checks * Math.PI * 2 + r * 0.37;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        let clear = true;
        const minDist = (body.r + COIN_R + 1) ** 2;
        const strikerMinDist = (body.r + STRIKER_R + 1) ** 2;
        for (const c of state.coins) {
          if (!c.active || c.id === body.id) continue;
          const dx = x - c.x;
          const dy = y - c.y;
          if (dx * dx + dy * dy < minDist) {
            clear = false;
            break;
          }
        }
        if (clear && state.striker.active) {
          const dx = x - state.striker.x;
          const dy = y - state.striker.y;
          if (dx * dx + dy * dy < strikerMinDist) clear = false;
        }
        if (clear) return { x, y };
      }
    }
    return { x: cx, y: cy };
  }
  function resolveTurn(state, pocketEvents) {
    const current = state.turn;
    const opponent = getOpponent(current);
    const scores = { p1: 0, p2: 0 };
    let message = "";
    let result = "switch";
    let turnSwitches = true;
    let queenCovered = state.queenCovered;
    let queenPocketedBy = state.queenPocketedBy;
    let returnedCoinIds = [];
    let gameOverWinner = null;
    const lastPots = [];
    const strikerFoul = pocketEvents.some((e) => e.type === "pocket" && e.bodyType === "striker");
    const coinPockets = pocketEvents.filter((e) => e.type === "pocket" && e.bodyType === "coin");
    const queenPocketedThisShot = coinPockets.find((e) => e.color === "red");
    const nonQueenPockets = coinPockets.filter((e) => e.color !== "red");
    function queueReturn(id) {
      if (!returnedCoinIds.includes(id)) returnedCoinIds.push(id);
    }
    for (const e of coinPockets) lastPots.push(e.color);
    if (strikerFoul) {
      result = "foul";
      message = "Striker pocketed \u2014 foul! No points.";
      for (const e of coinPockets) queueReturn(e.bodyId);
      if (queenPocketedThisShot && !queenCovered) {
        queenPocketedBy = null;
      }
      if (queenPocketedBy === current && !queenCovered) {
        const queen = getQueen(state.coins);
        if (queen) queueReturn(queen.id);
        queenPocketedBy = null;
      }
      return buildPatch();
    }
    if (coinPockets.length === 0) {
      message = "No coins pocketed \u2014 turn passes.";
      if (queenPocketedBy === current && !queenCovered) {
        const queen = getQueen(state.coins);
        if (queen) queueReturn(queen.id);
        queenPocketedBy = null;
      }
      return buildPatch();
    }
    let turnPoints = 0;
    for (const e of nonQueenPockets) {
      const value = COIN_VALUE[e.color] || 0;
      turnPoints += value;
    }
    if (turnPoints > 0) {
      scores[current] += turnPoints;
      message += `+${turnPoints} points. `;
    }
    const coveredNow = queenPocketedThisShot && nonQueenPockets.length > 0;
    const coverPending = !queenCovered && queenPocketedBy === current && nonQueenPockets.length > 0;
    if (coveredNow || coverPending) {
      queenCovered = true;
      queenPocketedBy = current;
      scores[current] += COIN_VALUE.red;
      message += `Queen covered! +${COIN_VALUE.red}. `;
    } else if (queenPocketedThisShot && !queenCovered) {
      queenPocketedBy = current;
      message += "Queen pocketed \u2014 cover it with a coin to keep it. ";
    }
    if (queenPocketedThisShot && !queenCovered && nonQueenPockets.length === 0) {
      result = "switch";
      turnSwitches = true;
      const queen = getQueen(state.coins);
      if (queen) queueReturn(queen.id);
      queenPocketedBy = null;
      message = "Queen pocketed without cover \u2014 it returns to the center.";
      return buildPatch();
    }
    if (coinPockets.length > 0) {
      result = "continue";
      turnSwitches = false;
    }
    if (turnSwitches && queenPocketedBy === current && !queenCovered) {
      const queen = getQueen(state.coins);
      if (queen) queueReturn(queen.id);
      queenPocketedBy = null;
    }
    if (!message) message = "Turn continues.";
    return buildPatch();
    function buildPatch() {
      const p1Score = state.scores.p1 + scores.p1;
      const p2Score = state.scores.p2 + scores.p2;
      const remainingCoins = state.coins.filter((c) => c.active && c.color !== "red").length;
      if (p1Score >= WIN_SCORE) gameOverWinner = TURN.P1;
      else if (p2Score >= WIN_SCORE) gameOverWinner = TURN.P2;
      else if (remainingCoins === 0) {
        if (p1Score > p2Score) gameOverWinner = TURN.P1;
        else if (p2Score > p1Score) gameOverWinner = TURN.P2;
        else gameOverWinner = current;
      }
      return {
        result,
        scores,
        message: message.trim(),
        turnSwitches,
        queenCovered,
        queenPocketedBy,
        returnedCoinIds,
        gameOverWinner,
        lastPots
      };
    }
  }
  function applyTurnPatch(state, patch) {
    state.scores.p1 += patch.scores.p1 || 0;
    state.scores.p2 += patch.scores.p2 || 0;
    state.lastShotResult = patch.result;
    state.lastShotMessage = patch.message;
    state.queenCovered = patch.queenCovered;
    state.queenPocketedBy = patch.queenPocketedBy;
    state.lastPots = (patch.lastPots || []).slice(-3);
    for (const id of patch.returnedCoinIds) {
      const coin = state.coins.find((c) => c.id === id);
      if (!coin) continue;
      const pos = findClearReturnPosition(state, coin);
      coin.active = true;
      coin.x = pos.x;
      coin.y = pos.y;
      coin.vx = 0;
      coin.vy = 0;
    }
    state.coinsPocketed.p1 = state.coins.filter((c) => !c.active && c.side === state.p1Side).length;
    state.coinsPocketed.p2 = state.coins.filter((c) => !c.active && c.side === state.p2Side).length;
    if (patch.gameOverWinner) {
      state.winner = patch.gameOverWinner;
      state.phase = PHASE.GAME_OVER;
      state.inputEnabled = false;
      return;
    }
    if (patch.turnSwitches) {
      state.turn = getOpponent(state.turn);
    }
  }

  // games/carrom/ai/ai-controller.js
  var SAMPLES = {
    [DIFFICULTY.EASY]: 160,
    [DIFFICULTY.MEDIUM]: 720,
    [DIFFICULTY.HARD]: 2200
  };
  var MAX_TIME_MS = 1600;
  var POCKETS2 = [
    { id: 0, x: MARGIN + 10, y: MARGIN + 10 },
    { id: 1, x: BOARD_SIZE - MARGIN - 10, y: MARGIN + 10 },
    { id: 2, x: MARGIN + 10, y: BOARD_SIZE - MARGIN - 10 },
    { id: 3, x: BOARD_SIZE - MARGIN - 10, y: BOARD_SIZE - MARGIN - 10 }
  ];
  function chooseShot(state) {
    const start = performance.now();
    const difficulty = state.difficulty || DIFFICULTY.MEDIUM;
    const baselineY2 = baselineFor(state.turn);
    const targets = buildTargetList(state);
    const candidates = [];
    const sampleTarget = Math.min(targets.length, 4 + Math.floor(SAMPLES[difficulty] / 28));
    const shotsPerTarget = Math.ceil(SAMPLES[difficulty] / Math.max(1, sampleTarget));
    for (const target of targets.slice(0, sampleTarget)) {
      for (let i = 0; i < shotsPerTarget; i++) {
        if (performance.now() - start > MAX_TIME_MS) break;
        const shot = generateCandidate(state, target, baselineY2, difficulty, i);
        if (!shot) continue;
        const score = simulateAndScore(state, shot, difficulty);
        if (score !== null) candidates.push({ ...shot, score });
      }
    }
    if (candidates.length === 0 || candidates.every((c) => c.score < 0)) {
      for (let i = 0; i < 40; i++) {
        if (performance.now() - start > MAX_TIME_MS) break;
        const shot = chooseBreakShot(state, baselineY2, difficulty);
        if (!shot) continue;
        const score = simulateAndScore(state, shot, difficulty);
        if (score !== null) candidates.push({ ...shot, score });
      }
    }
    if (candidates.length === 0) {
      for (let i = 0; i < 30; i++) {
        if (performance.now() - start > MAX_TIME_MS) break;
        const shot = randomBaselineShot(state, baselineY2);
        if (!shot) continue;
        const score = simulateAndScore(state, shot, difficulty);
        if (score !== null) candidates.push({ ...shot, score });
      }
    }
    if (candidates.length === 0) {
      return randomBaselineShot(state, baselineY2);
    }
    candidates.sort((a, b) => b.score - a.score);
    let pick;
    if (difficulty === DIFFICULTY.EASY) {
      const pool = candidates.slice(0, Math.max(6, Math.floor(candidates.length * 0.45)));
      pick = pool[Math.floor(Math.random() * pool.length)];
      pick.vx += (Math.random() - 0.5) * 30;
      pick.vy += (Math.random() - 0.5) * 30;
    } else if (difficulty === DIFFICULTY.MEDIUM) {
      const pool = candidates.slice(0, Math.max(4, Math.floor(candidates.length * 0.22)));
      pick = pool[Math.floor(Math.random() * pool.length)];
      pick.vx += (Math.random() - 0.5) * 10;
      pick.vy += (Math.random() - 0.5) * 10;
    } else {
      pick = candidates[0];
      pick.vx += (Math.random() - 0.5) * 3;
      pick.vy += (Math.random() - 0.5) * 3;
    }
    const speed = Math.hypot(pick.vx, pick.vy);
    if (speed > MAX_POWER) {
      const s = MAX_POWER / speed;
      pick.vx *= s;
      pick.vy *= s;
    }
    return { sx: pick.sx, sy: pick.sy, vx: pick.vx, vy: pick.vy, targetId: pick.targetId };
  }
  function buildTargetList(state) {
    const active = getActiveCoins(state.coins).filter((c) => c.color !== "red");
    active.sort((a, b) => (COIN_VALUE[b.color] || 0) - (COIN_VALUE[a.color] || 0));
    const queen = getQueen(state.coins);
    if (queen && queen.active && !state.queenCovered) {
      active.unshift(queen);
    }
    return active;
  }
  function generateCandidate(state, target, baselineY2, difficulty, index) {
    const pocket = POCKETS2[(index + Math.floor(Math.random() * 4)) % 4];
    const dx = pocket.x - target.x;
    const dy = pocket.y - target.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return null;
    const ux = dx / dist;
    const uy = dy / dist;
    if (Math.abs(uy) < 1e-3) return null;
    const t = (baselineY2 - target.y) / uy;
    if (t > -0.1) return null;
    const idealSx = target.x + t * ux;
    const minX = MARGIN + STRIKER_R + 4;
    const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 4;
    if (idealSx < minX || idealSx > maxX) return null;
    let sx = idealSx;
    if (difficulty === DIFFICULTY.EASY) sx += (Math.random() - 0.5) * 70;
    else if (difficulty === DIFFICULTY.MEDIUM) sx += (Math.random() - 0.5) * 24;
    else sx += (Math.random() - 0.5) * 6;
    const clamped = Math.max(minX, Math.min(maxX, sx));
    if (difficulty !== DIFFICULTY.EASY && clamped !== sx) return null;
    sx = clamped;
    if (!isValidStrikerPlacement(sx, baselineY2, state.coins)) {
      sx = findClearStrikerX(baselineY2, state.coins, sx);
      if (sx === null) return null;
    }
    const gx = target.x - ux * (target.r + STRIKER_R + 0.5);
    const gy = target.y - uy * (target.r + STRIKER_R + 0.5);
    if (pathBlocked(sx, baselineY2, gx, gy, STRIKER_R + 1.2, target.id, state.coins)) return null;
    if (pathBlocked(target.x, target.y, pocket.x, pocket.y, COIN_R + 1.2, target.id, state.coins)) return null;
    const dirX = gx - sx;
    const dirY = gy - baselineY2;
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen < 1) return null;
    let nx = dirX / dirLen;
    let ny = dirY / dirLen;
    let noise = 0;
    if (difficulty === DIFFICULTY.EASY) noise = (Math.random() - 0.5) * 0.14;
    else if (difficulty === DIFFICULTY.MEDIUM) noise = (Math.random() - 0.5) * 0.05;
    else noise = (Math.random() - 0.5) * 0.015;
    if (noise !== 0) {
      const angle = Math.atan2(ny, nx) + noise;
      nx = Math.cos(angle);
      ny = Math.sin(angle);
    }
    const targetDist = Math.hypot(sx - target.x, baselineY2 - target.y);
    const baseSpeed = Math.max(320, 260 + targetDist * 1.25);
    const speedFactor = 1 + index % 9 * 0.055;
    const speed = Math.min(MAX_POWER * 0.95, baseSpeed * speedFactor);
    return { sx, sy: baselineY2, vx: nx * speed, vy: ny * speed, targetId: target.id };
  }
  function pathBlocked(x1, y1, x2, y2, radius, ignoreId, coins) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return false;
    for (const c of coins) {
      if (!c.active || c.id === ignoreId) continue;
      const fx = c.x - x1;
      const fy = c.y - y1;
      let t = (fx * dx + fy * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = x1 + t * dx;
      const cy = y1 + t * dy;
      const r = c.r + radius;
      if ((c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy) < r * r) return true;
    }
    return false;
  }
  function chooseBreakShot(state, baselineY2, difficulty) {
    const minX = MARGIN + STRIKER_R + 6;
    const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 6;
    let sx;
    for (let tries = 0; tries < 50; tries++) {
      sx = minX + Math.random() * (maxX - minX);
      if (isValidStrikerPlacement(sx, baselineY2, state.coins)) break;
      sx = null;
    }
    if (sx === null) return null;
    const coins = getActiveCoins(state.coins).filter((c) => c.side !== "queen");
    const cx = coins.reduce((sum, c) => sum + c.x, 0) / Math.max(1, coins.length);
    const cy = coins.reduce((sum, c) => sum + c.y, 0) / Math.max(1, coins.length);
    const towardCenter = baselineY2 > BOARD_SIZE / 2 ? -1 : 1;
    let aimX = cx + (Math.random() - 0.5) * 70;
    let aimY = cy + towardCenter * 28;
    let dx = aimX - sx;
    let dy = aimY - baselineY2;
    const d = Math.hypot(dx, dy);
    if (d < 1) {
      dx = 0;
      dy = baselineY2 > BOARD_SIZE / 2 ? -1 : 1;
    }
    let angle = Math.atan2(dy, dx);
    const spread = difficulty === DIFFICULTY.EASY ? 0.3 : difficulty === DIFFICULTY.MEDIUM ? 0.16 : 0.08;
    angle += (Math.random() - 0.5) * spread;
    const distToCenter = Math.hypot(sx - BOARD_SIZE / 2, baselineY2 - BOARD_SIZE / 2);
    const breakSpeed = 520 + distToCenter * 1.25;
    const speed = Math.min(MAX_POWER * 0.96, breakSpeed);
    return {
      sx,
      sy: baselineY2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      targetId: null
    };
  }
  function randomBaselineShot(state, baselineY2) {
    const minX = MARGIN + STRIKER_R + 6;
    const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 6;
    let sx;
    for (let tries = 0; tries < 50; tries++) {
      sx = minX + Math.random() * (maxX - minX);
      if (isValidStrikerPlacement(sx, baselineY2, state.coins)) break;
    }
    const towardCenter = baselineY2 > BOARD_SIZE / 2 ? -1 : 1;
    const angle = Math.PI / 2 * towardCenter + (Math.random() - 0.5) * 0.8;
    const speed = 340 + Math.random() * 200;
    return { sx, sy: baselineY2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }
  function simulateAndScore(state, shot, difficulty) {
    const simState = cloneState(state);
    const sim = new Simulation(simState);
    sim.setStriker(shot.sx, shot.sy);
    sim.shoot(shot.vx, shot.vy);
    sim.runUntilSettled(4e3);
    const pocketed = sim.events.filter((e) => e.type === "pocket");
    if (pocketed.length === 0 && shot.targetId == null) {
      return -50;
    }
    return evaluateShot(pocketed, state, shot, difficulty);
  }
  function evaluateShot(pocketed, state, shot, difficulty) {
    let score = 0;
    let coinPoints = 0;
    let coinCount = 0;
    let queenPocketed = false;
    let strikerFoul = false;
    for (const p of pocketed) {
      if (p.bodyType === "striker") {
        strikerFoul = true;
        score -= 200;
        continue;
      }
      if (p.color === "red") {
        queenPocketed = true;
        continue;
      }
      const value = COIN_VALUE[p.color] || 0;
      coinPoints += value;
      coinCount++;
      score += value * 2;
    }
    if (strikerFoul) return score;
    if (queenPocketed) {
      if (coinCount > 0) {
        score += COIN_VALUE.red * 2;
      } else {
        score -= 80;
      }
    }
    if (coinCount > 1) score += coinCount * 15;
    const forward = baselineFor(state.turn) > BOARD_SIZE / 2 ? shot.vy < 0 : shot.vy > 0;
    if (forward) score += 4;
    if (difficulty === DIFFICULTY.HARD) {
      const remainingValue = state.coins.filter((c) => c.active && c.color !== "red").reduce((sum, c) => sum + (COIN_VALUE[c.color] || 0), 0);
      score += coinPoints / Math.max(1, remainingValue) * 30;
    }
    if (pocketed.length === 0) score -= 10;
    return score;
  }

  // games/carrom/render/renderer.js
  var Renderer = class {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: false });
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
      this.boardTexture = null;
    }
    _createBoardTexture() {
      const size = BOARD_SIZE;
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#120a06";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#c79b5e";
      ctx.fillRect(MARGIN - 6, MARGIN - 6, PLAY_AREA + 12, PLAY_AREA + 12);
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 280; i++) {
        const y = Math.random() * (PLAY_AREA + 20) + MARGIN - 10;
        const w = Math.random() * PLAY_AREA * 0.6 + PLAY_AREA * 0.2;
        const x = (size - w) / 2 + (Math.random() - 0.5) * 40;
        ctx.strokeStyle = Math.random() < 0.5 ? "#7a4e2a" : "#e6c88a";
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let j = 1; j <= 24; j++) {
          ctx.lineTo(x + w / 24 * j, y + (Math.random() - 0.5) * 6);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = "#2a1a0e";
      ctx.lineWidth = 8;
      ctx.strokeRect(MARGIN - 4, MARGIN - 4, PLAY_AREA + 8, PLAY_AREA + 8);
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      ctx.strokeRect(MARGIN, MARGIN, PLAY_AREA, PLAY_AREA);
      ctx.fillStyle = "rgba(230,205,165,0.06)";
      ctx.fillRect(MARGIN, MARGIN, PLAY_AREA, PLAY_AREA);
      for (const p of POCKETS) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, POCKET_R + 6);
        g.addColorStop(0, "#080503");
        g.addColorStop(0.65, "#1a0f08");
        g.addColorStop(1, "rgba(0,0,0,0.2)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      const cx = size / 2;
      const cy = size / 2;
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
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
      const base1 = MARGIN + BASELINE_OFFSET;
      const base2 = size - MARGIN - BASELINE_OFFSET;
      const lineInset = 26;
      ctx.save();
      ctx.setLineDash([10, 7]);
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(139, 69, 19, 0.92)";
      ctx.shadowColor = "rgba(139, 69, 19, 0.55)";
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
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.beginPath();
      ctx.moveTo(MARGIN + lineInset, base1 + 1);
      ctx.lineTo(size - MARGIN - lineInset, base1 + 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(MARGIN + lineInset, base2 - 1);
      ctx.lineTo(size - MARGIN - lineInset, base2 - 1);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
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
      const shake = state.shakeAmount || 0;
      if (shake > 0.1) {
        ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
      }
      if (!this.boardTexture) this.boardTexture = this._createBoardTexture();
      ctx.drawImage(this.boardTexture, 0, 0, BOARD_SIZE, BOARD_SIZE);
      if (state.phase !== "over") {
        this._drawPlacementGuide(ctx, state);
        this._drawAimGuide(ctx, state);
        this._drawAiPreview(ctx, state);
      }
      const currentSide = state.turn ? getPlayerSide(state, state.turn) : null;
      for (const coin of state.coins) {
        if (!coin.active) continue;
        const highlight = state.mode === "local" && coin.side === currentSide;
        this._drawCoin(ctx, coin, highlight);
      }
      if (state.striker.active) {
        this._drawStriker(ctx, state.striker, state);
      }
      this._drawPocketedSummary(ctx, state);
      this._drawParticles(ctx);
      const grad = ctx.createRadialGradient(BOARD_SIZE / 2, BOARD_SIZE / 2, BOARD_SIZE * 0.35, BOARD_SIZE / 2, BOARD_SIZE / 2, BOARD_SIZE * 0.75);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.18)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);
      ctx.restore();
    }
    _drawCoin(ctx, coin, highlight) {
      ctx.save();
      let base, rim, shine, specWeight;
      if (coin.color === "white") {
        base = "#f5f0e2";
        rim = "#d4cab0";
        shine = "#ffffff";
        specWeight = 0.45;
      } else if (coin.color === "black") {
        base = "#2a2a2a";
        rim = "#151515";
        shine = "#555555";
        specWeight = 0.18;
      } else {
        base = "#d44050";
        rim = "#8a1a26";
        shine = "#ff6b7a";
        specWeight = 0.35;
      }
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.arc(coin.x + 2, coin.y + 2, coin.r, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(
        coin.x - coin.r * 0.35,
        coin.y - coin.r * 0.35,
        coin.r * 0.1,
        coin.x,
        coin.y,
        coin.r
      );
      g.addColorStop(0, shine);
      g.addColorStop(0.55, base);
      g.addColorStop(1, rim);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(coin.x, coin.y, coin.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(coin.x, coin.y, coin.r - 1, 0, Math.PI * 2);
      ctx.stroke();
      const sg = ctx.createRadialGradient(
        coin.x - coin.r * 0.4,
        coin.y - coin.r * 0.45,
        0,
        coin.x,
        coin.y,
        coin.r
      );
      sg.addColorStop(0, `rgba(255,255,255,${specWeight})`);
      sg.addColorStop(0.45, `rgba(255,255,255,${specWeight * 0.2})`);
      sg.addColorStop(1, "rgba(0,0,0,0.1)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(coin.x, coin.y, coin.r, 0, Math.PI * 2);
      ctx.fill();
      if (highlight) {
        ctx.strokeStyle = "rgba(232,188,79,0.65)";
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
        ctx.shadowColor = "rgba(232,188,79,0.55)";
        ctx.shadowBlur = 14;
      }
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.beginPath();
      ctx.arc(striker.x + 2, striker.y + 2, striker.r, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(
        striker.x - striker.r * 0.3,
        striker.y - striker.r * 0.3,
        striker.r * 0.05,
        striker.x,
        striker.y,
        striker.r
      );
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.3, "#e8e4d8");
      g.addColorStop(0.7, "#c8b898");
      g.addColorStop(1, "#8a7a5a");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(striker.x, striker.y, striker.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#b89a50";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(striker.x, striker.y, striker.r * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#8a6a30";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(striker.x, striker.y, striker.r * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#8a7a5a";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(striker.x, striker.y, striker.r - 1, 0, Math.PI * 2);
      ctx.stroke();
      const sg = ctx.createRadialGradient(
        striker.x - striker.r * 0.35,
        striker.y - striker.r * 0.38,
        0,
        striker.x,
        striker.y,
        striker.r
      );
      sg.addColorStop(0, "rgba(255,255,255,0.42)");
      sg.addColorStop(0.5, "rgba(255,255,255,0.08)");
      sg.addColorStop(1, "rgba(0,0,0,0.15)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(striker.x, striker.y, striker.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    _drawAimGuide(ctx, state) {
      if (!state.dragStart || !state.dragCurrent || state.phase !== "aim") return;
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
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + nx * lineLen, sy + ny * lineLen);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(232,188,79,${0.5 + 0.4 * (power / 340)})`;
      ctx.lineWidth = 3.5;
      const angle = Math.atan2(-ny, nx);
      const ratio = power / 340;
      ctx.beginPath();
      ctx.arc(sx, sy, 36, angle - Math.PI * ratio * 0.75, angle + Math.PI * ratio * 0.75);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "bold 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${Math.round(ratio * 100)}%`, sx + nx * 52, sy + ny * 52);
      ctx.restore();
    }
    _drawPlacementGuide(ctx, state) {
      if (state.phase !== "place" || state.aiThinking) return;
      const baselineY2 = state.turn === TURN.P1 ? BOARD_SIZE - MARGIN - BASELINE_OFFSET : MARGIN + BASELINE_OFFSET;
      ctx.save();
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = "rgba(232,188,79,0.75)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(MARGIN + 24, baselineY2);
      ctx.lineTo(BOARD_SIZE - MARGIN - 24, baselineY2);
      ctx.stroke();
      ctx.setLineDash([]);
      const x = state.striker.x;
      const y = baselineY2;
      const valid = true;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = valid ? "#e8bc4f" : "#ff5e5e";
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
      ctx.strokeStyle = "rgba(255,150,80,0.55)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + vx * 8, sy + vy * 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    _drawPocketedSummary(ctx, state) {
      const p1Pocketed = state.coins.filter((c) => !c.active && c.side === state.p1Side).length;
      const p2Pocketed = state.coins.filter((c) => !c.active && c.side === state.p2Side).length;
      const gap = 8;
      const r = 4.5;
      const y = MARGIN - 12;
      ctx.save();
      for (let i = 0; i < p1Pocketed; i++) {
        ctx.fillStyle = state.p1Side === "white" ? "#f5f0e2" : "#2a2a2a";
        ctx.beginPath();
        ctx.arc(BOARD_SIZE - MARGIN - 18 - i * gap, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      for (let i = 0; i < p2Pocketed; i++) {
        ctx.fillStyle = state.p2Side === "white" ? "#f5f0e2" : "#2a2a2a";
        ctx.beginPath();
        ctx.arc(MARGIN + 18 + i * gap, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
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
          x,
          y,
          vx: Math.cos(angle) * speed * spread,
          vy: Math.sin(angle) * speed * spread,
          life: 0.35 + Math.random() * 0.55,
          maxLife: 0.9,
          color,
          r: 1.6 + Math.random() * 2.4
        });
      }
    }
    spawnSparkle(x, y, color) {
      for (let i = 0; i < 10; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 4;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.4 + Math.random() * 0.4,
          maxLife: 0.8,
          color,
          r: 1.2 + Math.random() * 1.5
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
  };

  // games/carrom/audio/audio-manager.js
  var MUTE_KEY = "carrom_muted";
  var AudioManager = class {
    constructor() {
      this.ctx = null;
      this.muted = localStorage.getItem(MUTE_KEY) === "true";
      this.buffers = /* @__PURE__ */ new Map();
      this.assetUrls = {
        striker: "assets/audio/carrom/striker.mp3",
        coin: "assets/audio/carrom/coin.mp3",
        wall: "assets/audio/carrom/wall.mp3",
        pocket: "assets/audio/carrom/pocket.mp3",
        foul: "assets/audio/carrom/foul.mp3",
        queen: "assets/audio/carrom/queen.mp3",
        win: "assets/audio/carrom/win.mp3",
        loss: "assets/audio/carrom/loss.mp3",
        ui: "assets/audio/carrom/ui.mp3"
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
      localStorage.setItem(MUTE_KEY, value ? "true" : "false");
      return this.muted;
    }
    toggleMute() {
      return this.setMute(!this.muted);
    }
    async _ensureContext() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") await this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) {
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
      gain.gain.exponentialRampToValueAtTime(1e-3, this.ctx.currentTime + buffer.duration + 0.05);
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
      filter.type = "bandpass";
      filter.frequency.value = filterFreq;
      filter.Q.value = q;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, this._now());
      gain.gain.exponentialRampToValueAtTime(1e-3, this._now() + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start();
    }
    _tone(freq, duration, type = "sine", volume = 0.15, decay = null) {
      if (this.muted || !this.ctx) return;
      const t = this._now();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(1e-3, t + (decay || duration));
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + (decay || duration));
    }
    _chord(notes, duration, volume = 0.12, type = "sine") {
      notes.forEach((freq, i) => {
        setTimeout(() => this._tone(freq, duration, type, volume, duration * 1.2), i * 70);
      });
    }
    // --- Game events ---
    playStrikerHit(power = 0.5) {
      if (this._playBuffer("striker", 0.7 + power * 0.3)) return;
      const vol = Math.min(0.06 + power * 0.04, 0.22);
      this._noise(0.1, vol, 450, 0.4);
      this._tone(130, 0.08, "triangle", vol * 0.5, 0.08);
    }
    playCoinHit(impact = 1) {
      if (this._playBuffer("coin", 0.6 + impact * 0.2)) return;
      const vol = Math.min(0.04 + impact * 0.015, 0.18);
      const freq = 700 + Math.random() * 500;
      this._tone(freq, 0.06, "sine", vol, 0.05);
      this._noise(0.05, vol * 0.8, 1400, 0.6);
    }
    playWallHit() {
      if (this._playBuffer("wall", 0.7)) return;
      this._tone(220, 0.05, "sine", 0.08, 0.04);
      this._noise(0.04, 0.05, 350, 0.4);
    }
    playPocket() {
      if (this._playBuffer("pocket", 0.75)) return;
      const t = this._now();
      [620, 880, 1100].forEach((freq, i) => {
        setTimeout(() => this._tone(freq, 0.1, "sine", 0.1, 0.12), i * 45);
      });
    }
    playFoul() {
      if (this._playBuffer("foul", 0.8)) return;
      this._tone(160, 0.25, "sawtooth", 0.12, 0.22);
      this._tone(110, 0.3, "triangle", 0.1, 0.28);
      setTimeout(() => this._noise(0.18, 0.07, 280, 0.3), 140);
    }
    playQueen() {
      if (this._playBuffer("queen", 0.8)) return;
      this._tone(880, 0.12, "sine", 0.14, 0.12);
      setTimeout(() => this._tone(1100, 0.14, "sine", 0.12, 0.14), 60);
      setTimeout(() => this._tone(1320, 0.16, "sine", 0.1, 0.16), 120);
    }
    playWin() {
      if (this.muted) return;
      if (this._playBuffer("win", 0.8)) return;
      this._chord([523, 659, 784, 1047], 0.35, 0.14, "sine");
    }
    playLoss() {
      if (this.muted) return;
      if (this._playBuffer("loss", 0.8)) return;
      this._chord([392, 330, 294, 247], 0.4, 0.12, "triangle");
    }
    playAim() {
      if (this._playBuffer("ui", 0.35)) return;
      this._tone(520, 0.035, "sine", 0.035, 0.035);
    }
    playUi() {
      if (this._playBuffer("ui", 0.4)) return;
      this._tone(720, 0.045, "sine", 0.045, 0.045);
    }
  };

  // games/carrom/app/game.js
  function mapHostMode(mode) {
    if (mode === GAME_MODE.AI || mode === "ai") return GAME_MODE.AI;
    if (mode === GAME_MODE.LOCAL || mode === "local" || mode === "pvp") return GAME_MODE.LOCAL;
    return GAME_MODE.AI;
  }
  var CarromGame = class {
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
      window.addEventListener("resize", this._onResize);
      canvas.addEventListener("pointerdown", this._onPointerDown);
      canvas.addEventListener("pointermove", this._onPointerMove);
      window.addEventListener("pointerup", this._onPointerUp);
      canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
      canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
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
      this.resize();
      if (!this.running) {
        this.running = true;
        this.lastTime = performance.now();
        this.rafId = requestAnimationFrame((t) => this.loop(t));
      }
    }
    startNew(mode, difficulty) {
      const humanSide = this.options.humanColor === "b" ? "black" : "white";
      this.state = createInitialState(mode, difficulty, { humanSide });
      this.state.options = {
        mode,
        difficulty,
        wager: this.options.wager || 0
      };
      this._resetStrikerForTurn();
      this.state.phase = PHASE.PLACE_STRIKER;
      this.state.inputEnabled = true;
      this.state.aiThinking = false;
    }
    resumeState(savedState) {
      let raw = typeof savedState === "string" ? JSON.parse(savedState) : savedState;
      this.state = cloneState(raw);
      this.state.options = {
        mode: this.state.mode,
        difficulty: this.state.difficulty,
        wager: this.options.wager || this.state.options?.wager || 0
      };
      this.state.phase = PHASE.PLACE_STRIKER;
      this.state.inputEnabled = this.state.mode === GAME_MODE.LOCAL || this.state.turn === TURN.P1;
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
        wager: this.options.wager || clean.options?.wager || 0
      };
      return clean;
    }
    destroy() {
      this.running = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.aiTimeouts.forEach((id) => clearTimeout(id));
      this.aiTimeouts = [];
      window.removeEventListener("resize", this._onResize);
      this.canvas.removeEventListener("pointerdown", this._onPointerDown);
      this.canvas.removeEventListener("pointermove", this._onPointerMove);
      window.removeEventListener("pointerup", this._onPointerUp);
      this.state = null;
      this.sim = null;
    }
    // ---- Loop ----
    loop(timestamp) {
      if (!this.running) return;
      this.rafId = requestAnimationFrame((t) => this.loop(t));
      const dt = Math.min((timestamp - this.lastTime) / 1e3, 0.05);
      this.lastTime = timestamp;
      if (!this.state) {
        this.renderer.draw({});
        return;
      }
      if (this.state.phase === PHASE.GAME_OVER) {
        this.renderer.draw(this.state);
        return;
      }
      if (this.state.phase === PHASE.PLACE_STRIKER && this.state.mode === GAME_MODE.AI && this.state.turn === TURN.P2 && !this.state.aiThinking) {
        this.aiTimer += dt;
        if (this.aiTimer > 0.55) {
          this.aiTimer = 0;
          this._runAI();
        }
      }
      if (this.state.phase === PHASE.SHOT_ACTIVE) {
        if (!this.sim) this.sim = new Simulation(this.state);
        const { remainingAcc, totalImpact } = this.sim.substep(this.state.accumulator + dt);
        this.state.accumulator = remainingAcc;
        if (totalImpact > 2) {
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
      this.renderer.updateParticles(dt);
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
      return this.state && this.state.phase !== PHASE.GAME_OVER && this.state.inputEnabled && !this.state.aiThinking;
    }
    _canvasPos(e) {
      const rect = this.canvas.getBoundingClientRect();
      const scale = BOARD_SIZE / rect.width;
      return {
        x: (e.clientX - rect.left) * scale,
        y: (e.clientY - rect.top) * scale
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
      const baselineY2 = baselineFor(this.state.turn);
      const minX = MARGIN + STRIKER_R + 3;
      const maxX = BOARD_SIZE - MARGIN - STRIKER_R - 3;
      let x = Math.max(minX, Math.min(maxX, pos.x));
      x = findClearStrikerX(baselineY2, this.state.coins, x);
      this.state.striker.x = x;
      this.state.striker.y = baselineY2;
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
        if (ev.type === "collision") {
          if (ev.impulse > maxCoinImpulse) maxCoinImpulse = ev.impulse;
          if (ev.impulse > 1.2) {
            const a = this._findBody(ev.aId);
            const b = this._findBody(ev.bId);
            if (a && b) {
              this.renderer.spawnSparkle((a.x + b.x) / 2, (a.y + b.y) / 2, "rgba(255,255,200,0.8)");
            }
          }
          if (ev.aId === "striker" || ev.bId === "striker") {
            if (ev.impulse > strikerHitImpulse) strikerHitImpulse = ev.impulse;
          }
        } else if (ev.type === "cushion") {
          if (ev.impact > maxWallImpulse) maxWallImpulse = ev.impact;
        } else if (ev.type === "pocket") {
          this._onPocketEvent(ev);
        }
      }
      this.eventIndex = events.length;
      if (strikerHitImpulse > 0) this.audio.playStrikerHit(Math.min(strikerHitImpulse / 8, 1));
      else if (maxCoinImpulse > 0.5) this.audio.playCoinHit(Math.min(maxCoinImpulse / 6, 1));
      if (maxWallImpulse > 1.5) this.audio.playWallHit();
    }
    _findBody(id) {
      if (id === "striker") return this.state.striker;
      return this.state.coins.find((c) => c.id === id);
    }
    _onPocketEvent(ev) {
      const pocket = { x: ev.x, y: ev.y };
      if (ev.bodyType === "coin") {
        if (ev.color === "red") {
          this.audio.playQueen();
          this.renderer.spawnSparkle(pocket.x, pocket.y, "#ffcf4d");
        } else {
          this.audio.playPocket();
        }
        const color = ev.color === "white" ? "#f5f0e2" : ev.color === "black" ? "#2a2a2a" : "#ff5e6e";
        this.renderer.spawnParticles(pocket.x, pocket.y, color, 14);
      } else if (ev.bodyType === "striker") {
        this.audio.playFoul();
        this.renderer.spawnParticles(pocket.x, pocket.y, "#e8bc4f", 22, 3.5);
      }
    }
    _finishShot() {
      if (!this.sim) return;
      const pocketEvents = this.sim.events.filter((e) => e.type === "pocket");
      const patch = resolveTurn(this.state, pocketEvents);
      applyTurnPatch(this.state, patch);
      this.sim = null;
      this.eventIndex = 0;
      if (patch.result === "foul") {
        this.audio.playFoul();
      }
      if (patch.gameOverWinner) {
        this._onGameOver(patch.gameOverWinner);
        return;
      }
      this._resetStrikerForTurn();
      this.state.phase = PHASE.PLACE_STRIKER;
      this.state.inputEnabled = this.state.mode === GAME_MODE.LOCAL || this.state.turn === TURN.P1;
      this.state.aiThinking = false;
      this.state.dragStart = null;
      this.state.dragCurrent = null;
      this._emitStateChangeThrottled();
    }
    _resetStrikerForTurn() {
      const baselineY2 = baselineFor(this.state.turn);
      const x = findClearStrikerX(baselineY2, this.state.coins, BOARD_SIZE / 2);
      this.state.striker.x = x;
      this.state.striker.y = baselineY2;
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
        game: "Carrom Clash",
        winner: winner === TURN.P1 ? "p1" : "p2",
        scores: { ...this.state.scores }
      };
      if (userWon) this.audio.playWin();
      else this.audio.playLoss();
      if (typeof this.options.onGameOver === "function") {
        this.options.onGameOver(payload);
      }
      this._emitStateChangeThrottled();
    }
    _emitStateChangeThrottled() {
      if (typeof this.options.onStateChange !== "function") return;
      const now = performance.now();
      if (now - this.lastStateChange < 500) return;
      this.lastStateChange = now;
      try {
        this.options.onStateChange(this.state);
      } catch (e) {
      }
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
  };

  // games/carrom/main.js
  var game;
  var selectedDifficulty = DIFFICULTY.MEDIUM;
  function init() {
    const canvas = document.getElementById("gameCanvas");
    if (!canvas) return;
    game = new CarromGame(canvas, {
      onGameOver: showResult,
      onStateChange: updateHUD
    });
    document.querySelectorAll(".player-target").forEach((el) => {
      el.textContent = `/ ${WIN_SCORE}`;
    });
    document.querySelectorAll(".diff-btn").forEach((btn) => {
      btn.addEventListener("click", () => selectDifficulty(btn.dataset.diff));
    });
    document.getElementById("btnAiEasy")?.addEventListener("click", () => selectDifficulty("easy"));
    document.getElementById("btnAiMed")?.addEventListener("click", () => selectDifficulty("medium"));
    document.getElementById("btnAiHard")?.addEventListener("click", () => selectDifficulty("hard"));
    document.getElementById("btnPlayAi")?.addEventListener("click", () => startGame(GAME_MODE.AI, selectedDifficulty));
    document.querySelectorAll(".js-start").forEach((btn) => {
      btn.addEventListener("click", () => startGame(GAME_MODE.AI, selectedDifficulty));
    });
    document.getElementById("btnLocal")?.addEventListener("click", () => startGame(GAME_MODE.LOCAL, DIFFICULTY.MEDIUM));
    document.getElementById("btnRematch")?.addEventListener("click", () => {
      const mode = game.state?.mode || GAME_MODE.AI;
      const diff = game.state?.difficulty || selectedDifficulty;
      hideResult();
      startGame(mode, diff);
    });
    document.getElementById("btnMenu")?.addEventListener("click", backToMenu);
    document.getElementById("btnLobby")?.addEventListener("click", backToMenu);
    document.getElementById("btnSound")?.addEventListener("click", () => {
      const muted = game.toggleMute();
      updateSoundIcon(muted);
    });
    updateSoundIcon(game.audio.isMuted());
    window.addEventListener("keydown", (e) => {
      if (typeof window.gameCommon !== "undefined" && window.gameCommon) return;
      if (e.key === "Escape" && game.state && game.state.phase !== PHASE.GAME_OVER) {
        backToMenu();
      }
    });
    if (typeof window.setupCarromGameCommon === "function") {
      window.setupCarromGameCommon({ startGame, backToMenu, getGame: () => game });
    }
  }
  function selectDifficulty(diff) {
    selectedDifficulty = diff;
    document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("active"));
    const btn = document.getElementById(diff === "easy" ? "btnAiEasy" : diff === "medium" ? "btnAiMed" : "btnAiHard");
    btn?.classList.add("active");
  }
  function startGame(mode, difficulty) {
    hideResult();
    document.getElementById("menuScreen")?.classList.add("hidden");
    document.getElementById("gameScreen")?.classList.remove("hidden");
    game.startNew(mode, difficulty);
    game.start();
    updateHUD(game.getState());
    if (typeof window.gameCommon !== "undefined" && window.gameCommon.startGamePlay) {
      window.gameCommon.startGamePlay();
    }
  }
  function backToMenu() {
    game.destroy();
    document.getElementById("menuScreen")?.classList.remove("hidden");
    document.getElementById("gameScreen")?.classList.add("hidden");
    hideResult();
    const canvas = document.getElementById("gameCanvas");
    game = new CarromGame(canvas, {
      onGameOver: showResult,
      onStateChange: updateHUD
    });
  }
  function showResult(result) {
    const state = game.getState();
    const won = result.winner === "p1";
    const details = `Final score \u2014 ${state.scores.p1} vs ${state.scores.p2} (target ${WIN_SCORE})`;
    if (typeof window.gameCommon !== "undefined" && window.gameCommon.showResult) {
      window.gameCommon.showResult(won, details);
      return;
    }
    const modal = document.getElementById("resultModal");
    const title = document.getElementById("resultTitle");
    const msg = document.getElementById("resultMsg");
    let titleText;
    let titleClass = "winner-text";
    if (state.mode === GAME_MODE.AI) {
      if (result.winner === "p1") {
        titleText = "\u{1F3C6} You Win!";
      } else {
        titleText = "\u{1F614} AI Wins";
        titleClass = "loser-text";
      }
    } else {
      titleText = result.winner === "p1" ? "\u{1F3C6} Player 1 Wins!" : "\u{1F3C6} Player 2 Wins!";
    }
    if (title) {
      title.textContent = titleText;
      title.className = titleClass;
    }
    if (msg) {
      msg.textContent = `Final score \u2014 ${state.scores.p1} vs ${state.scores.p2} (target ${WIN_SCORE})`;
    }
    modal?.classList.add("show");
  }
  function hideResult() {
    document.getElementById("resultModal")?.classList.remove("show");
  }
  function updateSoundIcon(muted) {
    const btn = document.getElementById("btnSound");
    if (btn) btn.textContent = muted ? "\u{1F507}" : "\u{1F50A}";
  }
  function updateHUD(state) {
    if (!state) return;
    const p1El = document.getElementById("p1Info");
    const p2El = document.getElementById("p2Info");
    if (state.mode === GAME_MODE.AI) {
      p1El?.querySelector(".player-name")?.setAttribute("data-name", "You");
      p2El?.querySelector(".player-name")?.setAttribute("data-name", "AI");
      if (p1El?.querySelector(".player-name")) p1El.querySelector(".player-name").textContent = "You";
      if (p2El?.querySelector(".player-name")) p2El.querySelector(".player-name").textContent = "AI";
    } else {
      if (p1El?.querySelector(".player-name")) p1El.querySelector(".player-name").textContent = "Player 1";
      if (p2El?.querySelector(".player-name")) p2El.querySelector(".player-name").textContent = "Player 2";
    }
    if (p1El?.querySelector(".player-score")) p1El.querySelector(".player-score").textContent = state.scores.p1;
    if (p2El?.querySelector(".player-score")) p2El.querySelector(".player-score").textContent = state.scores.p2;
    const lastPotEl = document.getElementById("lastPot");
    if (lastPotEl) {
      if (!state.lastPots || state.lastPots.length === 0) {
        lastPotEl.innerHTML = 'Last pot: <span class="pot-dot" style="background:transparent;border-color:rgba(255,255,255,0.15);"></span>';
      } else {
        const dots = state.lastPots.map((c) => `<span class="pot-dot ${c}"></span>`).join("");
        lastPotEl.innerHTML = `Last pot: ${dots}`;
      }
    }
    if (p1El?.querySelector(".player-dot")) {
      p1El.querySelector(".player-dot").className = "player-dot " + (state.p1Side === "white" ? "white-dot" : "black-dot");
    }
    if (p2El?.querySelector(".player-dot")) {
      p2El.querySelector(".player-dot").className = "player-dot " + (state.p2Side === "white" ? "white-dot" : "black-dot");
    }
    p1El?.classList.toggle("active-player", state.turn === TURN.P1);
    p2El?.classList.toggle("active-player", state.turn === TURN.P2);
    const turnEl = document.getElementById("turnIndicator");
    if (turnEl) {
      if (state.mode === GAME_MODE.AI) {
        turnEl.textContent = state.turn === TURN.P1 ? "Your Turn" : "AI Thinking";
      } else {
        turnEl.textContent = state.turn === TURN.P1 ? "Player 1 Turn" : "Player 2 Turn";
      }
    }
    const qEl = document.getElementById("queenStatus");
    if (qEl) {
      if (state.queenCovered) {
        qEl.textContent = "\u{1F451} Queen Covered";
        qEl.className = "queen-status queen-covered";
      } else if (state.queenPocketedBy) {
        qEl.textContent = "\u{1F451} Cover the Queen!";
        qEl.className = "queen-status queen-pending";
      } else {
        const queen = getQueen(state.coins);
        const active = queen && queen.active;
        qEl.textContent = active ? "\u{1F451} Queen Active" : "\u{1F451} Queen Pocketed";
        qEl.className = "queen-status " + (active ? "queen-active" : "queen-pending");
      }
    }
    const inst = document.getElementById("instruction");
    if (inst) {
      if (state.lastShotMessage && state.phase === PHASE.PLACE_STRIKER) {
        inst.textContent = state.lastShotMessage;
      } else if (state.phase === PHASE.PLACE_STRIKER) {
        const isHumanTurn = state.mode === GAME_MODE.LOCAL || state.turn === TURN.P1;
        inst.textContent = isHumanTurn ? "Tap the board or drag the striker to aim \u2014 release to shoot" : "AI is deciding its next move...";
      } else if (state.phase === PHASE.AIMING) {
        inst.textContent = "Pull back to set power, then release to strike";
      } else if (state.phase === PHASE.SHOT_ACTIVE) {
        inst.textContent = "Shot in progress...";
      } else if (state.phase === PHASE.GAME_OVER) {
        inst.textContent = "Game over";
      } else {
        inst.textContent = "";
      }
    }
  }
  window.CarromClash = CarromGame;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
