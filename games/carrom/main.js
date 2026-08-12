/* === Carrom Main — standalone bootstrap and shell wiring === */

import { CarromGame } from './app/game.js';
import { PHASE, TURN, GAME_MODE, DIFFICULTY, WIN_SCORE, getQueen } from './state.js';

let game;
let selectedDifficulty = DIFFICULTY.MEDIUM;

function init() {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;

  game = new CarromGame(canvas, {
    onGameOver: showResult,
    onStateChange: updateHUD,
  });
  window.carromGame = game;
  window.CARROM_GAME_MODE = GAME_MODE;

  // Score target labels
  document.querySelectorAll('.player-target').forEach(el => {
    el.textContent = `/ ${WIN_SCORE}`;
  });

  // Menu wiring
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => selectDifficulty(btn.dataset.diff));
  });
  document.getElementById('btnAiEasy')?.addEventListener('click', () => selectDifficulty('easy'));
  document.getElementById('btnAiMed')?.addEventListener('click', () => selectDifficulty('medium'));
  document.getElementById('btnAiHard')?.addEventListener('click', () => selectDifficulty('hard'));

  document.getElementById('btnPlayAi')?.addEventListener('click', () => startGame(GAME_MODE.AI, selectedDifficulty));
  document.querySelectorAll('.js-start').forEach(btn => {
    btn.addEventListener('click', () => startGame(GAME_MODE.AI, selectedDifficulty));
  });
  document.getElementById('btnLocal')?.addEventListener('click', () => startGame(GAME_MODE.LOCAL, DIFFICULTY.MEDIUM));

  document.getElementById('btnRematch')?.addEventListener('click', () => {
    const mode = game.state?.mode || GAME_MODE.AI;
    const diff = game.state?.difficulty || selectedDifficulty;
    hideResult();
    startGame(mode, diff);
  });
  document.getElementById('btnMenu')?.addEventListener('click', backToMenu);
  document.getElementById('btnLobby')?.addEventListener('click', backToMenu);

  document.getElementById('btnSound')?.addEventListener('click', () => {
    const muted = game.toggleMute();
    updateSoundIcon(muted);
  });
  updateSoundIcon(game.audio.isMuted());

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    // When GameCommon is active, Escape is handled as pause/resume there
    if (typeof window.gameCommon !== 'undefined' && window.gameCommon) return;
    if (e.key === 'Escape' && game.state && game.state.phase !== PHASE.GAME_OVER) {
      backToMenu();
    }
  });

  // Allow external GameCommon integration to take over menu visibility
  if (typeof window.setupCarromGameCommon === 'function') {
    window.setupCarromGameCommon({ startGame, backToMenu, getGame: () => game });
  }

  // ---- Online bridge -----------------------------------------------------
  // main.js is an ES module, so games/carrom-online.js (a classic script)
  // cannot import from it — publish the minimum surface it needs.
  // Note this deliberately calls startNew(GAME_MODE.PVP) instead of going
  // through start()'s mapHostMode(), which folds 'pvp' into LOCAL and would
  // disable the per-player turn gate in _canInteract().
  window.carromApi = {
    GAME_MODE,
    TURN,
    getGame: () => game,
    // Begin an online match as player 1 (host) or player 2 (guest).
    startOnline(playerNumber) {
      hideResult();
      document.getElementById('menuScreen')?.classList.add('hidden');
      document.getElementById('gameScreen')?.classList.remove('hidden');
      game.setPlayerNumber(playerNumber);
      game.startNew(GAME_MODE.PVP, DIFFICULTY.MEDIUM);
      game.start();
      updateHUD(game.getState());
    },
    // Replace local state with the shooter's authoritative snapshot.
    applySnapshot(snapshot) {
      if (!snapshot) return;
      const n = game.myPlayerNumber;
      game.resumeState(snapshot);
      game.setPlayerNumber(n); // resumeState must not clobber our identity
      updateHUD(game.getState());
    },
    refreshHud() { updateHUD(game.getState()); }
  };
}

function selectDifficulty(diff) {
  selectedDifficulty = diff;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(diff === 'easy' ? 'btnAiEasy' : diff === 'medium' ? 'btnAiMed' : 'btnAiHard');
  btn?.classList.add('active');
}

function startGame(mode, difficulty) {
  hideResult();
  document.getElementById('menuScreen')?.classList.add('hidden');
  document.getElementById('gameScreen')?.classList.remove('hidden');

  game.startNew(mode, difficulty);
  game.start();
  updateHUD(game.getState());

  if (typeof window.gameCommon !== 'undefined' && window.gameCommon.startGamePlay) {
    window.gameCommon.startGamePlay();
  }
}

function backToMenu() {
  game.destroy();
  document.getElementById('menuScreen')?.classList.remove('hidden');
  document.getElementById('gameScreen')?.classList.add('hidden');
  hideResult();

  // Recreate a fresh game object for the menu
  const canvas = document.getElementById('gameCanvas');
  game = new CarromGame(canvas, {
    onGameOver: showResult,
    onStateChange: updateHUD,
  });
  window.carromGame = game;
}

