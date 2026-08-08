const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const gameController = require('../controllers/gameController');
const { protect } = require('../middleware/auth');

router.use(protect);

const VALID_GAMES = [
  'Lightning Spin', 'Gold Rush Roulette', 'Arena Dice Master',
  'Carrom Clash', 'Ludo Stars', '8 Ball Pool',
  'Glow Hockey', 'Chess Royale', 'Checkers Clash'
];

const wagerValidation = body('wager')
  .optional()
  .isInt({ min: 5, max: 1000 })
  .withMessage('Wager must be between 5 and 1000 AX coins');

router.post(
  '/start',
  [
    body('game').isIn(VALID_GAMES).withMessage('Invalid game name'),
    wagerValidation
  ],
  gameController.startGame
);

router.post(
  '/end',
  [
    body('game').isIn(VALID_GAMES).withMessage('Invalid game name'),
    body('won').isBoolean().withMessage('Won status is required'),
    body('coinsWon').isInt({ min: 0 }).withMessage('Coins won must be a positive number'),
    wagerValidation,
    body('gameData').optional().isObject()
  ],
  gameController.endGame
);

router.get('/history', gameController.getGameHistory);

router.get('/stats', gameController.getGameStats);

module.exports = router;
