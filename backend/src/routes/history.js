const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, type, game, description, wager, pot, result, pkr_amount as pkrAmount, created_at as createdAt
    FROM transactions
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 100
  `).all(req.userId);

  res.json({ history: rows });
});

module.exports = router;
