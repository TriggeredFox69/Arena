// ==========================================
// ArenaX — 8-Ball Pool Online (Quick-Match 1v1)
// Subclass of js/online-mode.js :: OnlineMode.
//
// Pool is continuous physics, not discrete validated moves like chess, so
// the transport is split in two:
//  - High-frequency ball positions during a shot: raw Supabase Realtime
//    broadcast via socketClient.broadcastAction() (no DB write, no turn
//    check — this is what NON_TURN_TYPES/'sync' broadcasts were built for).
//    Only the shooter's client runs real physics; the other client just
//    paints incoming positions onto its own ball array (see
//    pool-game.js update()'s isRemoteShot early-return).
//  - The discrete shot result (foul/turn/win) once the shooter's physics
//    settles: sent via the REST-backed sendAction() -> POST /rooms/action,
//    which the server validates against current_turn_user_id and logs to
//    room_events (so it survives a refresh/reconnect, unlike the broadcast
//    stream). realtime:true is passed to OnlineMode so it never tries to
//    enforce myTurn/turn-flip bookkeeping itself — PoolOnline manages turn
//    state directly against pool-game.js's own currentPlayer.
// ==========================================

(function () {
  'use strict';

  class PoolOnline extends OnlineMode {
    constructor(options = {}) {
      super('8ball-pool', {
        gameName: '8 Ball Pool',
        gameCommon: window.gameCommon,
        realtime: true, // continuous physics — no per-action turn gating
        onGameStart: (data) => this.handlePoolStart(data),
        onOpponentAction: (action, by) => this.handleOpponentAction(action, by),
        onGameEnd: (data, iWon) => this.handlePoolEnd(data, iWon)
        // onTurnChange intentionally unused: realtime mode never calls it.
      });

      // 1 for host (breaks first), 2 for guest. Set in handlePoolStart().
      this.myPlayerNumber = null;
      // True while we (the shooter) are mid-shot and streaming positions.
      this._streaming = false;
      this._streamInterval = null;
      // Shot results go out over BOTH transports (see reportShotResult); the
      // sequence counter and applied-id set that dedupe them now live in
      // OnlineMode (_actionSeq / _appliedActionIds) so every game shares them.
    }

    // ---- Lifecycle callbacks (called by OnlineMode base) ----

    handlePoolStart(data) {
      const game = window.game;
      if (!game) return;

      // Host always breaks (player 1); mirrors chess's "host = White".
      this.myPlayerNumber = this.role === 'host' ? 1 : 2;

      game.online = true;
      game.myPlayerNumber = this.myPlayerNumber;
      game.isRemoteShot = false;
      game.myShotInFlight = false;
      this._actionSeq = 0;
      this._appliedActionIds.clear();
      game.gameMode = 'online';
      game.aiDifficulty = 'medium';

      // Reset to a fresh table (mirrors PoolGame.resetGame()'s rule-state reset,
      // without touching the mode-select DOM which online mode never shows).
      game.gameOver = false;
      game.firstBallType = null;
      game.player1Type = null;
      game.player2Type = null;
      game.currentPlayer = 1; // player 1 always breaks
      game.isShooting = false;
      game.tableSettling = false;
      game.turnResolved = false;
      game.charging = false;
      game.cueStriking = false;
      game._pendingShot = null;
      game._shotFired = false;
      game.aimPower = 0;
      game.aimAngle = Math.PI;
      game.breakShot = true;
      game.shotActive = false;
      game.shotPocketed = [];
      game.firstHitBall = null;
      game.anyCushion = false;
      game.cushionHitBalls.clear();
      game.player1Pocketed = [];
      game.player2Pocketed = [];
      game.ballInHand = false;
      game.ballInHandPlayer = null;
      game.placementPos = null;
      game._resultAlreadyShown = false;
      game.initBalls();
      game.updatePlayerCards();
      // Types were just reset to null above; render them from that state
      // rather than hardcoding the label, so there is exactly one formatter.
      game.refreshGroupLabels();
      game.updatePlayerBalls();
      game.renderPocketedBalls();

      const myName = (window.socketClient && socketClient.username) || 'You';
      const oppName = this.opponent?.username || 'Opponent';
      const p1NameEl = document.getElementById('player1Name');
      const p2NameEl = document.getElementById('player2Name');
      if (p1NameEl) p1NameEl.textContent = this.myPlayerNumber === 1 ? myName : oppName;
      if (p2NameEl) p2NameEl.textContent = this.myPlayerNumber === 1 ? oppName : myName;

      document.getElementById('modeSelection')?.classList.add('hidden');
      document.getElementById('gameBoard')?.classList.remove('hidden');

      game.gameStarted = true;
      // No local turn timer online (see pool-game.js gameLoop's !this.online guard).
      if (this.gameCommon) {
        this.gameCommon.setOnlineWager(this.wager);
        this.gameCommon.startGamePlay();
      }
    }

    // Raw broadcast handler — fires many times per shot (type:'sync') plus
    // once per discrete event (type:'shot_result', 'ball_in_hand').
    handleOpponentAction(action, by) {
      const game = window.game;
      if (!game || !action) return;

      if (action.type === 'sync') {
        this.applyBallPositions(action.balls);
        return;
      }
      if (action.type === 'shot_started') {
        game.isRemoteShot = true;
        game.isShooting = true;
        game.lastShooter = this.myPlayerNumber === 1 ? 2 : 1;
        game.cueStriking = false;
        return;
      }
      if (action.type === 'shot_result') {
        // Sent over both the broadcast and REST transports for speed +
        // durability; apply whichever lands first, ignore the duplicate.
        // Dedupe now lives in OnlineMode so every game shares it.
        if (!this.shouldApplyAction(action)) return;
        this.applyRemoteTurnResult(action);
        return;
      }
      if (action.type === 'ball_in_hand') {
        this.applyRemoteCueBallPlacement(action);
      }
    }

    // Paint the shooter's authoritative positions directly onto our balls —
    // never run local physics on top of these (see pool-game.js update()).
    applyBallPositions(balls) {
      const game = window.game;
      if (!game || !Array.isArray(balls)) return;
      // Drop stale position packets. Once the shot has been resolved
      // (isRemoteShot cleared by applyRemoteTurnResult) any sync still in
      // flight describes a moment BEFORE the table settled, and applying it
      // would re-introduce moving balls on what is now our own turn.
      if (!game.isRemoteShot) return;
      for (const incoming of balls) {
        const local = game.balls.find(b => b.number === incoming.number);
        if (!local) continue;
        local.x = incoming.x;
        local.y = incoming.y;
        local.vx = incoming.vx || 0;
        local.vy = incoming.vy || 0;
        local.isPocketed = !!incoming.isPocketed;
      }
    }

    // Apply the shooter's authoritative shot outcome on the watching client.
    applyRemoteTurnResult(result) {
      const game = window.game;
      if (!game) return;

      game.isRemoteShot = false;
      game.isShooting = false;
      game.shotActive = false;
      game.breakShot = false;
      // This was the opponent's shot — we must never try to resolve it.
      game.myShotInFlight = false;

      if (result.finalBalls) {
        for (const fb of result.finalBalls) {
          const local = game.balls.find(b => b.number === fb.number);
          if (!local) continue;
          local.x = fb.x;
          local.y = fb.y;
          local.vx = 0;
          local.vy = 0;
          local.isPocketed = !!fb.isPocketed;
        }
      }

      // Go through the game's own setGroups() so both players get a type from
      // this one event, using the exact same derivation the shooter used.
      // (This used to assign only the shooter's group, stranding the other
      // player on "Yet to decide" and breaking this client's own rule checks.)
      if (result.assignedType) {
        game.setGroups(result.assignedType.player, result.assignedType.type);
      }

      game.ballInHand = !!result.ballInHand;
      if (typeof result.nextTurn === 'number') {
        game.currentPlayer = result.nextTurn;
      }
      game.ballInHandPlayer = game.ballInHand ? game.currentPlayer : null;
      game.placementPos = null;

      game.updatePlayerCards();
      game.updatePlayerBalls();
      game.renderPocketedBalls();
    }

    applyRemoteCueBallPlacement(action) {
      const game = window.game;
      if (!game || !Number.isFinite(action.x) || !Number.isFinite(action.y)) return;
      game.cueBall.x = action.x;
      game.cueBall.y = action.y;
      game.cueBall.vx = 0;
      game.cueBall.vy = 0;
      game.cueBall.isPocketed = false;
      game.ballInHand = false;
      game.ballInHandPlayer = null;
      game.placementPos = null;
    }

    handlePoolEnd(data, iWon) {
      const game = window.game;
      if (game) game.gameOver = true;
      // The winning shooter's client already called game.endGame(winner)
      // locally (pool-game.js handleTurnEnd's 8-ball branch), which shows
      // the result via gameCommon.showResult for them. This covers the other
      // client and any server-declared end (forfeit/leave).
      if (window.gameCommon && !game?._resultAlreadyShown) {
        window.gameCommon.showResult(iWon, iWon
          ? 'You cleared the table — victory!'
          : 'Opponent wins the match.');
      }
    }

    // ---- Called from pool-game.js during our own shot ----

    // Fired once when we release the cue (fireShot()). Tells the opponent a
    // shot is in flight, then starts streaming our ball positions at ~20Hz
    // until the table settles.
    startStreamingShot(shotParams) {
      if (this._streaming) return;
      this._streaming = true;

      socketClient.broadcastAction({ type: 'shot_started', ...shotParams });

      this._streamInterval = setInterval(() => {
        const game = window.game;
        if (!game) return;
        socketClient.broadcastAction({
          type: 'sync',
          balls: game.balls.map(b => ({
            number: b.number, x: b.x, y: b.y, vx: b.vx, vy: b.vy, isPocketed: b.isPocketed
          }))
        });
        if (!game.anyBallMoving()) this.stopStreamingShot();
      }, 50); // ~20Hz — cheap broadcast payload, no DB write per frame
    }

    stopStreamingShot() {
      if (this._streamInterval) {
        clearInterval(this._streamInterval);
        this._streamInterval = null;
      }
      this._streaming = false;
    }

    // Called by pool-game.js handleTurnEnd() once OUR shot has resolved.
    // Sends the authoritative outcome through the REST path so it's
    // server-validated (only the current shooter can write it) and logged.
    reportShotResult(result) {
      this.stopStreamingShot();
      if (result.winner !== undefined) {
        // Game-ending shot: report via sendGameEnd so the server settles the
        // wager, same pattern as ChessOnline.reportGameOver().
        const myUserId = window.socketClient ? window.socketClient.userId : null;
        const oppUserId = this.opponent && this.opponent.userId ? this.opponent.userId : null;
        const iWon = result.winner === this.myPlayerNumber;
        const winnerId = iWon ? myUserId : oppUserId;
        const game = window.game;
        if (game) game._resultAlreadyShown = true;
        this.sendGameEnd('table_cleared', winnerId, {
          finalBalls: game ? game.balls.map(b => ({ number: b.number, x: b.x, y: b.y, isPocketed: b.isPocketed })) : []
        });
        return;
      }
      // Dual transport (fast ordered broadcast + durable REST), deduped by
      // actionId. This now lives in OnlineMode.sendReliableAction so every
      // game shares the exact mechanism pool proved out.
      this.sendReliableAction({ type: 'shot_result', ...result });
    }

    reportCueBallPlacement(pos) {
      this.sendReliableAction({
        type: 'ball_in_hand', x: pos.x, y: pos.y, player: this.myPlayerNumber
      });
    }

    // ---- Cleanup ----

    destroy() {
      this.stopStreamingShot();
      const game = window.game;
      if (game) {
        game.online = false;
        game.myPlayerNumber = null;
        game.isRemoteShot = false;
        game.myShotInFlight = false;
        game._resultAlreadyShown = false;
      }
      this._appliedActionIds.clear();
      this.myPlayerNumber = null;
      super.destroy();
      if (game) game.resetGame();
    }
  }

  window.PoolOnline = PoolOnline;
})();
