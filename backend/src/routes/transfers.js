/* ==========================================================================
   ARENAX BACKEND - TOKEN TRANSFERS ROUTES
   P2P token transfers between users by UID
   ========================================================================== */

const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// Send tokens to another user by UID
router.post('/send', authMiddleware, (req, res) => {
  try {
    const { toUid, amount, message } = req.body;

    if (!toUid || isNaN(toUid) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid UID or amount' });
    }

    const toUserId = parseInt(toUid);

    // Check recipient exists
    const recipient = db.prepare('SELECT id, username FROM users WHERE id = ?').get(toUserId);
    if (!recipient) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Can't send to yourself
    if (toUserId === req.userId) {
      return res.status(400).json({ error: 'Cannot send to yourself' });
    }

    // Check sender balance
    const sender = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);
    if (sender.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Execute transfer
    db.transaction(() => {
      // Deduct from sender
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?')
        .run(amount, req.userId);

      // Add to recipient
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
        .run(amount, toUserId);

      // Record transfer
      db.prepare(`
        INSERT INTO transfers (from_user_id, to_user_id, amount_ax, message)
        VALUES (?, ?, ?, ?)
      `).run(req.userId, toUserId, amount, message || null);
    })();

    res.json({
      success: true,
      message: 'Transfer completed',
      newBalance: sender.balance - amount,
      recipient: { id: recipient.id, username: recipient.username }
    });
  } catch (err) {
    console.error('Send transfer error:', err);
    res.status(500).json({ error: 'Failed to send tokens' });
  }
});

// Get transfer history
router.get('/history', authMiddleware, (req, res) => {
  try {
    const transfers = db.prepare(`
      SELECT t.*,
             fu.username as from_username,
             tu.username as to_username
      FROM transfers t
      JOIN users fu ON t.from_user_id = fu.id
      JOIN users tu ON t.to_user_id = tu.id
      WHERE t.from_user_id = ? OR t.to_user_id = ?
      ORDER BY t.created_at DESC
      LIMIT 100
    `).all(req.userId, req.userId);

    res.json({ transfers });
  } catch (err) {
    console.error('Get transfer history error:', err);
    res.status(500).json({ error: 'Failed to fetch transfer history' });
  }
});

module.exports = router;
