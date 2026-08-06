/* ==========================================================================
   ARENAX USER MODEL - Supabase-backed replacement for Mongoose User
   ========================================================================== */

const bcrypt = require('bcryptjs');
const { supabaseAdmin } = require('../config/supabase');

const TABLE = 'users';

function mapRow(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    username: row.username,
    email: row.email,
    phone: row.phone,
    password: row.password_hash,
    coins: row.balance,
    balance: row.balance,
    totalDeposited: 0,
    totalWithdrawn: 0,
    totalWon: row.total_won,
    gamesPlayed: row.wins + row.losses,
    gamesWon: row.wins,
    level: 1,
    isActive: true,
    joinedDate: row.created_at,
    createdAt: row.created_at,
    updatedAt: row.created_at,

    comparePassword: async function (candidatePassword) {
      return bcrypt.compare(candidatePassword, this.password);
    },

    getPublicProfile: function () {
      return {
        id: this.id,
        _id: this.id,
        username: this.username,
        email: this.email,
        phone: this.phone,
        coins: this.coins,
        balance: this.balance,
        wins: this.gamesWon,
        losses: this.gamesPlayed - this.gamesWon,
        level: this.level,
        isActive: this.isActive,
        joinedDate: this.joinedDate
      };
    },

    save: async function () {
      const { error } = await supabaseAdmin
        .from(TABLE)
        .update({
          username: this.username,
          email: this.email,
          phone: this.phone,
          password_hash: this.password,
          balance: this.coins,
          wins: this.gamesWon,
          losses: this.gamesPlayed - this.gamesWon,
          total_won: this.totalWon
        })
        .eq('id', this.id);
      if (error) throw error;
      return this;
    },

    session: function () {
      return this;
    }
  };
}

class User {
  static async create({ username, email, phone, password }) {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert({ username, email, phone, password_hash })
      .select()
      .single();

    if (error) throw error;
    return mapRow(data);
  }

  static async findOne(query) {
    let builder = supabaseAdmin.from(TABLE).select('*');
    if (query.username) builder = builder.eq('username', query.username);
    if (query.email) builder = builder.eq('email', query.email);
    if (query.phone) builder = builder.eq('phone', query.phone);
    if (query._id || query.id) builder = builder.eq('id', query._id || query.id);

    const { data, error } = await builder.single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return mapRow(data);
  }

  static async findById(id) {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return mapRow(data);
  }

  static async findByIdAndUpdate(id, updates) {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapRow(data);
  }

  static select(fields) {
    return {
      findOne: User.findOne.bind(User),
      findById: User.findById.bind(User)
    };
  }
}

User.findOne = User.findOne.bind(User);
User.findById = User.findById.bind(User);
User.findByIdAndUpdate = User.findByIdAndUpdate.bind(User);
User.create = User.create.bind(User);

module.exports = User;
