const { validationResult } = require('express-validator');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { recordActivity } = require('../utils/activity');

const COIN_PRICE = parseInt(process.env.COIN_PRICE) || 10;

exports.getBalance = async (req, res, next) => {
  try {
    res.json({
      success: true,
      balance: {
        coins: req.user.coins,
        rupees: req.user.coins * COIN_PRICE
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.deposit = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { method, amount, accountNumber } = req.body;
    const coins = Math.floor(amount / COIN_PRICE);

    const user = await User.findById(req.user._id);
    user.coins += coins;
    await user.save();

    const transaction = await Transaction.create([{
      user: user._id,
      type: 'credit',
      amount: coins,
      rupees: amount,
      source: 'deposit',
      method: method,
      accountNumber: accountNumber,
      status: 'completed',
      balanceAfter: user.coins
    }]);

    recordActivity(user.id, 'deposit', {
      method,
      amount_pkr: amount,
      coins,
      balance_after: user.coins
    });

    res.json({
      success: true,
      message: `Successfully deposited ${coins} coins`,
      coins: coins,
      balance: user.coins,
      transaction: transaction[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.withdraw = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { method, coins, accountNumber } = req.body;

    const user = await User.findById(req.user._id);

    if (user.coins < coins) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    const amount = coins * COIN_PRICE;
    user.coins -= coins;
    await user.save();

    const transaction = await Transaction.create([{
      user: user._id,
      type: 'debit',
      amount: coins,
      rupees: amount,
      source: 'withdrawal',
      method: method,
      accountNumber: accountNumber,
      status: 'pending',
      balanceAfter: user.coins,
      notes: 'Withdrawal request initiated. Processing time: 24-48 hours'
    }]);

    recordActivity(user.id, 'withdrawal', {
      method,
      coins,
      amount_pkr: amount,
      balance_after: user.coins
    });

    res.json({
      success: true,
      message: `Withdrawal of ₨${amount} initiated. You will receive payment within 24-48 hours.`,
      amount: amount,
      balance: user.coins,
      transaction: transaction[0]
    });
  } catch (error) {
    next(error);
  }
};

exports.getTransactions = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const all = await Transaction.find({ user: req.user._id });
    const transactions = all.slice(skip, skip + limit).map(t => ({
      ...t,
      user: undefined,
      user_id: undefined
    }));
    const total = all.length;

    res.json({
      success: true,
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};
