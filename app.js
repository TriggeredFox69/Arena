/* ==========================================================================
   ARENAX - APP CONTROLLER (PAKISTANI PKR ECONOMY & TOKEN WAGERS)
   ========================================================================== */

class AppController {
  static GAME_TITLES = {
    carrom: 'Carrom Clash',
    ludo: 'Ludo Duel',
    solitaire: 'Speed Solitaire',
    glowhockey: 'Glow Hockey',
    chess: 'Chess Royale',
    checkers: 'Checkers Pro',
    snooker: 'Snooker Elite',
    pool: 'Pool 8-Ball',
    darts: 'Dart Master'
  };

  static GAME_CLASSES = {
    carrom: 'CarromClash',
    ludo: 'LudoDuel',
    solitaire: 'SpeedSolitaire',
    glowhockey: 'GlowHockey',
    chess: 'ChessRoyale',
    checkers: 'CheckersPro',
    snooker: 'SnookerElite',
    pool: 'Pool8Ball',
    darts: 'DartMaster'
  };

  // Games that render taller than they are wide.
  static GAME_ASPECT = {
    solitaire: '600 / 850',
    glowhockey: '520 / 800',
    pool: '1000 / 520',
    snooker: '1000 / 500'
  };

  constructor() {
    this.balance = 100; // Default 100 AX Tokens (= Rs. 1,000 PKR)
    this.tokenRate = 10; // 1 AX Token = 10 PKR
    this.history = [];
    this.stats = { wins: 0, losses: 0, totalWagered: 0, totalWon: 0 };

    // Reset active player counts on refresh
    this.activePlayers = JSON.parse(localStorage.getItem('ivenax_active_players') || '{}');
    if (!this.activePlayers.carrom) this.activePlayers.carrom = 1420;
    if (!this.activePlayers.ludo) this.activePlayers.ludo = 2890;
    if (!this.activePlayers.solitaire) this.activePlayers.solitaire = 980;
    if (!this.activePlayers.airhockey) this.activePlayers.airhockey = 560;
    if (!this.activePlayers.chess) this.activePlayers.chess = 3240;
    if (!this.activePlayers.checkers) this.activePlayers.checkers = 1890;
    if (!this.activePlayers.snooker) this.activePlayers.snooker = 720;
    if (!this.activePlayers.pool) this.activePlayers.pool = 450;
    if (!this.activePlayers.darts) this.activePlayers.darts = 630;
    
    this.selectedGame = null;
    this.selectedWager = 10; // Default 10 AX Tokens
    this.selectedMode = 'pvp';
    this.activeGameInstance = null;
    this.activeWager = 0;
    this.onStateChange = () => this.saveActiveGame();

    // Deposit & Withdrawal State
    this.depositPkr = 100;
    this.depositTokens = 10;
    this.depositGateway = 'easypaisa';
    this.withdrawMethod = 'easypaisa';

    this.loadStorage();
    this.initUI();
    this.startLivePlayers();

    // Initialize new platform components
    this.initComponents();

    if (new URLSearchParams(window.location.search).get("clear") === "1") { localStorage.removeItem("arenax_active_game"); }
    this.tryResumeActiveGame();
  }

  initComponents() {
    // Only initialize if user is logged in
    const token = localStorage.getItem('arenax_token');
    if (!token) return;

    console.log('[App] Initializing platform components...');

    // Initialize store with user data
    if (this.username) {
      store.setUser({
        id: this.userId,
        username: this.username,
        balance: this.balance
      });
    }

    // Connect WebSocket
    try {
      socketClient.connect(token);
      console.log('[App] WebSocket connected');
    } catch (err) {
      console.error('[App] WebSocket connection failed:', err);
    }

    // Mount sidebar component
    try {
      sidebar.mount('sidebar-container');
      sidebar.loadFriends();
      sidebar.loadFriendRequests();
      console.log('[App] Sidebar mounted');
    } catch (err) {
      console.error('[App] Sidebar mount failed:', err);
    }

    // Listen for WebSocket events and update store
    socketClient.on('transfer_received', (data) => {
      store.addNotification({
        type: 'transfer',
        title: 'Tokens Received!',
        message: `${data.fromUsername} sent you ${data.amount} AX tokens${data.message ? ': ' + data.message : ''}`
      });
      // Refresh balance
      this.refreshBalance();
    });

    socketClient.on('order_filled', (data) => {
      store.addNotification({
        type: 'marketplace',
        title: 'Order Filled!',
        message: `Your ${data.type} order was filled: ${data.amount} AX @ ${data.price} PKR`
      });
      // Refresh balance
      this.refreshBalance();
    });

    console.log('[App] Components initialized successfully');
  }

