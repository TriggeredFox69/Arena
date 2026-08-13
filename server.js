/* ==========================================================================
   ARENAX - LOCAL DEV SERVER (port 5000)
   Serves static files + all /api/* routes via Express.
   Run with: node server.js
   ========================================================================== */

'use strict';

require('dotenv').config();

const path    = require('path');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');

// ---- ENV defaults ----
process.env.JWT_SECRET  = process.env.JWT_SECRET  || 'dev_secret_change_me';
process.env.JWT_EXPIRE  = process.env.JWT_EXPIRE  || '7d';
process.env.COIN_PRICE  = process.env.COIN_PRICE  || '10';

// ---- API routes ----
const authRoutes        = require('./backend/src/routes/authRoutes');
const walletRoutes      = require('./backend/src/routes/walletRoutes');
const gameRoutes        = require('./backend/src/routes/gameRoutes');
const roomsRoutes       = require('./backend/src/routes/rooms-supabase');
const friendsRoutes     = require('./backend/src/routes/friends-supabase');
const marketplaceRoutes = require('./backend/src/routes/marketplace-supabase');
const chatRoutes        = require('./backend/src/routes/chat-supabase');
const transfersRoutes   = require('./backend/src/routes/transfers-supabase');
const usdtRoutes        = require('./backend/src/routes/usdt-supabase');
const matchmakingRoutes = require('./backend/src/routes/matchmaking');

const app  = express();
const PORT = process.env.PORT || 5000;

// ---- Middleware ----
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ---- API routes ----
app.use('/api/auth',        authRoutes);
app.use('/api/wallet',      walletRoutes);
app.use('/api/games',       gameRoutes);
app.use('/api/rooms',       roomsRoutes);
app.use('/api/friends',     friendsRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/chat',        chatRoutes);
app.use('/api/transfers',   transfersRoutes);
app.use('/api/usdt',        usdtRoutes);
app.use('/api/matchmaking', matchmakingRoutes);

app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok', service: 'arenax-local' }));

// ---- Static files ----
app.use(express.static(path.join(__dirname)));

// ---- SPA fallback ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---- Start ----
app.listen(PORT, () => {
  console.log(`\n  ✅  ArenaX dev server running at http://localhost:${PORT}`);
  console.log(`  📡  API available at http://localhost:${PORT}/api`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
