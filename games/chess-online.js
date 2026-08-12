// ==========================================
// ArenaX — Chess Online (Quick-Match 1v1)
// Subclass of js/online-mode.js :: OnlineMode.
//
// Rebuilt on the transport that 8-ball pool proved out. What changed from the
// original implementation, and why:
//
//  1. DUAL TRANSPORT. Moves used to go out over REST only
//     (POST /rooms/action -> DB -> Realtime), which measured ~850ms end to
//     end — every move felt laggy. They now go through
//     OnlineMode.sendReliableAction(), which fires the move over the raw
//     Realtime broadcast (~50ms) *and* over REST for durability, so the
//     server still validates the turn and a refresh/reconnect can still
//     replay the match.
//
//  2. DE-DUPLICATION IS MANDATORY, not optional. With two transports the same
//     move arrives twice, and the broadcast copy is not a room_events row so
//     socket-client's row-id dedupe cannot catch it. Applying a chess move
//     twice is unrecoverable — it silently corrupts the board for one player
//     only. Every incoming move is therefore gated on shouldApplyAction().
//
//  3. ACTOR AUTHORITY. Only the client that actually made a move computes its
//     consequences; the peer applies the received move verbatim and never
//     re-derives it. This mirrors pool's rule that only the shooter resolves
//     a shot.
//
//  4. SINGLE SOURCE OF TRUTH for presentation. Board orientation, status text
//     and player names are all derived from one place (refreshUi) instead of
//     being written from several handlers that could disagree — the same class
//     of bug that left a pool player stuck on "Yet to decide".
//
// Role mapping: host = White (moves first), guest = Black. Both clients share
// ChessRoyale's board layout (row 0 = black back rank), so move coordinates
// are identical across peers; the guest's board is only flipped visually via
// CSS, so wire coordinates stay consistent.
// ==========================================

