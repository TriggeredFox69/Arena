/* ==========================================================================
   ARENAX - MATCHMAKING ROUTES (Supabase-backed, serverless-safe)
   Auto-matches players queuing for the same game. No room codes needed.
   ========================================================================== */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// POST /api/matchmaking/join
// Body: { gameKey, wager }
router.post('/join', authMiddleware, async (req, res) => {
  try {
    const { gameKey, wager } = req.body;
    if (!gameKey) return res.status(400).json({ success: false, error: 'Game key required' });

    const wagerNum = parseInt(wager, 10) || 0;
    if (wagerNum > 0 && req.user.balance < wagerNum) {
      return res.status(400).json({ success: false, error: 'Insufficient balance' });
    }

    // 1) Atomically try to claim an existing waiting player (same wager preferred, then any)
    const { data: opponent, error: claimErr } = await supabaseAdmin.rpc('matchmaking_claim_opponent', {
      p_game_key: gameKey,
      p_user_id: req.userId,
      p_username: req.username,
      p_wager: wagerNum
    });

    if (claimErr) {
      console.error('[matchmaking/join] claim error:', claimErr);
      return res.status(500).json({ success: false, error: 'Matchmaking failed' });
    }

    if (opponent && opponent.length > 0 && opponent[0].opponent_id) {
      // Match found! opponent[0] has: opponent_id, opponent_username, room_code, role ('host' or 'guest'), room_id
      const m = opponent[0];
      const matchWager = Math.max(wagerNum, m.opponent_wager || wagerNum);

      return res.json({
        success: true,
        matched: true,
        role: m.role,
        roomCode: m.room_code,
        room: {
          id: m.room_id,
          roomCode: m.room_code,
          gameKey: gameKey,
          wager: matchWager,
          status: 'ready',
          creatorId: m.role === 'host' ? req.userId : m.opponent_id,
          playerTwoId: m.role === 'guest' ? req.userId : m.opponent_id
        },
        message: `Matched with ${m.opponent_username}!`
      });
    }

    // 2) No match — insert ourselves into queue
    const { error: insertErr } = await supabaseAdmin
      .from('matchmaking_queue')
      .insert({
        game_key: gameKey,
        user_id: req.userId,
        username: req.username,
        wager: wagerNum
      });

    if (insertErr) {
      // If unique violation (already in queue), just return queue position
      if (insertErr.code === '23505') {
        const { data: myEntry } = await supabaseAdmin
          .from('matchmaking_queue')
          .select('*, queue_position:matchmaking_queue_position(user_id)')
          .eq('user_id', req.userId)
          .eq('game_key', gameKey)
          .maybeSingle();
        const pos = myEntry?.queue_position || 1;
        return res.json({ success: true, matched: false, queuePosition: pos, message: `Waiting for opponent... (position ${pos} in queue)` });
      }
      console.error('[matchmaking/join] insert error:', insertErr);
      return res.status(500).json({ success: false, error: 'Failed to join queue' });
    }

    // Get queue position
    const { data: posData } = await supabaseAdmin.rpc('matchmaking_queue_position', { p_user_id: req.userId, p_game_key: gameKey });
    const position = posData || 1;

    res.json({
      success: true,
      matched: false,
      queuePosition: position,
      message: `Waiting for opponent... (position ${position} in queue)`
    });
  } catch (err) {
    console.error('[matchmaking/join] error:', err);
    res.status(500).json({ success: false, error: 'Matchmaking failed' });
  }
});

// POST /api/matchmaking/leave
router.post('/leave', authMiddleware, async (req, res) => {
  try {
    const { gameKey } = req.body;
    if (gameKey) {
      await supabaseAdmin.from('matchmaking_queue').delete().eq('user_id', req.userId).eq('game_key', gameKey);
    } else {
      await supabaseAdmin.from('matchmaking_queue').delete().eq('user_id', req.userId);
    }
    res.json({ success: true, message: 'Left queue' });
  } catch (err) {
    console.error('[matchmaking/leave] error:', err);
    res.status(500).json({ success: false, error: 'Failed to leave queue' });
  }
});

// GET /api/matchmaking/status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const gameKey = req.query.gameKey;
    if (!gameKey) return res.status(400).json({ success: false, error: 'gameKey required' });

    // Check if we have a pending match (created by opponent's claim)
    const { data: match } = await supabaseAdmin
      .from('matchmaking_matches')
      .select('*')
      .eq('user_id', req.userId)
      .eq('game_key', gameKey)
      .maybeSingle();

    if (match) {
      // Clean up the match record
      await supabaseAdmin.from('matchmaking_matches').delete().eq('user_id', req.userId).eq('game_key', gameKey);
      return res.json({
        success: true,
        inQueue: null,
        matched: true,
        role: match.role,
        roomCode: match.room_code,
        room: {
          id: match.room_id,
          roomCode: match.room_code,
          gameKey: gameKey,
          wager: match.wager,
          status: 'ready',
          // The caller's own role decides which side they are: a 'host' IS the
          // room creator, so the opponent is player two (and vice versa).
          creatorId: match.role === 'host' ? req.userId : match.opponent_id,
          playerTwoId: match.role === 'host' ? match.opponent_id : req.userId
        },
        message: match.message
      });
    }

    // Check queue position
    const { data: posData } = await supabaseAdmin.rpc('matchmaking_queue_position', { p_user_id: req.userId, p_game_key: gameKey });
    const inQueue = posData ? { gameKey, position: posData, totalInQueue: posData, joinedAt: new Date().toISOString() } : null;

    // Race condition fallback: if not in queue and no match record,
    // check if there's a room where we're player_two with status 'ready'
    if (!inQueue) {
      const { data: room } = await supabaseAdmin
        .from('game_rooms')
        .select('*')
        .eq('player_two_id', req.userId)
        .eq('game_key', gameKey)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .maybeSingle();

      if (room) {
        return res.json({
          success: true,
          inQueue: null,
          matched: true,
          role: 'guest',
          roomCode: room.room_code,
          room: {
            id: room.id,
            roomCode: room.room_code,
            gameKey: gameKey,
            wager: room.wager,
            status: 'ready',
            creatorId: room.creator_id,
            playerTwoId: room.player_two_id
          },
          message: 'Matched!'
        });
      }
    }

    res.json({ success: true, inQueue, matched: false });
  } catch (err) {
    console.error('[matchmaking/status] error:', err);
    res.status(500).json({ success: false, error: 'Failed to check status' });
  }
});

// GET /api/matchmaking/queues — debug
router.get('/queues', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabaseAdmin.from('matchmaking_queue').select('*');
    const result = {};
    if (data) {
      for (const entry of data) {
        if (!result[entry.game_key]) result[entry.game_key] = [];
        result[entry.game_key].push({ username: entry.username, wager: entry.wager, waiting: Math.round((Date.now() - new Date(entry.created_at).getTime()) / 1000) + 's' });
      }
    }
    res.json({ success: true, queues: result });
  } catch (err) {
    console.error('[matchmaking/queues] error:', err);
    res.status(500).json({ success: false, error: 'Failed to get queues' });
  }
});

module.exports = router;