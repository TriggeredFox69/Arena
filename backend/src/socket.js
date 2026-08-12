/* ==========================================================================
   ARENAX BACKEND - WEBSOCKET SERVER (Socket.IO)
   Real-time events: chat, friends, marketplace, notifications, online PvP
   Data layer: Supabase (service role) — shared with the REST API.
   ========================================================================== */

const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('./config/supabase');

let io;

// Generic game room registry: roomCode -> { gameKey, roomId, players: [], state, wager, matchId, currentTurn, turnDeadline }
const gameRooms = new Map();

// Legacy Ludo rooms (kept for backwards compatibility)
const ludoRooms = new Map();

// Turn timeout in seconds per game
const TURN_TIMEOUTS = {
  chess: 30,
  checkers: 20,
  ludo: 30,
  '8ball-pool': 45,
  pool: 45,
  carrom: 30,
  glowhockey: 0 // real-time, no turn timeout
};

// Real-time games: no turn validation, actions are just relayed
const REALTIME_GAMES = new Set(['glowhockey']);

// Action types that never consume the turn (part of the current player's turn)
const NON_TURN_ACTIONS = new Set(['striker_place', 'ball_in_hand', 'mallet_move', 'sync', 'paddle', 'puck', 'goal', 'roll']);

// Grace period (ms) before a disconnected player forfeits the match
const DISCONNECT_GRACE_MS = 30000;

const GAME_TITLES = {
  carrom: 'Carrom Clash', ludo: 'Ludo Duel', chess: 'Chess Royale',
  checkers: 'Checkers Pro', pool: 'Pool 8-Ball', '8ball-pool': 'Pool 8-Ball',
  glowhockey: 'Glow Hockey'
};

