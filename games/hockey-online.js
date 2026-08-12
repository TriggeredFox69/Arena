// ==========================================
// ArenaX — Glow Hockey Online (Quick-Match 1v1)
// Subclass of js/online-mode.js :: OnlineMode.
//
// Glow hockey is the one game here with SIMULTANEOUS motion — there is no turn
// to hand over — so the pool/chess "only the actor resolves it" rule is
// re-expressed as authority split by OBJECT rather than by turn:
//
//   * Each client owns its OWN mallet and streams that mallet's target.
//   * The HOST owns the puck, goal detection and the score, and streams an
//     authoritative snapshot. The guest dead-reckons the puck between
//     snapshots (so motion stays smooth) and is corrected ~20x/second, so the
//     two sides can never disagree about whether a goal happened.
//
// Streams use the RAW broadcast only — never the durable REST path. Position
// updates at 20Hz would be ~1200 DB rows per minute, and they are worthless
// after ~50ms anyway. Only the match result goes over the reliable transport.
// This is the same split pool uses for its ball-position stream vs its shot
// result.
//
// Side mapping: host = bottom mallet, guest = top mallet.
// ==========================================

(function () {
  'use strict';

  const STREAM_HZ = 20;
  const STREAM_MS = Math.round(1000 / STREAM_HZ);

  class HockeyOnline extends OnlineMode {
    constructor(options = {}) {
      super('glowhockey', {
        gameName: 'Glow Hockey',
        gameCommon: window.gameCommon,
        realtime: true, // continuous motion: no turn gating at all
        onGameStart: (data) => this.handleHockeyStart(data),
        onOpponentAction: (action, by) => this.handleOpponentAction(action, by),
        onGameEnd: (data, iWon) => this.handleHockeyEnd(data, iWon)
      });

      this.isHost = false;
      this._streamTimer = null;
      this._resultReported = false;
    }

    get api() { return window.hockeyApi; }

    // ---- Lifecycle ----

    handleHockeyStart(data) {
      const api = this.api;
      if (!api) {
        console.error('[HockeyOnline] window.hockeyApi missing — cannot start.');
        return;
      }

      this.isHost = this.role === 'host';
      this._resultReported = false;
      this._actionSeq = 0;
      this._appliedActionIds.clear();

      api.startOnline(this.isHost);
      this.startStreaming();

      if (this.gameCommon) {
        this.gameCommon.setOnlineWager(this.wager);
        this.gameCommon.startGamePlay();
      }
    }

    handleOpponentAction(action, by) {
      const api = this.api;
      if (!api || !action) return;

      // Position streams are deliberately NOT deduped by actionId: they carry
      // no id, are idempotent by nature (last value wins), and dropping one is
      // harmless. Only discrete actions need exactly-once handling.
      if (action.type === 'mallet') {
        api.setOppTarget({ x: action.x, y: action.y });
        return;
      }
      if (action.type === 'puck') {
        // Only the host is authoritative for the puck; ignore any puck packet
        // if we happen to be the host (defensive against a mis-seated peer).
        if (!this.isHost) api.applyPuckSnapshot(action);
        return;
      }
    }

    handleHockeyEnd(data, iWon) {
      this.stopStreaming();
      if (this.api) this.api.stopOnline();
      if (this._resultReported) return; // our own end already showed a result
      if (window.gameCommon) {
        const label = iWon
          ? 'You win the match!'
          : `${this.opponent?.username || 'Opponent'} wins the match.`;
        window.gameCommon.showResult(iWon, `<b>${label}</b>`);
      }
    }

    // ---- Streaming ----

    startStreaming() {
      this.stopStreaming();
      this._streamTimer = setInterval(() => {
        const api = this.api;
        if (!api || !this.gameStarted) return;
        if (!window.socketClient || !socketClient.broadcastAction) return;

        // Our own mallet target — every client sends this.
        const t = api.getMyTarget();
        if (t) socketClient.broadcastAction({ type: 'mallet', x: t.x, y: t.y });

        // The host additionally owns the puck and the score.
        if (this.isHost) {
          const p = api.getPuckSnapshot();
          if (p) socketClient.broadcastAction(Object.assign({ type: 'puck' }, p));
        }
      }, STREAM_MS);
    }

    stopStreaming() {
      if (this._streamTimer) {
        clearInterval(this._streamTimer);
        this._streamTimer = null;
      }
    }

    // ---- Reporting ----

    // Called from glow-hockey.html when the match reaches the win score.
    // Both clients see the same host-authoritative score, so report from the
    // host only to avoid settling the wager twice.
    reportGameOver(iWon) {
      if (!this.gameStarted || this._resultReported) return;
      if (!this.isHost) {
        // Guest: stop streaming but let the host's report settle the match.
        this._resultReported = true;
        this.stopStreaming();
        return;
      }
      this._resultReported = true;
      this.stopStreaming();

      const myUserId = window.socketClient ? socketClient.userId : null;
      const oppUserId = this.opponent?.userId || null;
      const score = this.api ? this.api.getScore() : null;

      this.sendGameEnd('win', iWon ? myUserId : oppUserId, { score });
    }

    destroy() {
      this.stopStreaming();
      if (this.api) this.api.stopOnline();
      this.isHost = false;
      this._resultReported = false;
      this._appliedActionIds.clear();
      super.destroy();
    }
  }

  window.HockeyOnline = HockeyOnline;
})();
