// ==========================================
// ArenaX Socket Client — Supabase Realtime transport
// Maintains the same public API as the old Socket.IO client so game pages
// and js/online-mode.js keep working without changes.
// ==========================================

(function () {
  'use strict';

  const API_BASE = () => (window.ARENAX_CONFIG && window.ARENAX_CONFIG.getApiBase
    ? window.ARENAX_CONFIG.getApiBase()
    : '/api');

  class SocketClient {
    constructor() {
      this.supabase = null;
      this.channel = null;
      this.connected = false;
      this.userId = null;
      this.username = null;
      this.currentRoom = null;
      this.handlers = new Map();
      this._myPresence = null;
      // Authoritative room_events are delivered by BOTH Supabase Realtime and
      // a REST reconcile poll (see _startEventFallback). Every event carries a
      // row id, so handleRoomEvent() dedupes and whichever transport wins is
      // irrelevant — that's what makes the fallback safe.
      this._seenEventIds = new Set();
      this._eventPoll = null;
      this._eventPollMs = 0;
      this.channelHealthy = false;
    }

    getServerUrl() {
      if (window.ARENAX_CONFIG && window.ARENAX_CONFIG.getServerUrl) {
        return window.ARENAX_CONFIG.getServerUrl();
      }
      return '';
    }

    // Initialize Supabase client and decode the ArenaX JWT.
    async connect(token) {
      if (this.connected && this.supabase) return;

      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        this.userId = payload.id || null;
        this.username = payload.username || payload.name || 'Player';
      } catch (e) {
        console.warn('[Realtime] Could not decode token');
        this.userId = null;
        this.username = 'Player';
      }

      if (!window.ARENAX_CONFIG || !window.ARENAX_CONFIG.getSupabaseClient) {
        throw new Error('ARENAX_CONFIG.getSupabaseClient not found');
      }

      this.supabase = await window.ARENAX_CONFIG.getSupabaseClient();
      this.connected = true;
      this.emitLocal('connected', { userId: this.userId, username: this.username });
    }

    disconnect() {
      this.unsubscribeChannel();
      this.connected = false;
      this.currentRoom = null;
      this.supabase = null;
      this.emitLocal('disconnected', { reason: 'manual' });
    }

    isConnected() {
      return this.connected && !!this.supabase;
    }

    getUser() {
      return { userId: this.userId, username: this.username };
    }

    getTurnTimeout() {
      if (window.ARENAX_CONFIG && window.ARENAX_CONFIG.TURN_TIMEOUTS && this.currentRoom?.gameKey) {
        return window.ARENAX_CONFIG.TURN_TIMEOUTS[this.currentRoom.gameKey] || 30;
      }
      return 30;
    }

    // ==================== CHANNEL / ROOM ====================

    joinGame(roomCode, gameKey, roomId) {
      // ChatBox overload: joinGame(gameId) — single arg, lightweight chat join
      if (arguments.length === 1 && typeof roomCode === 'string' && !gameKey) {
        this.joinChat(roomCode);
        return true;
      }

      this.currentRoom = { roomCode, gameKey, roomId: roomId || null };

      if (!this.supabase) {
        console.error('[Realtime] Supabase client not initialized. Call connect() first.');
        return false;
      }

      this.unsubscribeChannel();
      this._seenEventIds.clear();
      this.channelHealthy = false;

      const channelName = `room:${roomCode}`;
      const channel = this.supabase.channel(channelName, {
        config: {
          broadcast: { self: true }
        }
      });

      // Broadcasts are used for physics games and soft peer events.
      channel.on('broadcast', { event: 'game:action' }, ({ payload }) => {
        if (payload && payload.by === this.userId) return;
        this.emitLocal('game:action', payload);
      });

      channel.on('broadcast', { event: 'game:sync' }, ({ payload }) => {
        if (payload && payload.by === this.userId) return;
        this.emitLocal('game:sync', payload);
      });

      channel.on('broadcast', { event: 'game:peer_joined' }, ({ payload }) => {
        if (payload && payload.userId === this.userId) return;
        this.emitLocal('game:peer_joined', payload);
      });

      channel.on('broadcast', { event: 'game:peer_ready' }, ({ payload }) => {
        if (payload && payload.userId === this.userId) return;
        this.emitLocal('game:peer_ready', payload);
      });

      channel.on('broadcast', { event: 'game:peer_left' }, ({ payload }) => {
        if (payload && payload.userId === this.userId) return;
        this.emitLocal('game:peer_left', payload);
      });

      // Presence: detect opponent connection/disconnection.
      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const others = Object.values(state).flat().filter(p => p.userId !== this.userId);
        if (others.length === 0) {
          this.emitLocal('game:peer_disconnected', { graceSeconds: 30 });
        } else {
          this.emitLocal('game:peer_reconnected', {});
        }
      });

      // Authoritative events come from the room_events table via Realtime.
      if (roomId) {
        channel.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
          (change) => this.handleRoomEvent(change.new)
        );
      }

      this.channel = channel;
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this._myPresence = {
            userId: this.userId,
            username: this.username,
            onlineAt: Date.now()
          };
          try {
            await channel.track(this._myPresence);
          } catch (e) {
            // Presence tracking is optional.
          }

          // Let the other player know we are here.
          channel.send({
            type: 'broadcast',
            event: 'game:peer_joined',
            payload: { userId: this.userId, username: this.username }
          });

          this.emitLocal('game:joined', {
            roomCode,
            gameKey,
            role: this.currentRoom.role || null,
            userId: this.userId,
            username: this.username
          });

          // Realtime is up: keep a slow reconcile poll anyway, because a
          // channel can silently stop delivering while still reporting
          // 'joined' (background tab throttling, network blips, proxies).
          this.channelHealthy = true;
          this._startEventFallback(4000);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Realtime is unavailable. This used to be fatal-but-silent: the
          // match still STARTED (online-mode.js polls /rooms/sync for the
          // start event) yet no action ever arrived afterwards, so play froze
          // right after the first move with nothing shown to the user.
          // Promote REST to the primary transport instead of dying quietly.
          this.channelHealthy = false;
          console.warn('[Realtime] channel ' + status + ' — falling back to REST event polling.');
          this.emitLocal('connect_error', { error: `Channel ${status}`, degraded: true });
          this._startEventFallback(1000);
        }
      });

      return true;
    }

    // ---- REST fallback / reconcile poll for authoritative room_events ----
    // Safe to run alongside Realtime: handleRoomEvent() dedupes by row id.
    _startEventFallback(intervalMs) {
      if (this._eventPoll && this._eventPollMs === intervalMs) return;
      this._stopEventFallback();
      this._eventPollMs = intervalMs;
      this._eventPoll = setInterval(() => this._pollRoomEvents(), intervalMs);
      this._pollRoomEvents();
    }

    _stopEventFallback() {
      if (this._eventPoll) {
        clearInterval(this._eventPoll);
        this._eventPoll = null;
        this._eventPollMs = 0;
      }
    }

    async _pollRoomEvents() {
      const code = this.currentRoom?.roomCode;
      if (!code) return;
      try {
        const data = await this.apiGet(`/rooms/sync?code=${encodeURIComponent(code)}`);
        if (!data || !data.success || !Array.isArray(data.events)) return;
        // Ordered oldest-first by the endpoint; dedupe drops anything already
        // delivered by Realtime.
        for (const evt of data.events) this.handleRoomEvent(evt);
      } catch (e) {
        /* transient: next tick retries */
      }
    }

    unsubscribeChannel() {
      if (this.channel) {
        try {
          this.channel.unsubscribe();
        } catch (e) { /* ignore */ }
        this.channel = null;
      }
    }

    // Turn authoritative room_events rows into the same events the old
    // Socket.IO server emitted.
    handleRoomEvent(row) {
      if (!row || !row.payload) return;

      // Idempotency gate. The same row can arrive twice — once over Realtime
      // and once over the REST reconcile poll — and replaying an 'action'
      // would corrupt turn state. First delivery wins; later ones are dropped.
      if (row.id) {
        if (this._seenEventIds.has(row.id)) return;
        this._seenEventIds.add(row.id);
      }

      switch (row.type) {
        case 'start': {
          this.emitLocal('game:start', {
            roomCode: this.currentRoom?.roomCode,
            gameKey: this.currentRoom?.gameKey,
            ...row.payload
          });
          break;
        }
        case 'action': {
          const timeoutSeconds = row.payload.timeoutSeconds || this.getTurnTimeout();
          const deadline = Date.now() + timeoutSeconds * 1000;

          // Don't echo our own actions back as opponent actions.
          if (row.user_id === this.userId) {
            this.emitLocal('game:action_ack', { nextTurn: row.payload.nextTurn, deadline, timeoutSeconds });
            return;
          }
          this.emitLocal('game:action', {
            action: row.payload.action,
            by: row.user_id,
            nextTurn: row.payload.nextTurn,
            deadline,
            timeoutSeconds
          });
          // Notify UI that the active turn changed so the timer resets.
          this.emitLocal('game:turn', { turn: row.payload.nextTurn, deadline, timeoutSeconds });
          break;
        }
        case 'end': {
          this.emitLocal('game:end', {
            roomCode: this.currentRoom?.roomCode,
            ...row.payload
          });
          break;
        }
        case 'forfeit': {
          this.emitLocal('game:peer_left', { forfeit: true, winnerId: row.payload.winnerId });
          this.emitLocal('game:end', {
            result: 'forfeit',
            winnerId: row.payload.winnerId,
            roomCode: this.currentRoom?.roomCode
          });
          break;
        }
        case 'leave': {
          this.emitLocal('game:peer_left', { forfeit: false });
          break;
        }
        case 'sync': {
          this.emitLocal('game:sync', row.payload);
          break;
        }
        case 'rematch': {
          this.emitLocal('game:rematch_offer', {
            roomCode: this.currentRoom?.roomCode,
            newRoomCode: row.payload?.newRoomCode,
            gameKey: row.payload?.gameKey,
            wager: row.payload?.wager
          });
          break;
        }
        default:
          break;
      }
    }

    // ==================== GAME METHODS (REST-backed) ====================

    async apiPost(endpoint, body) {
      const user = JSON.parse(localStorage.getItem('arenax_user') || 'null');
      const token = user?.token || localStorage.getItem('arenax_token');
      const response = await fetch(`${API_BASE()}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(body)
      });
      return response.json().catch(() => ({}));
    }

    async apiGet(endpoint) {
      const user = JSON.parse(localStorage.getItem('arenax_user') || 'null');
      const token = user?.token || localStorage.getItem('arenax_token');
      const response = await fetch(`${API_BASE()}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      return response.json().catch(() => ({}));
    }

    async sendReady(roomCode) {
      const code = roomCode || this.currentRoom?.roomCode;
      if (!code) return false;
      const data = await this.apiPost('/rooms/ready', { roomCode: code });
      if (!data.success) {
        this.emitLocal('game:error', { message: data.error || 'Ready failed' });
        return false;
      }
      if (data.started) {
        this.emitLocal('game:start', {
          roomCode: code,
          gameKey: this.currentRoom?.gameKey,
          ...data
        });
      }
      return true;
    }

    async sendAction(action, roomCode) {
      const code = roomCode || this.currentRoom?.roomCode;
      if (!code) return false;
      const data = await this.apiPost('/rooms/action', {
        roomCode: code,
        action,
        timestamp: Date.now()
      });
      if (!data.success) {
        this.emitLocal('game:error', { message: data.error || 'Action failed' });
        return false;
      }
      this.emitLocal('game:action_ack', { nextTurn: data.nextTurn });
      return true;
    }

    // Physics-only direct broadcast (used by Glow Hockey / Carrom fast updates).
    broadcastAction(action) {
      if (!this.channel) return false;
      this.channel.send({
        type: 'broadcast',
        event: 'game:action',
        payload: { action, by: this.userId, timestamp: Date.now() }
      });
      return true;
    }

    sendSync(state, roomCode) {
      const code = roomCode || this.currentRoom?.roomCode;
      if (!this.channel) return false;
      this.channel.send({
        type: 'broadcast',
        event: 'game:sync',
        payload: { state, by: this.userId, roomCode: code, timestamp: Date.now() }
      });
      return true;
    }

    async requestSync(roomCode) {
      const code = roomCode || this.currentRoom?.roomCode;
      if (!code) return false;
      const data = await this.apiGet(`/rooms/sync?code=${encodeURIComponent(code)}`);
      if (!data.success) return false;

      const timeoutSeconds = this.getTurnTimeout();

      // Reconstruct game state from stored events so subclasses can replay moves.
      const moves = [];
      let currentTurn = null;
      let deadline = null;
      (data.events || []).forEach(evt => {
        if (evt.type === 'start') {
          currentTurn = evt.payload && evt.payload.firstTurn;
          const seconds = (evt.payload && evt.payload.timeoutSeconds) || timeoutSeconds;
          deadline = Date.now() + seconds * 1000;
        } else if (evt.type === 'action' && evt.payload) {
          moves.push({
            action: evt.payload.action,
            by: evt.payload.by || evt.user_id,
            nextTurn: evt.payload.nextTurn
          });
          currentTurn = evt.payload.nextTurn;
          const seconds = evt.payload.timeoutSeconds || timeoutSeconds;
          deadline = Date.now() + seconds * 1000;
        } else if (evt.type === 'end') {
          deadline = null;
        }
      });

      this.emitLocal('game:sync', {
        roomCode: code,
        gameKey: this.currentRoom?.gameKey,
        players: data.players || data.room?.players,
        state: { moves, currentTurn, deadline },
        events: data.events || []
      });
      return true;
    }

    async sendGameEnd(result, winnerId, finalState, roomCode) {
      const code = roomCode || this.currentRoom?.roomCode;
      if (!code) return false;
      const data = await this.apiPost('/rooms/end', {
        roomCode: code,
        result,
        winnerId,
        finalState
      });
      if (!data.success) {
        this.emitLocal('game:error', { message: data.error || 'End match failed' });
        return false;
      }
      return true;
    }

    async leaveGame(roomCode) {
      const code = roomCode || this.currentRoom?.roomCode;
      this.unsubscribeChannel();
      this.currentRoom = null;
      if (!code) return false;
      const data = await this.apiPost('/rooms/leave', { roomCode: code });
      return data.success;
    }

    async requestRematch(roomCode) {
      const code = roomCode || this.currentRoom?.roomCode;
      if (!code) return false;
      const data = await this.apiPost('/rooms/rematch', { roomCode: code });
      if (!data.success) {
        this.emitLocal('game:error', { message: data.error || 'Rematch failed' });
        return false;
      }
      this.emitLocal('game:rematch_created', {
        oldRoomCode: code,
        newRoomCode: data.roomCode,
        role: data.role || 'host',
        room: data.room
      });
      return data;
    }

    // ==================== EVENT BUS ====================

    on(event, handler) {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event).push(handler);
      return () => this.off(event, handler);
    }

    off(event, handler) {
      const handlers = this.handlers.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx > -1) handlers.splice(idx, 1);
      }
    }

    emitLocal(event, data) {
      const handlers = this.handlers.get(event) || [];
      handlers.forEach(h => {
        try { h(data); } catch (e) { console.error('[Realtime] Handler error:', e); }
      });
    }

    // ========== Social / Friend Methods ==========

    // Send a chat message in a game room / lobby
    sendMessage(gameId, message) {
      if (!this.channel) return;
      this.channel.send({
        type: 'broadcast',
        event: 'chat_message',
        payload: { gameId, userId: this.userId, username: this.username, message, createdAt: new Date().toISOString() }
      });
      this.emitLocal('chat_message', { gameId, userId: this.userId, username: this.username, message, createdAt: new Date().toISOString() });
    }

    // Notify a friend that they received a friend request
    notifyFriendRequest(friendId, username) {
      if (!this.channel) return;
      this.channel.send({
        type: 'broadcast',
        event: 'friend_request',
        payload: { fromUserId: this.userId, fromUsername: username || this.username, toUserId: friendId }
      });
    }

    // Notify a friend that their request was accepted
    notifyFriendAccepted(friendId) {
      if (!this.channel) return;
      this.channel.send({
        type: 'broadcast',
        event: 'friend_accepted',
        payload: { fromUserId: this.userId, fromUsername: this.username, toUserId: friendId }
      });
    }

    // Notify recipient of a token transfer
    notifyTransfer(toUserId, amount, note) {
      if (!this.channel) return;
      this.channel.send({
        type: 'broadcast',
        event: 'transfer_received',
        payload: { fromUserId: this.userId, fromUsername: this.username, toUserId, amount, note }
      });
    }

    // Send a game invite to a friend
    sendGameInvite(friendId, roomCode, gameKey) {
      if (!this.channel) return;
      this.channel.send({
        type: 'broadcast',
        event: 'game_invite',
        payload: { fromUserId: this.userId, fromUsername: this.username, toUserId: friendId, roomCode, gameKey }
      });
    }

    // Join a chat channel for a game (lightweight — no game state)
    joinChat(gameId) {
      this.emitLocal('chat_joined', { gameId });
    }

    // Leave a chat channel
    leaveChat(gameId) {
      this.emitLocal('chat_left', { gameId });
    }

    // Named subscriptions (same signatures as the old SocketClient)
    onGameJoined(handler) { return this.on('game:joined', handler); }
    onGameStart(handler) { return this.on('game:start', handler); }
    onGameAction(handler) { return this.on('game:action', handler); }
    onGameTurn(handler) { return this.on('game:turn', handler); }
    onGameEnd(handler) { return this.on('game:end', handler); }
    onRematchCreated(handler) { return this.on('game:rematch_created', handler); }
    onRematchOffer(handler) { return this.on('game:rematch_offer', handler); }
    onPeerJoined(handler) { return this.on('game:peer_joined', handler); }
    onPeerReady(handler) { return this.on('game:peer_ready', handler); }
    onPeerLeft(handler) { return this.on('game:peer_left', handler); }
    onGameSync(handler) { return this.on('game:sync', handler); }
    onActionAck(handler) { return this.on('game:action_ack', handler); }
    onPeerDisconnected(handler) { return this.on('game:peer_disconnected', handler); }
    onPeerReconnected(handler) { return this.on('game:peer_reconnected', handler); }
    onGameError(handler) { return this.on('game:error', handler); }
    onTurnTimeout(handler) { return this.on('game:turn_timeout', handler); }
    onConnected(handler) { return this.on('connected', handler); }
    onDisconnected(handler) { return this.on('disconnected', handler); }
    onConnectError(handler) { return this.on('connect_error', handler); }
  }

  window.socketClient = new SocketClient();
})();