  async refreshBalance() {
    try {
      const response = await api.get('/api/auth/me');
      if (response.user) {
        this.balance = response.user.balance;
        this.updateBalanceUI();
        store.updateBalance(response.user.balance);
      }
    } catch (err) {
      console.error('[App] Failed to refresh balance:', err);
    }
  }

  saveActiveGame() {
    if (!this.activeGameInstance || !this.selectedGame) return;
    if (typeof this.activeGameInstance.serialize !== 'function') return;
    const payload = {
      gameKey: this.selectedGame,
      wager: this.activeWager,
      mode: this.selectedMode,
      pot: this.activeWager * 2,
      state: this.activeGameInstance.serialize(),
      savedAt: Date.now()
    };
    localStorage.setItem('arenax_active_game', JSON.stringify(payload));
    this.updateActivePlayerUI();
  }

  clearActiveGame() {
    localStorage.removeItem('arenax_active_game');
    if (this.activeGameInstance && typeof this.activeGameInstance.destroy === 'function') {
      try { this.activeGameInstance.destroy(); } catch (e) {}
      const wrapper = this.activeGameInstance.wrapper;
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      this.activeGameInstance = null;
    }
    const canvasFrame = document.getElementById('canvasFrame');
    if (canvasFrame) canvasFrame.innerHTML = '<canvas id="mainCanvas"></canvas>';
    this.updateActivePlayerUI();
  }

  updateActivePlayerUI() {
    const el = document.getElementById('arenaActivePlayer');
    if (!el || !this.activeGameInstance) return;
    const turn = this.activeGameInstance.turn;
    const mode = this.activeGameInstance.mode || this.selectedMode;
    if (turn === 1) {
      el.innerText = 'P1 TURN';
      el.className = 'active-player-pill p1-active';
    } else {
      el.innerText = mode === 'ai' ? 'AI TURN' : 'P2 TURN';
      el.className = 'active-player-pill p2-active';
    }
  }

  startLivePlayers() {
    setInterval(() => {
      const badges = document.querySelectorAll('.badge-online');
      badges.forEach(el => {
        let count = parseInt(el.dataset.count, 10);
        if (isNaN(count)) return;
        const delta = Math.floor(Math.random() * 7) - 3;
        count = Math.max(50, count + delta);
        el.dataset.count = count;
        el.innerText = count.toLocaleString() + ' Active';
      });
    }, 2000);
  }

  tryResumeActiveGame() {
    const raw = localStorage.getItem('arenax_active_game');
    if (!raw) return;
    let saved;
    try { saved = JSON.parse(raw); } catch { return; }
    if (!saved?.gameKey || !saved?.state) return;
    if (Date.now() - (saved.savedAt || 0) > 86400000) {
      this.clearActiveGame();
      return;
    }

    this.selectedGame = saved.gameKey;
    this.selectedMode = saved.mode || 'pvp';
    this.activeWager = saved.wager || 10;
    this.selectedWager = this.activeWager;

    const canvas = document.getElementById('mainCanvas');
    document.getElementById('arenaGameTitle').innerText = AppController.GAME_TITLES[saved.gameKey] || 'Arena Match';
    document.getElementById('arenaPotDisplay').innerText = `POT: ${(saved.pot || saved.wager * 2).toLocaleString()} AX`;

    const options = {
      mode: saved.mode,
      wager: saved.wager,
      savedState: saved.state,
      onGameOver: (res) => this.handleGameOver(res),
      onStateChange: this.onStateChange,
      canvas: canvas
    };

    const ctor = AppController.GAME_CLASSES[saved.gameKey];
    if (!ctor || typeof window[ctor] !== 'function') {
      this.clearActiveGame();
      return;
    }

    try {
      this.activeGameInstance = new window[ctor](canvas, options);
      this.showView('arenaView');
      this.updateActivePlayerUI();
      this.activeGameInstance.start();
    } catch (e) {
      console.error('Failed to resume active game:', e);
      this.clearActiveGame();
    }
  }

