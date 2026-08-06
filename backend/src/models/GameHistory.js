/* ==========================================================================
   ARENAX GAME HISTORY MODEL - Supabase-backed replacement for Mongoose GameHistory
   ========================================================================== */

const { supabaseAdmin } = require('../config/supabase');
const TABLE = 'matches';

function mapRow(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    user: row.user_id,
    user_id: row.user_id,
    game: row.game_key,
    game_key: row.game_key,
    entryFee: row.wager,
    won: row.result === 'WIN',
    coinsWon: row.result === 'WIN' ? row.pot : 0,
    rupeesWon: row.result === 'WIN' ? row.pot : 0,
    balanceBefore: 0,
    balanceAfter: 0,
    gameData: null,
    duration: 0,
    createdAt: row.created_at,
    updatedAt: row.created_at
  };
}

class GameHistory {
  static async create(docs, opts) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const rows = arr.map(doc => ({
      user_id: doc.user || doc.user_id,
      game_key: doc.game,
      mode: doc.gameData?.mode || 'solo',
      wager: doc.entryFee || 1,
      pot: doc.coinsWon || 0,
      status: 'settled',
      result: doc.won ? 'WIN' : 'LOSS'
    }));

    const { data, error } = await supabaseAdmin.from(TABLE).insert(rows).select();
    if (error) throw error;
    return data.map(mapRow);
  }

  static async find(query = {}) {
    let builder = supabaseAdmin.from(TABLE).select('*').order('created_at', { ascending: false });
    if (query.user) builder = builder.eq('user_id', query.user);
    if (query.user_id) builder = builder.eq('user_id', query.user_id);
    if (query.game) builder = builder.eq('game_key', query.game);

    const { data, error } = await builder;
    if (error) throw error;
    return data.map(mapRow);
  }
}

GameHistory.create = GameHistory.create.bind(GameHistory);
GameHistory.find = GameHistory.find.bind(GameHistory);

module.exports = GameHistory;
