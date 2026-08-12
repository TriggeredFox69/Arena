/* ==========================================================================
   ARENAX - TOKEN TRANSFERS ROUTES (Supabase / Netlify Functions)
   P2P token transfers between users by UID.
   ========================================================================== */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

function errorRes(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

// POST /api/transfers/send — send AX tokens to another user
router.post('/send', async (req, res) => {
  try {
    const { toUid, amount, message } = req.body;

    if (!toUid || !amount || amount <= 0) {
      return errorRes(res, 'Invalid recipient UID or amount');
    }

    if (amount < 1) return errorRes(res, 'Minimum transfer is 1 AX');

    if (toUid === req.userId) {
      return errorRes(res, 'Cannot send to yourself');
    }

    // Check recipient exists
    const { data: recipient, error: recipErr } = await supabaseAdmin
      .from('users')
      .select('id, username')
      .eq('id', toUid)
      .single();

    if (recipErr || !recipient) return errorRes(res, 'User not found', 404);

    // Check sender balance
    const { data: sender, error: senderErr } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', req.userId)
      .single();

    if (senderErr || !sender) return errorRes(res, 'Sender not found', 404);

    if (sender.balance < amount) {
      return errorRes(res, 'Insufficient balance');
    }

    // Atomic transfer: deduct sender, credit recipient, record transfer
    const { error: deductErr } = await supabaseAdmin
      .from('users')
      .update({ balance: sender.balance - amount })
      .eq('id', req.userId);

    if (deductErr) throw deductErr;

    const { data: recipData, error: creditErr } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', toUid)
      .single();

    if (creditErr) throw creditErr;

    const { error: addErr } = await supabaseAdmin
      .from('users')
      .update({ balance: recipData.balance + amount })
      .eq('id', toUid);

    if (addErr) throw addErr;

    // Record the transfer
    const { error: recordErr } = await supabaseAdmin
      .from('transfers')
      .insert({
        from_user_id: req.userId,
        to_user_id: toUid,
        amount_ax: amount,
        message: message || null
      });

    if (recordErr) throw recordErr;

    return res.json({
      success: true,
      message: `Sent ${amount} AX to ${recipient.username}`,
      newBalance: sender.balance - amount
    });
  } catch (err) {
    console.error('Send transfer error:', err);
    return errorRes(res, 'Failed to send transfer', 500);
  }
});

// GET /api/transfers/history — transfer history (sent and received)
router.get('/history', async (req, res) => {
  try {
    // Sent transfers
    const { data: sent, error: sentErr } = await supabaseAdmin
      .from('transfers')
      .select(`
        id, from_user_id, to_user_id, amount_ax, message, created_at,
        to_user:to_user_id(username)
      `)
      .eq('from_user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (sentErr) throw sentErr;

    // Received transfers
    const { data: received, error: recvErr } = await supabaseAdmin
      .from('transfers')
      .select(`
        id, from_user_id, to_user_id, amount_ax, message, created_at,
        from_user:from_user_id(username)
      `)
      .eq('to_user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (recvErr) throw recvErr;

    const format = (row, direction) => ({
      id: row.id,
      direction,
      amount: row.amount_ax,
      message: row.message,
      createdAt: row.created_at,
      counterparty: direction === 'sent'
        ? (Array.isArray(row.to_user) ? row.to_user[0]?.username : row.to_user?.username)
        : (Array.isArray(row.from_user) ? row.from_user[0]?.username : row.from_user?.username),
      counterpartyId: direction === 'sent' ? row.to_user_id : row.from_user_id
    });

    const transfers = [
      ...(sent || []).map(r => format(r, 'sent')),
      ...(received || []).map(r => format(r, 'received'))
    ];

    return res.json({ success: true, transfers });
  } catch (err) {
    console.error('Transfer history error:', err);
    return errorRes(res, 'Failed to fetch transfer history', 500);
  }
});

module.exports = router;
