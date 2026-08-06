const PIECES = {
  wp: '♙', wr: '♖', wn: '♘', wb: '♗', wq: '♕', wk: '♔',
  bp: '♟', br: '♜', bn: '♞', bb: '♝', bq: '♛', bk: '♚'
};

const SVG_PIECES = {
  wp: pieceSVG('pawn', 'white'), wr: pieceSVG('rook', 'white'), wn: pieceSVG('knight', 'white'), wb: pieceSVG('bishop', 'white'), wq: pieceSVG('queen', 'white'), wk: pieceSVG('king', 'white'),
  bp: pieceSVG('pawn', 'black'), br: pieceSVG('rook', 'black'), bn: pieceSVG('knight', 'black'), bb: pieceSVG('bishop', 'black'), bq: pieceSVG('queen', 'black'), bk: pieceSVG('king', 'black')
};

const FILES = ['a','b','c','d','e','f','g','h'];
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

function pieceSVG(type, color) {
  const text = ({ king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' }[type] || '♟');
  if (color === 'white') {
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="72" text-anchor="middle" font-size="74" font-family="Arial Unicode MS, Segoe UI Symbol, serif" font-weight="900" fill="#ffffff" stroke="#111111" stroke-width="4" paint-order="stroke fill">${text}</text></svg>`)}`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="72" text-anchor="middle" font-size="74" font-family="Arial Unicode MS, Segoe UI Symbol, serif" font-weight="900" fill="#3f3f3f">${text}</text></svg>`)}`;
}

let chessAudioCtx = null;
let chessSoundOn = localStorage.getItem('chess_sound') !== 'off';
function chessAc() {
  if (!chessAudioCtx) chessAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return chessAudioCtx;
}
function chessBeep(freq, dur, type, vol, when) {
  if (!chessSoundOn) return;
  try {
    const ctx = chessAc();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.12, ctx.currentTime + (when || 0));
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (when || 0) + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + (when || 0));
    o.stop(ctx.currentTime + (when || 0) + dur);
  } catch (e) {}
}
const chessSFX = {
  move: () => { chessBeep(680, 0.035, 'triangle', 0.05); chessBeep(980, 0.045, 'sine', 0.035, 0.015); },
  capture: () => { chessBeep(440, 0.06, 'square', 0.08); chessBeep(220, 0.12, 'triangle', 0.06, 0.04); },
  castle: () => { chessBeep(520, 0.05, 'triangle', 0.06); chessBeep(700, 0.06, 'triangle', 0.06, 0.04); chessBeep(900, 0.08, 'triangle', 0.05, 0.08); },
  promote: () => { chessBeep(620, 0.07, 'triangle', 0.07); chessBeep(830, 0.08, 'triangle', 0.07, 0.06); chessBeep(1040, 0.12, 'triangle', 0.06, 0.12); },
  check: () => { chessBeep(920, 0.06, 'sawtooth', 0.06); chessBeep(660, 0.12, 'triangle', 0.05, 0.05); },
  mate: () => { [523, 659, 784, 1047].forEach((f, i) => chessBeep(f, 0.22, 'triangle', 0.08, i * 0.12)); },
  stalemate: () => { chessBeep(330, 0.18, 'sine', 0.05); chessBeep(280, 0.22, 'sine', 0.05, 0.12); },
  select: () => chessBeep(760, 0.025, 'sine', 0.035),
  start: () => { chessBeep(440, 0.06, 'triangle', 0.05); chessBeep(660, 0.08, 'triangle', 0.05, 0.05); },
  click: () => chessBeep(560, 0.03, 'sine', 0.04)
};
function updateChessSoundButton() {
  const btn = document.getElementById('chessSoundBtn');
  if (btn) btn.textContent = chessSoundOn ? '🔊' : '🔇';
}
function toggleChessSound() {
  chessSoundOn = !chessSoundOn;
  localStorage.setItem('chess_sound', chessSoundOn ? 'on' : 'off');
  updateChessSoundButton();
  if (chessSoundOn) chessBeep(420, 0.06, 'sine', 0.05);
}

class ChessRoyale {
  constructor() {
    this.boardEl = document.getElementById('board');
    this.statusEl = document.getElementById('statusText');
    this.soundBtn = document.getElementById('chessSoundBtn');
    this.modeEl = document.getElementById('modeText');
    this.moveLogEl = document.getElementById('moveLog');
    this.modeSelect = document.getElementById('modeSelect');
    this.difficultySelect = document.getElementById('difficultySelect');
    this.newGameBtn = document.getElementById('newGameBtn');
    this.whiteCard = document.getElementById('whiteCard');
    this.blackCard = document.getElementById('blackCard');

    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.moveLog = [];
    this.aiThinking = false;
    this.gameStarted = false;

    this.setupBoardUI();
    this.bindEvents();
    this.resetGame();
  }

  resetGame() {
    this.gameStarted = false;
    this.board = this.createInitialBoard();
    this.turn = 'w';
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.moveLog = [];
    this.castling = { w: { k: true, q: true }, b: { k: true, q: true } };
    this.enPassant = null;
    this.updateModeLabel();
    this.render();
    this.statusEl.textContent = 'Press Start Game to begin';
  }

  bindEvents() {
    this.newGameBtn.addEventListener('click', () => { chessSFX.start(); this.startGame(); });
    if (this.soundBtn) this.soundBtn.addEventListener('click', toggleChessSound);
    this.modeSelect.addEventListener('change', () => {
      chessSFX.click();
      this.updateModeLabel();
      this.resetGame();
    });
    this.difficultySelect.addEventListener('change', () => {
      chessSFX.click();
      this.updateModeLabel();
      if (this.modeSelect.value === 'ai' && this.turn === 'b') this.scheduleAI();
    });
  }

  updateModeLabel() {
    const mode = this.modeSelect.value === 'ai' ? `vs AI (${this.difficultySelect.value})` : '2 Player Local';
    this.modeEl.textContent = `Mode: ${mode}`;
  }

  setupBoardUI() {
    this.boardEl.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = document.createElement('div');
        sq.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
        sq.dataset.row = String(r);
        sq.dataset.col = String(c);
        sq.addEventListener('click', () => this.handleSquareClick(r, c));
        this.boardEl.appendChild(sq);
      }
    }
  }

  createInitialBoard() {
    return [
      ['br','bn','bb','bq','bk','bb','bn','br'],
      ['bp','bp','bp','bp','bp','bp','bp','bp'],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      ['wp','wp','wp','wp','wp','wp','wp','wp'],
      ['wr','wn','wb','wq','wk','wb','wn','wr']
    ];
  }

  startGame() {
    this.gameStarted = true;
    this.board = this.createInitialBoard();
    this.turn = 'w';
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.moveLog = [];
    this.castling = { w: { k: true, q: true }, b: { k: true, q: true } };
    this.enPassant = null;
    this.updateModeLabel();
    this.render();
  }

  handleSquareClick(row, col) {
    if (!this.gameStarted) return;
    if (this.aiThinking) return;
    const piece = this.board[row][col];

    if (this.selected) {
      const move = this.legalMoves.find(m => m.to.row === row && m.to.col === col);
      if (move) {
        this.makeMove(move);
        return;
      }
    }

    if (piece && piece[0] === this.turn) {
      if (this.modeSelect.value === 'ai' && this.turn === 'b') return;
      this.selected = { row, col };
      this.legalMoves = this.getLegalMovesForSquare(row, col);
      if (this.legalMoves.length) chessSFX.select();
    } else {
      this.selected = null;
      this.legalMoves = [];
    }
    this.render();
  }

  inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  cloneBoard(board = this.board) {
    return board.map(row => row.slice());
  }

  getLegalMovesForSquare(row, col) {
    const piece = this.board[row][col];
    if (!piece) return [];
    const pseudo = this.getPseudoMoves(this.board, row, col, piece, true);
    return pseudo.filter(move => this.isMoveLegal(move, piece[0]));
  }

  isMoveLegal(move, color) {
    const snapshot = this.snapshotState();
    this.applyMoveToState(move);
    const inCheck = this.isKingInCheck(color);
    this.restoreState(snapshot);
    return !inCheck;
  }

  snapshotState() {
    return {
      board: this.cloneBoard(),
      castling: JSON.parse(JSON.stringify(this.castling)),
      enPassant: this.enPassant ? { ...this.enPassant } : null,
      lastMove: this.lastMove ? JSON.parse(JSON.stringify(this.lastMove)) : null
    };
  }

  restoreState(snapshot) {
    this.board = snapshot.board;
    this.castling = snapshot.castling;
    this.enPassant = snapshot.enPassant;
    this.lastMove = snapshot.lastMove;
  }

  getPseudoMoves(board, row, col, piece, includeSpecial) {
    const color = piece[0];
    const type = piece[1];
    const enemy = color === 'w' ? 'b' : 'w';
    const moves = [];

    const pushSlide = dirs => {
      for (const [dr, dc] of dirs) {
        let r = row + dr;
        let c = col + dc;
        while (this.inBounds(r, c)) {
          const target = board[r][c];
          if (!target) {
            moves.push({ from: { row, col }, to: { row: r, col: c }, piece });
          } else {
            if (target[0] === enemy) moves.push({ from: { row, col }, to: { row: r, col: c }, piece, capture: target });
            break;
          }
          r += dr;
          c += dc;
        }
      }
    };

    if (type === 'p') {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      const one = row + dir;
      if (this.inBounds(one, col) && !board[one][col]) {
        moves.push({ from: { row, col }, to: { row: one, col }, piece, promotion: one === 0 || one === 7 });
        const two = row + dir * 2;
        if (row === startRow && !board[two][col]) {
          moves.push({ from: { row, col }, to: { row: two, col }, piece, doublePawn: true });
        }
      }
      for (const dc of [-1, 1]) {
        const r = row + dir;
        const c = col + dc;
        if (!this.inBounds(r, c)) continue;
        const target = board[r][c];
        if (target && target[0] === enemy) {
          moves.push({ from: { row, col }, to: { row: r, col: c }, piece, capture: target, promotion: r === 0 || r === 7 });
        }
        if (includeSpecial && this.enPassant && this.enPassant.row === r && this.enPassant.col === c) {
          moves.push({ from: { row, col }, to: { row: r, col: c }, piece, enPassant: true });
        }
      }
    }

    if (type === 'n') {
      [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr, dc]) => {
        const r = row + dr, c = col + dc;
        if (!this.inBounds(r, c)) return;
        const target = board[r][c];
        if (!target || target[0] !== color) moves.push({ from: { row, col }, to: { row: r, col: c }, piece, capture: target || null });
      });
    }

    if (type === 'b') pushSlide([[-1,-1],[-1,1],[1,-1],[1,1]]);
    if (type === 'r') pushSlide([[-1,0],[1,0],[0,-1],[0,1]]);
    if (type === 'q') pushSlide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);

    if (type === 'k') {
      [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr, dc]) => {
        const r = row + dr, c = col + dc;
        if (!this.inBounds(r, c)) return;
        const target = board[r][c];
        if (!target || target[0] !== color) moves.push({ from: { row, col }, to: { row: r, col: c }, piece, capture: target || null });
      });

      if (includeSpecial) {
        const rights = this.castling[color];
        if (rights?.k && !board[row][5] && !board[row][6]) {
          moves.push({ from: { row, col }, to: { row, col: 6 }, piece, castle: 'k' });
        }
        if (rights?.q && !board[row][1] && !board[row][2] && !board[row][3]) {
          moves.push({ from: { row, col }, to: { row, col: 2 }, piece, castle: 'q' });
        }
      }
    }

    return moves;
  }

  applyMoveToState(move) {
    const piece = this.board[move.from.row][move.from.col];
    this.board[move.from.row][move.from.col] = null;

    if (move.enPassant) {
      const dir = piece[0] === 'w' ? 1 : -1;
      this.board[move.to.row + dir][move.to.col] = null;
    }

    if (move.castle === 'k') {
      this.board[move.to.row][5] = this.board[move.to.row][7];
      this.board[move.to.row][7] = null;
    }
    if (move.castle === 'q') {
      this.board[move.to.row][3] = this.board[move.to.row][0];
      this.board[move.to.row][0] = null;
    }

    let placedPiece = piece;
    if (move.promotion) placedPiece = piece[0] + 'q';
    this.board[move.to.row][move.to.col] = placedPiece;

    this.enPassant = null;
    if (move.doublePawn) {
      const midRow = (move.from.row + move.to.row) / 2;
      this.enPassant = { row: midRow, col: move.from.col };
    }

    if (piece[1] === 'k') {
      this.castling[piece[0]].k = false;
      this.castling[piece[0]].q = false;
    }
    if (piece[1] === 'r') {
      if (move.from.col === 0) this.castling[piece[0]].q = false;
      if (move.from.col === 7) this.castling[piece[0]].k = false;
    }
    if (move.capture && move.capture[1] === 'r') {
      const enemy = move.capture[0];
      if (move.to.col === 0) this.castling[enemy].q = false;
      if (move.to.col === 7) this.castling[enemy].k = false;
    }
  }

  makeMove(move) {
    this.applyMoveToState(move);
    this.lastMove = { from: move.from, to: move.to };
    this.moveLog.push(this.toAlgebraic(move));

    if (move.castle) chessSFX.castle();
    else if (move.promotion) chessSFX.promote();
    else if (move.capture || move.enPassant) chessSFX.capture();
    else chessSFX.move();

    this.turn = this.turn === 'w' ? 'b' : 'w';
    const inCheck = this.isKingInCheck(this.turn);
    if (inCheck) chessSFX.check();
    this.selected = null;
    this.legalMoves = [];
    this.render();

    const outcome = this.getGameOutcome(this.turn);
    if (outcome) {
      if (outcome.toLowerCase().includes('checkmated')) chessSFX.mate();
      else chessSFX.stalemate();
      this.statusEl.textContent = outcome;
      return;
    }

    if (this.modeSelect.value === 'ai' && this.turn === 'b') {
      this.scheduleAI();
    }
  }

  scheduleAI() {
    if (this.aiThinking) return;
    this.aiThinking = true;
    this.statusEl.textContent = 'AI is thinking...';
    setTimeout(() => {
      const move = this.chooseAIMove();
      this.aiThinking = false;
      if (move) this.makeMove(move);
    }, 450);
  }

  chooseAIMove() {
    const moves = this.getAllLegalMoves('b');
    if (!moves.length) return null;

    const depth = { easy: 1, medium: 2, hard: 3 }[this.difficultySelect.value] || 2;
    let bestMove = moves[0];
    let bestScore = Infinity;

    for (const move of moves) {
      const snap = this.snapshotState();
      this.applyMoveToState(move);
      this.turn = 'w';
      const score = this.minimax(depth - 1, true, -Infinity, Infinity);
      this.restoreState(snap);
      this.turn = 'b';
      if (score < bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
    return bestMove;
  }

  minimax(depth, maximizing, alpha, beta) {
    const color = maximizing ? 'w' : 'b';
    const outcome = this.getGameOutcome(color, true);
    if (depth === 0 || outcome) return this.evaluateBoard();

    const moves = this.getAllLegalMoves(color);
    if (!moves.length) return this.evaluateBoard();

    if (maximizing) {
      let best = -Infinity;
      for (const move of moves) {
        const snap = this.snapshotState();
        this.applyMoveToState(move);
        best = Math.max(best, this.minimax(depth - 1, false, alpha, beta));
        this.restoreState(snap);
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }

    let best = Infinity;
    for (const move of moves) {
      const snap = this.snapshotState();
      this.applyMoveToState(move);
      best = Math.min(best, this.minimax(depth - 1, true, alpha, beta));
      this.restoreState(snap);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  getAllLegalMoves(color) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r][c];
        if (piece && piece[0] === color) {
          moves.push(...this.getLegalMovesForSquare(r, c));
        }
      }
    }
    return moves;
  }

  evaluateBoard() {
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r][c];
        if (!piece) continue;
        const value = PIECE_VALUES[piece[1]] || 0;
        score += piece[0] === 'w' ? value : -value;
        if ((r >= 2 && r <= 5) && (c >= 2 && c <= 5)) score += piece[0] === 'w' ? 8 : -8;
      }
    }
    return score;
  }

  locateKing(color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.board[r][c] === color + 'k') return { row: r, col: c };
      }
    }
    return null;
  }

  isKingInCheck(color) {
    const king = this.locateKing(color);
    if (!king) return false;
    const enemy = color === 'w' ? 'b' : 'w';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r][c];
        if (!piece || piece[0] !== enemy) continue;
        const moves = this.getPseudoMoves(this.board, r, c, piece, false);
        if (moves.some(m => m.to.row === king.row && m.to.col === king.col)) return true;
      }
    }
    return false;
  }

  getGameOutcome(color, silent = false) {
    const moves = this.getAllLegalMoves(color);
    if (moves.length) return null;
    if (this.isKingInCheck(color)) return `${color === 'w' ? 'White' : 'Black'} is checkmated`;
    return silent ? 'stalemate' : 'Stalemate';
  }

  toAlgebraic(move) {
    return `${FILES[move.from.col]}${8 - move.from.row} → ${FILES[move.to.col]}${8 - move.to.row}`;
  }

  render() {
    const squares = this.boardEl.querySelectorAll('.square');
    squares.forEach((sq, index) => {
      const row = Math.floor(index / 8);
      const col = index % 8;
      const piece = this.board[row][col];
      sq.innerHTML = '';
      sq.classList.remove('selected', 'last-move', 'capture');

      if (this.selected && this.selected.row === row && this.selected.col === col) sq.classList.add('selected');
      if (this.lastMove && ((this.lastMove.from.row === row && this.lastMove.from.col === col) || (this.lastMove.to.row === row && this.lastMove.to.col === col))) {
        sq.classList.add('last-move');
      }

      const move = this.legalMoves.find(m => m.to.row === row && m.to.col === col);
      if (move) {
        const marker = document.createElement('div');
        marker.className = 'marker';
        if (move.capture || move.enPassant) sq.classList.add('capture');
        sq.appendChild(marker);
      }

      if (piece) {
        const el = document.createElement('div');
        el.className = `piece ${piece[0] === 'w' ? 'white' : 'black'}`;
        el.style.width = '78%';
        el.style.height = '78%';
        el.style.backgroundImage = `url("${SVG_PIECES[piece]}")`;
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundPosition = 'center';
        el.style.backgroundSize = 'contain';
        el.setAttribute('aria-label', PIECES[piece]);
        sq.appendChild(el);
      }
    });

    this.statusEl.textContent = `${this.turn === 'w' ? 'White' : 'Black'} to move${this.isKingInCheck(this.turn) ? ' • Check' : ''}`;
    this.whiteCard.classList.toggle('active', this.turn === 'w');
    this.blackCard.classList.toggle('active', this.turn === 'b');
    this.moveLogEl.innerHTML = this.moveLog.map((m, i) => `<div class="move-item">${i + 1}. ${m}</div>`).join('');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  updateChessSoundButton();
  new ChessRoyale();
});