(function () {
  'use strict';

  class ChessOnline extends OnlineMode {
    constructor(options = {}) {
      super('chess', {
        gameName: 'Chess Royale',
        gameCommon: window.gameCommon,
        // Chess is strictly alternating, so keep the base's myTurn gating and
        // the server's current_turn_user_id validation: unlike pool (where the
        // shooter may legally keep the table and the server check caused
        // spurious "Not your turn" rejections), alternating turns make that
        // check both correct and worth having as anti-cheat.
        realtime: false,
        onGameStart: (data) => this.handleChessStart(data),
        onOpponentAction: (action, by) => this.handleOpponentAction(action, by),
        onGameEnd: (data, iWon) => this.handleChessEnd(data, iWon),
        onTurnChange: (myTurn) => this.handleTurnChange(myTurn)
      });

      // 'w' for host (White), 'b' for guest (Black). Set in handleChessStart.
      this.color = null;
      // True when ChessRoyale.makeMove already displayed the result locally,
      // so handleChessEnd doesn't stack a second overlay.
      this._localResultShown = false;
    }

    // ---- Lifecycle callbacks (called by OnlineMode base) ----

    handleChessStart(data) {
      const game = window.chessGame;
      if (!game) {
        console.error('[ChessOnline] window.chessGame missing — cannot start.');
        return;
      }

      this.color = this.role === 'host' ? 'w' : 'b';
      this._localResultShown = false;
      // Fresh match: drop any action ids retained from a previous one.
      this._actionSeq = 0;
      this._appliedActionIds.clear();

      // Reset to a fresh game (both peers share this initial layout).
      game.online = true;
      game.onlineColor = this.color;
      game.gameStarted = true;
      game.gameOver = false;
      game.board = game.createInitialBoard();
      game.turn = 'w'; // White always moves first
      game.selected = null;
      game.legalMoves = [];
      game.lastMove = null;
      game.moveLog = [];
      game.castling = { w: { k: true, q: true }, b: { k: true, q: true } };
      game.enPassant = null;
      game._applyingRemote = false;
      game._onlineMyTurn = this.color === 'w';

      game.render();
      this.refreshUi();

      if (this.gameCommon) {
        this.gameCommon.setOnlineWager(this.wager);
        this.gameCommon.startGamePlay();
      }
    }

    handleOpponentAction(action, by) {
      const game = window.chessGame;
      if (!game || !action) return;

      if (action.type && action.type !== 'move') return;
      if (!action.move) return;

      // Exactly-once. The same move arrives over both transports, and
      // re-applying a chess move corrupts the board irreversibly.
      if (!this.shouldApplyAction(action)) return;

      // The move is authoritative: the peer generated it from its own legal
      // move list and the server validated whose turn it was. Apply it
      // verbatim rather than re-deriving legality here — _applyingRemote lets
      // makeMove bypass the local input/turn guards.
      game._applyingRemote = true;
      try {
        game.makeMove(action.move);
      } catch (err) {
        console.error('[ChessOnline] failed to apply opponent move:', err, action.move);
      } finally {
        game._applyingRemote = false;
      }

      this.refreshUi();
    }

    handleChessEnd(data, iWon) {
      const game = window.chessGame;
      if (game) {
        game.gameStarted = false;
        game.gameOver = true;
        game._onlineMyTurn = false;
      }
      // When the local player delivered mate, ChessRoyale.makeMove already
      // showed the result. This path covers server-declared ends (forfeit,
      // opponent leaving) where our board has no terminal position to detect.
      if (!this._localResultShown && window.gameCommon) {
        const isDraw = !!(data && data.result === 'draw');
        const label = isDraw
          ? 'Match drawn.'
          : (iWon ? 'You win the match!' : `${this.opponent?.username || 'Opponent'} wins the match.`);
        window.gameCommon.showResult(iWon, `<b>${label}</b>`, isDraw);
      }
    }

    handleTurnChange(myTurn) {
      const game = window.chessGame;
      if (game) game._onlineMyTurn = myTurn;
      this.refreshUi();
    }

    // ---- Called by ChessRoyale (chess.js) ----

    // Fired right after the local player's move has been applied locally.
    afterLocalMove(move) {
      if (!this.gameStarted) return;
      // Dual transport + dedupe. sendReliableAction re-checks myTurn and flips
      // it on success, so an out-of-turn move is dropped rather than sent.
      this.sendReliableAction({ type: 'move', move });
      this.refreshUi();
    }

    // Fired when the local player's move ended the game, so the backend can
    // settle the wager.
    reportGameOver(outcome, isDraw) {
      if (!this.gameStarted) return;
      this._localResultShown = true; // makeMove shows the local result itself

      const game = window.chessGame;
      // The side to move after a mating move is the mated side, so if that
      // isn't us, we won.
      const matedColor = game ? game.turn : null;
      const iWon = !isDraw && !!matedColor && matedColor !== this.color;

      const myUserId = window.socketClient ? socketClient.userId : null;
      const oppUserId = this.opponent?.userId || null;
      const winnerId = isDraw ? null : (iWon ? myUserId : oppUserId);

      this.sendGameEnd(isDraw ? 'draw' : 'checkmate', winnerId, {
        outcome,
        moves: game ? game.moveLog : []
      });
    }

    // ---- Presentation: one place, so nothing can disagree ----

    refreshUi() {
      this.applyBoardOrientation();
      this.applyPlayerNames();
      this.applyStatusText();
      this.applyActiveCards();
    }

    applyBoardOrientation() {
      const board = document.getElementById('board');
      if (!board) return;
      // Black (guest) sees the board rotated so their pieces are nearest.
      board.classList.toggle('flipped', this.color === 'b');
    }

    applyPlayerNames() {
      if (!this.color) return;
      const myName = (window.socketClient && socketClient.username) || 'You';
      const oppName = this.opponent?.username || 'Opponent';
      const whiteIsMe = this.color === 'w';

      const whiteEl = document.getElementById('whiteName');
      const blackEl = document.getElementById('blackName');
      if (whiteEl) whiteEl.textContent = whiteIsMe ? myName : oppName;
      if (blackEl) blackEl.textContent = whiteIsMe ? oppName : myName;

      const whiteSub = document.getElementById('whiteSub');
      const blackSub = document.getElementById('blackSub');
      if (whiteSub) whiteSub.textContent = whiteIsMe ? 'You — White' : 'Opponent — White';
      if (blackSub) blackSub.textContent = whiteIsMe ? 'Opponent — Black' : 'You — Black';
    }

    applyStatusText() {
      const statusEl = document.getElementById('statusText');
      if (!statusEl || !this.gameStarted || !this.color) return;
      const me = this.color === 'w' ? 'White' : 'Black';
      const opp = this.color === 'w' ? 'Black' : 'White';
      statusEl.textContent = this.myTurn
        ? `Your move (${me})`
        : `Waiting — ${opp} to move`;
    }

    applyActiveCards() {
      const game = window.chessGame;
      if (!game) return;
      const w = document.getElementById('whiteCard');
      const b = document.getElementById('blackCard');
      if (w) w.classList.toggle('active', game.turn === 'w');
      if (b) b.classList.toggle('active', game.turn === 'b');
    }

    // Reset everything when leaving a match / starting fresh.
    destroy() {
      const game = window.chessGame;
      const board = document.getElementById('board');
      if (board) board.classList.remove('flipped');
      if (game) {
        game.online = false;
        game.onlineColor = null;
        game._onlineMyTurn = false;
        game._applyingRemote = false;
      }
      this.color = null;
      this._localResultShown = false;
      this._appliedActionIds.clear();
      super.destroy();
      if (game) game.resetGame();
    }
  }

  window.ChessOnline = ChessOnline;
})();
