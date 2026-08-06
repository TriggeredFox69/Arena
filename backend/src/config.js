/* ==========================================================================
   ARENAX BACKEND - CONFIGURATION
   Central place for environment variables and game economy constants.
   ========================================================================== */

const path = require('path');

// Load .env from backend/ folder if present
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_change_me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRE || '7d',

  // Economy
  STARTING_BALANCE: parseInt(process.env.STARTING_BALANCE, 10) || 100,
  TOKEN_RATE: parseInt(process.env.TOKEN_RATE, 10) || 10, // 1 AX = 10 PKR
  USDT_PER_AX: parseFloat(process.env.USDT_PER_AX) || 0.01, // 1 AX = 0.01 USDT

  // CORS / frontend
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  RATE_LIMIT_MAX: 1000
};

module.exports = config;
