// ==========================================
// ArenaX - Core Application Logic
// Wallet · Authentication · Transactions
// ==========================================

class ArenaX {
    constructor() {
        this.COIN_PRICE = 10; // 1 coin = ₨10
        this.storageKey = 'arenax_data';
        this.MIN_WAGER = 5;
        this.MAX_WAGER = 1000;
        this._ready = false; // no balance mirroring until init() has synced
        this.init();
        this._ready = true;
    }

    init() {
        // Initialize or load existing data
        if (!localStorage.getItem(this.storageKey)) {
            this.resetData();
        }
        // Always re-sync from arenax_user so Supabase balance edits are reflected
        this.syncFromSessionUser();
    }

    // Bridge with the dashboard auth — api.js login stores arenax_user/arenax_token,
    // while this class uses arenax_data. Keep them in sync so game pages recognize
    // a dashboard login and share one balance.
    syncFromSessionUser() {
        try {
            const sessionUser = JSON.parse(localStorage.getItem('arenax_user') || 'null');
            if (!sessionUser) return;
            const data = this.getData();
            if (!data.user) data.user = {};
            data.user.username = sessionUser.username || sessionUser.name || data.user.username || 'Player';
            data.user.email    = sessionUser.email    || data.user.email    || '';
            data.user.phone    = sessionUser.phone    || data.user.phone    || '';
            data.user.uid      = sessionUser.uid      || sessionUser.id     || data.user.uid || '';
            data.user.id       = sessionUser.id       || sessionUser.uid    || data.user.id  || '';
            // Always sync balance — fall back to 100 so games are playable even without Supabase
            const sessionCoins = Number(sessionUser.coins ?? sessionUser.balance ?? NaN);
            if (!isNaN(sessionCoins) && sessionCoins > 0) {
                data.coins = sessionCoins;
                data.user.coins = sessionCoins;
                data.user.balance = sessionCoins;
            } else if (!data.coins || data.coins === 0) {
                // Default starter balance so wager screen doesn't block immediately
                data.coins = 100;
            }
            this.saveData(data);
        } catch (e) { /* corrupted session data — ignore */ }
    }

    // Get current state
    getData() {
        const data = localStorage.getItem(this.storageKey);
        return data ? JSON.parse(data) : this.getDefaultData();
    }

    // Save state (and mirror the balance back to the dashboard's session user)
    saveData(data) {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
        if (!this._ready) return; // during init we sync FROM the session, never over it
        try {
            const sessionUser = JSON.parse(localStorage.getItem('arenax_user') || 'null');
            if (sessionUser && sessionUser.coins !== data.coins) {
                sessionUser.coins = data.coins;
                sessionUser.balance = data.coins;
                localStorage.setItem('arenax_user', JSON.stringify(sessionUser));
            }
        } catch (e) { /* ignore */ }
    }

    // Default data structure
    getDefaultData() {
        return {
            user: null,
            coins: 0,
            totalDeposited: 0,
            totalWithdrawn: 0,
            totalWon: 0,
            gamesPlayed: 0,
            gamesWon: 0,
            transactions: [],
            gameHistory: []
        };
    }

    // Reset all data
    resetData() {
        this.saveData(this.getDefaultData());
    }

    // ========== Authentication ==========

    isLoggedIn() {
        const data = this.getData();
        if (data.user !== null) return true;
        // Also accept sessions set by api.js (dashboard login)
        const sessionUser = localStorage.getItem('arenax_user');
        const sessionToken = localStorage.getItem('arenax_token');
        return !!(sessionUser || sessionToken);
    }

    register(username, email, phone, password) {
        const data = this.getData();

        if (data.user) {
            return { success: false, message: 'Already logged in' };
        }

        if (!username || !email || !phone || !password) {
            return { success: false, message: 'All fields are required' };
        }

        data.user = {
            username,
            email,
            phone,
            joinedDate: new Date().toISOString(),
            level: 1
        };

        this.saveData(data);
        return { success: true, message: 'Registration successful' };
    }

    login(email, password) {
        const data = this.getData();

        if (!data.user) {
            return { success: false, message: 'No account found. Please register first.' };
        }

        if (data.user.email !== email) {
            return { success: false, message: 'Invalid credentials' };
        }

        return { success: true, message: 'Login successful' };
    }

    logout() {
        const data = this.getData();
        data.user = null;
        this.saveData(data);
        window.location.href = 'index.html';
    }

    getUser() {
        const data = this.getData();
        return data.user;
    }

    // ========== Wallet Management ==========

    getBalance() {
        const data = this.getData();
        if (data.coins > 0) return data.coins;
        // Fallback: read from api.js session user
        try {
            const u = JSON.parse(localStorage.getItem('arenax_user') || 'null');
            const bal = Number(u?.coins ?? u?.balance ?? 0);
            if (bal > 0) return bal;
        } catch(e) {}
        return data.coins;
    }

