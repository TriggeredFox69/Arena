const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

process.env.PORT = process.env.PORT || '5000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

const errorHandler = require('./middleware/errorHandler');
const { initSocket } = require('./socket');

const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const gameRoutes = require('./routes/gameRoutes');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO server for real-time chat, friends, marketplace, and PvP.
initSocket(server);

const PORT = process.env.PORT || 5000;

app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", "https:", "http:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      scriptSrcElem: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      // Frontend uses inline onclick= handlers throughout; helmet's default
      // script-src-attr 'none' silently blocks every one of them.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", "http:", "https:", "https://*.supabase.co", "wss://*.supabase.co"]
    }
  }
}));
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/rooms', require('./routes/rooms-supabase'));
app.use('/api/friends', require('./routes/friends-supabase'));
app.use('/api/marketplace', require('./routes/marketplace-supabase'));
app.use('/api/chat', require('./routes/chat-supabase'));
app.use('/api/transfers', require('./routes/transfers-supabase'));
app.use('/api/usdt', require('./routes/usdt-supabase'));
app.use('/api/matchmaking', require('./routes/matchmaking'));

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', service: 'arenax-backend' });
});

const FRONTEND_DIR = path.join(__dirname, '..', '..');
app.use(express.static(FRONTEND_DIR));

app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.use(errorHandler);

function startServer(port) {
  server.listen(port, () => {
    console.log(`ArenaX backend running at http://localhost:${port}`);
    console.log(`Frontend served from: ${FRONTEND_DIR}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is already in use. Trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server failed to start:', err.message);
      process.exit(1);
    }
  });
}

startServer(Number(PORT));

module.exports = server;