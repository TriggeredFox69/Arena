/* ==========================================================================
   ARENAX - GAME ROOMS ROUTES (Supabase / Netlify Functions)
   Authoritative 1v1 room lifecycle: create, join, ready, action, end, leave.
   Real-time delivery happens via Supabase Realtime on public.room_events.
   ========================================================================== */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const MIN_WAGER = 5;
const MAX_WAGER = 1000;
const TURN_TIMEOUTS = {
  chess: 30,
  checkers: 20,
  ludo: 30,
  // Pool is continuous-physics like glow hockey, not discrete-move like
  // chess: the shooter's client is already the sole authority for a shot's
  // outcome (canAim() blocks a client from ever firing out of turn), so
  // there's nothing for the server's turn-based validation to protect here.
  // Leaving pool on the turn-based branch meant /rooms/action rejected a
  // shot_result with "Not your turn" any time the server's view of
  // current_turn_user_id raced ahead of/behind the client's — which
  // silently desynced the game after the very first shot with no visible
  // error. Marking it real-time (like glowhockey) routes it through the
  // branch that trusts the reported nextTurn instead of validating req.userId.
  '8ball-pool': 0,
  pool: 0,
  // Carrom is shooter-authoritative turn-based physics, exactly like pool:
  // the client already blocks shooting out of turn (_canInteract), so the
  // server's current_turn_user_id check adds nothing but a race that
  // rejects a legitimate shot_result with "Not your turn". Route it down
  // the real-time branch that trusts the reported turn, as pool does.
  carrom: 0,
  glowhockey: 0
};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function isRealTime(gameKey) {
  return TURN_TIMEOUTS[gameKey] === 0;
}

function errorRes(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

// Broadcast a peer_ready event to the room channel
async function broadcastPeerReady(roomCode, userId, username) {
  try {
    const channel = supabaseAdmin.channel(`room:${roomCode}`, {
      config: { broadcast: { self: false } }
    });
    // Subscribe briefly to send the broadcast
    await new Promise((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
      });
    });
    channel.send({
      type: 'broadcast',
      event: 'game:peer_ready',
      payload: { userId, username }
    });
    channel.unsubscribe();
  } catch (e) {
    console.error('[rooms/ready] broadcast peer_ready error:', e);
  }
}

// Fetch a username by user ID
async function fetchUsername(userId) {
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from('users')
    .select('username')
    .eq('id', userId)
    .maybeSingle();
  return data?.username || null;
}

// Fetch a user (full row) by user ID
async function fetchUser(userId) {
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return data || null;
}

// GET /api/rooms/sync?code=XYZ
router.get('/sync', authMiddleware, async (req, res) => {
  try {
    const code = req.query.code || req.query.roomCode;
    if (!code) return errorRes(res, 'Room code required');

    const { data: room, error: roomErr } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_code', code.toUpperCase())
      .single();

    if (roomErr || !room) return errorRes(res, 'Room not found', 404);

    const userId = req.userId;
    if (room.creator_id !== userId && room.player_two_id !== userId) {
      return errorRes(res, 'Not a member of this room', 403);
    }

    const { data: events, error: eventsErr } = await supabaseAdmin
      .from('room_events')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
      .limit(200);

    if (eventsErr) console.error('[rooms/sync] events error:', eventsErr);

    // Attach usernames
    const [creatorName, playerTwoName] = await Promise.all([
      fetchUsername(room.creator_id),
      fetchUsername(room.player_two_id)
    ]);
    room.creator = creatorName ? { username: creatorName } : null;
    room.player_two = playerTwoName ? { username: playerTwoName } : null;

    const players = [];
    if (room.creator_id) {
      players.push({
        userId: room.creator_id,
        username: creatorName || 'Host',
        role: 'host',
        ready: !!room.creator_ready
      });
    }
    if (room.player_two_id) {
      players.push({
        userId: room.player_two_id,
        username: playerTwoName || 'Guest',
        role: 'guest',
        ready: !!room.player_two_ready
      });
    }

    res.json({
      success: true,
      room: mapRoom(room),
      players,
      events: events || []
    });
  } catch (err) {
    console.error('[rooms/sync] error:', err);
    return errorRes(res, 'Failed to sync room', 500);
  }
});

