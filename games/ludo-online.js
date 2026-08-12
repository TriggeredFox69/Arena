// ==========================================
// ArenaX — Ludo Online (Quick-Match 1v1)
// Subclass of js/online-mode.js :: OnlineMode.
//
// Same transport as pool/chess/checkers: every action goes out over
// OnlineMode.sendReliableAction() — fast Realtime broadcast (~50ms) plus the
// durable REST path — deduped by actionId so the copy landing second is a
// no-op. Replaying a ludo move twice would desync the board permanently.
//
// DICE AUTHORITY (the one thing ludo needs that the other games don't):
// both clients must agree on every roll, and a client that rolls its own dice
// can bias them. So the HOST generates every value, for both seats:
//
//     host's turn : host rolls          -> broadcasts {type:'roll', value}
//     guest's turn: guest sends          {type:'roll_request'}
//                   host rolls on receipt -> broadcasts {type:'roll', value}
//
// Both clients then run the identical doRoll(value). This costs the guest one
// round-trip per roll, and it removes the guest's ability to influence the
// dice — but note it does NOT make the dice trustworthy in the other
// direction: the host still generates them locally, so a modified host client
// could cheat. The only real fix is a server-side dice endpoint (the backend
// has none today); this is the strongest option available client-side and is
// deliberately concentrated in one place so it can be swapped for a server
// call without touching the engine.
//
// Seat mapping: host = seat 0 (red, moves first), guest = seat 1 (yellow).
// ==========================================

(function () {
  'use strict';

  class LudoOnline extends OnlineMode {
    constructor(options = {}) {
      super('ludo', {
        gameName: 'Ludo Stars',
        gameCommon: window.gameCommon,
        // The engine owns turn state (S.turn) and a roll of 6 grants another
        // turn, so per-action myTurn bookkeeping in the base would fight it.
        realtime: true,
        onGameStart: (data) => this.handleLudoStart(data),
        onOpponentAction: (action, by) => this.handleOpponentAction(action, by),
        onGameEnd: (data, iWon) => this.handleLudoEnd(data, iWon)
      });

      this.mySeat = null;          // 0 = host/red, 1 = guest/yellow
      this._resultReported = false;
    }

    get api() { return window.ludoApi; }
    get isHost() { return this.mySeat === 0; }

    // ---- Lifecycle ----

    handleLudoStart(data) {
      const api = this.api;
      if (!api) {
        console.error('[LudoOnline] window.ludoApi missing — cannot start.');
        return;
      }

      this.mySeat = this.role === 'host' ? 0 : 1;
      this._resultReported = false;
      this._actionSeq = 0;
      this._appliedActionIds.clear();

      const myName = (window.socketClient && socketClient.username) || 'You';
      const oppName = this.opponent?.username || 'Opponent';

      const S = api.state;
      S.online = true;
      S.mySeat = this.mySeat;
      S.applyingRemote = false;

      // Seat 0 is red and always starts, so name the seats accordingly rather
      // than assuming the local player is red.
      api.newGame({
        mode: 'online',
        redName: this.mySeat === 0 ? myName : oppName,
        yellowName: this.mySeat === 0 ? oppName : myName
      });
      // newGame resets S, so re-assert the online fields it does not know about.
      S.online = true;
      S.mySeat = this.mySeat;
      S.applyingRemote = false;

      api.log(`<b>Online match</b> — you are ${this.mySeat === 0 ? 'Red (first)' : 'Yellow'}.`);

      if (this.gameCommon) {
        this.gameCommon.setOnlineWager(this.wager);
        this.gameCommon.startGamePlay();
      }
    }

    handleOpponentAction(action, by) {
      const api = this.api;
      if (!api || !action) return;

      // A roll_request is a control message, not board state: it must be
      // handled even though it changes nothing, and it is not deduped as a
      // board action because the host's reply is what actually mutates state.
      if (action.type === 'roll_request') {
        if (this.isHost) this.hostRollFor(api.state.turn);
        return;
      }

      if (!this.shouldApplyAction(action)) return;

      if (action.type === 'roll') {
        api.applyRemoteRoll(action.value);
        return;
      }
      if (action.type === 'move') {
        Promise.resolve(api.applyRemoteMove(action.seat, action.token))
          .catch(err => console.error('[LudoOnline] failed to apply opponent move:', err, action));
        return;
      }
    }

    handleLudoEnd(data, iWon) {
      if (this._resultReported) return; // our own end already showed a result
      if (window.gameCommon) {
        const label = iWon
          ? 'You win the match!'
          : `${this.opponent?.username || 'Opponent'} wins the match.`;
        window.gameCommon.showResult(iWon, `<b>${label}</b>`);
      }
    }

    // ---- Dice (host-authoritative) ----

    // Called by ludo.html's onDiceClick for whichever player's turn it is.
    requestRoll() {
      const api = this.api;
      if (!api || !this.gameStarted) return;
      if (api.state.turn !== this.mySeat) return;

      if (this.isHost) {
        this.hostRollFor(this.mySeat);
      } else {
        // Ask the host to roll; the value arrives back as {type:'roll'}.
        this.sendReliableAction({ type: 'roll_request', seat: this.mySeat });
      }
    }

    // Host only: generate the value, tell the peer, then apply locally so both
    // sides run the same doRoll().
    hostRollFor(seat) {
      const api = this.api;
      if (!api || !this.isHost) return;
      if (api.state.phase !== 'roll' || api.state.animating) return;

      const value = 1 + Math.floor(Math.random() * 6);
      this.sendReliableAction({ type: 'roll', value, seat });
      api.applyRemoteRoll(value); // applyingRemote stops this echoing back
    }

    // ---- Reporting ----

    reportMove(move) {
      if (!this.gameStarted) return;
      this.sendReliableAction({ type: 'move', seat: this.mySeat, token: move.token });
    }

    reportGameOver(winnerSeat) {
      if (!this.gameStarted || this._resultReported) return;
      this._resultReported = true;

      const iWon = winnerSeat === this.mySeat;
      const myUserId = window.socketClient ? socketClient.userId : null;
      const oppUserId = this.opponent?.userId || null;

      this.sendGameEnd('win', iWon ? myUserId : oppUserId, { winnerSeat });
    }

    destroy() {
      const api = this.api;
      if (api) {
        api.state.online = false;
        api.state.mySeat = null;
        api.state.applyingRemote = false;
      }
      this.mySeat = null;
      this._resultReported = false;
      this._appliedActionIds.clear();
      super.destroy();
    }
  }

  window.LudoOnline = LudoOnline;
})();
