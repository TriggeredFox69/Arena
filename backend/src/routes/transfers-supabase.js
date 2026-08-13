/* ==========================================================================
   ARENAX - TOKEN TRANSFERS ROUTES (Supabase / Netlify Functions)
   P2P token transfers between users by UID.
   Uses supabaseAdmin (service role key) to bypass RLS.
   ========================================================================== */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

function errorRes(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

/**
 * Resolve a short or full UID to a users table row.
 * Short UIDs are "AX" + first 6 hex chars of UUID (dashes removed).
 * e.g. AXA3637A → hex prefix = a3637a → UUID id starts with "a3637a"
 */
async function resolveUser(uidStr) {
  const norm = String(uidStr || '').trim();
  if (!norm) return null;

  console.log('[resolveUser] Looking up:', norm);

  // Strategy 1: exact match on id column (full UUID)
  const { data: r1 } = await supabaseAdmin
    .from('users').select('id, username, balance').eq('id', norm).maybeSingle();
  if (r1) { console.log('[resolveUser] Found by id:', r1.id); return r1; }

  // Strategy 2: exact match on uid column
  const { data: r2 } = await supabaseAdmin
    .from('users').select('id, username, balance').ilike('uid', norm).maybeSingle();
  if (r2) { console.log('[resolveUser] Found by uid col:', r2.id); return r2; }

  // Strategy 3: UUID prefix match — cast id to text for ILIKE
  // Short UID: AX + first 6 hex chars of UUID (dashes stripped)
  // AXA3637A → hexPrefix = "a3637a" → UUID starts with "a3637a"
  if (/^AX[0-9A-Fa-f]+$/i.test(norm)) {
    const hexPrefix = norm.slice(2).toLowerCase(); // e.g. "a3637a"
    console.log('[resolveUser] Trying UUID prefix:', hexPrefix);

    // Use filter with ::text cast so ILIKE works on UUID column
    const { data: r3, error: e3 } = await supabaseAdmin
      .from('users')
      .select('id, username, balance')
      .filter('id::text', 'ilike', hexPrefix + '%')
      .maybeSingle();
    if (r3) { console.log('[resolveUser] Found by UUID prefix:', r3.id); return r3; }
    if (e3) console.warn('[resolveUser] UUID prefix query error:', e3.message);

    // Strategy 3b: try fetching all and filter in JS (fallback for strict PostgREST)
    const { data: allRows } = await supabaseAdmin
      .from('users')
      .select('id, username, balance')
      .limit(1000);
    if (allRows) {
      const match = allRows.find(r => r.id && r.id.replace(/-/g, '').startsWith(hexPrefix));
      if (match) { console.log('[resolveUser] Found by JS prefix scan:', match.id); return match; }
    }
  }

  console.warn('[resolveUser] No user found for UID:', norm);
  return null;
}


// POST /api/transfers/send — send AX tokens to another user by short or full UID
router.post('/send', async (req, res) => {
  try {
    const { toUid, amount, message } = req.body;

    if (!toUid || !amount || Number(amount) <= 0) {
      return errorRes(res, 'Invalid recipient UID or amount');
    }
    if (Number(amount) < 1) return errorRes(res, 'Minimum transfer is 1 AX');

    const numAmount = Number(amount);

    // Resolve recipient
    const recipientRow = await resolveUser(toUid);
    if (!recipientRow) return errorRes(res, 'Recipient user not found', 404);
    if (recipientRow.id === req.userId) return errorRes(res, 'Cannot send to yourself');

    // Get fresh sender balance from DB
    const { data: sender, error: senderErr } = await supabaseAdmin
      .from('users').select('balance').eq('id', req.userId).single();

    if (senderErr || !sender) return errorRes(res, 'Sender not found', 404);

    const senderBalance = Number(sender.balance || 0);
    if (senderBalance < numAmount) {
      return errorRes(res, `Insufficient balance. You have ${senderBalance} AX`);
    }

    const newSenderBalance = senderBalance - numAmount;
    const newRecipBalance = Number(recipientRow.balance || 0) + numAmount;

    // Deduct from sender
    const { error: deductErr } = await supabaseAdmin
      .from('users').update({ balance: newSenderBalance }).eq('id', req.userId);
    if (deductErr) throw deductErr;

    // Credit recipient
    const { error: creditErr } = await supabaseAdmin
      .from('users').update({ balance: newRecipBalance }).eq('id', recipientRow.id);
    if (creditErr) {
      // Rollback sender deduction on failure
      await supabaseAdmin.from('users').update({ balance: senderBalance }).eq('id', req.userId).catch(() => {});
      throw creditErr;
    }

    // Record transfer (non-fatal — transfers table may not exist in all envs)
    try {
      await supabaseAdmin.from('transfers').insert({
        from_user_id: req.userId,
        to_user_id: recipientRow.id,
        amount_ax: numAmount,
        message: message || null
      });
    } catch (_) {}

    console.log(`[transfer] ${req.userId} → ${recipientRow.id} : ${numAmount} AX`);

    return res.json({
      success: true,
      message: `Sent ${numAmount} AX to ${recipientRow.username}`,
      newBalance: newSenderBalance,
      recipientUsername: recipientRow.username
    });
  } catch (err) {
    console.error('Send transfer error:', err);
    return errorRes(res, 'Failed to send transfer', 500);
  }
});

// GET /api/transfers/history — transfer history (sent and received)
router.get('/history', async (req, res) => {
  try {
    const { data: sent, error: sentErr } = await supabaseAdmin
      .from('transfers')
      .select('id, from_user_id, to_user_id, amount_ax, message, created_at, to_user:to_user_id(username)')
      .eq('from_user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (sentErr) throw sentErr;

    const { data: received, error: recvErr } = await supabaseAdmin
      .from('transfers')
      .select('id, from_user_id, to_user_id, amount_ax, message, created_at, from_user:from_user_id(username)')
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
