/* ==========================================================================
   ARENAX BACKEND - GAME ROOMS ROUTES
   Custom rooms with invite codes for playing with friends
   ========================================================================== */

const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// Generate random 6-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create custom room
router.post('/create', authMiddleware, (req, res) => {
  try {
    const { gameKey, wager } = req.body;

    if (!gameKey) {
      return res.status(400).json({ error: 'Game key required' });
    }

    // Generate unique room code
    let roomCode;
    let attempts = 0;
    do {
      roomCode = generateRoomCode();
      attempts++;
      const existing = db.prepare('SELECT id FROM game_rooms WHERE room_code = ?').get(roomCode);
      if (!existing) break;
    } while (attempts < 10);

    if (attempts >= 10) {
      return res.status(500).json({ error: 'Failed to generate unique room code' });
    }

    // Create room
    const result = db.prepare(`
      INSERT INTO game_rooms (room_code, creator_id, game_key, wager)
      VALUES (?, ?, ?, ?)
    `).run(roomCode, req.userId, gameKey, wager || 0);

    res.json({
      success: true,
      roomId: result.lastInsertRowid,
      roomCode,
      gameKey,
      wager: wager || 0
    });
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Join room by code
router.post('/join', authMiddleware, (req, res) => {
  try {
    const { roomCode } = req.body;

    const room = db.prepare(`
      SELECT r.*, u.username as creator_username
      FROM game_rooms r
      JOIN users u ON r.creator_id = u.id
      WHERE r.room_code = ? AND r.status = 'waiting'
    `).get(roomCode);

    if (!room) {
      return res.status(404).json({ error: 'Room not found or already started' });
    }

    res.json({
      success: true,
      room: {
        id: room.id,
        roomCode: room.room_code,
        creator: { id: room.creator_id, username: room.creator_username },
        gameKey: room.game_key,
        wager: room.wager
      }
    });
  } catch (err) {
    console.error('Join room error:', err);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Start room game - creates match and links to room
router.post('/:roomId/start', authMiddleware, (req, res) => {
  try {
    const { roomId } = req.params;
    const { opponentId } = req.body || {};

    const room = db.prepare('SELECT * FROM game_rooms WHERE id = ?').get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.creator_id !== req.userId) {
      return res.status(403).json({ error: 'Only room creator can start game' });
    }

    if (room.status !== 'waiting') {
      return res.status(400).json({ error: 'Room already started' });
    }

    // Get creator user
    const creator = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (room.wager > 0 && creator.balance < room.wager) {
      return res.status(400).json({ error: 'Insufficient balance for wager' });
    }

    let matchId = null;
    const wagerAmt = room.wager || 0;
    const pot = wagerAmt * 2;

    // If wager > 0, create match records for both players
    if (wagerAmt > 0 && opponentId) {
      const opponent = db.prepare('SELECT * FROM users WHERE id = ?').get(opponentId);
      if (!opponent) {
        return res.status(400).json({ error: 'Opponent not found' });
      }
      if (opponent.balance < wagerAmt) {
        return res.status(400).json({ error: 'Opponent has insufficient balance' });
      }

      const GAME_TITLES = {
        carrom: 'Carrom Clash', ludo: 'Ludo Duel', chess: 'Chess Royale',
        checkers: 'Checkers Pro', pool: 'Pool 8-Ball', glowhockey: 'Glow Hockey'
      };
      const gameTitle = GAME_TITLES[room.game_key] || room.game_key;

      // Debit both players, create match records
      const tx = db.transaction(() => {
        // Debit creator
        db.prepare('UPDATE users SET balance = balance - ?, total_wagered = total_wagered + ? WHERE id = ?')
          .run(wagerAmt, wagerAmt, creator.id);

        // Debit opponent
        db.prepare('UPDATE users SET balance = balance - ?, total_wagered = total_wagered + ? WHERE id = ?')
          .run(wagerAmt, wagerAmt, opponentId);

        // Create match for creator
        const info1 = db.prepare(`
          INSERT INTO matches (user_id, game_key, mode, wager, pot, status, room_id)
          VALUES (?, ?, 'pvp', ?, ?, 'active', ?)
        `).run(creator.id, room.game_key, wagerAmt, pot, roomId);

        // Create match for opponent
        const info2 = db.prepare(`
          INSERT INTO matches (user_id, game_key, mode, wager, pot, status, room_id)
          VALUES (?, ?, 'pvp', ?, ?, 'active', ?)
        `).run(opponentId, room.game_key, wagerAmt, pot, roomId);

        // Store primary match_id (creator's) in room
        matchId = info1.lastInsertRowid;

        // Record transactions
        db.prepare(`
          INSERT INTO transactions (user_id, type, game, description, wager, pot, result)
          VALUES (?, 'wager', ?, ?, ?, ?, 'ACTIVE')
        `).run(creator.id, gameTitle, `${gameTitle} PvP Wager`, wagerAmt, pot);

        db.prepare(`
          INSERT INTO transactions (user_id, type, game, description, wager, pot, result)
          VALUES (?, 'wager', ?, ?, ?, ?, 'ACTIVE')
        `).run(opponentId, gameTitle, `${gameTitle} PvP Wager`, wagerAmt, pot);
      });
      tx();

      // Link match to room
      db.prepare('UPDATE game_rooms SET match_id = ? WHERE id = ?').run(matchId, roomId);
    }

    // Update room status
    db.prepare('UPDATE game_rooms SET status = ? WHERE id = ?').run('in_progress', roomId);

    res.json({
      success: true,
      message: 'Game started',
      matchId,
      pot
    });
  } catch (err) {
    console.error('Start room error:', err);
    res.status(500).json({ error: 'Failed to start game' });
  }
});

// List active rooms
router.get('/list', authMiddleware, (req, res) => {
  try {
    const rooms = db.prepare(`
      SELECT r.*, u.username as creator_username
      FROM game_rooms r
      JOIN users u ON r.creator_id = u.id
      WHERE r.status = 'waiting'
      ORDER BY r.created_at DESC
      LIMIT 50
    `).all();

    res.json({ rooms });
  } catch (err) {
    console.error('List rooms error:', err);
    res.status(500).json({ error: 'Failed to list rooms' });
  }
});

module.exports = router;