// POST /api/rooms/create
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { gameKey, wager } = req.body;
    if (!gameKey) return errorRes(res, 'Game key required');

    const wagerNum = parseInt(wager, 10) || 0;
    if (wagerNum !== 0 && (wagerNum < MIN_WAGER || wagerNum > MAX_WAGER)) {
      return errorRes(res, `Wager must be between ${MIN_WAGER} and ${MAX_WAGER} AX`);
    }

    if (wagerNum > 0 && req.user.balance < wagerNum) {
      return errorRes(res, 'Insufficient balance');
    }

    let roomCode;
    for (let attempts = 0; attempts < 10; attempts++) {
      const candidate = generateRoomCode();
      const { data: existing } = await supabaseAdmin
        .from('game_rooms')
        .select('id')
        .eq('room_code', candidate)
        .maybeSingle();
      if (!existing) {
        roomCode = candidate;
        break;
      }
    }
    if (!roomCode) return errorRes(res, 'Could not generate room code', 500);

    const { data: room, error } = await supabaseAdmin
      .from('game_rooms')
      .insert({
        room_code: roomCode,
        creator_id: req.userId,
        game_key: gameKey,
        wager: wagerNum,
        status: 'waiting'
      })
      .select()
      .single();

    if (error || !room) {
      console.error('[rooms/create] insert error:', error);
      return errorRes(res, 'Failed to create room', 500);
    }

    // Attach creator username
    room.creator = req.username ? { username: req.username } : null;

    res.json({
      success: true,
      roomCode: room.room_code,
      room: mapRoom(room),
      role: 'host'
    });
  } catch (err) {
    console.error('[rooms/create] error:', err);
    return errorRes(res, 'Failed to create room', 500);
  }
});

// POST /api/rooms/join
router.post('/join', authMiddleware, async (req, res) => {
  try {
    const { roomCode } = req.body;
    if (!roomCode) return errorRes(res, 'Room code required');

    const code = roomCode.toUpperCase().trim();

    // Step 1: find the room by code
    const { data: room, error: fetchErr } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_code', code)
      .single();

    if (fetchErr || !room) {
      console.error('[rooms/join] room lookup error:', fetchErr);
      return errorRes(res, 'Room not found', 404);
    }

    // Fetch creator username
    const creatorName = await fetchUsername(room.creator_id);
    room.creator = creatorName ? { username: creatorName } : null;

    if (room.creator_id === req.userId) {
      return res.json({ success: true, room: mapRoom(room), role: 'host' });
    }

    if (room.status !== 'waiting') {
      return errorRes(res, 'Room is no longer open', 400);
    }

    if (room.player_two_id && room.player_two_id !== req.userId) {
      return errorRes(res, 'Room is full', 400);
    }

    if (room.wager > 0 && req.user.balance < room.wager) {
      return errorRes(res, 'Insufficient balance for this wager');
    }

    // Step 2: update the room — set player_two and mark ready
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('game_rooms')
      .update({ player_two_id: req.userId, status: 'ready' })
      .eq('id', room.id)
      .select('*')
      .single();

    if (updateErr || !updated) {
      console.error('[rooms/join] update error:', updateErr);
      const detail = updateErr?.message || updateErr?.details || updateErr?.code || JSON.stringify(updateErr);
      return errorRes(res, `Failed to join room — DB error: ${detail}`, 500);
    }

    // Attach usernames
    updated.creator = creatorName ? { username: creatorName } : null;
    updated.player_two = { username: req.username || req.user?.username || 'Player' };

    res.json({ success: true, room: mapRoom(updated), role: 'guest' });
  } catch (err) {
    console.error('[rooms/join] error:', err);
    return errorRes(res, 'Failed to join room', 500);
  }
});

