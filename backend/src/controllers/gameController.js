const { validationResult } = require('express-validator');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const GameHistory = require('../models/GameHistory');

const COIN_PRICE = parseInt(process.env.COIN_PRICE) || 10;
const ENTRY_FEE = 1;

exports.startGame = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { game } = req.body;

    const user = await User.findById(req.user._id);

    if (user.coins < ENTRY_FEE) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance. Please deposit coins to play.'
      });
    }

    user.coins -= ENTRY_FEE;
    await user.save();

    await Transaction.create([{
      user: user._id,
      type: 'debit',
      amount: ENTRY_FEE,
      rupees: ENTRY_FEE * COIN_PRICE,
      source: 'game_entry',
      method: 'game',
      game: game,
      status: 'completed',
      balanceAfter: user.coins
    }]);

    res.json({
      success: true,
      message: 'Game started successfully',
      balance: user.coins,
      game: game
    });
  } catch (error) {
    next(error);
  }
};

exports.endGame = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { game, won, coinsWon, gameData } = req.body;

    const user = await User.findById(req.user._id);
    const balanceBefore = user.coins;

    if (won && coinsWon > 0) {
      user.coins += coinsWon;
      user.totalWon += coinsWon * COIN_PRICE;
      user.gamesWon += 1;

      await Transaction.create([{
        user: user._id,
        type: 'credit',
        amount: coinsWon,
        rupees: coinsWon * COIN_PRICE,
        source: 'game_win',
        method: 'game',
        game: game,
        status: 'completed',
        balanceAfter: user.coins
      }]);
    }

    await user.save();

    await GameHistory.create([{
      user: user._id,
      game: game,
      entryFee: ENTRY_FEE,
      won: won,
      coinsWon: coinsWon,
      rupeesWon: coinsWon * COIN_PRICE,
      balanceBefore: balanceBefore,
      balanceAfter: user.coins,
      gameData: gameData || {}
    }]);

    res.json({
      success: true,
      message: won ? `Congratulations! You won ${coinsWon} coins!` : 'Better luck next time!',
      won: won,
      coinsWon: coinsWon,
      balance: user.coins
    });
  } catch (error) {
    next(error);
  }
};

exports.getGameHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const gameFilter = req.query.game ? { game: req.query.game } : {};

    const all = await GameHistory.find({
      user: req.user._id,
      ...gameFilter
    });

    const history = all.slice(skip, skip + limit).map(h => ({
      ...h,
      user: undefined,
      user_id: undefined
    }));
    const total = all.length;

    res.json({
      success: true,
      history,
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

exports.getGameStats = async (req, res, next) => {
  try {
    const user = req.user;

    const allHistory = await GameHistory.find({ user: user._id });
    const gameStats = {};
    for (const h of allHistory) {
      const s = gameStats[h.game] || (gameStats[h.game] = { played: 0, won: 0, totalWinnings: 0 });
      s.played += 1;
      if (h.won) s.won += 1;
      s.totalWinnings += h.coinsWon || 0;
    }

    const stats = {
      overall: {
        coins: user.coins,
        totalDeposited: user.totalDeposited || 0,
        totalWithdrawn: user.totalWithdrawn || 0,
        totalWon: user.totalWon,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
        winRate: user.gamesPlayed > 0 ? ((user.gamesWon / user.gamesPlayed) * 100).toFixed(1) : 0
      },
      byGame: Object.entries(gameStats).map(([game, stat]) => ({
        game,
        played: stat.played,
        won: stat.won,
        winRate: stat.played > 0 ? ((stat.won / stat.played) * 100).toFixed(1) : 0,
        totalWinnings: stat.totalWinnings
      }))
    };

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    next(error);
  }
};
