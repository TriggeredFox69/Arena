const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post(
  '/register',
  [
    body('username').trim().isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('phone').optional({ checkFalsy: true }).trim(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  authController.register
);

router.post(
  '/login',
  [
    body('email').notEmpty().withMessage('Please provide your email or username'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  authController.login
);

router.get('/me', protect, authController.getMe);

router.put(
  '/update-profile',
  protect,
  [
    body('username').optional().trim().isLength({ min: 3, max: 30 }),
    body('phone').optional().matches(/^(\+92|0)?[0-9]{10}$/)
  ],
  authController.updateProfile
);

module.exports = router;