// POST /api/rooms/ready
router.post('/ready', authMiddleware, async (req, res) => {
  try {
    const { roomCode } = req.body;
    if (!roomCode) return errorRes(res, 'Room code required');

    const code = roomCode.toUpperCase().trim();

    const { data: room, error: fetchErr } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_code', code)
      .single();

    if (fetchErr || !room) return errorRes(res, 'Room not found', 404);

    if (![room.creator_id, room.player_two_id].includes(req.userId)) {
      return errorRes(res, 'Not a member of this room', 403);
    }

    if (!['waiting', 'ready'].includes(room.status)) {
      return errorRes(res, 'Room is not open for ready marks');
    }

    // Mark the caller ready directly (no custom RPC required).
    const readyUpdate = {};
    if (room.creator_id === req.userId) {
      readyUpdate.creator_ready = true;
    } else if (room.player_two_id === req.userId) {
      readyUpdate.player_two_ready = true;
    } else {
      return errorRes(res, 'Not a member of this room', 403);
    }

    const { data: marked, error: updateErr } = await supabaseAdmin
      .from('game_rooms')
      .update(readyUpdate)
      .eq('id', room.id)
      .select('*')
      .single();

    if (updateErr || !marked) {
      console.error('[rooms/ready] update error:', updateErr);
      return errorRes(res, updateErr?.message || 'Failed to mark ready', 500);
    }

    const bothReady = marked.creator_ready && marked.player_two_ready;
    if (!bothReady) {
      // Broadcast peer_ready event so the other player gets notified
      await broadcastPeerReady(code, req.userId, req.username);

      // Attach usernames
      const [creatorName, playerTwoName] = await Promise.all([
        fetchUsername(marked.creator_id),
        fetchUsername(marked.player_two_id)
      ]);
      marked.creator = creatorName ? { username: creatorName } : null;
      marked.player_two = playerTwoName ? { username: playerTwoName } : null;
      return res.json({ success: true, started: false, room: mapRoom(marked) });
    }

    // Both ready — start the match atomically.
    const startData = await startMatch(room.id);
    if (!startData) {
      return errorRes(res, 'Failed to start match', 500);
    }

    res.json({ success: true, started: true, ...startData });
  } catch (err) {
    console.error('[rooms/ready] error:', err);
    return errorRes(res, 'Failed to mark ready', 500);
  }
});

// POST /api/rooms/action
router.post('/action', authMiddleware, async (req, res) => {
  try {
    const { roomCode, action } = req.body;
    if (!roomCode || !action) return errorRes(res, 'Room code and action required');

    const code = roomCode.toUpperCase().trim();

    const { data: room, error: fetchErr } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_code', code)
      .single();

    if (fetchErr || !room) return errorRes(res, 'Room not found', 404);

    if (room.status !== 'in_progress') {
      return errorRes(res, 'Game is not in progress');
    }

    if (![room.creator_id, room.player_two_id].includes(req.userId)) {
      return errorRes(res, 'Not a member of this room', 403);
    }

    // For real-time games we still record the action but skip strict turn validation.
    if (isRealTime(room.game_key)) {
      const keepTurn = action && action.keepTurn;
      const nextTurn = keepTurn
        ? room.current_turn_user_id
        : (room.current_turn_user_id === room.creator_id ? room.player_two_id : room.creator_id);

      if (!keepTurn) {
        const { error: updErr } = await supabaseAdmin
          .from('game_rooms')
          .update({ current_turn_user_id: nextTurn })
          .eq('id', room.id);

        if (updErr) {
          console.error('[rooms/action] realtime update error:', updErr);
        }
      }

      const { data: event, error: insErr } = await supabaseAdmin
        .from('room_events')
        .insert({
          room_id: room.id,
          user_id: req.userId,
          type: 'action',
          payload: { action, nextTurn, timeoutSeconds: TURN_TIMEOUTS[room.game_key] || 30 }
        })
        .select()
        .single();

      if (insErr) {
        console.error('[rooms/action] realtime insert error:', insErr);
        return errorRes(res, 'Failed to record action', 500);
      }

      return res.json({
        success: true,
        ack: true,
        nextTurn,
        eventId: event.id
      });
    }

    // Turn-based action validation and turn toggle (no custom RPC required).
    if (room.current_turn_user_id && room.current_turn_user_id !== req.userId) {
      return errorRes(res, 'Not your turn');
    }

    const keepTurn = action && action.keepTurn;
    const nextTurn = keepTurn
      ? room.current_turn_user_id
      : (room.creator_id === req.userId ? room.player_two_id : room.creator_id);

    if (!keepTurn) {
      const { error: updErr } = await supabaseAdmin
        .from('game_rooms')
        .update({ current_turn_user_id: nextTurn })
        .eq('id', room.id);
      if (updErr) {
        console.error('[rooms/action] turn update error:', updErr);
      }
    }

    const { error: insErr } = await supabaseAdmin.from('room_events').insert({
      room_id: room.id,
      user_id: req.userId,
      type: 'action',
      payload: { action, nextTurn, by: req.userId, timeoutSeconds: TURN_TIMEOUTS[room.game_key] || 30 }
    });
    if (insErr) {
      console.error('[rooms/action] event insert error:', insErr);
      return errorRes(res, 'Failed to record action', 500);
    }

    res.json({
      success: true,
      ack: true,
      nextTurn
    });
  } catch (err) {
    console.error('[rooms/action] error:', err);
    return errorRes(res, 'Failed to record action', 500);
  }
});

