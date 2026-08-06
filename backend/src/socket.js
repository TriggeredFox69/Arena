/* ==========================================================================
   ARENAX BACKEND - WEBSOCKET SERVER (Socket.IO)
   Real-time events: chat, friends, marketplace, notifications, ludo 1v1
   ========================================================================== */

const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

let io;

// Ludo 1v1 room registry: code -> [{ socketId, userId, username }]
const ludoRooms = new Map();

// Initialize Socket.IO
function initSocket(server) {
  io = require('socket.io')(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication failed: No token provided'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      socket.userId = decoded.id;
      socket.username = decoded.username;
      next();
    } catch (err) {
      next(new Error('Authentication failed: Invalid token'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    console.log(`[WebSocket] User connected: ${socket.username} (ID: ${socket.userId})`);

    // Join personal room for notifications
    socket.join(`user:${socket.userId}`);

    // Broadcast online status to friends
    broadcastToFriends(socket.userId, 'user_online', {
      userId: socket.userId,
      username: socket.username
    });

    // Chat message
    socket.on('send_message', async (data) => {
      try {
        const { gameId, message, emojiReaction } = data;

        // Save to database
        const stmt = db.prepare(`
          INSERT INTO chat_messages (game_id, user_id, message, emoji_reaction)
          VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(gameId, socket.userId, message, emojiReaction || null);

        const chatMessage = {
          id: result.lastInsertRowid,
          gameId,
          userId: socket.userId,
          username: socket.username,
          message,
          emojiReaction,
          createdAt: new Date().toISOString()
        };

        // Broadcast to game room
        io.to(`game:${gameId}`).emit('chat_message', chatMessage);
      } catch (err) {
        console.error('[WebSocket] send_message error:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Join game room
    socket.on('join_game', (data) => {
      const { gameId } = data;
      socket.join(`game:${gameId}`);
      console.log(`[WebSocket] ${socket.username} joined game:${gameId}`);
    });

    // Leave game room
    socket.on('leave_game', (data) => {
      const { gameId } = data;
      socket.leave(`game:${gameId}`);
      console.log(`[WebSocket] ${socket.username} left game:${gameId}`);
    });

    // Friend request sent (notify the recipient)
    socket.on('friend_request_sent', (data) => {
      const { friendId, friendUsername } = data;
      io.to(`user:${friendId}`).emit('friend_request', {
        fromUserId: socket.userId,
        fromUsername: socket.username
      });
    });

    // Friend request accepted (notify the sender)
    socket.on('friend_accepted', (data) => {
      const { friendId } = data;
      io.to(`user:${friendId}`).emit('friend_request_accepted', {
        userId: socket.userId,
        username: socket.username
      });
    });

    // Game invite
    socket.on('send_game_invite', (data) => {
      const { friendId, roomCode, gameKey } = data;
      io.to(`user:${friendId}`).emit('game_invite', {
        fromUserId: socket.userId,
        fromUsername: socket.username,
        roomCode,
        gameKey
      });
    });

    // Token transfer notification
    socket.on('token_transfer_sent', (data) => {
      const { toUserId, amount, message } = data;
      io.to(`user:${toUserId}`).emit('transfer_received', {
        fromUserId: socket.userId,
        fromUsername: socket.username,
        amount,
        message
      });
    });

    /* ---------------- Ludo 1v1 relay ----------------
       Rooms of exactly 2. Host = first to join, guest = second.
       Server rolls dice for fairness and relays all actions. */
    socket.on('ludo:join', (data) => {
      try {
        const code = String(data.code || '').toUpperCase().slice(0, 8);
        if (!code) return socket.emit('ludo:error', { message: 'Invalid room code.' });

        const room = ludoRooms.get(code) || [];
        // Reconnecting same user?
        const existing = room.find(p => p.userId === socket.userId);
        if (existing) {
          existing.socketId = socket.id;
          socket.join(`ludo:${code}`);
          socket.emit('ludo:joined', { code, role: room.indexOf(existing) === 0 ? 'host' : 'guest' });
          return;
        }
        if (room.length >= 2) return socket.emit('ludo:error', { message: 'Room is full.' });

        room.push({ socketId: socket.id, userId: socket.userId, username: socket.username });
        ludoRooms.set(code, room);
        socket.join(`ludo:${code}`);
        const role = room.length === 1 ? 'host' : 'guest';
        socket.emit('ludo:joined', { code, role });

        if (room.length === 2) {
          // Tell the host their opponent arrived
          const guest = room[1];
          io.to(room[0].socketId).emit('ludo:peer_joined', { username: guest.username });
        }
        console.log(`[Ludo] ${socket.username} joined room ${code} as ${role}`);
      } catch (err) {
        console.error('[Ludo] join error:', err);
        socket.emit('ludo:error', { message: 'Failed to join room.' });
      }
    });

    socket.on('ludo:roll_request', (data) => {
      const code = String(data.code || '').toUpperCase();
      const room = ludoRooms.get(code);
      if (!room || room.length < 2) return;
      const value = 1 + Math.floor(Math.random() * 6);
      io.to(`ludo:${code}`).emit('ludo:roll', { value, by: socket.userId });
    });

    socket.on('ludo:action', (data) => {
      const code = String(data.code || '').toUpperCase();
      // Relay to everyone else in the room (moves, start, left)
      socket.to(`ludo:${code}`).emit('ludo:action', data.action);
    });

    function leaveLudoRooms() {
      for (const [code, room] of ludoRooms.entries()) {
        const idx = room.findIndex(p => p.socketId === socket.id);
        if (idx !== -1) {
          room.splice(idx, 1);
          if (room.length === 0) ludoRooms.delete(code);
          else {
            ludoRooms.set(code, room);
            io.to(`ludo:${code}`).emit('ludo:peer_left', {});
          }
        }
      }
    }

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`[WebSocket] User disconnected: ${socket.username}`);
      leaveLudoRooms();
      broadcastToFriends(socket.userId, 'user_offline', {
        userId: socket.userId,
        username: socket.username
      });
    });
  });

  return io;
}

// Broadcast event to all friends of a user
function broadcastToFriends(userId, event, data) {
  try {
    const friends = db.prepare(`
      SELECT friend_id FROM friends
      WHERE user_id = ? AND status = 'accepted'
    `).all(userId);

    friends.forEach(friend => {
      io.to(`user:${friend.friend_id}`).emit(event, data);
    });
  } catch (err) {
    console.error('[WebSocket] broadcastToFriends error:', err);
  }
}

// Emit order filled notification
function notifyOrderFilled(userId, orderData) {
  if (io) {
    io.to(`user:${userId}`).emit('order_filled', orderData);
  }
}

module.exports = { initSocket, notifyOrderFilled };
