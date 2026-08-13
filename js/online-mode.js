// ==========================================
// ArenaX Online Mode — Shared 1v1 PvP logic
// Handles room creation, joining, socket events
// Extend this class for each game
// ==========================================

(function () {
  'use strict';

  // Action types that never pass the turn (mirror of backend NON_TURN_ACTIONS)
  const NON_TURN_TYPES = ['striker_place', 'ball_in_hand', 'mallet_move', 'sync', 'paddle', 'puck', 'goal', 'roll'];

  class OnlineMode {
    constructor(gameKey, options = {}) {
      this.gameKey = gameKey;
      // Modal onclick="..." strings are parsed as JavaScript, so a gameKey
      // like '8ball-pool' would generate `window.onlineMode_8ball-pool`,
      // which JS reads as `8ball MINUS pool` (a SyntaxError, silently eaten
      // by the inline handler — the button does nothing). instanceKey strips
      // anything that isn't a valid identifier character so every gameKey is
      // safe to interpolate into onclick="". DOM id="..." attributes don't
      // have this problem (hyphens are valid in HTML ids), so those still use
      // the raw gameKey.
      this.instanceKey = String(gameKey).replace(/[^a-zA-Z0-9_]/g, '');
      // Auto-register so `window.onlineMode_<instanceKey>` always resolves,
      // even if the game's own HTML doesn't (or can't, if it guessed wrong)
      // assign this instance to that name itself.
      window['onlineMode_' + this.instanceKey] = this;
      this.gameName = options.gameName || gameKey;
      this.gameCommon = options.gameCommon || null;
      this.roomCode = null;
      this.role = null; // 'host' | 'guest'
      this.opponent = null; // { userId, username }
      this.myTurn = false;
      this.gameStarted = false;
      this.wager = 0;
      this.matchId = null;
      this.turnDeadline = null;
      this.turnTimerInterval = null;
      this.realtime = options.realtime || false; // real-time games skip turn gating
      this._startData = null;  // cached game:start payload (for state replay)
      this._restoring = false; // true while replaying state after reconnect
      this._pendingRematchCode = null;
      this._hostReady = false;
      this._guestReady = false;
      // Dual-transport action de-duplication (see sendReliableAction).
      this._actionSeq = 0;
      this._appliedActionIds = new Set();

      // Callbacks to override in subclass
      this.onGameStart = options.onGameStart || (() => {});
      this.onOpponentAction = options.onOpponentAction || (() => {});
      this.onGameEnd = options.onGameEnd || (() => {});
      this.onTurnChange = options.onTurnChange || (() => {});

      if (this.gameCommon) {
        this.gameCommon.onRematch = () => this.showRematchOverlay();
      }

      this.setupSocketHandlers();
    }

    // Setup socket event handlers
    setupSocketHandlers() {
      if (!window.socketClient) {
        console.error('[OnlineMode] socketClient not found');
        return;
      }

      socketClient.onGameJoined((data) => this.handleGameJoined(data));
      socketClient.onGameStart((data) => this.handleGameStart(data));
      socketClient.onGameAction((data) => this.handleGameAction(data));
      socketClient.onGameTurn((data) => this.handleGameTurn(data));
      socketClient.onGameEnd((data) => this.handleGameEnd(data));
      socketClient.onPeerJoined((data) => this.handlePeerJoined(data));
      socketClient.onPeerReady((data) => this.handlePeerReady(data));
      socketClient.onPeerLeft((data) => this.handlePeerLeft(data));
      socketClient.onGameError((data) => this.handleGameError(data));
      socketClient.onTurnTimeout((data) => this.handleTurnTimeout(data));
      socketClient.onActionAck((data) => this.handleActionAck(data));
      socketClient.onGameSync((data) => this.handleGameSync(data));
      socketClient.onPeerDisconnected((data) => this.handlePeerDisconnected(data));
      socketClient.onPeerReconnected((data) => this.handlePeerReconnected(data));
      socketClient.onRematchCreated((data) => this.handleRematchCreated(data));
      socketClient.onRematchOffer((data) => this.handleRematchOffer(data));

      // After a socket reconnect, socketClient auto-rejoins the room;
      // request a fresh authoritative state snapshot as well.
      socketClient.onConnected(() => {
        if (this.gameStarted && this.roomCode) {
          setTimeout(() => socketClient.requestSync(this.roomCode), 300);
        }
      });
    }

    // Show the online mode modal — matchmaking-first
    showModal() {
      this.createModalIfNeeded();
      document.getElementById('onlineModal')?.classList.add('show');
      this.showQuickMatch(); // default to quick match
    }

    // ── Quick Match / Matchmaking ──────────────────────────────────────
    showQuickMatch() {
      document.getElementById('onlineModeSelect').style.display = 'grid';
      document.getElementById(`createRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`joinRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`waitingRoom_${this.gameKey}`).style.display = 'none';
      document.getElementById(`matchmakingUI_${this.gameKey}`).style.display = 'none';
      this.clearError();
    }

    showMatchmakingUI() {
      document.getElementById('onlineModeSelect').style.display = 'none';
      document.getElementById(`createRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`joinRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`waitingRoom_${this.gameKey}`).style.display = 'none';
      document.getElementById(`matchmakingUI_${this.gameKey}`).style.display = 'block';
      this.clearError();
    }

    async startQuickMatch() {
      const wagerInput = document.getElementById(`quickMatchWager_${this.gameKey}`);
      const wager = parseInt(wagerInput?.value || '0', 10);
      if (isNaN(wager) || wager < 0) { this.showError('Enter a valid wager'); return; }

      try {
        this.showMatchmakingUI();
        this._animateQueue();

        // Call API first — socket connection only needed after match
        const response = await this.apiCall('/matchmaking/join', 'POST', { gameKey: this.gameKey, wager });

        if (!response.success) {
          this._stopQueueAnimation();
          this.showQuickMatch();
          this.showError(response.error || 'Matchmaking failed');
          return;
        }

        if (response.matched) {
          this._stopQueueAnimation();
          this.wager = response.room.wager;
          this.gameCommon?.setOnlineWager(this.wager);
          this.roomCode = response.roomCode;
          this.role = response.role;

          // Now connect socket only when matched
          try { await this.ensureConnected(); } catch (e) { /* socket optional */ }
          if (socketClient && socketClient.joinGame) {
            socketClient.currentRoom = {
              roomCode: this.roomCode, gameKey: this.gameKey,
              roomId: response.room?.id, role: this.role
            };
            socketClient.joinGame(this.roomCode, this.gameKey, response.room?.id);
          }

          this.showWaitingRoom(this.roomCode);
          document.getElementById(`readyBtn_${this.gameKey}`).style.display = 'block';
          document.getElementById(`waitingStatus_${this.gameKey}`).textContent = 'Matched! Click Ready.';
        } else {
          // Waiting for opponent — poll
          this._pollMatchmaking();
        }
      } catch (err) {
        this._stopQueueAnimation();
        console.error('[OnlineMode] quickMatch error:', err);
        this.showError(err.message || 'Matchmaking failed');
        this.showQuickMatch();
      }
    }

    _queueAnimInterval = null;
    _queueDots = 0;
    _queueStartTime = 0;

    _animateQueue() {
      this._queueStartTime = Date.now();
      this._queueDots = 0;
      const statusEl = document.getElementById(`queueStatus_${this.gameKey}`);
      const timerEl = document.getElementById(`queueTimer_${this.gameKey}`);
      this._queueAnimInterval = setInterval(() => {
        this._queueDots = (this._queueDots + 1) % 4;
        const dots = '.'.repeat(this._queueDots);
        if (statusEl) statusEl.textContent = `Searching for opponent${dots}`;
        if (timerEl) {
          const elapsed = Math.floor((Date.now() - this._queueStartTime) / 1000);
          timerEl.textContent = `${Math.floor(elapsed/60)}:${(elapsed%60).toString().padStart(2,'0')}`;
        }
      }, 500);
    }

    _stopQueueAnimation() {
      if (this._queueAnimInterval) { clearInterval(this._queueAnimInterval); this._queueAnimInterval = null; }
    }

    _matchmakingPoll = null;
    _matchmakingPollStopped = false;

    _pollMatchmaking() {
      this._matchmakingPollStopped = false;
      const poll = setInterval(async () => {
        if (this._matchmakingPollStopped) { clearInterval(poll); return; }
        if (!document.getElementById(`matchmakingUI_${this.gameKey}`)?.offsetParent) {
          clearInterval(poll); return;
        }
        try {
          const resp = await this.apiCall(`/matchmaking/status?gameKey=${this.gameKey}`, 'GET');
          if (!resp.success) { clearInterval(poll); return; }
          // If we were matched while polling
          if (resp.matched && resp.roomCode) {
            clearInterval(poll);
            this._stopQueueAnimation();
            this.wager = resp.room.wager;
            this.gameCommon?.setOnlineWager(this.wager);
            this.roomCode = resp.roomCode;
            this.role = resp.role || 'host';

            // Connect socket if available
            try { await this.ensureConnected(); } catch (e) { /* socket optional */ }
            if (socketClient && socketClient.joinGame) {
              socketClient.currentRoom = {
                roomCode: this.roomCode, gameKey: this.gameKey,
                roomId: resp.room?.id, role: this.role
              };
              socketClient.joinGame(this.roomCode, this.gameKey, resp.room?.id);
            }
            this.showWaitingRoom(this.roomCode);
            document.getElementById(`readyBtn_${this.gameKey}`).style.display = 'block';
            document.getElementById(`waitingStatus_${this.gameKey}`).textContent =
              resp.message || 'Matched! Click Ready.';
            return;
          }
          // Don't stop polling immediately when queue disappears -
          // give a moment for match record to appear (race condition fix)
          if (!resp.inQueue) {
            // Do one more quick check for match after queue goes empty
            setTimeout(async () => {
              if (this._matchmakingPollStopped) return;
              try {
                const retryResp = await this.apiCall(`/matchmaking/status?gameKey=${this.gameKey}`, 'GET');
                if (retryResp.matched && retryResp.roomCode) {
                  clearInterval(poll);
                  this._stopQueueAnimation();
                  this.wager = retryResp.room.wager;
                  this.gameCommon?.setOnlineWager(this.wager);
                  this.roomCode = retryResp.roomCode;
                  this.role = retryResp.role || 'host';
                  try { await this.ensureConnected(); } catch (e) { }
                  if (socketClient && socketClient.joinGame) {
                    socketClient.currentRoom = {
                      roomCode: this.roomCode, gameKey: this.gameKey,
                      roomId: retryResp.room?.id, role: this.role
                    };
                    socketClient.joinGame(this.roomCode, this.gameKey, retryResp.room?.id);
                  }
                  this.showWaitingRoom(this.roomCode);
                  document.getElementById(`readyBtn_${this.gameKey}`).style.display = 'block';
                  document.getElementById(`waitingStatus_${this.gameKey}`).textContent =
                    retryResp.message || 'Matched! Click Ready.';
                } else {
                  clearInterval(poll);
                }
              } catch (e) { clearInterval(poll); }
            }, 500);
          }
        } catch (e) { /* retry */ }
      }, 1000);
      this._matchmakingPoll = poll;
    }

    cancelMatchmaking() {
      this._matchmakingPollStopped = true;
      this._stopQueueAnimation();
      if (this._matchmakingPoll) { clearInterval(this._matchmakingPoll); this._matchmakingPoll = null; }
      this.apiCall('/matchmaking/leave', 'POST').catch(() => {});
      this.showQuickMatch();
    }

    // Hide the online modal
    hideModal() {
      // Remove the modal entirely (not just hide) so it never covers the game
      const modal = document.getElementById('onlineModal');
      if (modal) modal.remove();
      // Also clear any residual inline styles on the backdrop if it exists separately
      document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    }

    // Create the online modal HTML if it doesn't exist
    createModalIfNeeded() {
      if (document.getElementById('onlineModal')) return;

      const modal = document.createElement('div');
      modal.id = 'onlineModal';
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal" style="max-width:440px;">
          <h2>🌐 Play Online</h2>
          <div class="sub">${this.gameName} — Quick Match</div>

          <!-- Mode Select -->
          <div id="onlineModeSelect">
            <div class="ax-online-hero">
              <div style="font-size:44px;margin-bottom:6px;">⚡</div>
              <strong style="display:block;font-size:17px;margin-bottom:4px;color:#faf5ea;">Quick Match</strong>
              <span style="color:#b7ad97;font-size:13px;">Auto-match with another player</span>
              <input type="number" id="quickMatchWager_${this.gameKey}" min="0" value="0"
                     placeholder="Wager (0 = friendly)" class="gx-wager-input"
                     style="margin-top:14px;font-size:18px;text-align:center;width:100%;">
              <button class="btn ax-btn-block" onclick="window.onlineMode_${this.instanceKey}.startQuickMatch()">Find Opponent</button>
            </div>
          </div>

          <!-- Matchmaking Queue UI -->
          <div id="matchmakingUI_${this.gameKey}" class="online-form" style="display:none;">
            <div class="ax-matchmaking-center">
              <div class="ax-pulse-ring"></div>
              <div id="queueStatus_${this.gameKey}" style="font-size:18px;font-weight:700;color:#faf5ea;">Searching for opponent</div>
              <div id="queueTimer_${this.gameKey}" class="ax-queue-timer">0:00</div>
              <div style="color:#b7ad97;font-size:13px;">Waiting for another player...</div>
            </div>
            <button class="btn secondary" style="width:100%;" onclick="window.onlineMode_${this.instanceKey}.cancelMatchmaking()">Cancel</button>
          </div>

          <!-- Create Room Form -->
          <div id="createRoomForm_${this.gameKey}" class="online-form" style="display:none;">
            <div class="sub" style="margin-bottom:12px;">Set your wager and create the room</div>
            <input type="number" id="onlineWager_${this.gameKey}" min="5" max="1000" value="10"
                   placeholder="Wager (AX)" class="gx-wager-input" style="font-size:20px;">
            <div class="gx-range-hint">Min 5 AX · Max 1000 AX</div>
            <div class="modal-actions">
              <button class="btn secondary" onclick="window.onlineMode_${this.instanceKey}.showModeSelect()">Back</button>
              <button class="btn" onclick="window.onlineMode_${this.instanceKey}.createRoom()">Create & Wait</button>
            </div>
          </div>

          <!-- Join Room Form -->
          <div id="joinRoomForm_${this.gameKey}" class="online-form" style="display:none;">
            <div class="sub" style="margin-bottom:12px;">Enter the 6-character room code</div>
            <input type="text" id="joinRoomCode_${this.gameKey}" maxlength="6"
                   placeholder="ROOMCODE" class="gx-wager-input" style="font-size:24px;text-transform:uppercase;letter-spacing:4px;">
            <div class="modal-actions">
              <button class="btn secondary" onclick="window.onlineMode_${this.instanceKey}.showModeSelect()">Back</button>
              <button class="btn" onclick="window.onlineMode_${this.instanceKey}.joinRoom()">Join Match</button>
            </div>
          </div>

          <!-- Waiting Room -->
          <div id="waitingRoom_${this.gameKey}" class="online-form" style="display:none;">
            <div id="waitingPlayers_${this.gameKey}" style="margin:12px 0;">
              <div class="ax-player-row" id="waitingPlayerHost_${this.gameKey}">
                <div class="ax-player-avatar">H</div>
                <div class="ax-player-name" id="waitingHostName_${this.gameKey}">Host</div>
                <div class="ax-player-status" id="waitingHostStatus_${this.gameKey}">Not Ready</div>
              </div>
              <div class="ax-player-row" id="waitingPlayerGuest_${this.gameKey}">
                <div class="ax-player-avatar">G</div>
                <div class="ax-player-name" id="waitingGuestName_${this.gameKey}">Waiting...</div>
                <div class="ax-player-status" id="waitingGuestStatus_${this.gameKey}">-</div>
              </div>
            </div>
            <div class="sub" id="waitingStatus_${this.gameKey}">Waiting for opponent to join...</div>
            <div class="modal-actions">
              <button class="btn secondary" onclick="window.onlineMode_${this.instanceKey}.cancelRoom()">Cancel</button>
              <button class="btn" id="readyBtn_${this.gameKey}" style="display:none;"
                      onclick="window.onlineMode_${this.instanceKey}.sendReady()">Ready to Play</button>
            </div>
          </div>

          <!-- Error display -->
          <div id="onlineError_${this.gameKey}" class="gx-error" style="margin-top:12px;"></div>
        </div>
      `;
      document.body.appendChild(modal);
      this._injectStyles();
      this._createRematchOverlay();
    }

    _injectStyles() {
      if (document.getElementById('ax-online-styles')) return;
      const style = document.createElement('style');
      style.id = 'ax-online-styles';
      style.textContent = `
        #onlineModal.modal-backdrop { position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,.75); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 10000; opacity: 0; pointer-events: none; transition: opacity .25s; }
        #onlineModal.modal-backdrop.show { opacity: 1; pointer-events: auto; }
        #onlineModal .modal { position: static; margin: 0; background: linear-gradient(180deg, rgba(22,22,30,.98), rgba(12,12,18,.98)); border: 1px solid rgba(232,188,79,.25); border-radius: 24px; box-shadow: 0 40px 100px rgba(0,0,0,.7), 0 0 60px rgba(232,188,79,.08); padding: 28px; color: #faf5ea; transform: translateY(10px) scale(.97); transition: transform .25s; }
        #onlineModal.modal-backdrop.show .modal { transform: translateY(0) scale(1); }
        #onlineModal h2 { margin: 0 0 6px; font-family: Orbitron, sans-serif; font-size: 26px; color: #e8bc4f; text-align: center; letter-spacing: 1px; }
        #onlineModal .sub { text-align: center; color: #b7ad97; font-size: 13px; margin-bottom: 18px; }
        .ax-online-hero { background: linear-gradient(135deg, rgba(232,188,79,.12), rgba(232,188,79,.04)); border: 1px solid rgba(232,188,79,.25); border-radius: 20px; padding: 22px; text-align: center; margin-bottom: 14px; }
        .ax-online-hero:hover { border-color: rgba(232,188,79,.4); }
        .ax-online-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .ax-online-opt { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 16px; text-align: center; cursor: pointer; transition: all .15s; }
        .ax-online-opt:hover { background: rgba(255,255,255,.07); border-color: rgba(232,188,79,.25); transform: translateY(-2px); }
        .ax-room-code-wrap { position: relative; margin: 14px 0; }
        .ax-room-code { font-family: Orbitron, monospace; font-size: 32px; font-weight: 900; letter-spacing: 7px; color: #e8bc4f; text-align: center; padding: 18px 50px 18px 18px; background: rgba(0,0,0,.28); border-radius: 14px; border: 1px dashed rgba(232,188,79,.35); user-select: all; }
        .ax-copy-code { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: rgba(232,188,79,.12); border: 1px solid rgba(232,188,79,.25); color: #e8bc4f; border-radius: 8px; padding: 7px 10px; font-size: 12px; cursor: pointer; }
        .ax-copy-code:hover { background: rgba(232,188,79,.22); }
        .ax-player-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: rgba(255,255,255,.04); border-radius: 12px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,.06); }
        .ax-player-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #e8bc4f, #8b6118); display: flex; align-items: center; justify-content: center; font-weight: 800; color: #060608; font-size: 14px; }
        .ax-player-name { font-weight: 600; font-size: 14px; }
        .ax-player-status { margin-left: auto; font-size: 12px; color: #b7ad97; }
        .ax-player-status.ready { color: #53dc93; }
        .ax-matchmaking-center { text-align: center; padding: 30px 0 20px; }
        .ax-pulse-ring { width: 70px; height: 70px; border-radius: 50%; border: 3px solid rgba(232,188,79,.18); border-top-color: #e8bc4f; animation: axSpin 1s linear infinite; margin: 0 auto 18px; box-shadow: 0 0 24px rgba(232,188,79,.15); }
        .ax-queue-timer { font-size: 34px; font-weight: 900; color: #e8bc4f; font-family: Orbitron, monospace; margin: 8px 0; }

        /* The modal must not depend on the host page's stylesheet. Some game
           pages define no .btn at all (glow hockey uses .menu-btn, for
           example), which left the wager field and the Find Opponent button
           rendering as raw browser controls. These rules are scoped to
           #onlineModal so the matchmaking UI looks identical on every game,
           exactly like the self-contained centring rules above. */
        #onlineModal .btn {
          appearance: none; -webkit-appearance: none; cursor: pointer;
          font-family: inherit; font-size: 15px; font-weight: 800;
          padding: 12px 18px; border-radius: 999px; border: 1px solid transparent;
          background: linear-gradient(135deg, #fff2b8 0%, #e8bc4f 45%, #8b6118 100%);
          color: #140d04; transition: filter .15s, transform .15s;
        }
        #onlineModal .btn:hover { filter: brightness(1.06); }
        #onlineModal .btn:active { transform: translateY(1px); }
        #onlineModal .btn.secondary {
          background: rgba(255,255,255,.06); color: #faf5ea;
          border-color: rgba(255,255,255,.16);
        }
        #onlineModal .btn.secondary:hover { background: rgba(255,255,255,.1); }
        #onlineModal .ax-btn-block { display: block; width: 100%; margin-top: 12px; }
        #onlineModal input {
          appearance: none; -webkit-appearance: none; font-family: inherit;
          width: 100%; padding: 12px 14px; border-radius: 12px;
          background: rgba(0,0,0,.34); color: #faf5ea;
          border: 1px solid rgba(232,188,79,.28); outline: none;
        }
        #onlineModal input:focus { border-color: rgba(232,188,79,.6); }
        #onlineModal .modal-actions { display: flex; gap: 10px; justify-content: center; margin-top: 14px; }
        #onlineModal .gx-error { color: #f25c5c; font-size: 13px; text-align: center; min-height: 18px; }
        #onlineModal .gx-range-hint { color: #b7ad97; font-size: 12px; text-align: center; margin-top: 6px; }
        .ax-rematch-overlay { position: fixed; inset: 0; background: rgba(6,6,8,.85); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; z-index: 10000; opacity: 0; pointer-events: none; transition: opacity .25s; }
        .ax-rematch-overlay.show { opacity: 1; pointer-events: auto; }
        .ax-rematch-card { background: linear-gradient(180deg, rgba(24,24,32,.98), rgba(14,14,20,.98)); border: 1px solid rgba(232,188,79,.3); border-radius: 24px; padding: 30px; text-align: center; max-width: 360px; width: 90%; box-shadow: 0 40px 100px rgba(0,0,0,.7); }
        .ax-rematch-title { font-family: Orbitron, sans-serif; font-size: 22px; color: #e8bc4f; margin-bottom: 10px; }
        .ax-rematch-sub { color: #b7ad97; font-size: 14px; margin-bottom: 22px; }
        .ax-rematch-actions { display: flex; gap: 10px; justify-content: center; }
        @keyframes axSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `;
      document.head.appendChild(style);
    }

    _createRematchOverlay() {
      if (document.getElementById(`rematchOverlay_${this.gameKey}`)) return;
      const overlay = document.createElement('div');
      overlay.id = `rematchOverlay_${this.gameKey}`;
      overlay.className = 'ax-rematch-overlay';
      overlay.innerHTML = `
        <div class="ax-rematch-card">
          <div class="ax-rematch-title">Rematch?</div>
          <div class="ax-rematch-sub" id="rematchStatus_${this.gameKey}">Want to play again?</div>
          <div class="ax-rematch-actions">
            <button class="btn secondary" onclick="window.onlineMode_${this.instanceKey}.hideRematchOverlay()">No Thanks</button>
            <button class="btn" id="rematchBtn_${this.gameKey}" onclick="window.onlineMode_${this.instanceKey}.requestRematch()">Rematch</button>
            <button class="btn" id="rematchJoinBtn_${this.gameKey}" style="display:none;" onclick="window.onlineMode_${this.instanceKey}.acceptRematch()">Join Rematch</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    // Show mode selection (create/join)
    showModeSelect() {
      document.getElementById('onlineModeSelect').style.display = 'grid';
      document.getElementById(`createRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`joinRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`waitingRoom_${this.gameKey}`).style.display = 'none';
      this.clearError();
    }

    // Show create room form
    showCreateRoom() {
      document.getElementById('onlineModeSelect').style.display = 'none';
      document.getElementById(`createRoomForm_${this.gameKey}`).style.display = 'block';
      document.getElementById(`joinRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`waitingRoom_${this.gameKey}`).style.display = 'none';
      this.clearError();
    }

    // Show join room form
    showJoinRoom() {
      document.getElementById('onlineModeSelect').style.display = 'none';
      document.getElementById(`createRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`joinRoomForm_${this.gameKey}`).style.display = 'block';
      document.getElementById(`waitingRoom_${this.gameKey}`).style.display = 'none';
      this.clearError();
    }

    // Show waiting room
    showWaitingRoom(roomCode) {
      // Stop any queue polling/animation so the spinner can't overlap
      this._stopQueueAnimation();
      const mmUI = document.getElementById(`matchmakingUI_${this.gameKey}`);
      if (mmUI) mmUI.style.display = 'none';
      document.getElementById('onlineModeSelect').style.display = 'none';
      document.getElementById(`createRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`joinRoomForm_${this.gameKey}`).style.display = 'none';
      document.getElementById(`waitingRoom_${this.gameKey}`).style.display = 'block';
      document.getElementById(`waitingStatus_${this.gameKey}`).textContent = 'Waiting for opponent to join...';
      this._updateWaitingPlayers();
      // Reconcile as soon as the lobby is visible so both ready badges update
      // even before the local player clicks Ready.
      this._startReadyPolling();
      this.clearError();
    }

    // Create a new room
    async createRoom() {
      this.reset();
      const wagerInput = document.getElementById(`onlineWager_${this.gameKey}`);
      const wager = parseInt(wagerInput?.value || '10', 10);

      if (isNaN(wager) || wager < 5 || wager > 1000) {
        this.showError('Enter a wager between 5 and 1000 AX');
        return;
      }

      // Check balance
      const balance = window.arenaX ? window.arenaX.getBalance() : 0;
      if (balance < wager) {
        this.showError('Insufficient balance. You need ' + wager + ' AX');
        return;
      }

      try {
        // Ensure socket connected
        await this.ensureConnected();

        // Create room via REST API
        const response = await this.apiCall('/rooms/create', 'POST', {
          gameKey: this.gameKey,
          wager: wager
        });

        if (!response.success) {
          this.showError(response.error || 'Failed to create room');
          return;
        }

        this.wager = wager;
        this.gameCommon?.setOnlineWager(this.wager);
        this.roomCode = response.roomCode;
        this.role = 'host';

        // Join via realtime channel
        socketClient.currentRoom = {
          roomCode: this.roomCode,
          gameKey: this.gameKey,
          roomId: response.room?.id,
          role: this.role
        };
        socketClient.joinGame(this.roomCode, this.gameKey, response.room?.id);

        this.showWaitingRoom(this.roomCode);
        document.getElementById(`readyBtn_${this.gameKey}`).style.display = 'none';
        document.getElementById(`waitingStatus_${this.gameKey}`).textContent = 'Waiting for opponent to join...';
        this._updateWaitingPlayers();

      } catch (err) {
        console.error('[OnlineMode] createRoom error:', err);
        this.showError(err.message || 'Failed to create room');
      }
    }

    // Join an existing room
    async joinRoom() {
      this.reset();
      const codeInput = document.getElementById(`joinRoomCode_${this.gameKey}`);
      const roomCode = codeInput?.value?.toUpperCase().trim();

      if (!roomCode || roomCode.length !== 6) {
        this.showError('Enter a valid 6-character room code');
        return;
      }

      try {
        // Ensure socket connected
        await this.ensureConnected();

        // Validate room via REST API
        const response = await this.apiCall('/rooms/join', 'POST', { roomCode });

        if (!response.success) {
          this.showError(response.error || 'Room not found or already started');
          return;
        }

        this.roomCode = roomCode;
        this.wager = response.room.wager;
        this.gameCommon?.setOnlineWager(this.wager);
        this.role = 'guest';

        // Check balance for wager
        const balance = window.arenaX ? window.arenaX.getBalance() : 0;
        if (balance < this.wager) {
          this.showError('Insufficient balance. You need ' + this.wager + ' AX');
          return;
        }

        // Join via realtime channel
        socketClient.currentRoom = {
          roomCode: this.roomCode,
          gameKey: this.gameKey,
          roomId: response.room?.id,
          role: this.role
        };
        socketClient.joinGame(this.roomCode, this.gameKey, response.room?.id);

        this.opponent = { username: response.room.creator?.username || 'Host', userId: response.room.creator_id };
        this.showWaitingRoom(this.roomCode);
        document.getElementById(`readyBtn_${this.gameKey}`).style.display = 'block';
        document.getElementById(`waitingStatus_${this.gameKey}`).textContent =
          `Opponent: ${this.opponent.username} · Wager: ${this.wager} AX`;
        this._updateWaitingPlayers();

      } catch (err) {
        console.error('[OnlineMode] joinRoom error:', err);
        this.showError(err.message || 'Failed to join room');
      }
    }

    // Cancel room (leave)
    cancelRoom() {
      if (this.roomCode) {
        socketClient.leaveGame(this.roomCode);
        this.roomCode = null;
      }
      this.hideModal();
      this.reset();
    }

    // Send ready signal
    async sendReady() {
      if (!this.roomCode) return;
      const sent = await socketClient.sendReady(this.roomCode);
      if (!sent) return;
      // The second Ready response can start the game synchronously and remove
      // the lobby before this promise resumes.
      if (this.gameStarted) return;
      const readyBtn = document.getElementById(`readyBtn_${this.gameKey}`);
      const waitingStatus = document.getElementById(`waitingStatus_${this.gameKey}`);
      if (readyBtn) readyBtn.style.display = 'none';
      if (waitingStatus) waitingStatus.textContent = 'Ready! Waiting for opponent...';
      if (this.role === 'host') { this._hostReady = true; } else { this._guestReady = true; }
      this._updateWaitingPlayers();
      // Fallback: poll room status in case the realtime start event never arrives
      this._startReadyPolling();
    }

    _startReadyPolling() {
      if (!this.roomCode || this.gameStarted) return;
      if (this._readyPoll) clearInterval(this._readyPoll);
      this._readyPoll = setInterval(async () => {
        if (this.gameStarted) { clearInterval(this._readyPoll); this._readyPoll = null; return; }
        try {
          const resp = await this.apiCall(`/rooms/sync?code=${this.roomCode}`, 'GET');
          if (resp && resp.success && Array.isArray(resp.players)) {
            const host = resp.players.find(p => p.role === 'host');
            const guest = resp.players.find(p => p.role === 'guest');
            this._hostReady = !!host?.ready;
            this._guestReady = !!guest?.ready;
            const opponent = resp.players.find(p => p.userId !== socketClient.userId);
            if (opponent) this.opponent = { userId: opponent.userId, username: opponent.username };
            this._updateWaitingPlayers();
          }
          if (resp && resp.success && resp.room && resp.room.status === 'in_progress') {
            // Room started - extract start payload from events
            const startEvent = (resp.events || []).find(e => e.type === 'start');
            if (startEvent && startEvent.payload) {
              clearInterval(this._readyPoll); this._readyPoll = null;
              this.handleGameStart(startEvent.payload);
            }
          }
        } catch (e) { /* keep polling */ }
      }, 1500);
    }

    // Ensure socket is connected
    async ensureConnected() {
      if (socketClient.isConnected()) return;

      // Get token from storage
      const user = JSON.parse(localStorage.getItem('arenax_user') || 'null');
      const token = user?.token || localStorage.getItem('arenax_token');

      if (!token) {
        throw new Error('Please log in to play online');
      }

      await socketClient.connect(token);
    }

    // API call helper
    async apiCall(endpoint, method, data) {
      const apiBase = window.ARENAX_CONFIG && window.ARENAX_CONFIG.getApiBase
        ? window.ARENAX_CONFIG.getApiBase()
        : '/api';
      const user = JSON.parse(localStorage.getItem('arenax_user') || 'null');
      const token = user?.token || localStorage.getItem('arenax_token');

      const response = await fetch(`${apiBase}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: data ? JSON.stringify(data) : undefined
      });

      return await response.json();
    }

    // Show error message
    showError(message) {
      const el = document.getElementById(`onlineError_${this.gameKey}`);
      if (el) el.textContent = message;
    }

    // Clear error
    clearError() {
      const el = document.getElementById(`onlineError_${this.gameKey}`);
      if (el) el.textContent = '';
    }

    // ==================== SOCKET EVENT HANDLERS ====================

    handleGameJoined(data) {
      console.log('[OnlineMode] Joined room:', data);
      this.role = data.role;
      this.matchId = data.matchId;

      if (data.opponent) {
        this.opponent = { username: data.opponent };
        document.getElementById(`waitingStatus_${this.gameKey}`).textContent =
          `Opponent: ${data.opponent} · Wager: ${data.wager} AX`;
        document.getElementById(`readyBtn_${this.gameKey}`).style.display = 'block';
        this._updateWaitingPlayers();
      }

      // If we have state (reconnection), restore it
      if (data.state) {
        this.gameStarted = true;
        this.restoreState(data.state, data.currentTurn);
        // Resume the turn timer from the server deadline
        if (data.turnDeadline) {
          const remain = Math.ceil((data.turnDeadline - Date.now()) / 1000);
          if (remain > 0) this.startTurnTimer(remain);
        }
        // Show a banner if the opponent is the one currently disconnected
        if (data.opponentDisconnected) {
          this._peerStatusBanner('Opponent is disconnected — waiting…');
        }
      }
    }

    handlePeerJoined(data) {
      console.log('[OnlineMode] Peer joined:', data);
      this.opponent = { username: data.username, userId: data.userId };
      document.getElementById(`waitingStatus_${this.gameKey}`).textContent =
        `Opponent: ${data.username} joined! Click Ready to start.`;
      document.getElementById(`readyBtn_${this.gameKey}`).style.display = 'block';
      this._updateWaitingPlayers();
    }

    handlePeerReady(data) {
      console.log('[OnlineMode] Peer ready:', data);
      document.getElementById(`waitingStatus_${this.gameKey}`).textContent =
        `${data.username} is ready!`;
      if (this.role === 'host') { this._guestReady = true; } else { this._hostReady = true; }
      this._updateWaitingPlayers();
    }

    handleGameStart(data) {
      console.log('[OnlineMode] Game started:', data);
      this.gameStarted = true;
      this._hostReady = false;
      this._guestReady = false;
      this._startData = data; // cached for state replay after reconnect
      // Force-remove the Play Online modal so it doesn't cover the game
      const modal = document.getElementById('onlineModal');
      if (modal) {
        modal.classList.remove('show');
        modal.style.display = 'none';
      }
      this.hideModal();

      // Resolve my role, opponent identity, and match id from the start payload
      if (Array.isArray(data.players)) {
        const me = data.players.find(p => p.userId === socketClient.userId);
        if (me) this.role = me.role || this.role;
        const opp = data.players.find(p => p.userId !== socketClient.userId);
        if (opp) this.opponent = { userId: opp.userId, username: opp.username };
      }
      this.matchId = this.role === 'guest'
        ? (data.guestMatchId || data.matchId)
        : (data.creatorMatchId || data.matchId);

      // Determine if it's my turn
      this.myTurn = data.firstTurn === socketClient.userId;

      // Update the shared toolbar with the online wager and start timers.
      if (this.gameCommon) {
        this.gameCommon.setOnlineWager(this.wager);
        this.gameCommon.startGamePlay();
      }

      // Call game-specific handler
      this.onGameStart(data);

      // Update turn indicator
      this.onTurnChange(this.myTurn);
    }

    handleGameAction(data) {
      console.log('[OnlineMode] Opponent action:', data);
      // Server includes the authoritative nextTurn on every relayed action
      if (data.nextTurn !== undefined && socketClient.userId) {
        this.myTurn = data.nextTurn === socketClient.userId;
      } else if (!this.realtime) {
        this.myTurn = true; // legacy fallback: opponent acted, now it's my turn
      }
      this.onOpponentAction(data.action, data.by);
      if (!this.realtime) this.onTurnChange(this.myTurn);
    }

    // Server acknowledgement of our own action (authoritative turn state)
    handleActionAck(data) {
      if (this.realtime || !data || data.nextTurn === undefined) return;
      this.myTurn = data.nextTurn === socketClient.userId;
      this.onTurnChange(this.myTurn);
    }

    // Full state response to game:sync_request (has players array; physics
    // broadcasts only carry state+timestamp and are ignored here)
    handleGameSync(data) {
      if (!data || !data.players) return;
      console.log('[OnlineMode] State sync received:', data);
      if (data.state) {
        this.restoreState(data.state, data.currentTurn);
      }
      if (data.turnDeadline) {
        const remain = Math.ceil((data.turnDeadline - Date.now()) / 1000);
        if (remain > 0) this.startTurnTimer(remain);
      }
      if (data.opponentDisconnected) {
        this._peerStatusBanner('Opponent is disconnected — waiting…');
      } else {
        this._peerStatusBanner(null);
      }
    }

    handlePeerDisconnected(data) {
      console.log('[OnlineMode] Peer disconnected:', data);
      this._peerStatusBanner(
        `Opponent disconnected — waiting up to ${data.graceSeconds || 30}s for them to return…`
      );
    }

    handlePeerReconnected(data) {
      console.log('[OnlineMode] Peer reconnected:', data);
      this._peerStatusBanner(null);
    }

    // Small fixed banner for peer connectivity status
    _peerStatusBanner(text) {
      let el = document.getElementById('onlinePeerStatus');
      if (!text) {
        if (el) el.remove();
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.id = 'onlinePeerStatus';
        el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
          'background:rgba(20,20,30,.92);color:#e8bc4f;padding:8px 18px;border-radius:10px;' +
          'font-weight:700;z-index:9999;border:1px solid rgba(232,188,79,.4);font-size:14px;';
        document.body.appendChild(el);
      }
      el.textContent = text;
    }

    handleGameTurn(data) {
      console.log('[OnlineMode] Turn change:', data);
      this.myTurn = data.turn === socketClient.userId;
      this.turnDeadline = data.deadline;
      this.startTurnTimer(data.timeoutSeconds);
      this.onTurnChange(this.myTurn);
    }

    handleGameEnd(data) {
      console.log('[OnlineMode] Game ended:', data);
      this.stopTurnTimer();

      const iWon = data.winnerId === socketClient.userId;
      const isDraw = data.result === 'draw';

      // Show result via GameCommon
      if (this.gameCommon) {
        const details = isDraw ? 'Match ended in a draw.' :
          (iWon ? 'You won the match!' : `${this.opponent?.username || 'Opponent'} wins.`);
        this.gameCommon.showResult(iWon, `<b>${details}</b>`, isDraw);
      }

      this.onGameEnd(data, iWon);
      this.gameStarted = false;
      this.myTurn = false;
      this.stopTurnTimer();
    }

    handlePeerLeft(data) {
      console.log('[OnlineMode] Peer left:', data);
      if (data.forfeit) {
        // Opponent forfeited - we win
        this.stopTurnTimer();
        if (this.gameCommon) {
          this.gameCommon.showResult(true, '<b>Opponent forfeited. You win!</b>');
        }
      } else {
        // Opponent left before game started
        this.showError('Opponent left the room');
        document.getElementById(`waitingStatus_${this.gameKey}`).textContent = 'Opponent left. Waiting for new player...';
      }
    }

    handleGameError(data) {
      console.error('[OnlineMode] Error:', data);
      this.showError(data.message || 'An error occurred');
    }

    handleTurnTimeout(data) {
      console.log('[OnlineMode] Turn timeout:', data);
      this.showError(`${data.loserName} ran out of time!`);
    }

    // ==================== GAME ACTIONS ====================

    // ---- Reliable action transport (the 8-ball-pool pattern, shared) -------
    //
    // Send a game action over BOTH transports at once:
    //
    //   1. Raw Realtime broadcast — ~50ms, and ordered with respect to every
    //      other broadcast this client sends (same channel), so a fast
    //      position/state stream can never overtake the action that concludes
    //      it. This is the responsiveness path.
    //   2. REST POST /rooms/action — ~850ms, but durable: it writes a
    //      room_events row, which advances the server's authoritative
    //      current_turn_user_id and lets a refresh/reconnect (or the REST
    //      fallback poll in socket-client.js) replay the match.
    //
    // Using only REST made every move wait ~850ms; using only broadcast lost
    // the match on refresh and skipped server-side turn validation. Doing both
    // requires de-duplication, because the broadcast copy is NOT a room_events
    // row and so carries no row id for socket-client's row-level dedupe to
    // catch — hence the explicit actionId here, which subclasses check via
    // shouldApplyAction() before applying.
    //
    // The receive side is deliberately split: the base still runs turn
    // bookkeeping for BOTH copies (so the slower REST copy can correct turn
    // state authoritatively), while the subclass applies the action once.
    sendReliableAction(action) {
      if (this._restoring) return false;
      if (!this.gameStarted) {
        console.warn('[OnlineMode] Cannot send action - game not started');
        return false;
      }
      if (!this.realtime && !this.myTurn) {
        console.warn('[OnlineMode] Cannot send action - not your turn');
        return false;
      }

      const myId = (window.socketClient && socketClient.userId) || 'me';
      const payload = Object.assign({}, action, {
        actionId: `${myId}:${++this._actionSeq}`
      });

      // Guard against our own action echoing back and being re-applied.
      this._appliedActionIds.add(payload.actionId);

      if (window.socketClient && socketClient.broadcastAction) {
        socketClient.broadcastAction(payload);
      }
      return this.sendAction(payload);
    }

    // Subclasses call this at the top of their onOpponentAction handler. It
    // returns true at most once per distinct action, so an action arriving over
    // both transports (or replayed by the REST fallback poll) is applied once.
    shouldApplyAction(action) {
      if (!action) return false;
      const id = action.actionId;
      if (!id) return true; // no id (legacy/plain broadcast): cannot dedupe
      if (this._appliedActionIds.has(id)) return false;
      this._appliedActionIds.add(id);
      return true;
    }

    // Send an action to the opponent
    sendAction(action) {
      if (this._restoring) return false; // never echo replayed moves
      if (!this.gameStarted) {
        console.warn('[OnlineMode] Cannot send action - game not started');
        return false;
      }
      if (!this.realtime && !this.myTurn) {
        console.warn('[OnlineMode] Cannot send action - not your turn');
        return false;
      }

      socketClient.sendAction(action, this.roomCode);

      // Mirror the server's turn rules locally (authoritative ack follows)
      if (!this.realtime && action) {
        let passTurn;
        if (action.type === 'turn_end') {
          passTurn = !action.keepTurn;
        } else {
          passTurn = !NON_TURN_TYPES.includes(action.type) && !action.keepTurn;
        }
        if (passTurn) {
          this.myTurn = false;
          this.onTurnChange(false);
        }
      }
      return true;
    }

    // Send game end result
    sendGameEnd(result, winnerId, finalState) {
      socketClient.sendGameEnd(result, winnerId, finalState, this.roomCode);
    }

    // Start turn timer display
    startTurnTimer(seconds) {
      this.stopTurnTimer();
      if (!seconds || seconds <= 0) return;

      let remaining = seconds;
      this.turnTimerInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          this.stopTurnTimer();
        }
        // Update UI if needed (game-specific)
        this.updateTurnTimerDisplay?.(remaining);
      }, 1000);
    }

    stopTurnTimer() {
      if (this.turnTimerInterval) {
        clearInterval(this.turnTimerInterval);
        this.turnTimerInterval = null;
      }
    }

    // Restore state (for reconnection).
    // Physics games with a host snapshot get it applied directly (override
    // applySnapshot in the subclass); turn-based games replay the moves log
    // onto a fresh game. Subclasses may override for custom recovery.
    restoreState(state, currentTurn) {
      console.log('[OnlineMode] Restoring state:', state);
      this._restoring = true;
      try {
        if (state && state.snapshot && typeof this.applySnapshot === 'function') {
          this.applySnapshot(state.snapshot);
        } else if (state && Array.isArray(state.moves) && state.moves.length && this._startData) {
          // Rebuild a fresh game, then replay every logged action
          this.onGameStart(this._startData);
          for (const m of state.moves) {
            this.onOpponentAction(m, m.by);
          }
        }
      } catch (err) {
        console.error('[OnlineMode] State restore failed:', err);
      } finally {
        this._restoring = false;
      }
      this.myTurn = currentTurn === socketClient.userId;
      this.onTurnChange(this.myTurn);
    }

    // Reset state
    reset() {
      if (this._readyPoll) {
        clearInterval(this._readyPoll);
        this._readyPoll = null;
      }
      this.roomCode = null;
      this.role = null;
      this.opponent = null;
      this.myTurn = false;
      this.gameStarted = false;
      this.wager = 0;
      this.matchId = null;
      this.turnDeadline = null;
      this._startData = null;
      this._pendingRematchCode = null;
      this._hostReady = false;
      this._guestReady = false;
      // A fresh match restarts the action sequence, so stale ids from the
      // previous match must not suppress the new match's first actions.
      this._actionSeq = 0;
      this._appliedActionIds.clear();
      this._peerStatusBanner(null);
      this.stopTurnTimer();
    }

    // ==================== UI HELPERS ====================

    copyRoomCode() {
      const code = this.roomCode;
      if (!code) return;
      try {
        navigator.clipboard.writeText(code).then(() => {
          const btn = document.getElementById(`copyCodeBtn_${this.gameKey}`);
          if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
        });
      } catch (e) {
        document.execCommand('copy');
      }
    }

    _updateWaitingPlayers() {
      const hostNameEl = document.getElementById(`waitingHostName_${this.gameKey}`);
      const guestNameEl = document.getElementById(`waitingGuestName_${this.gameKey}`);
      const hostStatusEl = document.getElementById(`waitingHostStatus_${this.gameKey}`);
      const guestStatusEl = document.getElementById(`waitingGuestStatus_${this.gameKey}`);
      if (!hostNameEl || !guestNameEl) return;

      const myName = socketClient.username || 'You';
      const oppName = this.opponent?.username || (this.role === 'host' ? 'Waiting...' : 'Host');

      if (this.role === 'host') {
        hostNameEl.textContent = myName;
        guestNameEl.textContent = this.opponent ? this.opponent.username : 'Waiting...';
      } else {
        hostNameEl.textContent = oppName;
        guestNameEl.textContent = myName;
      }

      hostStatusEl.textContent = this._hostReady ? 'Ready' : 'Not Ready';
      hostStatusEl.className = 'ax-player-status' + (this._hostReady ? ' ready' : '');
      guestStatusEl.textContent = this._guestReady ? 'Ready' : 'Not Ready';
      guestStatusEl.className = 'ax-player-status' + (this._guestReady ? ' ready' : '');
    }

    // ==================== REMATCH FLOW ====================

    requestRematch() {
      if (!this.roomCode) return;
      const btn = document.getElementById(`rematchBtn_${this.gameKey}`);
      if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
      socketClient.requestRematch(this.roomCode).then((data) => {
        if (data && data.success) {
          this._pendingRematchCode = data.roomCode;
          const status = document.getElementById(`rematchStatus_${this.gameKey}`);
          if (status) status.textContent = 'Rematch room created. Waiting for opponent...';
        }
      }).catch(() => {
        if (btn) { btn.disabled = false; btn.textContent = 'Rematch'; }
      });
    }

    acceptRematch() {
      if (!this._pendingRematchCode) return;
      this.joinRematchRoom(this._pendingRematchCode);
    }

    async joinRematchRoom(roomCode) {
      this.hideRematchOverlay();
      this.reset();
      this.roomCode = roomCode;
      this.role = 'guest';
      try {
        await this.ensureConnected();
        const response = await this.apiCall('/rooms/join', 'POST', { roomCode });
        if (!response.success) {
          this.showError(response.error || 'Could not join rematch room');
          return;
        }
        this.wager = response.room.wager;
        this.gameCommon?.setOnlineWager(this.wager);
        socketClient.currentRoom = {
          roomCode: this.roomCode,
          gameKey: this.gameKey,
          roomId: response.room?.id,
          role: this.role
        };
        socketClient.joinGame(this.roomCode, this.gameKey, response.room?.id);
        this.opponent = { username: response.room.creator?.username || 'Host', userId: response.room.creator_id };
        this.showWaitingRoom(this.roomCode);
        document.getElementById(`readyBtn_${this.gameKey}`).style.display = 'block';
        document.getElementById(`waitingStatus_${this.gameKey}`).textContent =
          `Opponent: ${this.opponent.username} · Wager: ${this.wager} AX`;
      } catch (err) {
        console.error('[OnlineMode] joinRematchRoom error:', err);
        this.showError(err.message || 'Failed to join rematch room');
      }
    }

    handleRematchCreated(data) {
      console.log('[OnlineMode] Rematch created:', data);
      this._pendingRematchCode = data.newRoomCode;
      const status = document.getElementById(`rematchStatus_${this.gameKey}`);
      if (status) status.textContent = 'Rematch room created. Waiting for opponent...';
    }

    handleRematchOffer(data) {
      console.log('[OnlineMode] Rematch offer:', data);
      this._pendingRematchCode = data.newRoomCode;
      this.showRematchOverlay();
      const status = document.getElementById(`rematchStatus_${this.gameKey}`);
      if (status) status.textContent = `${this.opponent?.username || 'Opponent'} wants a rematch!`;
      const joinBtn = document.getElementById(`rematchJoinBtn_${this.gameKey}`);
      const rematchBtn = document.getElementById(`rematchBtn_${this.gameKey}`);
      if (joinBtn) joinBtn.style.display = 'inline-block';
      if (rematchBtn) rematchBtn.style.display = 'none';
    }

    showRematchOverlay() {
      const overlay = document.getElementById(`rematchOverlay_${this.gameKey}`);
      if (overlay) overlay.classList.add('show');
    }

    hideRematchOverlay() {
      const overlay = document.getElementById(`rematchOverlay_${this.gameKey}`);
      if (overlay) overlay.classList.remove('show');
    }

    // Leave and cleanup
    destroy() {
      if (this.roomCode) {
        socketClient.leaveGame(this.roomCode);
      }
      this.stopTurnTimer();
      this.reset();
    }

    /**
     * Called by game pages when launched from a custom room (roomCode in URL).
     * Connects to the existing room via the backend + socketClient, bypassing
     * the matchmaking/modal flow entirely.
     */
    async joinCustomRoom(roomCode, role) {
      try {
        this.roomCode = roomCode.toUpperCase();
        this.role     = role || 'guest';

        // Step 1: Ensure socket is connected (same as matchmaking does)
        try { await this.ensureConnected(); } catch(e) { /* socket optional */ }

        // Step 2: Fetch room via /sync (works for any status: waiting/ready/in_progress)
        const data = await this.apiCall('/rooms/sync?code=' + this.roomCode, 'GET');

        if (!data?.success) {
          console.error('[OnlineMode.joinCustomRoom] sync failed:', data?.error);
          alert('Could not connect to room: ' + (data?.error || 'Room not found'));
          return;
        }

        const room = data.room;
        this.wager  = room.wager || 0;
        this.matchId = room.matchId || null;
        if (this.gameCommon) this.gameCommon.setOnlineWager(this.wager);

        // Step 3: Set currentRoom on socket client (mirrors matchmaking exactly)
        if (socketClient) {
          socketClient.currentRoom = {
            roomCode: this.roomCode,
            gameKey:  this.gameKey,
            roomId:   room.id,
            role:     this.role
          };
          if (socketClient.joinGame) {
            socketClient.joinGame(this.roomCode, this.gameKey, room.id);
          }
        }

        console.log('[OnlineMode.joinCustomRoom] connected to room', this.roomCode, 'as', this.role, '| status:', room.status);

        // Step 4: If room already has a 'start' event in the events log, fire handleGameStart now.
        // Otherwise, _startReadyPolling() will poll /rooms/sync until it appears (same as matchmaking).
        const startEvent = (data.events || []).find(e => e.type === 'start');
        if (startEvent && startEvent.payload) {
          console.log('[OnlineMode.joinCustomRoom] found start event immediately, starting game');
          this.handleGameStart(startEvent.payload);
        } else {
          // Poll until the start event appears (handles edge case where game just started)
          this._startReadyPolling();
        }

      } catch(e) {
        console.error('[OnlineMode.joinCustomRoom] error:', e);
        alert('Failed to connect to room. Please try again.');
      }
    }


  }


  // Export class
  window.OnlineMode = OnlineMode;
})();
