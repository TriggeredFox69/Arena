const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const serverless = require('serverless-http');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';
process.env.COIN_PRICE = process.env.COIN_PRICE || '10';

const authRoutes = require('../../backend/src/routes/authRoutes');
const walletRoutes = require('../../backend/src/routes/walletRoutes');
const gameRoutes = require('../../backend/src/routes/gameRoutes');
const roomsRoutes = require('../../backend/src/routes/rooms-supabase');
const friendsRoutes = require('../../backend/src/routes/friends-supabase');
const marketplaceRoutes = require('../../backend/src/routes/marketplace-supabase');
const chatRoutes = require('../../backend/src/routes/chat-supabase');
const transfersRoutes = require('../../backend/src/routes/transfers-supabase');
const usdtRoutes = require('../../backend/src/routes/usdt-supabase');
const matchmakingRoutes = require('../../backend/src/routes/matchmaking');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
}));

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/transfers', transfersRoutes);
app.use('/api/usdt', usdtRoutes);
app.use('/api/matchmaking', matchmakingRoutes);

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', service: 'arenax-backend' });
});

exports.handler = serverless(app);
