// ==========================================
// ArenaX — Checkers Online (Quick-Match 1v1)
// Subclass of js/online-mode.js :: OnlineMode.
//
// Built on the same transport as 8-ball pool and chess:
//  - Moves go out over OnlineMode.sendReliableAction(): the fast Realtime
//    broadcast (~50ms) AND the durable REST path (~850ms), deduped by actionId
//    so the copy that lands second is a no-op. Applying a checkers move twice
//    would silently corrupt the board for one player only.
//  - ACTOR AUTHORITY: only the client that made a move sends it, and only that
//    client reports the game result (checkers.html guards both on
//    S.applyingRemote), so the wager settles exactly once.
//  - Checkers is fully deterministic, so only the move itself crosses the
//    wire. Both peers then run the identical applyMove(), including the
//    multi-jump continuation where the turn deliberately does NOT pass — the
//    checkers analogue of pool's keepTurn.
//
// Role mapping: host = DARK (moves first), guest = LIGHT. The board layout is
// shared, so row/col coordinates mean the same thing on both peers.
// ==========================================

(function () {
  'use strict';

  class CheckersOnline extends OnlineMode {
    constructor(options = {}) {
      super('checkers', {
        gameName: 'Checkers Clash',
        gameCommon: window.gameCommon,
        // Strictly alternating (a multi-jump chain is still one player's turn,
        // and the engine tracks that itself), so keep the base's myTurn gating
        // and the server's current_turn_user_id validation as anti-cheat.
        realtime: false,
        onGameStart: (data) => this.handleCheckersStart(data),
        onOpponentAction: (action, by) => this.handleOpponentAction(action, by),
        onGameEnd: (data, iWon) => this.handleCheckersEnd(data, iWon),
        onTurnChange: (myTurn) => this.handleTurnChange(myTurn)
      });

      this.mySide = null;            // api.DARK or api.LIGHT
      this._localResultShown = false;
    }

    get api() { return window.checkersApi; }

    // ---- Lifecycle ----

    handleCheckersStart(data) {
      const api = this.api;
      if (!api) {
        console.error('[CheckersOnline] window.checkersApi missing — cannot start.');
        return;
      }

      this.mySide = this.role === 'host' ? api.DARK : api.LIGHT;
      this._localResultShown = false;
      this._actionSeq = 0;
      this._appliedActionIds.clear();

      const S = api.state;
      // resetGame() rebuilds the board and calls startTurn(); set the online
      // fields first so every downstream render/gate sees them.
      S.online = true;
      S.mySide = this.mySide;
      S.applyingRemote = false;
      api.resetGame('online');

      // Hide the mode menus and show the board.
      document.getElementById('menuModal')?.classList.remove('show');
      document.getElementById('aiModal')?.classList.remove('show');

      api.log(`<b>Online match</b> — you are ${this.mySide === api.DARK ? 'Dark' : 'Light'}. Dark moves first.`);
      this.refreshUi();

      if (this.gameCommon) {
        this.gameCommon.setOnlineWager(this.wager);
        this.gameCommon.startGamePlay();
      }
    }

    handleOpponentAction(action, by) {
      const api = this.api;
      if (!api || !action) return;
      if (action.type && action.type !== 'move') return;
      if (!action.move) return;

      // Exactly-once across both transports.
      if (!this.shouldApplyAction(action)) return;

      Promise.resolve(api.applyRemoteMove(action.move))
        .then(() => this.refreshUi())
        .catch(err => console.error('[CheckersOnline] failed to apply opponent move:', err, action.move));
    }

    handleCheckersEnd(data, iWon) {
      const api = this.api;
      if (api) {
        api.state.gameOver = true;
        api.stopTimer();
      }
      // The player who made the winning move already saw the local result via
      // finishGame(). This covers server-declared ends (forfeit / opponent
      // leaving) where our board has no terminal position to detect.
      if (!this._localResultShown && window.gameCommon) {
        const isDraw = !!(data && data.result === 'draw');
        const label = isDraw
          ? 'Match drawn.'
          : (iWon ? 'You win the match!' : `${this.opponent?.username || 'Opponent'} wins the match.`);
        window.gameCommon.showResult(iWon, `<b>${label}</b>`, isDraw);
      }
    }

    handleTurnChange(myTurn) {
      this.refreshUi();
    }

    // ---- Called from checkers.html ----

    // Fired for our own move only (guarded by S.applyingRemote there).
    reportMove(move) {
      if (!this.gameStarted) return;
      // Send only what is needed to replay: from/to/captures.
      this.sendReliableAction({
        type: 'move',
        move: {
          from: { row: move.from.row, col: move.from.col },
          to: { row: move.to.row, col: move.to.col },
          captures: (move.captures || []).map(c => ({ row: c.row, col: c.col }))
        }
      });
      this.refreshUi();
    }

    // Fired for our own game-ending move only, so the wager settles once.
    reportGameOver(winnerSide) {
      if (!this.gameStarted) return;
      this._localResultShown = true;

      const iWon = winnerSide === this.mySide;
      const myUserId = window.socketClient ? socketClient.userId : null;
      const oppUserId = this.opponent?.userId || null;

      this.sendGameEnd('win', iWon ? myUserId : oppUserId, {
        winnerSide,
        darkPieces: this.api ? this.api.countPieces(this.api.DARK) : null,
        lightPieces: this.api ? this.api.countPieces(this.api.LIGHT) : null
      });
    }

    // ---- Presentation: one place, so nothing can disagree ----

    refreshUi() {
      const api = this.api;
      if (!api || !this.gameStarted) return;
      const S = api.state;
      if (S.gameOver) return;

      api.renderPlayers();
      api.renderHighlights();

      const mine = S.turn === this.mySide;
      const oppName = this.opponent?.username || 'Opponent';
      api.setBanner(mine ? 'Your turn' : `${oppName}'s turn`, S.turn);
      api.setHint(mine
        ? `<b>Your move</b>Select a piece, then tap a highlighted square.`
        : `<b>Waiting for ${oppName}</b>Their move is on the way.`);
    }

    destroy() {
      const api = this.api;
      if (api) {
        api.state.online = false;
        api.state.mySide = null;
        api.state.applyingRemote = false;
      }
      this.mySide = null;
      this._localResultShown = false;
      this._appliedActionIds.clear();
      super.destroy();
    }
  }

  window.CheckersOnline = CheckersOnline;
})();