// POST /api/rooms/end
router.post('/end', authMiddleware, async (req, res) => {
  try {
    const { roomCode, result, winnerId, finalState } = req.body;
    if (!roomCode || !result) return errorRes(res, 'Room code and result required');

    const code = roomCode.toUpperCase().trim();

    const { data: room, error: fetchErr } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_code', code)
      .single();

    if (fetchErr || !room) return errorRes(res, 'Room not found', 404);

    if (!['in_progress', 'ready', 'waiting'].includes(room.status)) {
      return errorRes(res, 'Game already ended');
    }

    if (![room.creator_id, room.player_two_id].includes(req.userId)) {
      return errorRes(res, 'Not a member of this room', 403);
    }

    const resolvedWinner = resolveWinner(room, result, winnerId, req.userId);
    const settled = await settleMatch(room, resolvedWinner);
    if (!settled) {
      return errorRes(res, 'Failed to settle match', 500);
    }

    const { error: insErr } = await supabaseAdmin
      .from('room_events')
      .insert({
        room_id: room.id,
        user_id: req.userId,
        type: 'end',
        payload: { result, winnerId: resolvedWinner, finalState }
      });

    if (insErr) {
      console.error('[rooms/end] event insert error:', insErr);
    }

    const { error: updErr } = await supabaseAdmin
      .from('game_rooms')
      .update({ status: 'finished' })
      .eq('id', room.id);

    if (updErr) console.error('[rooms/end] status update error:', updErr);

    res.json({
      success: true,
      result,
      winnerId: resolvedWinner,
      pot: room.wager * 2
    });
  } catch (err) {
    console.error('[rooms/end] error:', err);
    return errorRes(res, 'Failed to end match', 500);
  }
});

// POST /api/rooms/rematch
router.post('/rematch', authMiddleware, async (req, res) => {
  try {
    const { roomCode } = req.body;
    if (!roomCode) return errorRes(res, 'Room code required');

    const code = roomCode.toUpperCase().trim();

    const { data: oldRoom, error: fetchErr } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_code', code)
      .single();

    if (fetchErr || !oldRoom) return errorRes(res, 'Room not found', 404);

    if (![oldRoom.creator_id, oldRoom.player_two_id].includes(req.userId)) {
      return errorRes(res, 'Not a member of this room', 403);
    }

    if (!['finished', 'cancelled'].includes(oldRoom.status)) {
      return errorRes(res, 'Room is still active', 400);
    }

    if (!oldRoom.player_two_id) {
      return errorRes(res, 'No opponent to rematch');
    }

    // Look for an existing rematch room between these two players
    const existing = await findRematchRoom(oldRoom);
    if (existing) {
      await notifyRematch(oldRoom, existing.room_code);
      return res.json({
        success: true,
        roomCode: existing.room_code,
        room: mapRoom(existing),
        role: existing.creator_id === req.userId ? 'host' : 'guest'
      });
    }

    // Create a new room; the caller becomes the host so they can share the code
    const newCreatorId = req.userId;
    const newPlayerTwoId = oldRoom.creator_id === req.userId ? oldRoom.player_two_id : oldRoom.creator_id;

    let newRoomCode;
    for (let attempts = 0; attempts < 10; attempts++) {
      const candidate = generateRoomCode();
      const { data: existingCode } = await supabaseAdmin
        .from('game_rooms')
        .select('id')
        .eq('room_code', candidate)
        .maybeSingle();
      if (!existingCode) {
        newRoomCode = candidate;
        break;
      }
    }
    if (!newRoomCode) return errorRes(res, 'Could not generate room code', 500);

    const { data: newRoom, error: insertErr } = await supabaseAdmin
      .from('game_rooms')
      .insert({
        room_code: newRoomCode,
        creator_id: newCreatorId,
        player_two_id: newPlayerTwoId,
        game_key: oldRoom.game_key,
        wager: oldRoom.wager,
        status: 'ready'
      })
      .select('*')
      .single();

    if (insertErr || !newRoom) {
      console.error('[rooms/rematch] insert error:', insertErr);
      return errorRes(res, 'Failed to create rematch room', 500);
    }

    await notifyRematch(oldRoom, newRoomCode);

    newRoom.creator = { username: req.username || 'Host' };
    const opponentName = await fetchUsername(newPlayerTwoId);
    newRoom.player_two = { username: opponentName || 'Guest' };

    res.json({
      success: true,
      roomCode: newRoomCode,
      room: mapRoom(newRoom),
      role: 'host'
    });
  } catch (err) {
    console.error('[rooms/rematch] error:', err);
    return errorRes(res, 'Failed to create rematch', 500);
  }
});

