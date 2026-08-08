/* === Carrom State — canonical constants, initial state, and helpers === */

export const PHASE = {
  MENU: 'menu',
  PLACE_STRIKER: 'place',
  AIMING: 'aim',
  SHOT_ACTIVE: 'shot',
  SETTLING: 'settle',
  RESOLVING: 'resolve',
  GAME_OVER: 'over',
};

export const TURN = { P1: 'p1', P2: 'p2' };
export const SIDE = { WHITE: 'white', BLACK: 'black' };
export const GAME_MODE = { AI: 'ai', LOCAL: 'local', PVP: 'pvp' };
export const DIFFICULTY = { EASY: 'easy', MEDIUM: 'medium', HARD: 'hard' };

// Logical board coordinates
export const BOARD_SIZE = 700;
export const MARGIN = 42;
export const PLAY_AREA = BOARD_SIZE - MARGIN * 2;
export const COIN_R = 16;
export const STRIKER_R = 21;
export const POCKET_R = 26;
export const BASELINE_OFFSET = PLAY_AREA * 0.09;

// Physics constants (units are logical px/sec)
export const STRIKER_MASS = 4;
export const COIN_MASS = 1;
export const RESTITUTION = 0.92;
export const WALL_RESTITUTION = 0.72;
export const DAMPING = 1.1; // per-second velocity decay
export const STOP_SPEED = 1.2;
export const MAX_POWER = 720;
export const FIXED_DT = 1 / 120;
export const SUB_STEPS = 8;
export const SETTLE_TIME = 0.28;
export const MIN_DRAG = 10;

export const POCKETS = [
  { id: 0, x: MARGIN + 10, y: MARGIN + 10 },
  { id: 1, x: BOARD_SIZE - MARGIN - 10, y: MARGIN + 10 },
  { id: 2, x: MARGIN + 10, y: BOARD_SIZE - MARGIN - 10 },
  { id: 3, x: BOARD_SIZE - MARGIN - 10, y: BOARD_SIZE - MARGIN - 10 },
];

function baselineY(player) {
  return player === TURN.P1
    ? BOARD_SIZE - MARGIN - BASELINE_OFFSET
    : MARGIN + BASELINE_OFFSET;
}

// Standard 19-coin carrom arrangement: red at center, two alternating rings.
function makeCoins() {
  const cx = BOARD_SIZE / 2;
  const cy = BOARD_SIZE / 2;
  const gap = COIN_R * 2 + 4.0;
  const coins = [];
  let id = 0;

  // Red queen
  coins.push({
    id: id++,
    x: cx, y: cy, vx: 0, vy: 0,
    r: COIN_R, color: 'red', side: 'queen',
    mass: COIN_MASS, active: true,
  });

  // Inner ring: 6 coins alternating, starting black at 0°
  const innerCount = 6;
  for (let i = 0; i < innerCount; i++) {
    const angle = (i * 2 * Math.PI) / innerCount;
    coins.push({
      id: id++,
      x: cx + Math.cos(angle) * gap,
      y: cy + Math.sin(angle) * gap,
      vx: 0, vy: 0,
      r: COIN_R,
      color: i % 2 === 0 ? SIDE.BLACK : SIDE.WHITE,
      side: i % 2 === 0 ? SIDE.BLACK : SIDE.WHITE,
      mass: COIN_MASS, active: true,
    });
  }

  // Outer ring: 12 coins alternating, starting white at 15°
  const outerCount = 12;
  for (let i = 0; i < outerCount; i++) {
    const angle = (Math.PI / 12) + (i * 2 * Math.PI) / outerCount;
    coins.push({
      id: id++,
      x: cx + Math.cos(angle) * (gap * 2),
      y: cy + Math.sin(angle) * (gap * 2),
      vx: 0, vy: 0,
      r: COIN_R,
      color: i % 2 === 0 ? SIDE.WHITE : SIDE.BLACK,
      side: i % 2 === 0 ? SIDE.WHITE : SIDE.BLACK,
      mass: COIN_MASS, active: true,
    });
  }

  return coins;
}

export function getQueen(coins) {
  return coins.find(c => c.color === 'red');
}

export function createInitialState(mode, difficulty, options = {}) {
  const coins = makeCoins();
  let p1Side = SIDE.WHITE;
  if (mode === GAME_MODE.LOCAL) {
    p1Side = SIDE.WHITE;
  } else if (options.humanSide === 'black') {
    p1Side = SIDE.BLACK;
  } else if (options.humanSide === 'white') {
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
      vx: 0, vy: 0,
      r: STRIKER_R,
      side: TURN.P1,
      mass: STRIKER_MASS,
      active: true,
    },
    scores: { p1: 0, p2: 0 },
    coinsPocketed: { p1: 0, p2: 0 },
    queenPocketedBy: null,
    queenCovered: false,
    lastShotResult: null,
    lastShotMessage: '',
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
    options,
  };
}

export function getPlayerSide(state, player) {
  return player === TURN.P1 ? state.p1Side : state.p2Side;
}

export function getOpponent(player) {
  return player === TURN.P1 ? TURN.P2 : TURN.P1;
}

export function getActiveCoins(coins) {
  return coins.filter(c => c.active);
}

export function getPlayerCoins(state, player) {
  const side = getPlayerSide(state, player);
  return state.coins.filter(c => c.active && c.side === side);
}

export function baselineFor(player) {
  return baselineY(player);
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
