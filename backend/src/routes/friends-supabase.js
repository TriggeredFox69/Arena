/* ==========================================================================
   ARENAX - FRIENDS ROUTES (Supabase / Netlify Functions)
   Add friends, accept requests, block users, friend list.
   ========================================================================== */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

function errorRes(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

// GET /api/friends/list — accepted friends with profile info
router.get('/list', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('friends')
      .select(`
        id,
        status,
        created_at,
        friend:friend_id(id, username, wins, losses)
      `)
      .eq('user_id', req.userId)
      .eq('status', 'accepted');

    if (error) throw error;

    const friends = (data || []).map(row => ({
      id: row.friend?.id,
      username: row.friend?.username || 'Unknown',
      wins: row.friend?.wins || 0,
      losses: row.friend?.losses || 0,
      since: row.created_at
    }));

    return res.json({ success: true, friends });
  } catch (err) {
    console.error('Friends list error:', err);
    return errorRes(res, 'Failed to fetch friends list', 500);
  }
});

// GET /api/friends/requests — incoming pending friend requests
router.get('/requests', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('friends')
      .select(`
        id,
        created_at,
        sender:user_id(id, username, wins, losses)
      `)
      .eq('friend_id', req.userId)
      .eq('status', 'pending');

    if (error) throw error;

    const requests = (data || []).map(row => ({
      id: row.id,
      from: {
        id: row.sender?.id,
        username: row.sender?.username || 'Unknown',
        wins: row.sender?.wins || 0,
        losses: row.sender?.losses || 0
      },
      since: row.created_at
    }));

    return res.json({ success: true, requests });
  } catch (err) {
    console.error('Friend requests error:', err);
    return errorRes(res, 'Failed to fetch requests', 500);
  }
});

// POST /api/friends/add — send a friend request
router.post('/add', async (req, res) => {
  try {
    const { friendUid } = req.body;

    if (!friendUid) return errorRes(res, 'Friend UID is required');

    if (friendUid === req.userId) {
      return errorRes(res, 'Cannot add yourself as a friend');
    }

    // Check recipient exists
    const { data: friend, error: findErr } = await supabaseAdmin
      .from('users')
      .select('id, username')
      .eq('id', friendUid)
      .single();

    if (findErr || !friend) return errorRes(res, 'User not found', 404);

    // Check for existing relationship (any direction, any status)
    const { data: existing, error: checkErr } = await supabaseAdmin
      .from('friends')
      .select('id, status, user_id, friend_id')
      .or(`and(user_id.eq.${req.userId},friend_id.eq.${friendUid}),and(user_id.eq.${friendUid},friend_id.eq.${req.userId})`)
      .maybeSingle();

    if (checkErr) throw checkErr;

    if (existing) {
      if (existing.status === 'accepted') return errorRes(res, 'Already friends');
      if (existing.status === 'pending') {
        if (existing.user_id === req.userId) return errorRes(res, 'Friend request already sent');
        // Other user already sent a request — auto-accept
        const { error: acceptErr } = await supabaseAdmin
          .from('friends')
          .update({ status: 'accepted' })
          .eq('id', existing.id);

        if (acceptErr) throw acceptErr;
        return res.json({ success: true, message: 'Friend request accepted! You are now friends.' });
      }
      if (existing.status === 'blocked') return errorRes(res, 'Cannot add this user');
    }

    // Insert pending request
    const { error: insertErr } = await supabaseAdmin
      .from('friends')
      .insert({ user_id: req.userId, friend_id: friendUid, status: 'pending' });

    if (insertErr) throw insertErr;

    return res.json({ success: true, message: 'Friend request sent' });
  } catch (err) {
    console.error('Add friend error:', err);
    return errorRes(res, 'Failed to send friend request', 500);
  }
});

// POST /api/friends/accept — accept a friend request
router.post('/accept', async (req, res) => {
  try {
    const { friendUid } = req.body;

    if (!friendUid) return errorRes(res, 'Friend UID is required');

    // Find the pending request where the other user sent to us
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('friends')
      .select('id, status')
      .eq('user_id', friendUid)
      .eq('friend_id', req.userId)
      .eq('status', 'pending')
      .maybeSingle();

    if (findErr) throw findErr;
    if (!existing) return errorRes(res, 'No pending request from this user', 404);

    // Accept the request
    const { error: updateErr } = await supabaseAdmin
      .from('friends')
      .update({ status: 'accepted' })
      .eq('id', existing.id);

    if (updateErr) throw updateErr;

    // Insert reciprocal row so both directions show up
    const { error: reciprocalErr } = await supabaseAdmin
      .from('friends')
      .insert({ user_id: req.userId, friend_id: friendUid, status: 'accepted' });

    if (reciprocalErr) {
      // Non-fatal — the first row is already accepted. Log and continue.
      console.warn('Reciprocal friend insert warning:', reciprocalErr);
    }

    return res.json({ success: true, message: 'Friend request accepted' });
  } catch (err) {
    console.error('Accept friend error:', err);
    return errorRes(res, 'Failed to accept request', 500);
  }
});

// POST /api/friends/decline — decline/reject a friend request
router.post('/decline', async (req, res) => {
  try {
    const { friendUid } = req.body;

    if (!friendUid) return errorRes(res, 'Friend UID is required');

    const { error } = await supabaseAdmin
      .from('friends')
      .delete()
      .eq('user_id', friendUid)
      .eq('friend_id', req.userId)
      .eq('status', 'pending');

    if (error) throw error;

    return res.json({ success: true, message: 'Friend request declined' });
  } catch (err) {
    console.error('Decline friend error:', err);
    return errorRes(res, 'Failed to decline request', 500);
  }
});

// POST /api/friends/remove — unfriend (delete both directions)
router.post('/remove', async (req, res) => {
  try {
    const { friendUid } = req.body;

    if (!friendUid) return errorRes(res, 'Friend UID is required');

    // Delete both directions regardless of status
    const { error } = await supabaseAdmin
      .from('friends')
      .delete()
      .or(`and(user_id.eq.${req.userId},friend_id.eq.${friendUid}),and(user_id.eq.${friendUid},friend_id.eq.${req.userId})`);

    if (error) throw error;

    return res.json({ success: true, message: 'Friend removed' });
  } catch (err) {
    console.error('Remove friend error:', err);
    return errorRes(res, 'Failed to remove friend', 500);
  }
});

// POST /api/friends/block — block a user
router.post('/block', async (req, res) => {
  try {
    const { friendUid } = req.body;

    if (!friendUid) return errorRes(res, 'Friend UID is required');

    if (friendUid === req.userId) return errorRes(res, 'Cannot block yourself');

    // Delete any existing relationship
    await supabaseAdmin
      .from('friends')
      .delete()
      .or(`and(user_id.eq.${req.userId},friend_id.eq.${friendUid}),and(user_id.eq.${friendUid},friend_id.eq.${req.userId})`);

    // Insert block row
    const { error } = await supabaseAdmin
      .from('friends')
      .insert({ user_id: req.userId, friend_id: friendUid, status: 'blocked' });

    if (error) throw error;

    return res.json({ success: true, message: 'User blocked' });
  } catch (err) {
    console.error('Block friend error:', err);
    return errorRes(res, 'Failed to block user', 500);
  }
});

module.exports = router;