async function findRematchRoom(oldRoom) {
  try {
    const { data: rooms } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .in('status', ['waiting', 'ready'])
      .or(`creator_id.eq.${oldRoom.creator_id},creator_id.eq.${oldRoom.player_two_id}`)
      .order('created_at', { ascending: false })
      .limit(20);

    return (rooms || []).find(r =>
      r.id !== oldRoom.id &&
      ((r.creator_id === oldRoom.creator_id && r.player_two_id === oldRoom.player_two_id) ||
       (r.creator_id === oldRoom.player_two_id && r.player_two_id === oldRoom.creator_id))
    ) || null;
  } catch (err) {
    console.error('[findRematchRoom] error:', err);
    return null;
  }
}

async function notifyRematch(oldRoom, newRoomCode) {
  try {
    await supabaseAdmin.from('room_events').insert({
      room_id: oldRoom.id,
      user_id: oldRoom.creator_id,
      type: 'rematch',
      payload: { newRoomCode, gameKey: oldRoom.game_key, wager: oldRoom.wager }
    });
  } catch (err) {
    console.error('[notifyRematch] error:', err);
  }
}

// POST /api/rooms/leave
router.post('/leave', authMiddleware, async (req, res) => {
  try {
    const { roomCode } = req.body;
    if (!roomCode) return errorRes(res, 'Room code required');

    const code = roomCode.toUpperCase().trim();

    const { data: room, error: fetchErr } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_code', code)
      .single();

    if (fetchErr || !room) return errorRes(res, 'Room not found', 404);

    if (![room.creator_id, room.player_two_id].includes(req.userId)) {
      return errorRes(res, 'Not a member of this room', 403);
    }

    const isInProgress = room.status === 'in_progress';
    const isCreator = room.creator_id === req.userId;

    if (isInProgress) {
      // Forfeit: opponent wins
      const winnerId = isCreator ? room.player_two_id : room.creator_id;
      await settleMatch(room, winnerId);
      await supabaseAdmin.from('room_events').insert({
        room_id: room.id,
        user_id: req.userId,
        type: 'forfeit',
        payload: { winnerId, forfeitBy: req.userId }
      });
      await supabaseAdmin.from('game_rooms').update({ status: 'finished' }).eq('id', room.id);
      return res.json({ success: true, forfeit: true, winnerId });
    }

    // Before game started
    if (isCreator) {
      await supabaseAdmin.from('game_rooms').update({ status: 'cancelled' }).eq('id', room.id);
      await supabaseAdmin.from('room_events').insert({
        room_id: room.id,
        user_id: req.userId,
        type: 'leave',
        payload: { cancelled: true }
      });
      return res.json({ success: true, cancelled: true });
    }

    // Guest leaves before start
    const { data: updated } = await supabaseAdmin
      .from('game_rooms')
      .update({ player_two_id: null, status: 'waiting', player_two_ready: false })
      .eq('id', room.id)
      .select()
      .single();

    await supabaseAdmin.from('room_events').insert({
      room_id: room.id,
      user_id: req.userId,
      type: 'leave',
      payload: {}
    });

    res.json({ success: true, room: mapRoom(updated) });
  } catch (err) {
    console.error('[rooms/leave] error:', err);
    return errorRes(res, 'Failed to leave room', 500);
  }
});