  loadStorage() {
    const savedBalance = localStorage.getItem('arenax_token_balance');
    if (savedBalance !== null) this.balance = parseInt(savedBalance, 10);
    const savedHistory = localStorage.getItem('arenax_history');
    if (savedHistory) this.history = JSON.parse(savedHistory);
    const savedStats = localStorage.getItem('arenax_stats');
    if (savedStats) this.stats = JSON.parse(savedStats);
  }

  saveStorage() {
    localStorage.setItem('arenax_token_balance', this.balance);
    localStorage.setItem('arenax_history', JSON.stringify(this.history));
    localStorage.setItem('arenax_stats', JSON.stringify(this.stats));
  }

  initUI() {
    this.updateBalanceUI();

    // Bottom Navigation Bar Tab Switching
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        if (window.soundEngine) window.soundEngine.playClick();
        const tabKey = tab.dataset.tab;
        this.setActiveTab(tabKey);
        if (tabKey === 'lobby') { this.closeAllSheets(); this.showView('lobbyView'); }
        else if (tabKey === 'deposit') this.openDepositSheet();
        else if (tabKey === 'withdraw') this.openWithdrawSheet();
        else if (tabKey === 'history') { this.renderHistory(); this.openSheet('historySheet'); }
      });
    });

    // Escape closes any open sheet — previously the only exit was a thin strip
    // of backdrop above the sheet.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAllSheets();
    });

    // Deposit Packages Selector
    document.querySelectorAll('.deposit-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (window.soundEngine) window.soundEngine.playClick();
        document.querySelectorAll('.deposit-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        this.depositPkr = parseInt(chip.dataset.pkr, 10);
        this.depositTokens = parseInt(chip.dataset.tokens, 10);
      });
    });

    // Deposit Gateway Selector
    document.querySelectorAll('.gateway-badge').forEach(badge => {
      badge.addEventListener('click', () => {
        if (window.soundEngine) window.soundEngine.playClick();
        document.querySelectorAll('.gateway-badge').forEach(b => b.classList.remove('selected'));
        badge.classList.add('selected');
        this.depositGateway = badge.dataset.method;
      });
    });

    // Deposit Execution Button
    document.getElementById('executeDepositBtn').addEventListener('click', () => {
      this.executeDeposit();
    });

    // Withdrawal Input Calculation Preview
    const tokenInput = document.getElementById('withdrawTokenInput');
    if (tokenInput) {
      tokenInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10) || 0;
        document.getElementById('withdrawPkrPreview').innerText = `= Rs. ${(val * this.tokenRate).toLocaleString()} PKR`;
      });
    }

    // Withdrawal Method Cards
    document.querySelectorAll('[data-wmethod]').forEach(card => {
      card.addEventListener('click', () => {
        if (window.soundEngine) window.soundEngine.playClick();
        document.querySelectorAll('[data-wmethod]').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.withdrawMethod = card.dataset.wmethod;
      });
    });

    // Withdrawal Execution Button
    document.getElementById('executeWithdrawBtn').addEventListener('click', () => {
      this.executeWithdrawal();
    });

    // Wager Chip Selection (1 to 10,000 Tokens)
    document.querySelectorAll('.wager-chip-item').forEach(chip => {
      chip.addEventListener('click', () => {
        if (window.soundEngine) window.soundEngine.playClick();
        document.querySelectorAll('.wager-chip-item').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        this.selectedWager = parseInt(chip.dataset.wager, 10);
      });
    });

    document.querySelectorAll('.mode-option-card[data-mode]').forEach(card => {
      card.addEventListener('click', () => {
        if (window.soundEngine) window.soundEngine.playClick();
        document.querySelectorAll('.mode-option-card[data-mode]').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedMode = card.dataset.mode;
        this.updateModeUI();
      });
    });

    // Toggle difficulty/side selectors based on game and mode
    this.updateModeUI = () => {
      const isChess = this.selectedGame === 'chess';
      const isAI = this.selectedMode === 'ai';
      document.getElementById('difficultyWrap').style.display = (isChess && isAI) ? '' : 'none';
      document.getElementById('sideWrap').style.display = (isChess && isAI) ? '' : 'none';
    };

    // Confirm Wager & Start Match
    document.getElementById('startWagerBtn').addEventListener('click', () => {
      if (this.balance < this.selectedWager || this.selectedWager <= 0) {
        this.notify('Insufficient Balance', 'You do not have enough AX Tokens for this wager. Deposit PKR via EasyPaisa, JazzCash or PayFast to continue.');
        return;
      }
      if (window.soundEngine) window.soundEngine.playWagerBet();
      this.closeSheet('wagerSheet');
      this.launchGame(this.selectedGame, this.selectedWager, this.selectedMode);
    });

    // Exit Arena
    document.getElementById('closeArenaBtn').addEventListener('click', () => {
      if (this.activeGameInstance) {
        this.saveActiveGame();
        this.activeGameInstance.destroy();
        this.activeGameInstance = null;
      }
      this.showView('lobbyView');
    });

    window.addEventListener('beforeunload', () => this.saveActiveGame());

    // Close sheets on backdrop click
    document.querySelectorAll('.sheet-backdrop').forEach(sheet => {
      sheet.addEventListener('click', (e) => {
        if (e.target === sheet) sheet.classList.remove('active');
      });
    });
  }



  openDepositSheet() {
    if (window.soundEngine) window.soundEngine.playClick();
    this.openSheet('depositSheet');
  }

  openWithdrawSheet() {
    if (window.soundEngine) window.soundEngine.playClick();
    this.openSheet('withdrawSheet');
  }

  executeDeposit() {
    if (window.soundEngine) window.soundEngine.playWagerBet();
    const pkr = this.depositPkr;
    const tokens = this.depositTokens;
    const gatewayNames = { easypaisa: 'EasyPaisa', jazzcash: 'JazzCash', payfast: 'PayFast Online' };
    const method = gatewayNames[this.depositGateway] || 'Online Gateway';
    const txId = 'TXN_' + Math.floor(100000 + Math.random() * 900000);

    this.balance += tokens;
    this.history.unshift({
      game: `Deposit (${method})`,
      wager: `Rs. ${pkr.toLocaleString()} PKR`,
      result: 'APPROVED',
      pot: tokens
    });

    this.saveStorage();
    this.updateBalanceUI();
    this.closeSheet('depositSheet');
    alert(`DEPOSIT SUCCESSFUL!\n\nTransaction ID: ${txId}\nAmount Paid: Rs. ${pkr.toLocaleString()} PKR\nTokens Added: +${tokens} AX Tokens`);
  }

  executeWithdrawal() {
    const tokens = parseInt(document.getElementById('withdrawTokenInput').value, 10) || 0;
    const accountNo = document.getElementById('withdrawAccountInput').value.trim();

    if (tokens < 10) { this.notify('Amount Too Low', 'The minimum withdrawal is 10 AX Tokens (Rs. 100 PKR).'); return; }
    if (tokens > this.balance) { this.notify('Insufficient Balance', 'You do not have enough AX Tokens for this withdrawal.'); return; }
    if (!accountNo) { this.notify('Account Required', 'Please enter a valid account or mobile number.'); return; }

    if (window.soundEngine) window.soundEngine.playWagerBet();

    const pkrAmount = tokens * this.tokenRate;
    const methodNames = { easypaisa: 'EasyPaisa', jazzcash: 'JazzCash', bank: 'Bank IBAN' };
    const method = methodNames[this.withdrawMethod] || 'Mobile Wallet';
    const txId = 'WD_' + Math.floor(100000 + Math.random() * 900000);

    this.balance -= tokens;
    this.history.unshift({
      game: `Withdraw (${method})`,
      wager: `${tokens} AX Tokens`,
      result: 'PROCESSED',
      pot: `Rs. ${pkrAmount.toLocaleString()} PKR`
    });

    this.saveStorage();
    this.updateBalanceUI();
    this.closeSheet('withdrawSheet');
    alert(`WITHDRAWAL REQUEST PROCESSED!\n\nRef ID: ${txId}\nTokens Deducted: ${tokens} AX\nAmount Sent: Rs. ${pkrAmount.toLocaleString()} PKR\nAccount: ${accountNo} (${method})`);
  }

  openWagerSheet(gameKey) {
    if (window.soundEngine) window.soundEngine.playClick();
    this.selectedGame = gameKey;
    document.getElementById('sheetGameTitle').innerText = AppController.GAME_TITLES[gameKey] || 'Arena Match';
    this.syncWagerSheetUI();
    this.openSheet('wagerSheet');
  }

  // Makes the sheet's highlighted chips match the state the app will actually
  // use, so the player is never charged a different stake than the one shown.
  syncWagerSheetUI() {
    document.querySelectorAll('.wager-chip-item').forEach(c => {
      c.classList.toggle('selected', parseInt(c.dataset.wager, 10) === this.selectedWager);
    });
    document.querySelectorAll('.mode-option-card[data-mode]').forEach(c => {
      c.classList.toggle('selected', c.dataset.mode === this.selectedMode);
    });
    this.updateModeUI();
  }

  // Only one sheet may be open at a time; stacking them left the user with no
  // reachable backdrop to dismiss.
  openSheet(id) {
    this.closeAllSheets();
    document.getElementById(id).classList.add('active');
  }

  closeSheet(id) { document.getElementById(id).classList.remove('active'); }

  closeAllSheets() {
    document.querySelectorAll('.sheet-backdrop.active').forEach(s => s.classList.remove('active'));
  }

  // In-app replacement for alert(). `variant` tints the icon: info | win | loss.
  notify(title, message, variant = 'info') {
    const sheet = document.getElementById('noticeSheet');
    if (!sheet) { console.warn(`${title}: ${message}`); return; }
    document.getElementById('noticeTitle').textContent = title;
    document.getElementById('noticeBody').textContent = message;
    const icon = document.getElementById('noticeIcon');
    icon.textContent = variant === 'win' ? '✓' : variant === 'loss' ? '✕' : '!';
    icon.className = `notice-icon notice-${variant}`;
    this.openSheet('noticeSheet');
  }

  showView(viewId) {
    document.getElementById('lobbyView').style.display = viewId === 'lobbyView' ? 'flex' : 'none';
    document.getElementById('arenaView').style.display = viewId === 'arenaView' ? 'flex' : 'none';

    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) bottomNav.style.display = viewId === 'arenaView' ? 'none' : 'flex';

    if (viewId === 'lobbyView') this.setActiveTab('lobby');

    const canvasFrame = document.getElementById('canvasFrame');
    if (canvasFrame) {
      canvasFrame.style.aspectRatio = viewId === 'arenaView'
        ? (AppController.GAME_ASPECT[this.selectedGame] || '1 / 1')
        : '1 / 1';
    }
  }

  // Keeps the highlighted nav tab in sync with what is actually on screen.
  setActiveTab(tabKey) {
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabKey);
    });
  }

  updateBalanceUI() {
    document.getElementById('headerTokenDisplay').innerText = `${this.balance.toLocaleString()} AX`;
    document.getElementById('headerPkrDisplay').innerText = `(Rs. ${(this.balance * this.tokenRate).toLocaleString()})`;
  }

  launchGame(gameKey, wagerTokens, mode) {
    const loader = document.getElementById('gameLoader');
    const canvas = document.getElementById('mainCanvas');
    const ctor = AppController.GAME_CLASSES[gameKey];

    if (!ctor || typeof window[ctor] !== 'function') {
      this.notify('Unavailable', `${AppController.GAME_TITLES[gameKey] || 'This game'} could not be loaded. Your tokens have not been deducted.`);
      return;
    }

    this.clearActiveGame();
    this.selectedGame = gameKey;
    this.activeWager = wagerTokens;
    this.selectedMode = mode;

    const options = {
      mode: mode,
      wager: wagerTokens,
      onGameOver: (res) => this.handleGameOver(res),
      onStateChange: this.onStateChange,
      canvas: canvas,
      humanColor: mode === 'ai' ? (document.getElementById('sideSelect')?.value || 'w') : 'w',
      difficulty: mode === 'ai' ? (document.getElementById('difficultySelect')?.value || 'medium') : 'medium'
    };

    // Construct BEFORE debiting so a failure can never take the player's tokens.
    let instance;
    try {
      instance = new window[ctor](canvas, options);
    } catch (e) {
      console.error(`Failed to start ${gameKey}:`, e);
      if (loader) loader.classList.remove('active');
      this.notify('Unavailable', `${AppController.GAME_TITLES[gameKey] || 'This game'} failed to start. Your tokens have not been deducted.`);
      return;
    }

    this.activeGameInstance = instance;
    this.balance -= wagerTokens;
    this.stats.totalWagered += wagerTokens;
    this.saveStorage();
    this.updateBalanceUI();

    document.getElementById('arenaPotDisplay').innerText = `POT: ${(wagerTokens * 2).toLocaleString()} AX`;
    document.getElementById('arenaGameTitle').innerText = AppController.GAME_TITLES[gameKey] || 'Arena Match';

    if (loader) loader.classList.add('active');
    this.loaderTimer = setTimeout(() => {
      if (loader) loader.classList.remove('active');
      this.showView('arenaView');
      this.updateActivePlayerUI();
      this.saveActiveGame();
      try {
        this.activeGameInstance.start();
      } catch (e) {
        console.error(`Failed to start ${gameKey}:`, e);
        this.refundWager('Match could not be started');
      }
    }, 900);
  }

  // Returns the stake when a match never actually got underway.
  refundWager(reason) {
    if (!this.activeWager) return;
    this.balance += this.activeWager;
    this.stats.totalWagered -= this.activeWager;
    this.saveStorage();
    this.updateBalanceUI();
    this.clearActiveGame();
    this.showView('lobbyView');
    this.notify('Match Cancelled', `${reason}. Your ${this.activeWager.toLocaleString()} AX stake has been refunded.`);
    this.activeWager = 0;
  }

  handleGameOver(result) {
    this.clearActiveGame();
    const isWin = result.userWon;
    const potTokens = result.pot;

    if (isWin) {
      this.balance += potTokens;
      this.stats.wins++;
      this.stats.totalWon += potTokens;
      if (window.soundEngine) window.soundEngine.playVictory();
    } else {
      this.stats.losses++;
      if (window.soundEngine) window.soundEngine.playExplosion();
    }

    this.history.unshift({
      game: result.game,
      wager: `${result.pot / 2} AX`,
      result: isWin ? 'WIN' : 'LOSS',
      pot: isWin ? potTokens : 0
    });
    this.saveStorage();
    this.updateBalanceUI();

    alert(isWin
      ? `VICTORY! You won ${potTokens.toLocaleString()} AX Tokens (Rs. ${(potTokens * this.tokenRate).toLocaleString()} PKR)!`
      : `DEFEAT! Better luck next match.`);
    this.showView('lobbyView');
  }

  renderHistory() {
    const container = document.getElementById('historyContainer');
    if (this.history.length === 0) {
      container.innerHTML = `<p style="text-align:center; color: var(--text-muted); padding: 20px; font-size: 0.85rem;">No transaction history recorded yet.</p>`;
      return;
    }
    container.innerHTML = this.history.map(h => `
      <div class="row-item">
        <div>
          <div style="font-weight:700; font-size: 0.9rem;">${h.game}</div>
          <div style="font-size:0.75rem; color:var(--text-secondary);">Details: ${h.wager}</div>
        </div>
        <div class="${h.result === 'LOSS' ? 'text-loss' : 'text-win'}">
          ${h.result} (${h.pot})
        </div>
      </div>
    `).join('');
  }
}

// NOTE: AppController is now instantiated by auth.js after a successful
// login/register/session-restore, not automatically on DOMContentLoaded.