    addCoins(amount, source = 'deposit') {
        const data = this.getData();
        data.coins += amount;

        this.addTransaction({
            type: 'credit',
            amount: amount,
            source: source,
            timestamp: new Date().toISOString(),
            rupees: amount * this.COIN_PRICE
        });

        this.saveData(data);
        return data.coins;
    }

    deductCoins(amount, reason = 'game') {
        const data = this.getData();

        // If arenax_data is unpopulated, seed from session user first
        if (data.coins === 0) {
            try {
                const u = JSON.parse(localStorage.getItem('arenax_user') || 'null');
                const bal = Number(u?.coins ?? u?.balance ?? 0);
                if (bal > 0) data.coins = bal;
            } catch(e) {}
        }

        if (data.coins < amount) {
            return { success: false, message: 'Insufficient balance' };
        }

        data.coins -= amount;

        this.addTransaction({
            type: 'debit',
            amount: amount,
            source: reason,
            timestamp: new Date().toISOString(),
            rupees: amount * this.COIN_PRICE
        });

        this.saveData(data);
        return { success: true, balance: data.coins };
    }

    // ========== Transactions ==========

    addTransaction(transaction) {
        const data = this.getData();
        data.transactions.unshift({
            id: 'TXN' + Date.now(),
            ...transaction
        });

        // Keep only last 50 transactions
        if (data.transactions.length > 50) {
            data.transactions = data.transactions.slice(0, 50);
        }

        this.saveData(data);
    }

    getTransactions(limit = 10) {
        const data = this.getData();
        return data.transactions.slice(0, limit);
    }

    // ========== Deposits ==========

    deposit(method, amount, accountNumber) {
        if (!this.isLoggedIn()) {
            return { success: false, message: 'Please login first' };
        }

        if (amount < 10) {
            return { success: false, message: 'Minimum deposit is ₨10 (1 coin)' };
        }

        const coins = Math.floor(amount / this.COIN_PRICE);
        const data = this.getData();

        data.coins += coins;
        data.totalDeposited += amount;

        this.addTransaction({
            type: 'credit',
            amount: coins,
            source: 'deposit',
            method: method,
            accountNumber: accountNumber,
            timestamp: new Date().toISOString(),
            rupees: amount,
            status: 'completed'
        });

        this.saveData(data);

        return {
            success: true,
            message: `Successfully deposited ${coins} coins`,
            coins: coins,
            balance: data.coins
        };
    }

    // ========== Withdrawals ==========

    withdraw(method, coins, accountNumber) {
        if (!this.isLoggedIn()) {
            return { success: false, message: 'Please login first' };
        }

        const data = this.getData();

        if (coins < 1) {
            return { success: false, message: 'Minimum withdrawal is 1 coin' };
        }

        if (data.coins < coins) {
            return { success: false, message: 'Insufficient balance' };
        }

        const amount = coins * this.COIN_PRICE;
        data.coins -= coins;
        data.totalWithdrawn += amount;

        this.addTransaction({
            type: 'debit',
            amount: coins,
            source: 'withdrawal',
            method: method,
            accountNumber: accountNumber,
            timestamp: new Date().toISOString(),
            rupees: amount,
            status: 'pending'
        });

        this.saveData(data);

        return {
            success: true,
            message: `Withdrawal of ₨${amount} initiated`,
            amount: amount,
            balance: data.coins
        };
    }

    // ========== Game Management ==========

    validateWager(wager) {
        const amount = parseInt(wager, 10);
        if (Number.isNaN(amount)) {
            return { valid: false, message: 'Wager must be a number' };
        }
        if (amount < this.MIN_WAGER) {
            return { valid: false, message: `Minimum wager is ${this.MIN_WAGER} AX coins` };
        }
        if (amount > this.MAX_WAGER) {
            return { valid: false, message: `Maximum wager is ${this.MAX_WAGER} AX coins` };
        }
        return { valid: true, amount };
    }

    startGame(gameName, wager = 1) {
        if (!this.isLoggedIn()) {
            return { success: false, message: 'Please login to play' };
        }

        const validation = this.validateWager(wager);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        const result = this.deductCoins(validation.amount, 'game_entry');

        if (!result.success) {
            return result;
        }

        const data = this.getData();
        data.gamesPlayed++;
        this.saveData(data);

        return {
            success: true,
            message: 'Game started',
            balance: result.balance,
            wager: validation.amount
        };
    }

    startGameWithWager(gameName, wager) {
        return this.startGame(gameName, wager);
    }

