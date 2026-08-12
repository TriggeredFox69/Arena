/* ==========================================================================
   ARENAX BACKEND - DATABASE LAYER (SQLite via better-sqlite3)
   ========================================================================== */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'arenax.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 100,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    total_wagered INTEGER NOT NULL DEFAULT 0,
    total_won INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,               -- 'deposit' | 'withdraw' | 'wager' | 'settlement'
    game TEXT,                        -- game key / display name
    description TEXT,                 -- e.g. "Deposit (EasyPaisa)"
    wager INTEGER DEFAULT 0,
    pot INTEGER DEFAULT 0,
    result TEXT,                      -- 'APPROVED' | 'PROCESSED' | 'WIN' | 'LOSS' | 'ACTIVE'
    pkr_amount INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    wager INTEGER NOT NULL,
    pot INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'settled'
    result TEXT, -- 'WIN' | 'LOSS'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    settled_at TEXT
  );

  -- Friends system
  CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'blocked'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, friend_id)
  );

  -- Marketplace orders
  CREATE TABLE IF NOT EXISTS marketplace_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'buy' | 'sell'
    amount_ax INTEGER NOT NULL,
    price_per_ax REAL NOT NULL,
    filled_amount INTEGER NOT NULL DEFAULT 0,
    total_value REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'filled' | 'cancelled' | 'partial'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    filled_at TEXT
  );

  -- Marketplace trades (order matching history)
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buy_order_id INTEGER NOT NULL REFERENCES marketplace_orders(id),
    sell_order_id INTEGER NOT NULL REFERENCES marketplace_orders(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    amount_ax INTEGER NOT NULL,
    price_per_ax REAL NOT NULL,
    total_value REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Token transfers
  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    amount_ax INTEGER NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Chat messages
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    emoji_reaction TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Game invites/custom rooms
  CREATE TABLE IF NOT EXISTS game_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT UNIQUE NOT NULL,
    creator_id INTEGER NOT NULL REFERENCES users(id),
    game_key TEXT NOT NULL,
    wager INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'waiting', -- 'waiting' | 'in_progress' | 'finished'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- USDT transactions (mock for now)
  CREATE TABLE IF NOT EXISTS usdt_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL, -- 'buy' | 'withdraw'
    usdt_amount REAL NOT NULL,
    ax_amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'failed'
    usdt_address TEXT,
    txn_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id);
  CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);
  CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);
  CREATE INDEX IF NOT EXISTS idx_marketplace_orders_user ON marketplace_orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status ON marketplace_orders(status);
  CREATE INDEX IF NOT EXISTS idx_trades_buyer ON trades(buyer_id);
  CREATE INDEX IF NOT EXISTS idx_trades_seller ON trades(seller_id);
  CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(from_user_id);
  CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(to_user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_game ON chat_messages(game_id);
  CREATE INDEX IF NOT EXISTS idx_rooms_code ON game_rooms(room_code);
  CREATE INDEX IF NOT EXISTS idx_usdt_user ON usdt_transactions(user_id);
`);

// Migrations: add columns for room/match linking
try {
  // Add room_id to matches table (links match to game room)
  db.exec(`ALTER TABLE matches ADD COLUMN room_id INTEGER REFERENCES game_rooms(id)`);
} catch (e) {
  // Column already exists
}

try {
  // Add match_id to game_rooms table (links room to active match)
  db.exec(`ALTER TABLE game_rooms ADD COLUMN match_id INTEGER REFERENCES matches(id)`);
} catch (e) {
  // Column already exists
}

try {
  // Add current_turn_user_id to game_rooms (for turn timer tracking)
  db.exec(`ALTER TABLE game_rooms ADD COLUMN current_turn_user_id INTEGER REFERENCES users(id)`);
} catch (e) {
  // Column already exists
}

module.exports = db;