// Helpers

function mapRoom(room) {
  return {
    id: room.id,
    roomCode: room.room_code,
    gameKey: room.game_key,
    wager: room.wager,
    status: room.status,
    creatorId: room.creator_id,
    creator: room.creator,
    playerTwoId: room.player_two_id,
    playerTwo: room.player_two,
    creatorReady: room.creator_ready,
    playerTwoReady: room.player_two_ready,
    currentTurnUserId: room.current_turn_user_id,
    matchId: room.match_id,
    creatorMatchId: room.creator_match_id,
    playerTwoMatchId: room.player_two_match_id,
    createdAt: room.created_at
  };
}

async function startMatch(roomId) {
  // Fetch room and both users separately
  const { data: room, error: lockErr } = await supabaseAdmin
    .from('game_rooms')
    .select('*')
    .eq('id', roomId)
    .single();

  if (lockErr || !room) return null;

  const { data: existing } = await supabaseAdmin
    .from('game_rooms')
    .select('status')
    .eq('id', roomId)
    .eq('status', 'in_progress')
    .maybeSingle();
  if (existing) {
    return buildStartPayload(room);
  }

  if (room.status !== 'ready' || !room.player_two_id) return null;

  // Fetch both users for balance
  const [creatorUser, playerTwoUser] = await Promise.all([
    fetchUser(room.creator_id),
    fetchUser(room.player_two_id)
  ]);

  if (!creatorUser || !playerTwoUser) return null;

  room.creator = creatorUser;
  room.player_two = playerTwoUser;

  const wager = room.wager;
  const pot = wager * 2;
  const firstTurn = room.creator_id;
  const deadline = new Date(Date.now() + (TURN_TIMEOUTS[room.game_key] || 30) * 1000).toISOString();

  // Debit both players
  const creatorBal = (creatorUser.balance || 0) - wager;
  const guestBal = (playerTwoUser.balance || 0) - wager;

  if (creatorBal < 0 || guestBal < 0) return null;

  const { error: cErr } = await supabaseAdmin
    .from('users')
    .update({ balance: creatorBal })
    .eq('id', room.creator_id);
  if (cErr) { console.error('[startMatch] creator debit error:', cErr); return null; }

  const { error: gErr } = await supabaseAdmin
    .from('users')
    .update({ balance: guestBal })
    .eq('id', room.player_two_id);
  if (gErr) { console.error('[startMatch] guest debit error:', gErr); return null; }

  // Create match records
  const matchesToInsert = [
    { user_id: room.creator_id, game_key: room.game_key, mode: 'online', wager, pot, status: 'active' },
    { user_id: room.player_two_id, game_key: room.game_key, mode: 'online', wager, pot, status: 'active' }
  ];

  const { data: matches, error: mErr } = await supabaseAdmin
    .from('matches')
    .insert(matchesToInsert)
    .select();

  if (mErr || !matches || matches.length !== 2) {
    console.error('[startMatch] match insert error:', mErr);
    return null;
  }

  const creatorMatch = matches.find(m => m.user_id === room.creator_id);
  const guestMatch = matches.find(m => m.user_id === room.player_two_id);

  // Log wager transactions
  await supabaseAdmin.from('transactions').insert([
    { user_id: room.creator_id, type: 'wager', game: room.game_key, description: `Wager on ${room.game_key}`, wager, pot },
    { user_id: room.player_two_id, type: 'wager', game: room.game_key, description: `Wager on ${room.game_key}`, wager, pot }
  ]);

  const { data: updatedRoom, error: updErr } = await supabaseAdmin
    .from('game_rooms')
    .update({
      status: 'in_progress',
      current_turn_user_id: firstTurn,
      match_id: creatorMatch.id,
      creator_match_id: creatorMatch.id,
      player_two_match_id: guestMatch.id
    })
    .eq('id', roomId)
    .select('*')
    .single();

  if (updErr || !updatedRoom) {
    console.error('[startMatch] room update error:', updErr);
    return null;
  }

  // Attach usernames for the payload
  updatedRoom.creator = { username: creatorUser.username || 'Host' };
  updatedRoom.player_two = { username: playerTwoUser.username || 'Guest' };

  // Insert authoritative start event so both clients receive it via Realtime.
  await supabaseAdmin.from('room_events').insert({
    room_id: roomId,
    user_id: room.creator_id,
    type: 'start',
    payload: {
      firstTurn,
      deadline,
      timeoutSeconds: TURN_TIMEOUTS[room.game_key] || 30,
      players: [
        { userId: room.creator_id, username: creatorUser.username || 'Host', role: 'host' },
        { userId: room.player_two_id, username: playerTwoUser.username || 'Guest', role: 'guest' }
      ],
      wager,
      pot,
      creatorMatchId: creatorMatch.id,
      guestMatchId: guestMatch.id
    }
  });

  return buildStartPayload(updatedRoom, firstTurn, deadline, creatorMatch.id, guestMatch.id);
}

