// ==========================================
// ArenaX - Core Application Logic
// Wallet · Authentication · Transactions
// ==========================================

class ArenaX {
    constructor() {
        this.COIN_PRICE = 10; // 1 coin = ₨10
        this.storageKey = 'arenax_data';
        this.init();
    }

    init() {
        // Initialize or load existing data
        if (!localStorage.getItem(this.storageKey)) {
            this.resetData();
        }
    }

    // Get current state
    getData() {
        const data = localStorage.getItem(this.storageKey);
        return data ? JSON.parse(data) : this.getDefaultData();
    }

    // Save state
    saveData(data) {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
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
        return data.user !== null;
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

    startGame(gameName) {
        if (!this.isLoggedIn()) {
            return { success: false, message: 'Please login to play' };
        }

        const result = this.deductCoins(1, 'game_entry');

        if (!result.success) {
            return result;
        }

        const data = this.getData();
        data.gamesPlayed++;
        this.saveData(data);

        return {
            success: true,
            message: 'Game started',
            balance: result.balance
        };
    }

    endGame(gameName, won, coinsWon) {
        const data = this.getData();

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
}

// Initialize ArenaX
const arenaX = new ArenaX();

// Make it globally accessible
window.arenaX = arenaX;

// Update balance on page load
document.addEventListener('DOMContentLoaded', () => {
    arenaX.updateBalanceDisplay();

    // Update user info if logged in
    if (arenaX.isLoggedIn()) {
        const user = arenaX.getUser();
        const userNameElements = document.querySelectorAll('.user-name');
        userNameElements.forEach(el => {
            el.textContent = user.username;
        });
    }
});