function showResult(result) {
  const state = game.getState();
  const myWinner = game.myPlayerNumber === 2 ? 'p2' : 'p1';
  const won = state.mode === GAME_MODE.AI ? result.winner === 'p1' : result.winner === myWinner;
  const details = `Final score — ${state.scores.p1} vs ${state.scores.p2} (target ${WIN_SCORE})`;

  if (typeof window.gameCommon !== 'undefined' && window.gameCommon.showResult) {
    window.gameCommon.showResult(won, details);
    return;
  }

  const modal = document.getElementById('resultModal');
  const title = document.getElementById('resultTitle');
  const msg = document.getElementById('resultMsg');

  let titleText;
  let titleClass = 'winner-text';

  if (state.mode === GAME_MODE.AI) {
    if (result.winner === 'p1') {
      titleText = '🏆 You Win!';
    } else {
      titleText = '😔 AI Wins';
      titleClass = 'loser-text';
    }
  } else {
    titleText = result.winner === 'p1' ? '🏆 Player 1 Wins!' : '🏆 Player 2 Wins!';
  }

  if (title) {
    title.textContent = titleText;
    title.className = titleClass;
  }
  if (msg) {
    msg.textContent = details;
  }
  modal?.classList.add('show');
}

function hideResult() {
  document.getElementById('resultModal')?.classList.remove('show');
}

function updateSoundIcon(muted) {
  const btn = document.getElementById('btnSound');
  if (btn) btn.textContent = muted ? '🔇' : '🔊';
}

function updateHUD(state) {
  if (!state) return;

  const p1El = document.getElementById('p1Info');
  const p2El = document.getElementById('p2Info');

  if (state.mode === GAME_MODE.AI) {
    p1El?.querySelector('.player-name')?.setAttribute('data-name', 'You');
    p2El?.querySelector('.player-name')?.setAttribute('data-name', 'AI');
    if (p1El?.querySelector('.player-name')) p1El.querySelector('.player-name').textContent = 'You';
    if (p2El?.querySelector('.player-name')) p2El.querySelector('.player-name').textContent = 'AI';
  } else {
    if (p1El?.querySelector('.player-name')) p1El.querySelector('.player-name').textContent = 'Player 1';
    if (p2El?.querySelector('.player-name')) p2El.querySelector('.player-name').textContent = 'Player 2';
  }

  if (p1El?.querySelector('.player-score')) p1El.querySelector('.player-score').textContent = state.scores.p1;
  if (p2El?.querySelector('.player-score')) p2El.querySelector('.player-score').textContent = state.scores.p2;

  // Update last pot widget.
  const lastPotEl = document.getElementById('lastPot');
  if (lastPotEl) {
    if (!state.lastPots || state.lastPots.length === 0) {
      lastPotEl.innerHTML = 'Last pot: <span class="pot-dot" style="background:transparent;border-color:rgba(255,255,255,0.15);"></span>';
    } else {
      const dots = state.lastPots.map(c => `<span class="pot-dot ${c}"></span>`).join('');
      lastPotEl.innerHTML = `Last pot: ${dots}`;
    }
  }

  if (p1El?.querySelector('.player-dot')) {
    p1El.querySelector('.player-dot').className = 'player-dot ' + (state.p1Side === 'white' ? 'white-dot' : 'black-dot');
  }
  if (p2El?.querySelector('.player-dot')) {
    p2El.querySelector('.player-dot').className = 'player-dot ' + (state.p2Side === 'white' ? 'white-dot' : 'black-dot');
  }

  p1El?.classList.toggle('active-player', state.turn === TURN.P1);
  p2El?.classList.toggle('active-player', state.turn === TURN.P2);

  const turnEl = document.getElementById('turnIndicator');
  if (turnEl) {
    if (state.mode === GAME_MODE.AI) {
      turnEl.textContent = state.turn === TURN.P1 ? 'Your Turn' : 'AI Thinking';
    } else {
      turnEl.textContent = state.turn === TURN.P1 ? 'Player 1 Turn' : 'Player 2 Turn';
    }
  }

  const qEl = document.getElementById('queenStatus');
  if (qEl) {
    if (state.queenCovered) {
      qEl.textContent = '👑 Queen Covered';
      qEl.className = 'queen-status queen-covered';
    } else if (state.queenPocketedBy) {
      qEl.textContent = '👑 Cover the Queen!';
      qEl.className = 'queen-status queen-pending';
    } else {
      const queen = getQueen(state.coins);
      const active = queen && queen.active;
      qEl.textContent = active ? '👑 Queen Active' : '👑 Queen Pocketed';
      qEl.className = 'queen-status ' + (active ? 'queen-active' : 'queen-pending');
    }
  }

  const inst = document.getElementById('instruction');
  if (inst) {
    if (state.lastShotMessage && state.phase === PHASE.PLACE_STRIKER) {
      inst.textContent = state.lastShotMessage;
    } else if (state.phase === PHASE.PLACE_STRIKER) {
      const isHumanTurn = state.mode === GAME_MODE.LOCAL || state.turn === TURN.P1;
      inst.textContent = isHumanTurn
        ? 'Tap the board or drag the striker to aim — release to shoot'
        : 'AI is deciding its next move...';
    } else if (state.phase === PHASE.AIMING) {
      inst.textContent = 'Pull back to set power, then release to strike';
    } else if (state.phase === PHASE.SHOT_ACTIVE) {
      inst.textContent = 'Shot in progress...';
    } else if (state.phase === PHASE.GAME_OVER) {
      inst.textContent = 'Game over';
    } else {
      inst.textContent = '';
    }
  }
}

// Host integration: make the game class available for ArenaX embedding
window.CarromClash = CarromGame;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
