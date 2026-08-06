const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

process.env.PORT = process.env.PORT || '5000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/arenax';

const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const gameRoutes = require('./routes/gameRoutes');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

connectDB().catch((err) => {
  console.error('[ArenaX] MongoDB connection failed:', err.message);
  console.error('[ArenaX] Start MongoDB or set MONGODB_URI in backend/.env for login/register to work.');
});

app.use(helmet({ crossOriginResourcePolicy: false }));
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

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', service: 'arenax-backend' });
});

const FRONTEND_DIR = path.join(__dirname, '..', '..');
app.use(express.static(FRONTEND_DIR));

app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.use(errorHandler);

server.listen(PORT, () => {
  console.log(`ArenaX backend running at http://localhost:${PORT}`);
  console.log(`Frontend served from: ${FRONTEND_DIR}`);
});

module.exports = server;