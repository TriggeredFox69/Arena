/* ==========================================================================
   ARENAX BACKEND - USER ACTIVITY HELPER
   Records user actions to the Supabase user_activity table.
   ========================================================================== */

const { supabaseAdmin } = require('../config/supabase');

const TABLE = 'user_activity';

/**
 * Record a user activity event in Supabase.
 * @param {string} userId - The user's UUID from Supabase.
 * @param {string} action - Short action name, e.g. 'login', 'register', 'game_started'.
 * @param {object} [details={}] - Optional extra data (stored as JSONB).
 */
async function recordActivity(userId, action, details = {}) {
  if (!userId || !action) return;

  try {
    const { error } = await supabaseAdmin.from(TABLE).insert({
      user_id: userId,
      action,
      details
    });

    if (error) {
      console.error('[Activity] Failed to record activity:', error.message);
    }
  } catch (err) {
    console.error('[Activity] Unexpected error:', err.message);
  }
}

module.exports = { recordActivity };
