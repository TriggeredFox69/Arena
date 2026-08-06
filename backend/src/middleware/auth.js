/* ==========================================================================
   ARENAX BACKEND - AUTHENTICATION MIDDLEWARE
   Verifies JWT tokens and attaches req.user.
   ========================================================================== */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

function extractToken(req) {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return req.headers.authorization.split(' ')[1];
  }
  if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
}

async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    req.user = user;
    req.userId = decoded.id;
    req.username = user.username;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
}

const protect = requireAuth;

module.exports = requireAuth;
module.exports.requireAuth = requireAuth;
module.exports.protect = protect;
