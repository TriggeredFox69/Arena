/* ==========================================================================
   ARENAX BACKEND - AUTHENTICATION MIDDLEWARE
   Verifies JWT tokens (custom OR Supabase) and attaches req.user / req.userId.
   ========================================================================== */

const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { supabaseAdmin } = require('../config/supabase');

function extractToken(req) {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1].trim();
  }
  if (req.query && req.query.token) return req.query.token;
  return null;
}

async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized — no token provided' });
  }

  // ---- Method 1: Custom JWT (arenax_token from localStorage) ----
  if (process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.id) {
        const user = await User.findById(decoded.id);
        if (user) {
          req.user   = user;
          req.userId = decoded.id;
          req.username = user.username;
          return next();
        }
      }
    } catch (_) {
      // Not a valid custom JWT — try Supabase token next
    }
  }

  // ---- Method 2: Supabase access token ----
  try {
    const { data: { user: sbUser }, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && sbUser) {
      // Find matching row in users table
      const user = await User.findById(sbUser.id);
      if (user) {
        req.user     = user;
        req.userId   = sbUser.id;
        req.username = user.username;
        return next();
      }
    }
  } catch (_) {
    // Not a valid Supabase token either
  }

  return res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
}

const protect = requireAuth;

module.exports = requireAuth;
module.exports.requireAuth = requireAuth;
module.exports.protect = protect;