    endGame(gameName, won, coinsWon, wager = null) {
        const data = this.getData();
        const entryWager = wager || Math.ceil(coinsWon / 2) || 1;

        if (won && coinsWon > 0) {
            data.coins += coinsWon;
            data.totalWon += coinsWon * this.COIN_PRICE;
            data.gamesWon++;

            this.addTransaction({
                type: 'credit',
                amount: coinsWon,
                source: 'game_win',
                game: gameName,
                timestamp: new Date().toISOString(),
                rupees: coinsWon * this.COIN_PRICE
            });
        }

        data.gameHistory.unshift({
            id: 'GAME' + Date.now(),
            game: gameName,
            won: won,
            coinsWon: coinsWon,
            wager: entryWager,
            timestamp: new Date().toISOString()
        });

        // Keep only last 100 games
        if (data.gameHistory.length > 100) {
            data.gameHistory = data.gameHistory.slice(0, 100);
        }

        this.saveData(data);

        return {
            success: true,
            won: won,
            coinsWon: coinsWon,
            wager: entryWager,
            balance: data.coins
        };
    }

    getGameHistory(limit = 10) {
        const data = this.getData();
        return data.gameHistory.slice(0, limit);
    }

    getStats() {
        const data = this.getData();
        return {
            coins: data.coins,
            totalDeposited: data.totalDeposited,
            totalWithdrawn: data.totalWithdrawn,
            totalWon: data.totalWon,
            gamesPlayed: data.gamesPlayed,
            gamesWon: data.gamesWon,
            winRate: data.gamesPlayed > 0 ? ((data.gamesWon / data.gamesPlayed) * 100).toFixed(1) : 0
        };
    }

    // ========== UI Helpers ==========

    updateBalanceDisplay() {
        const balance = this.getBalance();
        const elements = document.querySelectorAll('.balance-display');
        elements.forEach(el => {
            el.textContent = balance;
        });
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('show');
        }, 100);

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }

    formatDate(isoString) {
        const date = new Date(isoString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatCurrency(amount) {
        return '₨' + amount.toLocaleString();
    }

    /** Fetch live balance from Supabase users table via REST — works on ALL pages (no supabase-js needed). */
    async fetchBalanceFromSupabase() {
        try {
            const cfg = window.ARENAX_SUPABASE_CONFIG || window.ARENAX_CONFIG || {};
            const url = cfg.url || cfg.SUPABASE_URL;
            const key = cfg.anonKey || cfg.SUPABASE_ANON_KEY;
            if (!url || !key) return;

            // Read Supabase auth session directly from localStorage (no library needed)
            let session = null;
            try {
                const sbKey = Object.keys(localStorage).find(k => k.includes('arenax_sb_auth') || (k.includes('supabase') && k.includes('auth')));
                if (sbKey) {
                    const raw = JSON.parse(localStorage.getItem(sbKey) || 'null');
                    session = raw?.currentSession || raw?.session || raw;
                }
            } catch(e) {}

            if (!session?.access_token || !session?.user?.id) return;

            const res = await fetch(
                `${url}/rest/v1/users?id=eq.${session.user.id}&select=id,username,uid,balance,escrow_ax&limit=1`,
                {
                    headers: {
                        'apikey': key,
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!res.ok) return;
            const rows = await res.json();
            const data = rows?.[0];
            if (!data) return;

            const balance = Number(data.balance ?? 0);

            // Update arenax_user
            const u = JSON.parse(localStorage.getItem('arenax_user') || '{}');
            u.id = data.id; u.uid = data.uid || data.id;
            u.username = data.username || u.username;
            u.coins = balance; u.balance = balance;
            localStorage.setItem('arenax_user', JSON.stringify(u));

            // Update arenax_data (what game-common.js reads via getBalance())
            const appData = this.getData();
            if (!appData.user) appData.user = {};
            appData.coins = balance;
            appData.user.coins = balance;
            appData.user.balance = balance;
            appData.user.username = data.username || appData.user.username || 'Player';
            this.saveData(appData);

            this.updateBalanceDisplay();
            console.log('[arenaX] Balance synced from Supabase:', balance, 'AX');
        } catch (e) {
            console.warn('[arenaX] fetchBalanceFromSupabase failed:', e.message);
        }
    }
}

// Initialize ArenaX
const arenaX = new ArenaX();

// Make it globally accessible
window.arenaX = arenaX;

// Update balance on page load — and fetch live balance from Supabase
document.addEventListener('DOMContentLoaded', () => {
    arenaX.updateBalanceDisplay();

    // Fetch real balance from Supabase users table (reflects edits made in Supabase dashboard)
    arenaX.fetchBalanceFromSupabase();

    // Update user info if logged in
    if (arenaX.isLoggedIn()) {
        const user = arenaX.getUser();
        const userNameElements = document.querySelectorAll('.user-name');
        userNameElements.forEach(el => {
            el.textContent = user.username;
        });
    }
});