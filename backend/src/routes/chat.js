/* ==========================================================================
   ARENAX BACKEND - CHAT ROUTES
   Save and retrieve chat messages, emoji reactions
   ========================================================================== */

const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// Get chat history for a game
router.get('/:gameId', authMiddleware, (req, res) => {
  try {
    const { gameId } = req.params;

    const messages = db.prepare(`
      SELECT c.*, u.username
      FROM chat_messages c
      JOIN users u ON c.user_id = u.id
      WHERE c.game_id = ?
      ORDER BY c.created_at ASC
      LIMIT 100
    `).all(gameId);

    res.json({ messages });
  } catch (err) {
    console.error('Get chat error:', err);
    res.status(500).json({ error: 'Failed to fetch chat' });
  }
});

// Add emoji reaction to message
router.post('/:messageId/react', authMiddleware, (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;

    db.prepare('UPDATE chat_messages SET emoji_reaction = ? WHERE id = ?')
      .run(emoji, messageId);

    res.json({ success: true });
  } catch (err) {
    console.error('Add reaction error:', err);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

module.exports = router;