function buildStartPayload(room, firstTurn, deadline, creatorMatchId, guestMatchId) {
  const creatorName = room.creator?.username || 'Host';
  const guestName = room.player_two?.username || 'Guest';
  return {
    roomCode: room.room_code,
    gameKey: room.game_key,
    firstTurn: firstTurn || room.creator_id,
    deadline: deadline || new Date(Date.now() + (TURN_TIMEOUTS[room.game_key] || 30) * 1000).toISOString(),
    timeoutSeconds: TURN_TIMEOUTS[room.game_key] || 30,
    players: [
      { userId: room.creator_id, username: creatorName, role: 'host' },
      { userId: room.player_two_id, username: guestName, role: 'guest' }
    ],
    wager: room.wager,
    pot: room.wager * 2,
    creatorMatchId: creatorMatchId || room.creator_match_id,
    guestMatchId: guestMatchId || room.player_two_match_id,
    matchId: room.match_id || creatorMatchId
  };
}

function resolveWinner(room, result, winnerId, callerId) {
  if (result === 'draw') return null;
  if (winnerId && [room.creator_id, room.player_two_id].includes(winnerId)) return winnerId;
  return room.creator_id === callerId ? room.player_two_id : room.creator_id;
}

async function settleMatch(room, winnerId) {
  try {
    const pot = room.wager * 2;

    // Credit winner and increment stats directly (no custom RPC required).
    if (winnerId) {
      const loserId = winnerId === room.creator_id ? room.player_two_id : room.creator_id;

      const { data: winner } = await supabaseAdmin
        .from('users')
        .select('balance, total_won, wins')
        .eq('id', winnerId)
        .single();
      if (winner) {
        await supabaseAdmin.from('users').update({
          balance: (winner.balance || 0) + pot,
          total_won: (winner.total_won || 0) + pot,
          wins: (winner.wins || 0) + 1
        }).eq('id', winnerId);
      }

      if (loserId) {
        const { data: loser } = await supabaseAdmin
          .from('users')
          .select('losses')
          .eq('id', loserId)
          .single();
        if (loser) {
          await supabaseAdmin.from('users').update({
            losses: (loser.losses || 0) + 1
          }).eq('id', loserId);
        }
      }

      await supabaseAdmin.from('transactions').insert({
        user_id: winnerId,
        type: 'win',
        game: room.game_key,
        description: `Won ${room.game_key} match`,
        wager: room.wager,
        pot,
        result: 'win'
      });

      await supabaseAdmin.from('transactions').insert({
        user_id: loserId,
        type: 'loss',
        game: room.game_key,
        description: `Lost ${room.game_key} match`,
        wager: room.wager,
        pot,
        result: 'loss'
      });
    }

    return true;
  } catch (err) {
    console.error('[settleMatch] error:', err);
    return false;
  }
}

module.exports = router;
