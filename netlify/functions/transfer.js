/* ==========================================================================
   ARENAX - Standalone Netlify Function: AX Token Transfer
   POST /.netlify/functions/transfer
   Body: { fromUserId, toUid, amount }
   Auth: Bearer token in Authorization header OR jwtToken in body
   
   Accepts BOTH:
     1. Custom JWT (arenax_token from localStorage)
     2. Supabase access token (from sb.auth.getSession())
   
   Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS for balance updates.
   ========================================================================== */

const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

function jsonRes(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

async function resolveUser(sb, uidStr) {
  const norm = String(uidStr || '').trim();
  if (!norm) return null;

  // Exact match on id (full UUID)
  const { data: r1 } = await sb.from('users').select('id, username, balance').eq('id', norm).maybeSingle();
  if (r1) return r1;

  // Exact match on uid column
  const { data: r2 } = await sb.from('users').select('id, username, balance').ilike('uid', norm).maybeSingle();
  if (r2) return r2;

  // Short UID prefix match: AX + hex prefix → UUID starts with hex prefix
  if (/^AX[0-9A-Fa-f]+$/i.test(norm)) {
    const hexPrefix = norm.slice(2).toLowerCase();
    const { data: r3 } = await sb.from('users').select('id, username, balance').ilike('id', hexPrefix + '%').maybeSingle();
    if (r3) return r3;
  }

  return null;
}

exports.handler = async (event) => {
  // Handle preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return jsonRes(200, {});
  }

  if (event.httpMethod !== 'POST') {
    return jsonRes(405, { success: false, error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[transfer] Missing SUPABASE_URL or SERVICE_KEY env vars');
    return jsonRes(500, { success: false, error: 'Server configuration error' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonRes(400, { success: false, error: 'Invalid JSON body' });
  }

  const { toUid, amount, jwtToken, supabaseToken, fromUserId } = body;
  const numAmount = Number(amount);

  if (!toUid || !numAmount || numAmount < 1) {
    return jsonRes(400, { success: false, error: 'Invalid recipient UID or amount (minimum 1 AX)' });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // ---- Identify the sender ----
  let senderId = null;

  // Method 1: Verify custom JWT (arenax_token)
  if (jwtToken && JWT_SECRET) {
    try {
      const decoded = jwt.verify(jwtToken, JWT_SECRET);
      if (decoded && decoded.id) senderId = decoded.id;
    } catch (e) {
      console.warn('[transfer] Custom JWT invalid:', e.message);
    }
  }

  // Method 2: Verify Supabase access token
  if (!senderId && supabaseToken) {
    try {
      const { data: { user }, error } = await sb.auth.getUser(supabaseToken);
      if (!error && user) senderId = user.id;
    } catch (e) {
      console.warn('[transfer] Supabase token verify failed:', e.message);
    }
  }

  // Method 3: Trust fromUserId if provided (used as fallback — we verify by checking DB)
  if (!senderId && fromUserId) {
    // Verify this user actually exists
    const { data: existsCheck } = await sb.from('users').select('id').eq('id', fromUserId).maybeSingle();
    if (existsCheck) senderId = fromUserId;
  }

  if (!senderId) {
    return jsonRes(401, { success: false, error: 'Authentication required. Please log in again.' });
  }

  try {
    // Resolve recipient
    const recipient = await resolveUser(sb, toUid);
    if (!recipient) {
      return jsonRes(404, { success: false, error: `Recipient "${toUid}" not found. Check the UID.` });
    }
    if (recipient.id === senderId) {
      return jsonRes(400, { success: false, error: 'Cannot send AX to yourself.' });
    }

    // Get sender balance from DB (source of truth)
    const { data: sender, error: senderErr } = await sb
      .from('users').select('balance, username').eq('id', senderId).single();
    if (senderErr || !sender) {
      return jsonRes(404, { success: false, error: 'Sender account not found in database.' });
    }

    const senderBalance = Number(sender.balance || 0);
    if (senderBalance < numAmount) {
      return jsonRes(400, {
        success: false,
        error: `Insufficient balance. You have ${senderBalance.toLocaleString()} AX, tried to send ${numAmount.toLocaleString()} AX.`
      });
    }

    const newSenderBalance = senderBalance - numAmount;
    const newRecipBalance = Number(recipient.balance || 0) + numAmount;

    // Deduct sender
    const { error: deductErr } = await sb
      .from('users').update({ balance: newSenderBalance }).eq('id', senderId);
    if (deductErr) {
      console.error('[transfer] Deduct sender failed:', deductErr);
      throw deductErr;
    }

    // Credit recipient
    const { error: creditErr } = await sb
      .from('users').update({ balance: newRecipBalance }).eq('id', recipient.id);
    if (creditErr) {
      // Rollback sender deduction
      await sb.from('users').update({ balance: senderBalance }).eq('id', senderId).catch(() => {});
      console.error('[transfer] Credit recipient failed:', creditErr);
      throw creditErr;
    }

    // Record transfer (non-fatal)
    try {
      await sb.from('transfers').insert({
        from_user_id: senderId,
        to_user_id: recipient.id,
        amount_ax: numAmount,
        message: body.message || null
      });
    } catch (_) {}

    console.log(`[transfer] ✓ ${senderId} → ${recipient.id} : ${numAmount} AX | sender: ${newSenderBalance} | recip: ${newRecipBalance}`);

    return jsonRes(200, {
      success: true,
      message: `Sent ${numAmount} AX to ${recipient.username}`,
      newBalance: newSenderBalance,
      recipientUsername: recipient.username
    });

  } catch (err) {
    console.error('[transfer] Unexpected error:', err.message || err);
    return jsonRes(500, { success: false, error: 'Transfer failed: ' + (err.message || 'Unknown error') });
  }
};
