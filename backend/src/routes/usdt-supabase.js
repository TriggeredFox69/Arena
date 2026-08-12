/* ==========================================================================
   ARENAX - USDT ROUTES (Supabase / Netlify Functions)
   Mock USDT buy/withdraw. Produces fake addresses and tx hashes.
   Ready to swap for real crypto payment gateway later.
   No setTimeout — completes instantly (serverless-safe).
   ========================================================================== */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

function errorRes(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

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

// POST /api/usdt/buy — Buy AX with USDT (mock)
router.post('/buy', async (req, res) => {
  try {
    const { amountAx } = req.body;

    if (!amountAx || amountAx <= 0) {
      return errorRes(res, 'Invalid amount');
    }

    // 1 AX = 0.01 USDT (1 USDT = 100 AX)
    const usdtAmount = parseFloat((amountAx * 0.01).toFixed(2));
    const mockAddress = generateMockUsdtAddress();
    const mockTxnHash = generateMockTxnHash();

    // Insert the transaction (completed instantly — no setTimeout)
    const { data: txn, error: insertErr } = await supabaseAdmin
      .from('usdt_transactions')
      .insert({
        user_id: req.userId,
        type: 'buy',
        usdt_amount: usdtAmount,
        ax_amount: amountAx,
        usdt_address: mockAddress,
        txn_hash: mockTxnHash,
        status: 'completed'
      })
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    // Credit the user's balance
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', req.userId)
      .single();

    if (userErr || !user) return errorRes(res, 'User not found', 404);

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ balance: user.balance + amountAx })
      .eq('id', req.userId);

    if (updateErr) throw updateErr;

    return res.json({
      success: true,
      message: `Purchased ${amountAx} AX successfully`,
      paymentAddress: mockAddress,
      txnHash: mockTxnHash,
      usdtAmount,
      axAmount: amountAx,
      newBalance: user.balance + amountAx
    });
  } catch (err) {
    console.error('USDT buy error:', err);
    return errorRes(res, 'Failed to process purchase', 500);
  }
});

// POST /api/usdt/withdraw — Withdraw AX for USDT (mock)
router.post('/withdraw', async (req, res) => {
  try {
    const { amountAx, usdtAddress } = req.body;

    if (!amountAx || amountAx <= 0) {
      return errorRes(res, 'Invalid amount');
    }

    if (!usdtAddress) {
      return errorRes(res, 'USDT withdrawal address is required');
    }

    // Check balance
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', req.userId)
      .single();

    if (userErr || !user) return errorRes(res, 'User not found', 404);

    if (user.balance < amountAx) {
      return errorRes(res, 'Insufficient balance');
    }

    const usdtAmount = parseFloat((amountAx * 0.01).toFixed(2));
    const mockTxnHash = generateMockTxnHash();

    // Deduct balance
    const { error: deductErr } = await supabaseAdmin
      .from('users')
      .update({ balance: user.balance - amountAx })
      .eq('id', req.userId);

    if (deductErr) throw deductErr;

    // Record the withdrawal
    const { error: insertErr } = await supabaseAdmin
      .from('usdt_transactions')
      .insert({
        user_id: req.userId,
        type: 'withdraw',
        usdt_amount: usdtAmount,
        ax_amount: amountAx,
        usdt_address: usdtAddress,
        txn_hash: mockTxnHash,
        status: 'completed'
      });

    if (insertErr) throw insertErr;

    return res.json({
      success: true,
      message: `Withdrawn ${amountAx} AX successfully`,
      txnHash: mockTxnHash,
      usdtAmount,
      axAmount: amountAx,
      newBalance: user.balance - amountAx
    });
  } catch (err) {
    console.error('USDT withdraw error:', err);
    return errorRes(res, 'Failed to process withdrawal', 500);
  }
});

// GET /api/usdt/history — transaction history
router.get('/history', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('usdt_transactions')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    const transactions = (data || []).map(t => ({
      id: t.id,
      type: t.type,
      usdtAmount: t.usdt_amount,
      axAmount: t.ax_amount,
      usdtAddress: t.usdt_address,
      txnHash: t.txn_hash,
      status: t.status,
      createdAt: t.created_at
    }));

    return res.json({ success: true, transactions });
  } catch (err) {
    console.error('USDT history error:', err);
    return errorRes(res, 'Failed to fetch USDT history', 500);
  }
});

module.exports = router;
