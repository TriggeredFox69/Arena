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
        localStorage.removeItem('arenaX_state_v1');
        if (typeof window !== 'undefined' && typeof window.showLanding === 'function') {
            window.showLanding();
        }
    }

    isLoggedIn() {
        return !!(this.token || this.user);
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
            return result;
        }
        // Fallback for demo / offline mode
        const mockUser = {
            id: 'AX' + Math.floor(100000 + Math.random() * 900000),
            username: username || email.split('@')[0] || 'Player',
            email: email,
            phone: phone,
            coins: 100,
            gamesPlayed: 0,
            wins: 0
        };
        const mockToken = 'demo-token-' + Date.now();
        this.setSession(mockToken, mockUser);
        return { success: true, message: 'Registration successful', token: mockToken, user: mockUser };
    }

    async login(emailOrUsername, password) {
        const result = await this.request('POST', '/auth/login', { email: emailOrUsername, password });
        if (result.success && result.token) {
            this.setSession(result.token, result.user);
            return result;
        }
        // Fallback for demo / offline mode
        const mockUser = {
            id: 'AX' + Math.floor(100000 + Math.random() * 900000),
            username: emailOrUsername.split('@')[0] || 'Player',
            email: emailOrUsername,
            coins: 100,
            gamesPlayed: 0,
            wins: 0
        };
        const mockToken = 'demo-token-' + Date.now();
        this.setSession(mockToken, mockUser);
        return { success: true, message: 'Login successful', token: mockToken, user: mockUser };
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

    showNotification(message, type = 'info') {
        let box = document.getElementById('arenax-notifications');
        if (!box) {
            box = document.createElement('div');
            box.id = 'arenax-notifications';
            box.style.cssText = 'position:fixed;top:18px;right:18px;z-index:9999;display:flex;flex-direction:column;gap:10px;';
            document.body.appendChild(box);
        }
        const el = document.createElement('div');
        const colors = {
            success: 'background:rgba(83,220,147,.14);border-color:rgba(83,220,147,.4);color:#c8ffe0;',
            error: 'background:rgba(242,92,92,.14);border-color:rgba(242,92,92,.4);color:#ffc4c4;',
            info: 'background:rgba(113,168,255,.14);border-color:rgba(113,168,255,.4);color:#d6e6ff;'
        };
        el.style.cssText = `padding:12px 18px;border-radius:14px;border:1px solid;font-weight:700;font-size:13.5px;backdrop-filter:blur(12px);box-shadow:0 14px 40px rgba(0,0,0,.45);animation:toastIn .35s ease;${colors[type] || colors.info}`;
        el.textContent = message;
        box.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; setTimeout(() => el.remove(), 300); }, 3000);
    }

    playAuthAnimation(type, title, message, callback) {
        if (!document.getElementById('ax-auth-anim-styles')) {
            const style = document.createElement('style');
            style.id = 'ax-auth-anim-styles';
            style.textContent = `
                @keyframes axOverlayFadeIn {
                    from { opacity: 0; backdrop-filter: blur(0px); }
                    to { opacity: 1; backdrop-filter: blur(24px); }
                }
                @keyframes axCardZoom {
                    from { opacity: 0; transform: scale(0.85) translateY(20px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                @keyframes axPulseGlow {
                    0%, 100% { box-shadow: 0 0 35px rgba(216, 164, 59, 0.25), 0 0 70px rgba(216, 164, 59, 0.1); border-color: rgba(216, 164, 59, 0.4); }
                    50% { box-shadow: 0 0 65px rgba(216, 164, 59, 0.55), 0 0 120px rgba(216, 164, 59, 0.25); border-color: rgba(255, 231, 166, 0.8); }
                }
                @keyframes axSpinRing {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes axFillBar {
                    0% { width: 0%; }
                    100% { width: 100%; }
                }
                .ax-auth-overlay {
                    position: fixed; inset: 0; z-index: 999999;
                    background: rgba(6, 6, 8, 0.94);
                    display: flex; align-items: center; justify-content: center;
                    animation: axOverlayFadeIn 0.35s ease forwards;
                    font-family: 'Inter', sans-serif;
                }
                .ax-auth-card {
                    background: radial-gradient(circle at 50% 0%, rgba(216, 164, 59, 0.15), transparent 70%), linear-gradient(180deg, rgba(22, 22, 30, 0.95), rgba(10, 10, 14, 0.98));
                    border: 1px solid rgba(216, 164, 59, 0.35);
                    border-radius: 28px;
                    padding: 42px 48px;
                    width: min(440px, calc(100vw - 40px));
                    text-align: center;
                    position: relative;
                    animation: axCardZoom 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, axPulseGlow 3s ease-in-out infinite;
                }
                .ax-auth-icon-wrap {
                    position: relative;
                    width: 84px; height: 84px; margin: 0 auto 24px;
                    display: flex; align-items: center; justify-content: center;
                }
                .ax-auth-spinner {
                    position: absolute; inset: 0;
                    border-radius: 50%;
                    border: 3px solid transparent;
                    border-top-color: #d8a43b;
                    border-right-color: #ffe7a6;
                    animation: axSpinRing 1.2s linear infinite;
                }
                .ax-auth-icon-inner {
                    width: 64px; height: 64px; border-radius: 50%;
                    background: linear-gradient(135deg, rgba(216, 164, 59, 0.25), rgba(139, 97, 24, 0.2));
                    border: 1px solid rgba(255, 231, 166, 0.3);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 28px; color: #ffe7a6;
                }
                .ax-auth-title-text {
                    font-family: 'Orbitron', sans-serif;
                    font-size: 22px; font-weight: 800;
                    color: #faf5ea; margin-bottom: 8px;
                    letter-spacing: 0.5px;
                }
                .ax-auth-sub-text {
                    color: #b7ab95; font-size: 13.5px;
                    line-height: 1.5; margin-bottom: 24px;
                }
                .ax-auth-progress-track {
                    width: 100%; height: 6px;
                    background: rgba(255, 255, 255, 0.08);
                    border-radius: 999px; overflow: hidden;
                    margin-bottom: 20px;
                }
                .ax-auth-progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #8b6118, #d8a43b, #ffe7a6);
                    border-radius: 999px;
                    animation: axFillBar 1.1s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                }
                .ax-auth-brand {
                    font-family: 'Orbitron', sans-serif;
                    font-size: 13px; font-weight: 800;
                    letter-spacing: 2px; color: #7d7263;
                }
                .ax-auth-brand span { color: #d8a43b; }
            `;
            document.head.appendChild(style);
        }

        const icons = {
            login: '🛡️',
            register: '⚡',
            logout: '🔒'
        };

        const overlay = document.createElement('div');
        overlay.className = 'ax-auth-overlay';
        overlay.innerHTML = `
            <div class="ax-auth-card">
                <div class="ax-auth-icon-wrap">
                    <div class="ax-auth-spinner"></div>
                    <div class="ax-auth-icon-inner">${icons[type] || '✨'}</div>
                </div>
                <div class="ax-auth-title-text">${title || 'Processing...'}</div>
                <div class="ax-auth-sub-text">${message || 'Please wait...'}</div>
                <div class="ax-auth-progress-track">
                    <div class="ax-auth-progress-fill"></div>
                </div>
                <div class="ax-auth-brand">ARENA<span>X</span></div>
            </div>
        `;
        document.body.appendChild(overlay);

        setTimeout(() => {
            overlay.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
            overlay.style.opacity = '0';
            overlay.style.transform = 'scale(1.05)';
            setTimeout(() => {
                overlay.remove();
                if (typeof callback === 'function') callback();
            }, 350);
        }, 1300);
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