// Initialize Socket.IO
function initSocket(server) {
  io = require('socket.io')(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Authentication middleware.
  // JWT payload carries only { id } (see utils/jwt.js), so the username is
  // looked up from Supabase — this also rejects tokens for deleted users.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication failed: No token provided'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
      if (!decoded || !decoded.id) {
        return next(new Error('Authentication failed: Invalid token'));
      }

      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('id, username')
        .eq('id', decoded.id)
        .maybeSingle();

      if (error || !user) {
        return next(new Error('Authentication failed: User not found'));
      }

      socket.userId = user.id;
      socket.username = user.username;
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

        const { data: inserted, error } = await supabaseAdmin
          .from('chat_messages')
          .insert({
            game_id: String(gameId),
            user_id: socket.userId,
            message,
            emoji_reaction: emojiReaction || null
          })
          .select('id')
          .single();

        if (error) throw error;

        const chatMessage = {
          id: inserted.id,
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

    /* ---------------- Generic Game PvP Handlers ---------------- */
    // Join or create a game room
    socket.on('game:join', async (data) => {
      try {
        const roomCode = String(data.roomCode || '').toUpperCase().slice(0, 8);
        const gameKey = String(data.gameKey || '').toLowerCase();

        if (!roomCode) return socket.emit('game:error', { message: 'Invalid room code.' });
        if (!gameKey) return socket.emit('game:error', { message: 'Game key required.' });

        // Check if room exists in DB
        const { data: dbRoom, error: roomErr } = await supabaseAdmin
          .from('game_rooms')
          .select('*')
          .eq('room_code', roomCode)
          .maybeSingle();

        if (roomErr) throw roomErr;
        if (!dbRoom) return socket.emit('game:error', { message: 'Room not found.' });
        if (dbRoom.status !== 'waiting' && dbRoom.status !== 'in_progress') {
          return socket.emit('game:error', { message: 'Room is not available.' });
        }

        // Get or create in-memory room
        let room = gameRooms.get(roomCode);
        if (!room) {
          room = {
            gameKey,
            roomId: dbRoom.id,
            players: [],
            state: null,
            wager: dbRoom.wager,
            matchId: dbRoom.match_id,
            currentTurn: null,
            turnDeadline: null,
            createdAt: Date.now()
          };
          gameRooms.set(roomCode, room);
        }

        // Check for reconnection
        const existing = room.players.find(p => p.userId === socket.userId);
        if (existing) {
          existing.socketId = socket.id;
          socket.join(`game:${roomCode}`);

          // Clear disconnect grace timer if one was running
          if (existing.disconnectTimer) {
            clearTimeout(existing.disconnectTimer);
            existing.disconnectTimer = null;
          }
          const wasDisconnected = !!existing.disconnected;
          existing.disconnected = false;

          // Notify opponent that this player is back
          const peer = room.players.find(p => p.userId !== socket.userId);
          if (peer && wasDisconnected) {
            io.to(peer.socketId).emit('game:peer_reconnected', { username: socket.username });
          }

          // Send current state if game in progress
          if (room.state) {
            socket.emit('game:joined', {
              roomCode,
              role: room.players.indexOf(existing) === 0 ? 'host' : 'guest',
              opponent: peer?.username,
              opponentDisconnected: peer ? !!peer.disconnected : false,
              wager: room.wager,
              matchId: room.matchId,
              state: room.state,
              currentTurn: room.currentTurn,
              turnDeadline: room.turnDeadline || null,
              yourTurn: room.currentTurn === socket.userId,
              reconnected: true
            });
          } else {
            socket.emit('game:joined', {
              roomCode,
              role: room.players.indexOf(existing) === 0 ? 'host' : 'guest',
              opponent: peer?.username,
              wager: room.wager,
              matchId: room.matchId,
              reconnected: true
            });
          }
          return;
        }

        // Room full?
        if (room.players.length >= 2) {
          return socket.emit('game:error', { message: 'Room is full.' });
        }

        // Add player
        room.players.push({
          socketId: socket.id,
          userId: socket.userId,
          username: socket.username,
          ready: false,
          joinedAt: Date.now()
        });

        socket.join(`game:${roomCode}`);
        const role = room.players.length === 1 ? 'host' : 'guest';

        // Get opponent info if exists
        const opponent = room.players.find(p => p.userId !== socket.userId);

        socket.emit('game:joined', {
          roomCode,
          role,
          opponent: opponent?.username,
          wager: room.wager,
          matchId: room.matchId
        });

        // Notify host that guest joined
        if (role === 'guest' && room.players[0]) {
          io.to(room.players[0].socketId).emit('game:peer_joined', {
            username: socket.username,
            userId: socket.userId
          });
        }

        console.log(`[Game] ${socket.username} joined ${gameKey} room ${roomCode} as ${role}`);
      } catch (err) {
        console.error('[Game] join error:', err);
        socket.emit('game:error', { message: 'Failed to join room.' });
      }
    });

    // Player ready to start
    socket.on('game:ready', async (data) => {
      try {
        const roomCode = String(data.roomCode || '').toUpperCase();
        const room = gameRooms.get(roomCode);

        if (!room) return socket.emit('game:error', { message: 'Room not found.' });

        const player = room.players.find(p => p.userId === socket.userId);
        if (!player) return socket.emit('game:error', { message: 'You are not in this room.' });

        player.ready = true;

        // Notify other player
        const opponent = room.players.find(p => p.userId !== socket.userId);
        if (opponent) {
          io.to(opponent.socketId).emit('game:peer_ready', { username: socket.username });
        }

        // Both ready? Start game
        if (room.players.length === 2 && room.players.every(p => p.ready)) {
          await startGame(roomCode, room);
        }
      } catch (err) {
        console.error('[Game] ready error:', err);
        socket.emit('game:error', { message: 'Failed to mark ready.' });
      }
    });

    // Game action (move, shoot, etc.)
    socket.on('game:action', (data) => {
      try {
        const roomCode = String(data.roomCode || '').toUpperCase();
        const room = gameRooms.get(roomCode);

        if (!room) return socket.emit('game:error', { message: 'Room not found.' });
        if (room.players.length < 2) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return socket.emit('game:error', { message: 'You are not in this room.' });

        const action = data.action || {};
        const realtime = REALTIME_GAMES.has(room.gameKey);

        // Turn-based games validate whose turn it is; real-time games relay freely
        if (!realtime && room.currentTurn !== socket.userId) {
          return socket.emit('game:error', { message: 'Not your turn.' });
        }

        // Ludo dice are rolled server-side so neither client can rig the outcome.
        // The client sends { type: 'roll' } and the server attaches the value
        // before it is logged and relayed.
        if (room.gameKey === 'ludo' && action.type === 'roll') {
          action.value = 1 + Math.floor(Math.random() * 6);
        }

        // Decide whether this action passes the turn to the opponent.
        // - turn_end: explicit pass from the active player (pool/carrom post-shot resolution)
        // - NON_TURN_ACTIONS: intra-turn actions (ball in hand, striker placement, real-time frames)
        // - action.keepTurn: sender keeps the turn (checkers multi-jump, pool continuation)
        const opponent = room.players.find(p => p.userId !== socket.userId);
        let passTurn = false;
        if (!realtime && opponent) {
          if (action.type === 'turn_end') {
            passTurn = !action.keepTurn;
          } else {
            passTurn = !NON_TURN_ACTIONS.has(action.type) && !action.keepTurn;
          }
        }

        if (passTurn) {
          room.currentTurn = opponent.userId;
          setTurnTimeout(roomCode, room);
        }

        // Keep the server's canonical state up to date for reconnection recovery
        applyActionToState(room, action, socket.userId);

        // Relay action to opponent (with authoritative nextTurn so clients stay in sync)
        if (opponent) {
          io.to(opponent.socketId).emit('game:action', {
            action,
            by: socket.userId,
            timestamp: data.timestamp,
            nextTurn: room.currentTurn
          });
        }

        // Echo nextTurn back to the sender so their UI stays authoritative.
        // The (possibly server-augmented, e.g. ludo dice) action rides along.
        if (!realtime) {
          socket.emit('game:action_ack', { nextTurn: room.currentTurn, action });
        }
      } catch (err) {
        console.error('[Game] action error:', err);
        socket.emit('game:error', { message: 'Failed to send action.' });
      }
    });

    // Full state sync request (reconnection / recovery)
    socket.on('game:sync_request', (data) => {
      try {
        const roomCode = String(data.roomCode || '').toUpperCase();
        const room = gameRooms.get(roomCode);

        if (!room) return socket.emit('game:error', { message: 'Room not found.' });

        const player = room.players.find(p => p.userId === socket.userId);
        if (!player) return socket.emit('game:error', { message: 'You are not in this room.' });

        const opponent = room.players.find(p => p.userId !== socket.userId);

        socket.emit('game:sync', {
          state: room.state,
          currentTurn: room.currentTurn,
          turnDeadline: room.turnDeadline || null,
          yourTurn: room.currentTurn === socket.userId,
          players: room.players.map(p => ({
            userId: p.userId,
            username: p.username,
            disconnected: !!p.disconnected
          })),
          opponentDisconnected: opponent ? !!opponent.disconnected : false
        });
      } catch (err) {
        console.error('[Game] sync_request error:', err);
      }
    });

    // Sync state (for physics games)
    socket.on('game:sync', (data) => {
      try {
        const roomCode = String(data.roomCode || '').toUpperCase();
        const room = gameRooms.get(roomCode);

        if (!room) return;

        room.state = data.state;

        // Broadcast to all players
        io.to(`game:${roomCode}`).emit('game:sync', {
          state: data.state,
          timestamp: data.timestamp
        });
      } catch (err) {
        console.error('[Game] sync error:', err);
      }
    });

    // Game end (result submission)
    socket.on('game:end', async (data) => {
      try {
        const roomCode = String(data.roomCode || '').toUpperCase();
        const room = gameRooms.get(roomCode);

        if (!room) return socket.emit('game:error', { message: 'Room not found.' });

        const { winnerId, result, finalState } = data;

        // Clear turn timeout
        clearTurnTimeout(roomCode);

        // Update room state
        room.state = finalState;

        // Broadcast end to all players
        io.to(`game:${roomCode}`).emit('game:end', {
          winnerId,
          result,
          finalState
        });

        // Settle match if wager was placed
        if (room.matchId && room.wager > 0) {
          await settleMatch(room, winnerId, result);
        }

        // Update room status in DB (bookkeeping — never block gameplay on it)
        const { error: updErr } = await supabaseAdmin
          .from('game_rooms')
          .update({ status: 'finished' })
          .eq('room_code', roomCode);
        if (updErr) console.error('[Game] room status update failed:', updErr.message);

        // Clean up
        gameRooms.delete(roomCode);

        console.log(`[Game] Room ${roomCode} ended. Winner: ${winnerId}`);
      } catch (err) {
        console.error('[Game] end error:', err);
        socket.emit('game:error', { message: 'Failed to end game.' });
      }
    });

    // Leave game (forfeit)
    socket.on('game:leave', async (data) => {
      try {
        const roomCode = String(data.roomCode || '').toUpperCase();
        const room = gameRooms.get(roomCode);

        if (!room) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return;

        // If game in progress, this is a forfeit
        if (room.state && room.players.length === 2) {
          const opponent = room.players.find(p => p.userId !== socket.userId);
          if (opponent) {
            // Opponent wins by forfeit
            clearTurnTimeout(roomCode);

            io.to(opponent.socketId).emit('game:peer_left', { forfeit: true });
            io.to(opponent.socketId).emit('game:end', {
              winnerId: opponent.userId,
              result: 'forfeit',
              forfeit: true
            });

            // Settle match - opponent wins
            if (room.matchId && room.wager > 0) {
              await settleMatch(room, opponent.userId, 'forfeit');
            }
          }
        } else {
          // Just notify that player left
          const opponent = room.players.find(p => p.userId !== socket.userId);
          if (opponent) {
            io.to(opponent.socketId).emit('game:peer_left', { forfeit: false });
          }
        }

        // Remove from room
        room.players = room.players.filter(p => p.socketId !== socket.id);
        socket.leave(`game:${roomCode}`);

        if (room.players.length === 0) {
          clearTurnTimeout(roomCode);
          gameRooms.delete(roomCode);
        } else {
          gameRooms.set(roomCode, room);
        }

        console.log(`[Game] ${socket.username} left room ${roomCode}`);
      } catch (err) {
        console.error('[Game] leave error:', err);
      }
    });

    // Start game when both players ready
    async function startGame(roomCode, room) {
      try {
        // Wagered match: debit both players and create match rows first.
        // If anyone can't cover the wager, abort before the game starts.
        if (room.wager > 0 && !room.matchId) {
          const ok = await createMatchForRoom(roomCode, room);
          if (!ok) {
            room.players.forEach(p => { p.ready = false; });
            return;
          }
        }

        // Determine first turn (host goes first by default, or random for some games)
        const firstTurn = room.players[0].userId; // host first
        room.currentTurn = firstTurn;

        // Create initial state based on game type
        const initialState = createInitialState(room.gameKey, room.players);
        room.state = initialState;

        // Set turn timeout
        setTurnTimeout(roomCode, room);

        // Update room status (bookkeeping — a failure here must not stop the game)
        const { error: updErr } = await supabaseAdmin
          .from('game_rooms')
          .update({ status: 'in_progress', current_turn_user_id: firstTurn })
          .eq('room_code', roomCode);
        if (updErr) console.error('[Game] room status update failed:', updErr.message);

        // Notify all players
        io.to(`game:${roomCode}`).emit('game:start', {
          firstTurn,
          initialState,
          matchId: room.matchId,
          wager: room.wager,
          players: room.players.map(p => ({ userId: p.userId, username: p.username }))
        });

        console.log(`[Game] Room ${roomCode} started. First turn: ${firstTurn}`);
      } catch (err) {
        console.error('[Game] start error:', err);
      }
    }

    // Debit both players' wagers and create the match + transaction rows.
    // Returns true when the match is ready, false when the game must abort.
    async function createMatchForRoom(roomCode, room) {
      const [host, guest] = room.players;
      const wager = room.wager;
      const pot = wager * 2;
      const gameTitle = GAME_TITLES[room.gameKey] || room.gameKey;

      const { data: users, error: usersErr } = await supabaseAdmin
        .from('users')
        .select('id, username, balance, total_wagered')
        .in('id', [host.userId, guest.userId]);

      if (usersErr || !users || users.length !== 2) {
        console.error('[Game] wager lookup failed:', usersErr);
        io.to(`game:${roomCode}`).emit('game:error', { message: 'Could not verify balances. Try again.' });
        return false;
      }

      const broke = users.find(u => u.balance < wager);
      if (broke) {
        io.to(`game:${roomCode}`).emit('game:error', {
          message: `${broke.username} has insufficient balance for the ${wager} AX wager.`
        });
        return false;
      }

      // Debit both players (read-modify-write; each player settles once per match)
      for (const u of users) {
        const { error } = await supabaseAdmin
          .from('users')
          .update({
            balance: u.balance - wager,
            total_wagered: (u.total_wagered || 0) + wager
          })
          .eq('id', u.id);
        if (error) {
          console.error('[Game] wager debit failed:', error);
          io.to(`game:${roomCode}`).emit('game:error', { message: 'Wager debit failed. Try again.' });
          return false;
        }
      }

      // One match row per player, both linked to the room
      const matchRows = users.map(u => ({
        user_id: u.id,
        game_key: room.gameKey,
        mode: 'pvp',
        wager,
        pot,
        status: 'active',
        room_id: room.roomId
      }));

      const { data: matches, error: matchErr } = await supabaseAdmin
        .from('matches')
        .insert(matchRows)
        .select('id, user_id');

      if (matchErr || !matches || matches.length !== 2) {
        console.error('[Game] match creation failed:', matchErr);
        // Refund both players so nobody loses money on a failed start
        for (const u of users) {
          await supabaseAdmin
            .from('users')
            .update({ balance: u.balance, total_wagered: u.total_wagered || 0 })
            .eq('id', u.id);
        }
        io.to(`game:${roomCode}`).emit('game:error', { message: 'Could not create match. Wager refunded.' });
        return false;
      }

      room.matchId = (matches.find(m => m.user_id === host.userId) || matches[0]).id;

      // Link the primary match to the room (bookkeeping)
      const { error: linkErr } = await supabaseAdmin
        .from('game_rooms')
        .update({ match_id: room.matchId })
        .eq('id', room.roomId);
      if (linkErr) console.error('[Game] room match link failed:', linkErr.message);

      // Wager transaction records
      const { error: txErr } = await supabaseAdmin.from('transactions').insert(
        users.map(u => ({
          user_id: u.id,
          type: 'wager',
          game: gameTitle,
          description: `${gameTitle} PvP Wager`,
          wager,
          pot,
          result: 'ACTIVE'
        }))
      );
      if (txErr) console.error('[Game] wager transaction log failed:', txErr.message);

      console.log(`[Game] Match ${room.matchId} created for room ${roomCode} (${wager} AX each, pot ${pot})`);
      return true;
    }

    // Apply a relayed action to the server's canonical room state.
    // Turn-based games append to a moves log (clients replay on reconnect);
    // physics games additionally keep the latest host snapshot.
    function applyActionToState(room, action, byUserId) {
      if (!room.state || !action) return;
      const state = room.state;

      // High-frequency real-time frames: keep only the latest snapshot
      if (action.type === 'sync') {
        state.snapshot = action.state || null;
        return;
      }
      if (action.type === 'mallet_move' || action.type === 'paddle' || action.type === 'puck') {
        return; // transient, not worth logging
      }

      // Append turn-relevant actions to the moves log
      if (!Array.isArray(state.moves)) state.moves = [];
      state.moves.push({ ...action, by: byUserId });

      // Turn field for games that track color/side in state
      if (room.gameKey === 'chess' && action.type === 'move') {
        state.turn = state.turn === 'w' ? 'b' : 'w';
      } else if (room.gameKey === 'checkers' && action.type === 'move' && !action.keepTurn) {
        state.turn = state.turn === 'dark' ? 'light' : 'dark';
        state.forcedFrom = null;
      } else if (room.gameKey === 'checkers' && action.type === 'move') {
        state.forcedFrom = action.to || null;
      }
    }

    // Create initial game state
    function createInitialState(gameKey, players) {
      const host = players[0];
      const guest = players[1];

      switch (gameKey) {
        case 'chess':
          return {
            board: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // FEN
            turn: 'w',
            white: host.userId,
            black: guest.userId,
            moves: []
          };

        case 'checkers':
          return {
            board: null, // client generates initial board
            turn: 'dark', // dark (host) moves first
            darkPlayer: host.userId,
            lightPlayer: guest.userId,
            forcedFrom: null,
            moves: []
          };

        case 'ludo':
          // 1v1: host plays red, guest plays yellow (matches the client board)
          return {
            players: [
              { userId: host.userId, username: host.username, color: 'red', tokens: [-1, -1, -1, -1] },
              { userId: guest.userId, username: guest.username, color: 'yellow', tokens: [-1, -1, -1, -1] }
            ],
            diceValue: null,
            moves: [] // roll/move/turn_end log — clients replay on reconnect
          };

        case '8ball-pool':
        case 'pool':
          return {
            balls: [], // client generates rack
            turn: host.userId,
            hostBreaks: true,
            ballsAssigned: false,
            assignments: {}, // userId -> 'solids'|'stripes'
            cueBallInHand: false,
            foul: false,
            moves: [],
            snapshot: null // latest full table state from the active player
          };

        case 'carrom':
          return {
            pieces: [], // client generates setup
            turn: host.userId,
            scores: { [host.userId]: 0, [guest.userId]: 0 },
            queenCovered: false,
            moves: [],
            snapshot: null
          };

        case 'glowhockey':
          return {
            puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
            paddles: {
              [host.userId]: { x: 0.5, y: 0.9 },
              [guest.userId]: { x: 0.5, y: 0.1 }
            },
            score: { [host.userId]: 0, [guest.userId]: 0 },
            playing: true
          };

        default:
          return { turn: host.userId };
      }
    }

    // Set turn timeout
    const turnTimeouts = new Map();
    function setTurnTimeout(roomCode, room) {
      const timeout = TURN_TIMEOUTS[room.gameKey] || 30;
      if (timeout <= 0) return; // no timeout for real-time games

      clearTurnTimeout(roomCode);

      const timeoutId = setTimeout(() => {
        (async () => {
          const r = gameRooms.get(roomCode);
          if (!r) return;

          // Current player forfeits
          const loser = r.players.find(p => p.userId === r.currentTurn);
          const winner = r.players.find(p => p.userId !== r.currentTurn);

          if (loser && winner) {
            io.to(`game:${roomCode}`).emit('game:turn_timeout', {
              loserId: loser.userId,
              loserName: loser.username
            });

            io.to(`game:${roomCode}`).emit('game:end', {
              winnerId: winner.userId,
              result: 'timeout',
              forfeit: true
            });

            // Settle match
            if (r.matchId && r.wager > 0) {
              await settleMatch(r, winner.userId, 'timeout');
            }

            // Clean up
            gameRooms.delete(roomCode);
          }
        })().catch(err => console.error('[Game] turn timeout error:', err));
      }, timeout * 1000);

      turnTimeouts.set(roomCode, timeoutId);

      // Track deadline on the room so reconnecting players can resume the timer
      room.turnDeadline = Date.now() + (timeout * 1000);

      // Notify players of turn deadline
      io.to(`game:${roomCode}`).emit('game:turn', {
        turn: room.currentTurn,
        deadline: room.turnDeadline,
        timeoutSeconds: timeout
      });
    }

    function clearTurnTimeout(roomCode) {
      const timeoutId = turnTimeouts.get(roomCode);
      if (timeoutId) {
        clearTimeout(timeoutId);
        turnTimeouts.delete(roomCode);
      }
      const room = gameRooms.get(roomCode);
      if (room) room.turnDeadline = null;
    }

    // Settle match and pay out.
    // Settles BOTH match rows (one per player, linked by room_id) so neither
    // player is left with a dangling 'active' match.
    async function settleMatch(room, winnerId, result) {
      try {
        if (!room.matchId && !room.roomId) return;

        // Get all unsettled match rows for this room
        let query = supabaseAdmin.from('matches').select('*');
        if (room.roomId) query = query.eq('room_id', room.roomId);
        else query = query.eq('id', room.matchId);

        const { data: matchRows, error: matchErr } = await query;
        if (matchErr) throw matchErr;

        const active = (matchRows || []).filter(m => m.status !== 'settled');
        if (!active.length) return;

        const pot = active[0].pot;
        const wager = active[0].wager;
        const loser = room.players.find(p => p.userId !== winnerId);

        // Winner gets the pot
        const { data: winnerUser, error: winnerErr } = await supabaseAdmin
          .from('users')
          .select('id, balance, wins, total_won')
          .eq('id', winnerId)
          .maybeSingle();

        if (winnerErr) throw winnerErr;

        if (winnerUser) {
          const { error } = await supabaseAdmin
            .from('users')
            .update({
              balance: winnerUser.balance + pot,
              wins: (winnerUser.wins || 0) + 1,
              total_won: (winnerUser.total_won || 0) + pot
            })
            .eq('id', winnerId);
          if (error) console.error('[Game] winner payout failed:', error);
        }

        // Loser already paid at match start — just record the loss
        if (loser) {
          const { data: loserUser } = await supabaseAdmin
            .from('users')
            .select('id, losses')
            .eq('id', loser.userId)
            .maybeSingle();

          if (loserUser) {
            const { error } = await supabaseAdmin
              .from('users')
              .update({ losses: (loserUser.losses || 0) + 1 })
              .eq('id', loser.userId);
            if (error) console.error('[Game] loser record failed:', error);
          }
        }

        // Settle each match row with its owner's result
        for (const m of active) {
          const isWinnerRow = m.user_id === winnerId;
          const { error } = await supabaseAdmin
            .from('matches')
            .update({
              status: 'settled',
              result: isWinnerRow ? 'WIN' : 'LOSS',
              settled_at: new Date().toISOString()
            })
            .eq('id', m.id);
          if (error) console.error('[Game] match settle failed:', error);
        }

        // Transaction records
        const txRows = [{
          user_id: winnerId,
          type: 'settlement',
          game: room.gameKey,
          description: `${room.gameKey} victory`,
          wager,
          pot,
          result: 'WIN'
        }];
        if (loser) {
          txRows.push({
            user_id: loser.userId,
            type: 'settlement',
            game: room.gameKey,
            description: `${room.gameKey} defeat`,
            wager,
            pot: 0,
            result: 'LOSS'
          });
        }
        const { error: txErr } = await supabaseAdmin.from('transactions').insert(txRows);
        if (txErr) console.error('[Game] settlement transaction log failed:', txErr.message);

        console.log(`[Game] Match ${room.matchId} settled. Winner ${winnerId} gets ${pot} AX`);
      } catch (err) {
        console.error('[Game] settlement error:', err);
      }
    }

    // Clean up game rooms on disconnect.
    // Mid-game disconnects get a grace period to reconnect before forfeiting;
    // voluntary leaves (game:leave) forfeit immediately.
    function leaveGameRooms() {
      for (const [roomCode, room] of gameRooms.entries()) {
        const idx = room.players.findIndex(p => p.socketId === socket.id);
        if (idx === -1) continue;

        const player = room.players[idx];
        const opponent = room.players.find(p => p.userId !== player.userId);
        const gameInProgress = room.state !== null && room.players.length === 2;

        if (!gameInProgress) {
          // Game not started (or player alone): remove immediately
          room.players.splice(idx, 1);

          if (opponent) {
            io.to(opponent.socketId).emit('game:peer_left', { forfeit: false });
          }

          if (room.players.length === 0) {
            clearTurnTimeout(roomCode);
            gameRooms.delete(roomCode);
          } else {
            gameRooms.set(roomCode, room);
          }
          continue;
        }

        // Game in progress: mark disconnected, give them time to reconnect
        player.disconnected = true;
        gameRooms.set(roomCode, room);

        if (opponent) {
          io.to(opponent.socketId).emit('game:peer_disconnected', {
            username: player.username,
            graceSeconds: Math.round(DISCONNECT_GRACE_MS / 1000)
          });
        }

        console.log(`[Game] ${player.username} disconnected from ${roomCode}, ${DISCONNECT_GRACE_MS / 1000}s grace`);

        player.disconnectTimer = setTimeout(() => {
          (async () => {
            const r = gameRooms.get(roomCode);
            if (!r) return;

            const stillGone = r.players.find(p => p.userId === player.userId);
            if (!stillGone || !stillGone.disconnected) return; // reconnected already

            const winner = r.players.find(p => p.userId !== player.userId);
            if (!winner) {
              gameRooms.delete(roomCode);
              return;
            }

            clearTurnTimeout(roomCode);

            io.to(winner.socketId).emit('game:peer_left', { forfeit: true });
            io.to(winner.socketId).emit('game:end', {
              winnerId: winner.userId,
              result: 'forfeit',
              forfeit: true
            });

            if (r.matchId && r.wager > 0) {
              await settleMatch(r, winner.userId, 'forfeit');
            }

            const { error: updErr } = await supabaseAdmin
              .from('game_rooms')
              .update({ status: 'finished' })
              .eq('room_code', roomCode);
            if (updErr) console.error('[Game] room status update failed:', updErr.message);

            gameRooms.delete(roomCode);

            console.log(`[Game] ${player.username} forfeit room ${roomCode} after disconnect grace`);
          })().catch(err => console.error('[Game] disconnect forfeit error:', err));
        }, DISCONNECT_GRACE_MS);
      }
    }

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`[WebSocket] User disconnected: ${socket.username}`);
      leaveLudoRooms();
      leaveGameRooms();
      broadcastToFriends(socket.userId, 'user_offline', {
        userId: socket.userId,
        username: socket.username
      });
    });
  });

  return io;
}

// Broadcast event to all friends of a user
async function broadcastToFriends(userId, event, data) {
  try {
    const { data: friends, error } = await supabaseAdmin
      .from('friends')
      .select('friend_id')
      .eq('user_id', userId)
      .eq('status', 'accepted');

    if (error) throw error;

    (friends || []).forEach(friend => {
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
