/* ==========================================================================
   ARENAX - CHAT ROUTES (Supabase / Netlify Functions)
   Save chat messages, retrieve history, emoji reactions.
   ========================================================================== */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

function errorRes(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

// GET /api/chat/:gameId — chat history for a game
router.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .select('id, user_id, game_id, message, emoji_reaction, created_at, users!inner(username)')
      .eq('game_id', gameId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) throw error;

    const messages = (data || []).map(msg => ({
      id: msg.id,
      userId: msg.user_id,
      gameId: msg.game_id,
      message: msg.message,
      emojiReaction: msg.emoji_reaction,
      createdAt: msg.created_at,
      username: Array.isArray(msg.users) ? msg.users[0]?.username : (msg.users?.username || 'Unknown')
    }));

    return res.json({ success: true, messages });
  } catch (err) {
    console.error('Get chat error:', err);
    return errorRes(res, 'Failed to fetch chat messages', 500);
  }
});

// POST /api/chat/send — send a chat message
router.post('/send', async (req, res) => {
  try {
    const { gameId, message } = req.body;

    if (!gameId || !message) {
      return errorRes(res, 'gameId and message are required');
    }

    if (message.length > 500) {
      return errorRes(res, 'Message too long (max 500 characters)');
    }

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        user_id: req.userId,
        game_id: gameId,
        message: message.trim()
      })
      .select('id, user_id, game_id, message, emoji_reaction, created_at')
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      message: {
        id: data.id,
        userId: data.user_id,
        gameId: data.game_id,
        message: data.message,
        emojiReaction: data.emoji_reaction,
        createdAt: data.created_at,
        username: req.user.username
      }
    });
  } catch (err) {
    console.error('Send chat error:', err);
    return errorRes(res, 'Failed to send message', 500);
  }
});

// POST /api/chat/:messageId/react — add emoji reaction
router.post('/:messageId/react', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) return errorRes(res, 'Emoji is required');

    // Verify the message belongs to this game/context and user can react
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('chat_messages')
      .select('id')
      .eq('id', messageId)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!existing) return errorRes(res, 'Message not found', 404);

    const { error } = await supabaseAdmin
      .from('chat_messages')
      .update({ emoji_reaction: emoji })
      .eq('id', messageId);

    if (error) throw error;

    return res.json({ success: true, message: 'Reaction added' });
  } catch (err) {
    console.error('Add reaction error:', err);
    return errorRes(res, 'Failed to add reaction', 500);
  }
});

module.exports = router;
