/* ==========================================================================
   ARENAX BACKEND - FRIENDS ROUTES
   Add friends, accept requests, list friends, block users
   ========================================================================== */

const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// Add friend by UID
router.post('/add', authMiddleware, (req, res) => {
  try {
    const { friendUid } = req.body;

    if (!friendUid || isNaN(friendUid)) {
      return res.status(400).json({ error: 'Invalid UID' });
    }

    const friendId = parseInt(friendUid);

    // Check if friend exists
    const friend = db.prepare('SELECT id, username FROM users WHERE id = ?').get(friendId);
    if (!friend) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Can't add yourself
    if (friendId === req.userId) {
      return res.status(400).json({ error: 'Cannot add yourself as friend' });
    }

    // Check if already friends or pending
    const existing = db.prepare(`
      SELECT status FROM friends
      WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
    `).get(req.userId, friendId, friendId, req.userId);

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Already friends' });
      } else if (existing.status === 'pending') {
        return res.status(400).json({ error: 'Friend request already sent' });
      } else if (existing.status === 'blocked') {
        return res.status(400).json({ error: 'Cannot add this user' });
      }
    }

    // Insert friend request
    db.prepare(`
      INSERT INTO friends (user_id, friend_id, status)
      VALUES (?, ?, 'pending')
    `).run(req.userId, friendId);

    res.json({
      success: true,
      message: 'Friend request sent',
      friend: { id: friend.id, username: friend.username }
    });
  } catch (err) {
    console.error('Add friend error:', err);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

// Accept friend request
router.post('/accept', authMiddleware, (req, res) => {
  try {
    const { friendId } = req.body;

    // Find the pending request
    const request = db.prepare(`
      SELECT * FROM friends
      WHERE user_id = ? AND friend_id = ? AND status = 'pending'
    `).get(friendId, req.userId);

    if (!request) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    // Update to accepted
    db.prepare(`
      UPDATE friends SET status = 'accepted' WHERE id = ?
    `).run(request.id);

    // Create reciprocal friendship
    db.prepare(`
      INSERT INTO friends (user_id, friend_id, status)
      VALUES (?, ?, 'accepted')
    `).run(req.userId, friendId);

    res.json({ success: true, message: 'Friend request accepted' });
  } catch (err) {
    console.error('Accept friend error:', err);
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

// Decline friend request
router.post('/decline', authMiddleware, (req, res) => {
  try {
    const { friendId } = req.body;

    db.prepare(`
      DELETE FROM friends
      WHERE user_id = ? AND friend_id = ? AND status = 'pending'
    `).run(friendId, req.userId);

    res.json({ success: true, message: 'Friend request declined' });
  } catch (err) {
    console.error('Decline friend error:', err);
    res.status(500).json({ error: 'Failed to decline friend request' });
  }
});

// List all friends
router.get('/list', authMiddleware, (req, res) => {
  try {
    const friends = db.prepare(`
      SELECT u.id, u.username, u.wins, u.losses, f.status, f.created_at
      FROM friends f
      JOIN users u ON f.friend_id = u.id
      WHERE f.user_id = ? AND f.status = 'accepted'
      ORDER BY u.username
    `).all(req.userId);

    res.json({ friends });
  } catch (err) {
    console.error('List friends error:', err);
    res.status(500).json({ error: 'Failed to list friends' });
  }
});

// List pending friend requests (incoming)
router.get('/requests', authMiddleware, (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT u.id, u.username, f.created_at
      FROM friends f
      JOIN users u ON f.user_id = u.id
      WHERE f.friend_id = ? AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `).all(req.userId);

    res.json({ requests });
  } catch (err) {
    console.error('List requests error:', err);
    res.status(500).json({ error: 'Failed to list friend requests' });
  }
});

// Block user
router.post('/block', authMiddleware, (req, res) => {
  try {
    const { friendId } = req.body;

    // Delete any existing friendship
    db.prepare(`
      DELETE FROM friends
      WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
    `).run(req.userId, friendId, friendId, req.userId);

    // Insert blocked status
    db.prepare(`
      INSERT INTO friends (user_id, friend_id, status)
      VALUES (?, ?, 'blocked')
    `).run(req.userId, friendId);

    res.json({ success: true, message: 'User blocked' });
  } catch (err) {
    console.error('Block user error:', err);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// Remove friend
router.post('/remove', authMiddleware, (req, res) => {
  try {
    const { friendId } = req.body;

    // Delete both directions
    db.prepare(`
      DELETE FROM friends
      WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
    `).run(req.userId, friendId, friendId, req.userId);

    res.json({ success: true, message: 'Friend removed' });
  } catch (err) {
    console.error('Remove friend error:', err);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

module.exports = router;
