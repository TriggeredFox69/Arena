/* === Carrom Rules Engine — point-based race to WIN_SCORE === */

import { TURN, PHASE, getOpponent, getQueen, BOARD_SIZE, COIN_R, STRIKER_R, WIN_SCORE, COIN_VALUE } from '../state.js';

function findClearReturnPosition(state, body) {
  const cx = BOARD_SIZE / 2;
  const cy = BOARD_SIZE / 2;
  const step = 3;
  const maxRadius = 160;

  for (let r = 0; r <= maxRadius; r += step) {
    const checks = r === 0 ? 1 : Math.max(4, Math.floor((2 * Math.PI * r) / (body.r * 2.5)));
    for (let i = 0; i < checks; i++) {
      const angle = (i / checks) * Math.PI * 2 + (r * 0.37);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      let clear = true;
      const minDist = (body.r + COIN_R + 1) ** 2;
      const strikerMinDist = (body.r + STRIKER_R + 1) ** 2;
      for (const c of state.coins) {
        if (!c.active || c.id === body.id) continue;
        const dx = x - c.x;
        const dy = y - c.y;
        if (dx * dx + dy * dy < minDist) { clear = false; break; }
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

export function resolveTurn(state, pocketEvents) {
  const current = state.turn;
  const opponent = getOpponent(current);

  const scores = { p1: 0, p2: 0 };
  let message = '';
  let result = 'switch';
  let turnSwitches = true;
  let queenCovered = state.queenCovered;
  let queenPocketedBy = state.queenPocketedBy;
  let returnedCoinIds = [];
  let gameOverWinner = null;
  const lastPots = [];

  const strikerFoul = pocketEvents.some(e => e.type === 'pocket' && e.bodyType === 'striker');
  const coinPockets = pocketEvents.filter(e => e.type === 'pocket' && e.bodyType === 'coin');
  const queenPocketedThisShot = coinPockets.find(e => e.color === 'red');
  const nonQueenPockets = coinPockets.filter(e => e.color !== 'red');

  function queueReturn(id) {
    if (!returnedCoinIds.includes(id)) returnedCoinIds.push(id);
  }

  // Track last potted colors for the HUD.
  for (const e of coinPockets) lastPots.push(e.color);

  // --- Striker foul: no points, return everything pocketed this shot ---
  if (strikerFoul) {
    result = 'foul';
    message = 'Striker pocketed — foul! No points.';
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

  // --- Nothing pocketed ---
  if (coinPockets.length === 0) {
    message = 'No coins pocketed — turn passes.';
    if (queenPocketedBy === current && !queenCovered) {
      const queen = getQueen(state.coins);
      if (queen) queueReturn(queen.id);
      queenPocketedBy = null;
    }
    return buildPatch();
  }

  // --- Score black/white coins by color value ---
  let turnPoints = 0;
  for (const e of nonQueenPockets) {
    const value = COIN_VALUE[e.color] || 0;
    turnPoints += value;
  }
  if (turnPoints > 0) {
    scores[current] += turnPoints;
    message += `+${turnPoints} points. `;
  }

  // --- Queen handling: must be covered by a black/white coin in this or a later turn ---
  const coveredNow = queenPocketedThisShot && nonQueenPockets.length > 0;
  const coverPending = !queenCovered && queenPocketedBy === current && nonQueenPockets.length > 0;

  if (coveredNow || coverPending) {
    queenCovered = true;
    queenPocketedBy = current;
    scores[current] += COIN_VALUE.red;
    message += `Queen covered! +${COIN_VALUE.red}. `;
  } else if (queenPocketedThisShot && !queenCovered) {
    queenPocketedBy = current;
    message += 'Queen pocketed — cover it with a coin to keep it. ';
  }

  // --- Queen pocketed without any cover coin: it returns when turn passes ---
  if (queenPocketedThisShot && !queenCovered && nonQueenPockets.length === 0) {
    result = 'switch';
    turnSwitches = true;
    const queen = getQueen(state.coins);
    if (queen) queueReturn(queen.id);
    queenPocketedBy = null;
    message = 'Queen pocketed without cover — it returns to the center.';
    return buildPatch();
  }

  // --- Turn continues if any coin was pocketed, else passes ---
  if (coinPockets.length > 0) {
    result = 'continue';
    turnSwitches = false;
  }

  // --- If turn passes while queen is pending, return it ---
  if (turnSwitches && queenPocketedBy === current && !queenCovered) {
    const queen = getQueen(state.coins);
    if (queen) queueReturn(queen.id);
    queenPocketedBy = null;
  }

  if (!message) message = 'Turn continues.';

  return buildPatch();

  function buildPatch() {
    const p1Score = state.scores.p1 + scores.p1;
    const p2Score = state.scores.p2 + scores.p2;
    const remainingCoins = state.coins.filter(c => c.active && c.color !== 'red').length;

    // First to WIN_SCORE wins immediately.
    if (p1Score >= WIN_SCORE) gameOverWinner = TURN.P1;
    else if (p2Score >= WIN_SCORE) gameOverWinner = TURN.P2;
    // If the board is clear, highest score wins.
    else if (remainingCoins === 0) {
      if (p1Score > p2Score) gameOverWinner = TURN.P1;
      else if (p2Score > p1Score) gameOverWinner = TURN.P2;
      else gameOverWinner = current; // tie-break to the player who cleared the board
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
      lastPots,
    };
  }
}

export function applyTurnPatch(state, patch) {
  state.scores.p1 += patch.scores.p1 || 0;
  state.scores.p2 += patch.scores.p2 || 0;
  state.lastShotResult = patch.result;
  state.lastShotMessage = patch.message;
  state.queenCovered = patch.queenCovered;
  state.queenPocketedBy = patch.queenPocketedBy;
  state.lastPots = (patch.lastPots || []).slice(-3);

  for (const id of patch.returnedCoinIds) {
    const coin = state.coins.find(c => c.id === id);
    if (!coin) continue;
    const pos = findClearReturnPosition(state, coin);
    coin.active = true;
    coin.x = pos.x;
    coin.y = pos.y;
    coin.vx = 0;
    coin.vy = 0;
  }

  state.coinsPocketed.p1 = state.coins.filter(c => !c.active && c.side === state.p1Side).length;
  state.coinsPocketed.p2 = state.coins.filter(c => !c.active && c.side === state.p2Side).length;

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
