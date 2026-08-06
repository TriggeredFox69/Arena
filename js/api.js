const API_BASE_URL = '/api';

class ArenaXAPI {
    constructor() {
        this.token = localStorage.getItem('arenax_token');
        this.user = JSON.parse(localStorage.getItem('arenax_user') || 'null');
    }

    setSession(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('arenax_token', token);
        localStorage.setItem('arenax_user', JSON.stringify(user));
        return user;
    }

    logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('arenax_token');
        localStorage.removeItem('arenax_user');
        window.location.href = 'index.html';
    }

    isLoggedIn() {
        return !!this.token;
    }

    getUser() {
        return this.user || JSON.parse(localStorage.getItem('arenax_user') || 'null');
    }

    async request(method, endpoint, body = null) {
        const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (this.token) {
            options.headers['Authorization'] = `Bearer ${this.token}`;
        }
        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, options);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                return { success: false, message: data.message || `Request failed (${response.status})` };
            }
            return data;
        } catch (err) {
            console.warn(`[API] ${method} ${endpoint} failed, using fallback:`, err.message);
            return { success: false, message: 'Network error' };
        }
    }

    async register(username, email, phone, password) {
        const result = await this.request('POST', '/auth/register', { username, email, phone, password });
        if (result.success && result.token) {
            this.setSession(result.token, result.user);
        }
        return result;
    }

    async login(emailOrUsername, password) {
        const result = await this.request('POST', '/auth/login', { email: emailOrUsername, password });
        if (result.success && result.token) {
            this.setSession(result.token, result.user);
        }
        return result;
    }

    async getMe() {
        const result = await this.request('GET', '/auth/me');
        if (result.success && result.user) {
            this.user = result.user;
            localStorage.setItem('arenax_user', JSON.stringify(result.user));
        }
        return result;
    }

    async getBalance() {
        return this.request('GET', '/wallet/balance');
    }

    async deposit(method, amount, accountNumber) {
        return this.request('POST', '/wallet/deposit', { method, amount, accountNumber });
    }

    async withdraw(method, coins, accountNumber) {
        return this.request('POST', '/wallet/withdraw', { method, coins, accountNumber });
    }

    async getTransactions(page = 1, limit = 20) {
        return this.request('GET', `/wallet/transactions?page=${page}&limit=${limit}`);
    }

    async startGame(game) {
        return this.request('POST', '/games/start', { game });
    }

    async endGame(game, won, coinsWon, gameData = {}) {
        return this.request('POST', '/games/end', { game, won, coinsWon, gameData });
    }

    async getGameHistory(page = 1, limit = 20, game = '') {
        const q = `page=${page}&limit=${limit}${game ? `&game=${encodeURIComponent(game)}` : ''}`;
        return this.request('GET', `/games/history?${q}`);
    }

    async getGameStats() {
        return this.request('GET', '/games/stats');
    }

    // Generic endpoints — still mocked for features not yet migrated to Netlify Functions
    async get(endpoint) {
        if (endpoint.includes('/friends/list')) {
            return {
                success: true,
                friends: [
                    { id: 101, username: 'ShadowPro', wins: 42, losses: 13, online: true },
                    { id: 102, username: 'CoinKing', wins: 31, losses: 18, online: false },
                    { id: 103, username: 'PoolMaster', wins: 67, losses: 22, online: true }
                ]
            };
        }
        if (endpoint.includes('/friends/requests')) return { success: true, requests: [] };
        if (endpoint.includes('/marketplace/orders')) {
            return {
                success: true,
                sellOrders: [
                    { id: 1, amount_ax: 500, filled_amount: 0, price_per_ax: 9.8 },
                    { id: 2, amount_ax: 250, filled_amount: 0, price_per_ax: 10.0 },
                    { id: 3, amount_ax: 1000, filled_amount: 0, price_per_ax: 10.2 }
                ],
                buyOrders: [
                    { id: 4, amount_ax: 300, filled_amount: 0, price_per_ax: 9.5 },
                    { id: 5, amount_ax: 800, filled_amount: 0, price_per_ax: 9.2 }
                ]
            };
        }
        if (endpoint.includes('/chat/')) return { success: true, messages: [] };
        return this.request('GET', endpoint);
    }

    async post(endpoint, body = {}) {
        if (endpoint.includes('/usdt/buy')) {
            const user = this.getUser();
            const ax = Number(body.amountAx || 0);
            if (user) {
                user.coins = (user.coins || user.balance || 0) + ax;
                user.balance = user.coins;
                localStorage.setItem('arenax_user', JSON.stringify(user));
                this.user = user;
            }
            return { success: true, message: `Bought ${ax} AX` };
        }
        if (endpoint.includes('/usdt/withdraw')) {
            const user = this.getUser();
            const ax = Number(body.amountAx || 0);
            if (!user || (user.coins || 0) < ax) {
                return { success: false, message: 'Insufficient AX balance' };
            }
            user.coins -= ax;
            user.balance = user.coins;
            localStorage.setItem('arenax_user', JSON.stringify(user));
            this.user = user;
            return { success: true, message: `Withdrew ${ax} AX` };
        }
        if (endpoint.includes('/friends/add')) return { success: true, message: 'Friend request sent' };
        if (endpoint.includes('/friends/accept')) return { success: true, message: 'Friend request accepted' };
        if (endpoint.includes('/marketplace/order')) return { success: true, message: 'Order placed' };
        return this.request('POST', endpoint, body);
    }
}

const api = new ArenaXAPI();
window.api = api;
