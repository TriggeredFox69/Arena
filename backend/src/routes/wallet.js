const express = require('express');
const db = require('../db');
const { TOKEN_RATE } = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const GATEWAY_NAMES = { easypaisa: 'EasyPaisa', jazzcash: 'JazzCash', payfast: 'PayFast Online' };
const WITHDRAW_METHOD_NAMES = { easypaisa: 'EasyPaisa', jazzcash: 'JazzCash', bank: 'Bank IBAN' };

const VALID_DEPOSITS = { 100: 10, 500: 50, 1000: 100, 5000: 500 };

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

router.get('/', (req, res) => {
  const user = getUser(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({
    balance: user.balance,
    tokenRate: TOKEN_RATE,
    pkr: user.balance * TOKEN_RATE
  });
});

router.post('/deposit', (req, res) => {
  const { pkr, gateway } = req.body || {};
  const tokens = VALID_DEPOSITS[pkr];
  if (!tokens) return res.status(400).json({ error: 'Invalid deposit package.' });
  const method = GATEWAY_NAMES[gateway] || 'Online Gateway';

  const user = getUser(req.userId);
  const newBalance = user.balance + tokens;
  const txId = 'TXN_' + Math.floor(100000 + Math.random() * 900000);

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, user.id);
    db.prepare(`
      INSERT INTO transactions (user_id, type, description, pot, result, pkr_amount)
      VALUES (?, 'deposit', ?, ?, 'APPROVED', ?)
    `).run(user.id, `Deposit (${method})`, tokens, pkr);
  });
  tx();

  res.json({
    txId,
    balance: newBalance,
    tokensAdded: tokens,
    pkrPaid: pkr,
    method
  });
});

router.post('/withdraw', (req, res) => {
  const { tokens, method: methodKey, accountNo } = req.body || {};
  const amount = parseInt(tokens, 10);

  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum withdrawal amount is 10 AX Tokens (Rs. 100 PKR).' });
  if (!accountNo || !String(accountNo).trim()) return res.status(400).json({ error: 'Please provide a valid account or mobile number.' });

  const user = getUser(req.userId);
  if (amount > user.balance) return res.status(400).json({ error: 'Insufficient AX Token balance for this withdrawal!' });

  const method = WITHDRAW_METHOD_NAMES[methodKey] || 'Mobile Wallet';
  const pkrAmount = amount * TOKEN_RATE;
  const newBalance = user.balance - amount;
  const txId = 'WD_' + Math.floor(100000 + Math.random() * 900000);

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, user.id);
    db.prepare(`
      INSERT INTO transactions (user_id, type, description, wager, result, pkr_amount)
      VALUES (?, 'withdraw', ?, ?, 'PROCESSED', ?)
    `).run(user.id, `Withdraw (${method})`, amount, pkrAmount);
  });
  tx();

  res.json({
    txId,
    balance: newBalance,
    tokensDeducted: amount,
    pkrSent: pkrAmount,
    method,
    accountNo
  });
});

module.exports = router;
