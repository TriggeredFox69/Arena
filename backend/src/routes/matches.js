const express = require('express');
const db = require('../db');
const { TOKEN_RATE } = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const GAME_TITLES = {
  carrom: 'Carrom Clash',
  ludo: 'Ludo Duel',
  solitaire: 'Speed Solitaire',
  glowhockey: 'Glow Hockey',
  chess: 'Chess Royale',
  checkers: 'Checkers Pro',
  snooker: 'Snooker Elite',
  pool: 'Pool 8-Ball',
  darts: 'Dart Master'
};

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Start a match: validate wager, debit balance, create an active match record
router.post('/start', (req, res) => {
  const { gameKey, wager, mode } = req.body || {};
  const wagerAmt = parseInt(wager, 10);

  if (!GAME_TITLES[gameKey]) return res.status(400).json({ error: 'Unknown game.' });
  if (!wagerAmt || wagerAmt <= 0 || wagerAmt > 10000) return res.status(400).json({ error: 'Invalid wager amount.' });
  if (mode !== 'ai' && mode !== 'pvp') return res.status(400).json({ error: 'Invalid game mode.' });

  const user = getUser(req.userId);
  if (user.balance < wagerAmt) return res.status(400).json({ error: 'Insufficient AX Token balance! Deposit PKR to continue.' });

  const pot = wagerAmt * 2;
  const newBalance = user.balance - wagerAmt;

  let matchId;
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = ?, total_wagered = total_wagered + ? WHERE id = ?')
      .run(newBalance, wagerAmt, user.id);

    const info = db.prepare(`
      INSERT INTO matches (user_id, game_key, mode, wager, pot, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(user.id, gameKey, mode, wagerAmt, pot);
    matchId = info.lastInsertRowid;

    db.prepare(`
      INSERT INTO transactions (user_id, type, game, description, wager, pot, result)
      VALUES (?, 'wager', ?, ?, ?, ?, 'ACTIVE')
    `).run(user.id, GAME_TITLES[gameKey], `${GAME_TITLES[gameKey]} Wager`, wagerAmt, pot);
  });
  tx();

  res.status(201).json({ matchId, balance: newBalance, pot, wager: wagerAmt, gameTitle: GAME_TITLES[gameKey] });
});

// Settle a match: credit pot if won, record final result
router.post('/:id/settle', (req, res) => {
  const matchId = parseInt(req.params.id, 10);
  const { userWon, winner } = req.body || {};

  const match = db.prepare('SELECT * FROM matches WHERE id = ? AND user_id = ?').get(matchId, req.userId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (match.status === 'settled') return res.status(409).json({ error: 'Match already settled.' });

  const user = getUser(req.userId);
  const isWin = !!userWon;
  let newBalance = user.balance;

  const tx = db.transaction(() => {
    if (isWin) {
      newBalance = user.balance + match.pot;
      db.prepare('UPDATE users SET balance = ?, wins = wins + 1, total_won = total_won + ? WHERE id = ?')
        .run(newBalance, match.pot, user.id);
    } else {
      db.prepare('UPDATE users SET losses = losses + 1 WHERE id = ?').run(user.id);
    }

    db.prepare(`UPDATE matches SET status = 'settled', result = ?, settled_at = datetime('now') WHERE id = ?`)
      .run(isWin ? 'WIN' : 'LOSS', matchId);

    db.prepare(`
      INSERT INTO transactions (user_id, type, game, description, wager, pot, result)
      VALUES (?, 'settlement', ?, ?, ?, ?, ?)
    `).run(user.id, GAME_TITLES[match.game_key] || match.game_key, winner ? `Winner: ${winner}` : null,
      match.wager, isWin ? match.pot : 0, isWin ? 'WIN' : 'LOSS');
  });
  tx();

  res.json({
    balance: newBalance,
    isWin,
    pot: match.pot,
    pkrWon: isWin ? match.pot * TOKEN_RATE : 0
  });
});

module.exports = router;
