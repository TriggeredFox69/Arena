/* ==========================================================================
   ARENAX BACKEND - USDT ROUTES (MOCK)
   Mock USDT buy/withdraw system - generates fake addresses and txn hashes
   Ready to swap for real crypto payment gateway later
   ========================================================================== */

const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// Mock USDT address generator (TRC-20 format)
function generateMockUsdtAddress() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let address = 'T'; // TRC-20 addresses start with T
  for (let i = 0; i < 33; i++) {
    address += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return address;
}

// Mock transaction hash generator
function generateMockTxnHash() {
  const chars = '0123456789abcdef';
  let hash = '0x';
  for (let i = 0; i < 64; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return hash;
}

// Buy AX with USDT (mock)
router.post('/buy', authMiddleware, (req, res) => {
  try {
    const { amountAx } = req.body;

    if (!amountAx || amountAx <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // 1 AX = 0.01 USDT (1 USDT = 100 AX)
    const usdtAmount = amountAx * 0.01;
    const mockAddress = generateMockUsdtAddress();

    // Create pending transaction
    const result = db.prepare(`
      INSERT INTO usdt_transactions (user_id, type, usdt_amount, ax_amount, usdt_address)
      VALUES (?, 'buy', ?, ?, ?)
    `).run(req.userId, usdtAmount, amountAx, mockAddress);

    const txnId = result.lastInsertRowid;

    // Simulate payment confirmation after 10 seconds
    setTimeout(() => {
      try {
        const txnHash = generateMockTxnHash();

        db.transaction(() => {
          // Update transaction
          db.prepare(`
            UPDATE usdt_transactions
            SET status = 'completed', txn_hash = ?
            WHERE id = ?
          `).run(txnHash, txnId);

          // Add AX to user balance
          db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
            .run(amountAx, req.userId);
        })();

        console.log(`[USDT] Mock buy completed: ${amountAx} AX for user ${req.userId}`);
      } catch (err) {
        console.error('[USDT] Mock buy completion error:', err);
      }
    }, 10000);

    res.json({
      success: true,
      txnId,
      amountAx,
      usdtAmount,
      paymentAddress: mockAddress,
      message: 'Send USDT to the address above. Your AX will be credited within 10 seconds.'
    });
  } catch (err) {
    console.error('USDT buy error:', err);
    res.status(500).json({ error: 'Failed to initiate purchase' });
  }
});

// Withdraw AX to USDT (mock)
router.post('/withdraw', authMiddleware, (req, res) => {
  try {
    const { amountAx, usdtAddress } = req.body;

    if (!amountAx || amountAx <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!usdtAddress || !usdtAddress.startsWith('T')) {
      return res.status(400).json({ error: 'Invalid USDT address (TRC-20 required)' });
    }

    // Check balance
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);
    if (user.balance < amountAx) {
      return res.status(400).json({ error: 'Insufficient AX balance' });
    }

    const usdtAmount = amountAx * 0.01;

    // Create pending withdrawal
    db.transaction(() => {
      // Deduct AX from balance
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?')
        .run(amountAx, req.userId);

      // Create transaction record
      db.prepare(`
        INSERT INTO usdt_transactions (user_id, type, usdt_amount, ax_amount, usdt_address)
        VALUES (?, 'withdraw', ?, ?, ?)
      `).run(req.userId, usdtAmount, amountAx, usdtAddress);
    })();

    res.json({
      success: true,
      message: 'Withdrawal request submitted. USDT will be sent to your address within 24 hours.',
      amountAx,
      usdtAmount,
      usdtAddress
    });
  } catch (err) {
    console.error('USDT withdraw error:', err);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  }
});

// Get USDT transaction history
router.get('/history', authMiddleware, (req, res) => {
  try {
    const transactions = db.prepare(`
      SELECT * FROM usdt_transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.userId);

    res.json({ transactions });
  } catch (err) {
    console.error('USDT history error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
