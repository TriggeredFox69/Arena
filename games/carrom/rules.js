/* === Carrom Rules Engine — pure functions, no side effects === */
import { TURN, getPlayerSide, getOpponent, getQueen } from './state.js';

/**
 * resolveShot(state, pocketedItems) -> result object
 *
 * pocketedItems: array of {type:'coin', color, side} | {type:'striker'}
 *
 * Returns:
 * {
 *   result: 'continue' | 'switch' | 'foul',
 *   scores: { p1, p2 } additions,
 *   message: string,
 *   queenReturned: bool,
 *   strikerFoul: bool,
 * }
 */
export function resolveShot(state, pocketedItems) {
  const currentPlayer = state.turn;
  const opponent = getOpponent(currentPlayer);
  const playerSide = getPlayerSide(state, currentPlayer);

  const pockCoins = pocketedItems.filter(p => p.type === 'coin');
  const strikerFoul = pocketedItems.some(p => p.type === 'striker');

  let scoreAdd = { p1: 0, p2: 0 };
  let result = 'switch';  // default: turn switches
  let message = '';
  let queenReturned = false;
  let strikerFoulFlag = false;

  // --- Striker foul ---
  if (strikerFoul) {
    strikerFoulFlag = true;
    result = 'foul';
    scoreAdd[opponent] += 10;

    // Return any coins pocketed on a striker foul
    for (const pc of pockCoins) {
      if (pc.color === 'red') {
        queenReturned = true;
        state.queenPocketedBy = null;
        state.queenCovered = false;
      } else {
        // Return the coin (will be handled by caller)
      }
    }

    message = 'Striker pocketed! Foul — opponent gains +10';
    return {
      result,
      scores: scoreAdd,
      message,
      queenReturned,
      coinsReturned: pockCoins.filter(p => p.color !== 'red'),
      strikerFoul: true,
    };
  }

  // --- Nothing pocketed ---
  if (pockCoins.length === 0) {
    message = 'Miss! Turn switches.';
    return { result: 'switch', scores: scoreAdd, message, queenReturned: false, coinsReturned: [], strikerFoul: false };
  }

  // --- Analyze pocketed coins ---
  const queenPocketed = pockCoins.find(p => p.color === 'red');
  const ownPocketed = pockCoins.filter(p => p.side === playerSide);
  const oppPocketed = pockCoins.filter(p => p.side !== playerSide && p.color !== 'red');

  // --- Queen handling ---
  if (queenPocketed) {
    if (state.queenPocketedBy === null) {
      // First time queen pocketed
      state.queenPocketedBy = currentPlayer;

      // Check for cover: must have at least one own coin in same shot
      if (ownPocketed.length > 0 || state.queenCovered) {
        state.queenCovered = true;
        scoreAdd[currentPlayer] += 20;  // queen bonus
        message += 'Queen pocketed and covered! +20. ';
        result = 'continue';
      } else {
        // Queen pocketed without cover
        queenReturned = true;
        state.queenPocketedBy = null;
        scoreAdd[opponent] += 5;
        message += 'Queen pocketed without cover! Queen returns. ';
        result = 'foul';
      }
    } else if (!state.queenCovered) {
      // Queen was pending, now pocketed again
      state.queenCovered = true;
      scoreAdd[currentPlayer] += 20;
      message += 'Queen covered! +20. ';
      if (ownPocketed.length > 0) result = 'continue';
    }
  }

  // --- Own coins pocketed ---
  if (ownPocketed.length > 0 && result !== 'foul') {
    scoreAdd[currentPlayer] += ownPocketed.length * 10;
    message += `${ownPocketed.length} own coin(s) pocketed! `;
    result = 'continue';
  }

  // --- Opponent coins pocketed ---
  if (oppPocketed.length > 0) {
    scoreAdd[opponent] += oppPocketed.length * 10;
    message += `${oppPocketed.length} opponent coin(s) pocketed. `;
    result = 'switch';  // opponent coins end your turn
  }

  // --- First blood rule: if no own coins pocketed but some pocketed ---
  if (pockCoins.length > 0 && ownPocketed.length === 0 && !queenPocketed && result !== 'foul') {
    result = 'switch';
  }

  // --- If striker foul wasn't flagged but something went wrong ---
  if (result === 'switch' && ownPocketed.length === 0 && oppPocketed.length === 0 && !queenPocketed) {
    result = 'switch';
    message = message || 'No scoring shot. Turn switches.';
  }

  // --- Award queen points if already covered ---
  if (state.queenCovered && ownPocketed.length > 0 && result === 'continue') {
    scoreAdd[currentPlayer] += 5;
  }

  if (!message) message = 'Turn continues.';

  return {
    result,  // 'continue' | 'switch' | 'foul'
    scores: scoreAdd,
    message: message.trim(),
    queenReturned,
    coinsReturned: [],
    strikerFoul: false,
  };
}

/**
 * Check if game is over.
 * Game ends when one player has pocketed all their coins and the queen is covered.
 */
export function checkGameEnd(state) {
  const p1Side = state.p1Side;
  const p2Side = state.p2Side;

  const p1Remaining = state.coins.filter(c => c.active && c.side === p1Side).length;
  const p2Remaining = state.coins.filter(c => c.active && c.side === p2Side).length;
  const queenActive = state.coins.some(c => c.active && c.color === 'red');

  // Queen must be covered for game to end
  if (!state.queenCovered) return null;

  if (p1Remaining === 0) return TURN.P1;
  if (p2Remaining === 0) return TURN.P2;

  return null;
}

/**
 * Handle returning the queen to center position.
 * Returns new queen state or null if no queen active.
 */
export function returnQueenToCenter(state) {
  const queen = getQueen(state.coins);
  if (!queen) return;

  queen.active = true;
  queen.x = 350;  // BOARD_SIZE/2
  queen.y = 350;
  queen.vx = 0;
  queen.vy = 0;
}

/**
 * Return a specific coin to center
 */
export function returnCoinToCenter(coin) {
  coin.active = true;
  coin.x = 340 + Math.random() * 20;
  coin.y = 340 + Math.random() * 20;
  coin.vx = 0;
  coin.vy = 0;
}
