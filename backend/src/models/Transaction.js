/* ==========================================================================
   ARENAX TRANSACTION MODEL - Supabase-backed replacement for Mongoose Transaction
   ========================================================================== */

const { supabaseAdmin } = require('../config/supabase');
const TABLE = 'transactions';

function mapRow(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    user: row.user_id,
    user_id: row.user_id,
    type: row.type === 'credit' || row.type === 'deposit' ? 'credit' : 'debit',
    amount: row.wager || row.pkr_amount || 0,
    rupees: row.pkr_amount || 0,
    source: row.type,
    method: row.type === 'deposit' || row.type === 'withdraw' ? (row.description || 'easypaisa') : 'game',
    accountNumber: null,
    game: row.game,
    status: row.result === 'APPROVED' || row.result === 'PROCESSED' || row.result === 'WIN' ? 'completed' : 'pending',
    balanceAfter: 0,
    createdAt: row.created_at,
    updatedAt: row.created_at
  };
}

class Transaction {
  static async create(docs, opts) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const rows = arr.map(doc => ({
      user_id: doc.user || doc.user_id,
      type: doc.source || doc.type,
      game: doc.game || null,
      description: doc.method || doc.description || null,
      wager: doc.amount || 0,
      pkr_amount: doc.rupees || 0,
      result: doc.status === 'completed' ? 'PROCESSED' : doc.status || 'PENDING'
    }));

    const { data, error } = await supabaseAdmin.from(TABLE).insert(rows).select();
    if (error) throw error;
    return data.map(mapRow);
  }

  static async find(query = {}) {
    let builder = supabaseAdmin.from(TABLE).select('*').order('created_at', { ascending: false });
    if (query.user) builder = builder.eq('user_id', query.user);
    if (query.user_id) builder = builder.eq('user_id', query.user_id);
    if (query.type) builder = builder.eq('type', query.type);

    const { data, error } = await builder;
    if (error) throw error;
    return data.map(mapRow);
  }
}

Transaction.create = Transaction.create.bind(Transaction);
Transaction.find = Transaction.find.bind(Transaction);

module.exports = Transaction;
