const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/balance', walletController.getBalance);
router.get('/sync', walletController.getBalance);  // alias for /balance — returns server-side balance

router.post(
  '/deposit',
  [
    body('method').isIn(['easypaisa', 'jazzcash']).withMessage('Invalid payment method'),
    body('amount').isFloat({ min: 10 }).withMessage('Minimum deposit is ₨10'),
    body('accountNumber').notEmpty().withMessage('Account number is required')
  ],
  walletController.deposit
);

router.post(
  '/withdraw',
  [
    body('method').isIn(['easypaisa', 'jazzcash']).withMessage('Invalid payment method'),
    body('coins').isInt({ min: 1 }).withMessage('Minimum withdrawal is 1 coin'),
    body('accountNumber').notEmpty().withMessage('Account number is required')
  ],
  walletController.withdraw
);

router.get('/transactions', walletController.getTransactions);

module.exports = router;
