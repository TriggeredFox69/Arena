// ==========================================
// ArenaX — Carrom Online (Quick-Match 1v1)
// Subclass of js/online-mode.js :: OnlineMode.
//
// Carrom is turn-based physics, exactly like 8-ball pool, so it uses pool's
// model rather than chess's:
//
//  - FAST PATH: when we place the striker and shoot, those inputs go out over
//    the raw Realtime broadcast immediately, so the opponent sees the striker
//    move and the shot play out with ~50ms latency instead of ~850ms. The peer
//    replays the identical shot through its own simulation for smooth motion.
//  - AUTHORITATIVE PATH: float physics can drift between machines, so the
//    peer's re-simulation is NOT trusted as the source of truth. Once the
//    shooter's physics settles, the shooter sends a full serialize() snapshot
//    via sendReliableAction() (broadcast + durable REST, deduped by actionId),
//    and the peer overwrites its state with resumeState(). This is the same
//    "only the shooter resolves the shot" rule that fixed pool.
//  - Sending the snapshot on the SAME broadcast channel as the shot inputs
//    guarantees it can never overtake them — the exact ordering race that
//    corrupted pool's turn state when the two travelled different transports.
//
// Role mapping: host = player 1 (shoots first), guest = player 2.
// The engine was already online-aware (GAME_MODE.PVP, setPlayerNumber(),
// _canInteract() gating on myPlayerNumber), so no rule logic is duplicated
// here — this file only moves bytes and delegates.
// ==========================================

(function () {
  'use strict';

  class CarromOnline extends OnlineMode {
    constructor(options = {}) {
      super('carrom', {
        gameName: 'Carrom Clash',
        gameCommon: window.gameCommon,
        // Turn-based physics: the engine owns turn state (state.turn) and the
        // shooter is authoritative, so skip the base's per-action myTurn
        // bookkeeping — the same reason pool passes realtime:true.
        realtime: true,
        onGameStart: (data) => this.handleCarromStart(data),
        onOpponentAction: (action, by) => this.handleOpponentAction(action, by),
        onGameEnd: (data, iWon) => this.handleCarromEnd(data, iWon)
      });

      this.myPlayerNumber = null;
      this._hooked = false;
      this._resultReported = false;
    }

    get api() { return window.carromApi; }
    get game() { return window.carromApi && window.carromApi.getGame(); }

    // ---- Lifecycle ----

    handleCarromStart(data) {
      const api = this.api;
      if (!api) {
        console.error('[CarromOnline] window.carromApi missing — cannot start.');
        return;
      }

      this.myPlayerNumber = this.role === 'host' ? 1 : 2;
      this._resultReported = false;
      this._actionSeq = 0;
      this._appliedActionIds.clear();

      api.startOnline(this.myPlayerNumber);
      this.installHooks();
      this.applyPlayerNames();

      if (this.gameCommon) {
        this.gameCommon.setOnlineWager(this.wager);
        this.gameCommon.startGamePlay();
      }
    }

    // Attach to the engine's existing outbound hooks. These fire for LOCAL
    // input only — a replayed remote shot goes through applyRemote* below,
    // which suppresses re-broadcast via _applyingRemote.
    installHooks() {
      const game = this.game;
      if (!game || this._hooked) return;
      this._hooked = true;

      game.options.onStrikerPlace = (pos) => {
        if (this._applyingRemote) return;
        this.sendReliableAction({ type: 'striker_place', x: pos.x, y: pos.y });
      };

      game.options.onShoot = (shot) => {
        if (this._applyingRemote) return;
        // Fast path: send the shot inputs so the peer can animate the same
        // shot immediately. The authoritative snapshot follows on settle.
        this.sendReliableAction({
          type: 'shot',
          strikerX: shot.strikerX,
          strikerY: shot.strikerY,
          vx: shot.vx,
          vy: shot.vy,
          power: shot.power
        });
      };

      game.options.onShotResolved = () => {
        if (this._applyingRemote) return;
        // Authoritative path: our physics is the source of truth for our own
        // shot. Push the settled snapshot so the peer cannot drift.
        this.sendReliableAction({ type: 'snapshot', state: game.serialize() });
      };

      // Wrap the engine's game-over so only the player who ended it reports.
      const prevGameOver = game.options.onGameOver;
      game.options.onGameOver = (result) => {
        if (typeof prevGameOver === 'function') prevGameOver(result);
        if (!this._applyingRemote) this.reportGameOver(result);
      };
    }

    handleOpponentAction(action, by) {
      const api = this.api;
      const game = this.game;
      if (!api || !game || !action) return;

      // Exactly-once across both transports.
      if (!this.shouldApplyAction(action)) return;

      this._applyingRemote = true;
      try {
        if (action.type === 'striker_place') {
          game.placeStriker(action.x, action.y);
        } else if (action.type === 'shot') {
          // Replay the same inputs for smooth local animation. Any physics
          // drift is corrected by the snapshot that follows.
          game.placeStriker(action.strikerX, action.strikerY);
          game.shoot(action.vx, action.vy, action.power);
        } else if (action.type === 'snapshot') {
          api.applySnapshot(action.state);
        }
      } catch (err) {
        console.error('[CarromOnline] failed to apply opponent action:', err, action);
      } finally {
        this._applyingRemote = false;
      }
    }

    handleCarromEnd(data, iWon) {
      if (this._resultReported) return; // our own end already showed a result
      if (window.gameCommon) {
        const label = iWon
          ? 'You win the match!'
          : `${this.opponent?.username || 'Opponent'} wins the match.`;
        window.gameCommon.showResult(iWon, `<b>${label}</b>`);
      }
    }

    // ---- Reporting ----

    reportGameOver(result) {
      if (!this.gameStarted || this._resultReported) return;
      this._resultReported = true;

      const myWinner = this.myPlayerNumber === 2 ? 'p2' : 'p1';
      const iWon = result && result.winner === myWinner;
      const myUserId = window.socketClient ? socketClient.userId : null;
      const oppUserId = this.opponent?.userId || null;

      this.sendGameEnd('win', iWon ? myUserId : oppUserId, {
        winner: result ? result.winner : null,
        finalState: this.game ? this.game.serialize() : null
      });
    }

    applyPlayerNames() {
      const myName = (window.socketClient && socketClient.username) || 'You';
      const oppName = this.opponent?.username || 'Opponent';
      const p1 = document.getElementById('p1Name') || document.querySelector('[data-player="1"] .player-name');
      const p2 = document.getElementById('p2Name') || document.querySelector('[data-player="2"] .player-name');
      if (p1) p1.textContent = this.myPlayerNumber === 1 ? myName : oppName;
      if (p2) p2.textContent = this.myPlayerNumber === 1 ? oppName : myName;
    }

    destroy() {
      const game = this.game;
      if (game && game.options) {
        game.options.onStrikerPlace = null;
        game.options.onShoot = null;
        game.options.onShotResolved = null;
      }
      this._hooked = false;
      this.myPlayerNumber = null;
      this._resultReported = false;
      this._appliedActionIds.clear();
      super.destroy();
    }
  }

  window.CarromOnline = CarromOnline;
})();
