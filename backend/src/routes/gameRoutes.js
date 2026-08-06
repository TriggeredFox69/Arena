const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const gameController = require('../controllers/gameController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.post(
  '/start',
  [
    body('game').isIn(['Lightning Spin', 'Gold Rush Roulette', 'Arena Dice Master']).withMessage('Invalid game name')
  ],
  gameController.startGame
);

router.post(
  '/end',
  [
    body('game').isIn(['Lightning Spin', 'Gold Rush Roulette', 'Arena Dice Master']).withMessage('Invalid game name'),
    body('won').isBoolean().withMessage('Won status is required'),
    body('coinsWon').isInt({ min: 0 }).withMessage('Coins won must be a positive number'),
    body('gameData').optional().isObject()
  ],
  gameController.endGame
);

router.get('/history', gameController.getGameHistory);

router.get('/stats', gameController.getGameStats);

module.exports = router;
