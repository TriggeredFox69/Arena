/* ==========================================================================
   ARENAX FRONTEND - REALTIME CLIENT
   Netlify Functions do not support persistent WebSocket connections, so this
   client currently runs a local event bus. For live chat/rooms/friends, wire
   Supabase Realtime here using the public anon key.
   ========================================================================== */

class SocketClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.listeners = new Map();
  }

  connect(token) {
    if (this.connected) {
      console.warn('[Realtime] Already connected');
      return;
    }

    // Socket.IO is disabled on Netlify because serverless functions cannot hold
    // persistent connections. The app still works; real-time chat/rooms are local.
    // TODO: connect to Supabase Realtime channels here if you enable live features.
    console.log('[Realtime] Local event bus ready (Supabase Realtime not configured)');
    this.connected = true;
    this.emit('connected');
  }

  disconnect() {
    this.connected = false;
    this.emit('disconnected');
  }

  sendMessage(gameId, message, emojiReaction = null) {
    if (!this.connected) {
      console.error('[Realtime] Not connected');
      return;
    }
    this.emit('chat_message', { gameId, message, emojiReaction });
  }

  joinGame(gameId) {
    if (!this.connected) return;
    console.log('[Realtime] Joined game room:', gameId);
  }

  leaveGame(gameId) {
    if (!this.connected) return;
    console.log('[Realtime] Left game room:', gameId);
  }

  notifyFriendRequest(friendId, friendUsername) {
    if (!this.connected) return;
    this.emit('friend_request', { friendId, friendUsername });
  }

  notifyFriendAccepted(friendId) {
    if (!this.connected) return;
    this.emit('friend_accepted', { friendId });
  }

  sendGameInvite(friendId, roomCode, gameKey) {
    if (!this.connected) return;
    this.emit('game_invite', { friendId, roomCode, gameKey });
  }

  notifyTransfer(toUserId, amount, message) {
    if (!this.connected) return;
    this.emit('transfer_received', { toUserId, amount, message });
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) callbacks.splice(index, 1);
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`[Realtime] Event handler error for ${event}:`, err);
      }
    });
  }
}

const socketClient = new SocketClient();

// Auto-connect on page visibility change
// Socket.IO removed for Netlify deployment. Replace with Supabase Realtime later.
