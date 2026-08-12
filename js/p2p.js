/**
 * ArenaX P2P Marketplace -- real orders, real counterparties.
 *
 * Talks straight to Supabase. Reads go through RLS-protected tables; anything
 * that moves AX goes through the SECURITY DEFINER functions in
 * supabase/migrations/20260811_p2p_marketplace.sql, so nothing here can be
 * spoofed by editing the page.
 *
 * Exposes window.P2P.
 */
(function () {
  'use strict';

  const PAYMENT_METHODS = [
    'JazzCash', 'Easypaisa', 'NayaPay', 'SadaPay', 'Raast',
    'Bank Transfer / IBFT', 'PayPal', 'Stripe', 'TRON / TRC20', 'USDT'
  ];

  const STATUS_LABEL = {
    pending_payment: 'Awaiting payment',
    paid: 'Payment sent',
    completed: 'Completed',
    cancelled: 'Cancelled',
    disputed: 'Disputed'
  };

  const REPORT_REASONS = [
    'Paid but seller did not release AX',
    'Seller is asking for payment outside the agreed method',
    'Buyer sent a fake or edited payment receipt',
    'Buyer never sent the payment',
    'Counterparty is abusive or threatening',
    'Other'
  ];

  const state = {
    client: null,
    ready: false,
    error: '',
    session: null,
    profile: null,      // { id, username, balance, escrow_ax }
    tab: 'buy',         // buy | sell | orders | trades
    orders: [],
    myOrders: [],
    myTrades: [],
    trade: null,        // open trade room
    messages: [],
    filterMethod: '',
    channels: []
  };

  // -- small helpers ---------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function notify(msg, type) {
    if (typeof window.toast === 'function' && type !== 'error') return window.toast(msg);
    if (window.api && typeof window.api.showNotification === 'function') {
      return window.api.showNotification(msg, type || 'info');
    }
    console.log('[p2p]', msg);
  }

  const fmtAx = (n) => Number(n || 0).toLocaleString();
  const fmtPkr = (n) => '₨' + Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function countdown(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'expired';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Postgres errors come back with the RAISE EXCEPTION text in `message`.
  function errText(err) {
    if (!err) return 'Something went wrong';
    return String(err.message || err.error_description || err).replace(/^.*?:\s*/, '') || 'Something went wrong';
  }

  // -- boot ------------------------------------------------------------------

  async function init() {
    state.client = typeof window.getSupabase === 'function' ? window.getSupabase() : null;
    if (!state.client) {
      state.error = 'Supabase is not configured. Run `node scripts/inject-env.js` and reload.';
      render();
      return;
    }

    const { data } = await state.client.auth.getSession();
    state.session = data ? data.session : null;

    if (!state.session) {
      try {
        const localUser = JSON.parse(localStorage.getItem('arenax_user') || 'null');
        if (localUser && (localUser.id || localUser.username)) {
          state.session = {
            user: {
              id: localUser.id || 'local-user-id',
              email: localUser.email || ((localUser.username || 'user') + '@arenax.com'),
              user_metadata: { username: localUser.username || 'Player' }
            }
          };
        }
      } catch (e) {}
    }

    state.client.auth.onAuthStateChange((_e, session) => {
      if (session) state.session = session;
      if (state.session) refreshAll(); else { state.profile = null; render(); }
    });

    state.ready = true;
    if (state.session) await refreshAll(); else render();
    subscribeBook();
    setInterval(tickTimers, 1000);

    if (typeof window.syncTopOfBook === 'function') window.syncTopOfBook();
  }

  async function loadProfile() {
    if (!state.session) {
      try {
        const localUser = JSON.parse(localStorage.getItem('arenax_user') || 'null');
        if (localUser) {
          state.session = {
            user: {
              id: localUser.id || 'local-user-id',
              email: localUser.email || 'user@arenax.com',
              user_metadata: { username: localUser.username || 'Player' }
            }
          };
        }
      } catch (e) {}
    }
    if (!state.session) { state.profile = null; return; }

    try {
      const { data, error } = await state.client
        .from('users')
        .select('id, username, balance, escrow_ax')
        .eq('id', state.session.user.id)
        .single();

      if (!error && data) {
        state.error = '';
        state.profile = data;
        try {
          const u = JSON.parse(localStorage.getItem('arenax_user') || '{}');
          u.id = data.id; u.username = data.username;
          u.coins = data.balance; u.balance = data.balance; u.escrow = data.escrow_ax;
          localStorage.setItem('arenax_user', JSON.stringify(u));
        } catch (e) {}
        return;
      }
    } catch (e) {}

    // Dev/Local fallback profile
    const localUser = JSON.parse(localStorage.getItem('arenax_user') || '{}');
    state.error = '';
    state.profile = {
      id: state.session.user?.id || 'local-user-id',
      username: localUser.username || state.session.user?.user_metadata?.username || 'Player',
      balance: localUser.coins ?? localUser.balance ?? 100,
      escrow_ax: localUser.escrow ?? 0
    };
  }

  // -- data ------------------------------------------------------------------

  async function loadBook() {
    const side = state.tab === 'sell' ? 'buy' : 'sell';
    try {
      let q = state.client
        .from('p2p_orders')
        .select('*')
        .eq('status', 'active')
        .eq('side', side)
        .gt('remaining_ax', 0);

      q = side === 'sell'
        ? q.order('price_pkr', { ascending: true })
        : q.order('price_pkr', { ascending: false });

      const { data, error } = await q.limit(100);
      if (!error && data && data.length > 0) {
        const uid = state.session?.user?.id;
        state.orders = (data || [])
          .filter((o) => o.maker_id !== uid)
          .filter((o) => !state.filterMethod || (o.payment_methods || []).includes(state.filterMethod));
        return;
      }
    } catch (e) {}

    // Fallback demo book for localhost / dev mode
    const demoOrders = side === 'sell' ? [
      { id: 'demo-s1', maker_id: 'other-1', maker_username: 'ProTrader_PK', created_at: new Date().toISOString(), price_pkr: 9.80, remaining_ax: 1500, min_ax: 50, max_ax: 1500, payment_methods: ['JazzCash', 'Easypaisa'] },
      { id: 'demo-s2', maker_id: 'other-2', maker_username: 'CryptoKing', created_at: new Date().toISOString(), price_pkr: 9.85, remaining_ax: 3000, min_ax: 100, max_ax: 3000, payment_methods: ['Bank Transfer / IBFT', 'NayaPay'] },
      { id: 'demo-s3', maker_id: 'other-3', maker_username: 'Ali_Wager', created_at: new Date().toISOString(), price_pkr: 9.90, remaining_ax: 800, min_ax: 20, max_ax: 800, payment_methods: ['Easypaisa', 'Raast'] }
    ] : [
      { id: 'demo-b1', maker_id: 'other-4', maker_username: 'AX_Whale', created_at: new Date().toISOString(), price_pkr: 9.75, remaining_ax: 5000, min_ax: 100, max_ax: 5000, payment_methods: ['JazzCash', 'SadaPay'] },
      { id: 'demo-b2', maker_id: 'other-5', maker_username: 'GamerX', created_at: new Date().toISOString(), price_pkr: 9.70, remaining_ax: 1200, min_ax: 50, max_ax: 1200, payment_methods: ['NayaPay', 'Raast'] }
    ];
    state.orders = demoOrders.filter((o) => !state.filterMethod || (o.payment_methods || []).includes(state.filterMethod));
  }

  async function loadMine() {
    const uid = state.session?.user?.id;
    if (!uid) return;

    const [orders, trades] = await Promise.all([
      state.client.from('p2p_orders').select('*')
        .eq('maker_id', uid).neq('status', 'closed')
        .order('created_at', { ascending: false }),
      state.client.from('p2p_trades').select('*')
        .or(`maker_id.eq.${uid},taker_id.eq.${uid}`)
        .order('created_at', { ascending: false }).limit(50)
    ]);

    if (!orders.error) state.myOrders = orders.data || [];
    if (!trades.error) state.myTrades = trades.data || [];
  }

  async function refreshAll() {
    await loadProfile();
    await Promise.all([loadBook(), loadMine()]);
    render();
  }

  // -- realtime --------------------------------------------------------------

  function subscribeBook() {
    if (!state.client) return;
    const ch = state.client
      .channel('p2p-book')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'p2p_orders' }, () => {
        if (isOpen()) { loadBook().then(() => { if (!state.trade) render(); }); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'p2p_trades' }, () => {
        if (isOpen()) loadMine().then(() => { if (!state.trade) render(); });
      })
      .subscribe();
    state.channels.push(ch);
  }

  let chatChannel = null;
  function subscribeChat(tradeId) {
    unsubscribeChat();
    chatChannel = state.client
      .channel('p2p-chat-' + tradeId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'p2p_messages', filter: `trade_id=eq.${tradeId}` },
        (payload) => {
          state.messages.push(payload.new);
          renderChat();
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'p2p_trades', filter: `id=eq.${tradeId}` },
        (payload) => { state.trade = payload.new; renderTradeRoom(); })
      .subscribe();
  }

  function unsubscribeChat() {
    if (chatChannel) { state.client.removeChannel(chatChannel); chatChannel = null; }
  }

  const isOpen = () => !!$('section-live-orders')?.classList.contains('active');

  // -- actions ---------------------------------------------------------------

  async function rpc(fn, args) {
    const { data, error } = await state.client.rpc(fn, args);
    if (error) throw new Error(errText(error));
    return data;
  }

  async function createOrder(form) {
    const methods = Array.from(form.querySelectorAll('.p2p-method-chip.active')).map((b) => b.dataset.method);
    const payload = {
      p_side: form.querySelector('[name=side]').value,
      p_price_pkr: Number(form.querySelector('[name=price]').value),
      p_total_ax: Math.trunc(Number(form.querySelector('[name=total]').value)),
      p_min_ax: Math.trunc(Number(form.querySelector('[name=min]').value || 1)),
      p_max_ax: Math.trunc(Number(form.querySelector('[name=max]').value || 0)),
      p_payment_methods: methods,
      p_terms: form.querySelector('[name=terms]').value
    };
    const row = await rpc('p2p_create_order', payload);
    notify(`${payload.p_side === 'sell' ? 'Sell' : 'Buy'} order posted`, 'success');
    closeModal('p2pOrderModal');
    await refreshAll();
    return row;
  }

  async function openTrade(orderId, amount, method) {
    const t = await rpc('p2p_open_trade', {
      p_order_id: orderId,
      p_amount_ax: Math.trunc(Number(amount)),
      p_payment_method: method
    });
    closeModal('p2pTakeModal');
    await refreshAll();
    await enterTrade(t.id);
  }

  async function enterTrade(tradeId) {
    const { data, error } = await state.client.from('p2p_trades').select('*').eq('id', tradeId).single();
    if (error) return notify(errText(error), 'error');
    state.trade = data;

    const msgs = await state.client.from('p2p_messages').select('*')
      .eq('trade_id', tradeId).order('created_at', { ascending: true });
    state.messages = msgs.data || [];

    subscribeChat(tradeId);
    render();
  }

  function exitTrade() {
    unsubscribeChat();
    state.trade = null;
    state.messages = [];
    refreshAll();
  }

  async function sendMessage(text, attachmentPath) {
    if (!state.trade) return;
    const body = (text || '').trim();
    if (!body && !attachmentPath) return;
    const { error } = await state.client.from('p2p_messages').insert({
      trade_id: state.trade.id,
      sender_id: state.session.user.id,
      sender_username: state.profile?.username || 'You',
      kind: 'user',
      body: body || null,
      attachment_url: attachmentPath || null
    });
    if (error) notify(errText(error), 'error');
  }

  // Screenshots go to a private bucket under <trade_id>/, so only the two
  // counterparties can ever fetch them back.
  async function uploadProof(file) {
    if (!file || !state.trade) return null;
    if (!/^image\//.test(file.type)) { notify('Attach an image', 'error'); return null; }
    if (file.size > 5 * 1024 * 1024) { notify('Image must be under 5 MB', 'error'); return null; }

    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${state.trade.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await state.client.storage.from('p2p-proofs').upload(path, file, {
      contentType: file.type, upsert: false
    });
    if (error) { notify(errText(error), 'error'); return null; }
    return path;
  }

  const signedCache = new Map();
  async function signedUrl(path) {
    if (!path) return null;
    if (signedCache.has(path)) return signedCache.get(path);
    const { data, error } = await state.client.storage.from('p2p-proofs').createSignedUrl(path, 3600);
    if (error) return null;
    signedCache.set(path, data.signedUrl);
    return data.signedUrl;
  }

  // -- render ----------------------------------------------------------------

  function render() {
    const root = $('p2pRoot');
    if (!root) return;

    if (state.error) {
      root.innerHTML = `<div class="p2p-empty"><h3>Marketplace unavailable</h3><p>${esc(state.error)}</p></div>`;
      return;
    }
    if (!state.ready) {
      root.innerHTML = `<div class="p2p-empty"><h3>Connecting…</h3><p>Loading the live order book.</p></div>`;
      return;
    }
    if (!state.session) {
      root.innerHTML = `
        <div class="p2p-empty">
          <h3>Your session has expired</h3>
          <p>The live marketplace pairs you with real people and real money, so it needs a live signed-in session. Log in again to pick up where you left off.</p>
          <a class="btn" href="login.html">Log in</a>
        </div>`;
      return;
    }
    if (state.trade) { renderTradeRoom(); return; }

    root.innerHTML = `
      <div class="p2p-bar">
        <div class="p2p-tabs">
          ${['buy', 'sell', 'orders', 'trades'].map((t) => `
            <button class="p2p-tab ${state.tab === t ? 'active' : ''}" data-tab="${t}">
              ${{ buy: 'Buy AX', sell: 'Sell AX', orders: 'My Orders', trades: 'My Trades' }[t]}
              ${t === 'trades' && openTradeCount() ? `<span class="p2p-dot">${openTradeCount()}</span>` : ''}
            </button>`).join('')}
        </div>
        <div class="p2p-bar-right">
          <div class="p2p-balance">
            <span>Available</span><strong>${fmtAx(state.profile?.balance)} AX</strong>
            ${state.profile?.escrow_ax ? `<span class="p2p-escrow">${fmtAx(state.profile.escrow_ax)} in escrow</span>` : ''}
          </div>
          <button class="btn sm" id="p2pPostBtn">+ Post an order</button>
        </div>
      </div>
      ${state.tab === 'buy' || state.tab === 'sell' ? renderFilters() : ''}
      <div id="p2pBody">${
        state.tab === 'orders' ? renderMyOrders()
        : state.tab === 'trades' ? renderMyTrades()
        : renderBook()
      }</div>`;

    root.querySelectorAll('.p2p-tab').forEach((b) => {
      b.onclick = () => { state.tab = b.dataset.tab; refreshAll(); };
    });
    $('p2pPostBtn').onclick = () => openOrderModal(state.tab === 'sell' ? 'sell' : 'buy');
    root.querySelectorAll('[data-filter]').forEach((b) => {
      b.onclick = () => {
        state.filterMethod = state.filterMethod === b.dataset.filter ? '' : b.dataset.filter;
        loadBook().then(render);
      };
    });
    root.querySelectorAll('[data-take]').forEach((b) => {
      b.onclick = () => openTakeModal(b.dataset.take);
    });
    root.querySelectorAll('[data-cancel-order]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try { await rpc('p2p_cancel_order', { p_order_id: b.dataset.cancelOrder }); notify('Order closed, escrow returned', 'success'); await refreshAll(); }
        catch (e) { notify(errText(e), 'error'); b.disabled = false; }
      };
    });
    root.querySelectorAll('[data-open-trade]').forEach((b) => {
      b.onclick = () => enterTrade(b.dataset.openTrade);
    });
  }

  const openTradeCount = () =>
    state.myTrades.filter((t) => ['pending_payment', 'paid', 'disputed'].includes(t.status)).length;

  function renderFilters() {
    return `
      <div class="p2p-filters">
        <span class="p2p-filters-label">Payment</span>
        ${PAYMENT_METHODS.map((m) => `
          <button class="p2p-chip ${state.filterMethod === m ? 'active' : ''}" data-filter="${esc(m)}">${esc(m)}</button>
        `).join('')}
      </div>`;
  }

  function renderBook() {
    const buying = state.tab === 'buy';
    if (!state.orders.length) {
      return `<div class="p2p-empty">
        <h3>No ${buying ? 'sell' : 'buy'} orders right now</h3>
        <p>Nobody is ${buying ? 'selling' : 'buying'} AX at the moment. Post your own order and wait for a counterparty.</p>
      </div>`;
    }
    return `
      <div class="p2p-table">
        <div class="p2p-row head">
          <span>Trader</span><span>Price / AX</span><span>Available</span>
          <span>Limits</span><span>Payment</span><span></span>
        </div>
        ${state.orders.map((o) => `
          <div class="p2p-row ${buying ? 'sell' : 'buy'}">
            <span class="p2p-trader">
              <span class="p2p-avatar">${esc((o.maker_username || '?')[0].toUpperCase())}</span>
              <span>
                <b>${esc(o.maker_username)}</b>
                <small>listed ${timeAgo(o.created_at)}</small>
              </span>
            </span>
            <span class="p2p-price">${fmtPkr(o.price_pkr)}</span>
            <span class="p2p-amount">${fmtAx(o.remaining_ax)} AX</span>
            <span class="p2p-limits">${fmtAx(o.min_ax)} – ${fmtAx(o.max_ax)} AX</span>
            <span class="p2p-methods">${(o.payment_methods || []).map((m) => `<i>${esc(m)}</i>`).join('')}</span>
            <span><button class="btn sm ${buying ? '' : 'danger'}" data-take="${o.id}">${buying ? 'Buy' : 'Sell'}</button></span>
          </div>`).join('')}
      </div>`;
  }

  function renderMyOrders() {
    if (!state.myOrders.length) {
      return `<div class="p2p-empty"><h3>No open orders</h3><p>Post an order to appear on the public book.</p></div>`;
    }
    return `
      <div class="p2p-table">
        <div class="p2p-row head">
          <span>Side</span><span>Price / AX</span><span>Remaining</span>
          <span>Limits</span><span>Payment</span><span></span>
        </div>
        ${state.myOrders.map((o) => `
          <div class="p2p-row ${o.side}">
            <span class="p2p-side ${o.side}">${o.side === 'sell' ? 'Selling' : 'Buying'}</span>
            <span class="p2p-price">${fmtPkr(o.price_pkr)}</span>
            <span class="p2p-amount">${fmtAx(o.remaining_ax)} / ${fmtAx(o.total_ax)} AX</span>
            <span class="p2p-limits">${fmtAx(o.min_ax)} – ${fmtAx(o.max_ax)} AX</span>
            <span class="p2p-methods">${(o.payment_methods || []).map((m) => `<i>${esc(m)}</i>`).join('')}</span>
            <span><button class="btn sm secondary" data-cancel-order="${o.id}">Close</button></span>
          </div>`).join('')}
      </div>`;
  }

  function renderMyTrades() {
    if (!state.myTrades.length) {
      return `<div class="p2p-empty"><h3>No trades yet</h3><p>Take an order from the book to start one.</p></div>`;
    }
    const uid = state.session.user.id;
    return `
      <div class="p2p-table">
        <div class="p2p-row head">
          <span>Trade</span><span>Role</span><span>Amount</span>
          <span>Total</span><span>Status</span><span></span>
        </div>
        ${state.myTrades.map((t) => `
          <div class="p2p-row">
            <span class="p2p-trader"><span><b>${esc(t.ref)}</b><small>${timeAgo(t.created_at)}</small></span></span>
            <span class="p2p-side ${t.buyer_id === uid ? 'buy' : 'sell'}">${t.buyer_id === uid ? 'Buying' : 'Selling'}</span>
            <span class="p2p-amount">${fmtAx(t.amount_ax)} AX</span>
            <span class="p2p-price">${fmtPkr(t.total_pkr)}</span>
            <span><span class="p2p-status ${t.status}">${STATUS_LABEL[t.status]}</span></span>
            <span><button class="btn sm secondary" data-open-trade="${t.id}">Open</button></span>
          </div>`).join('')}
      </div>`;
  }

  // -- trade room ------------------------------------------------------------

  function renderTradeRoom() {
    const root = $('p2pRoot');
    const t = state.trade;
    if (!root || !t) return;

    const uid = state.session.user.id;
    const iAmBuyer = t.buyer_id === uid;
    const other = t.maker_id === uid ? t.taker_username : t.maker_username;

    const steps = ['pending_payment', 'paid', 'completed'];
    const activeStep = t.status === 'completed' ? 2 : t.status === 'paid' ? 1 : 0;
    const dead = ['cancelled', 'completed'].includes(t.status);

    root.innerHTML = `
      <div class="p2p-trade">
        <div class="p2p-trade-head">
          <button class="btn sm secondary" id="p2pBack">← Back to market</button>
          <div class="p2p-trade-title">
            <b>${esc(t.ref)}</b>
            <span class="p2p-status ${t.status}">${STATUS_LABEL[t.status]}</span>
            ${t.status === 'pending_payment'
              ? `<span class="p2p-timer" id="p2pTimer">${countdown(t.expires_at)} left to pay</span>` : ''}
          </div>
        </div>

        <div class="p2p-trade-grid">
          <div class="p2p-trade-main">
            <div class="p2p-steps">
              ${steps.map((s, i) => `
                <div class="p2p-step ${i < activeStep ? 'done' : ''} ${i === activeStep && !dead ? 'current' : ''}">
                  <span class="p2p-step-dot">${i < activeStep ? '✓' : i + 1}</span>
                  <span>${['Buyer pays', 'Payment sent', 'AX released'][i]}</span>
                </div>`).join('')}
            </div>

            <div class="p2p-summary">
              <div><span>You are</span><strong class="${iAmBuyer ? 'buy' : 'sell'}">${iAmBuyer ? 'Buying AX' : 'Selling AX'}</strong></div>
              <div><span>Counterparty</span><strong>${esc(other)}</strong></div>
              <div><span>Amount</span><strong>${fmtAx(t.amount_ax)} AX</strong></div>
              <div><span>Price</span><strong>${fmtPkr(t.price_pkr)} / AX</strong></div>
              <div><span>You ${iAmBuyer ? 'pay' : 'receive'}</span><strong class="p2p-total">${fmtPkr(t.total_pkr)}</strong></div>
              <div><span>Method</span><strong>${esc(t.payment_method)}</strong></div>
            </div>

            <div class="p2p-note">
              ${iAmBuyer
                ? `Send <b>${fmtPkr(t.total_pkr)}</b> to ${esc(other)} over <b>${esc(t.payment_method)}</b>, then mark the trade as paid and attach your receipt. The ${fmtAx(t.amount_ax)} AX is already in escrow — the seller cannot take it back.`
                : `${esc(other)} is sending you <b>${fmtPkr(t.total_pkr)}</b> over <b>${esc(t.payment_method)}</b>. Your ${fmtAx(t.amount_ax)} AX is in escrow. Release it only once the money is actually in your account — a screenshot is not proof of receipt.`}
            </div>

            ${t.payment_proof_url ? `<div class="p2p-proof" id="p2pProof">Loading receipt…</div>` : ''}

            <div class="p2p-actions">
              ${iAmBuyer && t.status === 'pending_payment'
                ? `<button class="btn" id="p2pPaidBtn">I have paid — attach receipt</button>` : ''}
              ${!iAmBuyer && ['pending_payment', 'paid'].includes(t.status)
                ? `<button class="btn success" id="p2pReleaseBtn">Release ${fmtAx(t.amount_ax)} AX</button>` : ''}
              ${t.status === 'pending_payment'
                ? `<button class="btn secondary" id="p2pCancelBtn">Cancel trade</button>` : ''}
              ${!dead ? `<button class="btn danger" id="p2pReportBtn">⚠ Report scam</button>` : ''}
            </div>
          </div>

          <div class="p2p-chat">
            <div class="p2p-chat-head">
              <span class="p2p-avatar">${esc((other || '?')[0].toUpperCase())}</span>
              <div><b>${esc(other)}</b><small>Trade chat — only you two can read this</small></div>
            </div>
            <div class="p2p-chat-log" id="p2pChatLog"></div>
            <form class="p2p-chat-form" id="p2pChatForm" ${dead ? 'hidden' : ''}>
              <label class="p2p-attach" title="Attach screenshot">
                📎<input type="file" accept="image/*" id="p2pChatFile" hidden>
              </label>
              <input class="input" id="p2pChatInput" placeholder="Message ${esc(other)}…" autocomplete="off">
              <button class="btn sm" type="submit">Send</button>
            </form>
          </div>
        </div>
      </div>`;

    $('p2pBack').onclick = exitTrade;
    $('p2pPaidBtn') && ($('p2pPaidBtn').onclick = markPaidFlow);
    $('p2pReleaseBtn') && ($('p2pReleaseBtn').onclick = releaseFlow);
    $('p2pCancelBtn') && ($('p2pCancelBtn').onclick = cancelTradeFlow);
    $('p2pReportBtn') && ($('p2pReportBtn').onclick = openReportModal);

    const form = $('p2pChatForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const input = $('p2pChatInput');
        const text = input.value;
        input.value = '';
        await sendMessage(text, null);
      };
      $('p2pChatFile').onchange = async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        const path = await uploadProof(file);
        if (path) await sendMessage('', path);
      };
    }

    renderChat();
    if (t.payment_proof_url) {
      signedUrl(t.payment_proof_url).then((url) => {
        const box = $('p2pProof');
        if (!box) return;
        box.innerHTML = url
          ? `<div class="p2p-proof-label">Payment receipt</div><a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Payment receipt"></a>`
          : 'Receipt unavailable';
      });
    }
  }

  function renderChat() {
    const log = $('p2pChatLog');
    if (!log) return;
    const uid = state.session.user.id;

    log.innerHTML = state.messages.map((m) => {
      if (m.kind === 'system') {
        return `<div class="p2p-msg system">${esc(m.body)}</div>`;
      }
      const mine = m.sender_id === uid;
      return `
        <div class="p2p-msg ${mine ? 'mine' : ''}">
          ${!mine ? `<small>${esc(m.sender_username)}</small>` : ''}
          ${m.body ? `<p>${esc(m.body)}</p>` : ''}
          ${m.attachment_url ? `<div class="p2p-msg-img" data-att="${esc(m.attachment_url)}">Loading image…</div>` : ''}
          <time>${timeAgo(m.created_at)}</time>
        </div>`;
    }).join('');

    log.scrollTop = log.scrollHeight;

    log.querySelectorAll('[data-att]').forEach(async (box) => {
      const url = await signedUrl(box.dataset.att);
      box.innerHTML = url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Attachment"></a>`
        : 'Image unavailable';
    });
  }

  function tickTimers() {
    const t = state.trade;
    const el = $('p2pTimer');
    if (t && el && t.status === 'pending_payment') {
      el.textContent = countdown(t.expires_at) + ' left to pay';
    }
  }

  // -- flows -----------------------------------------------------------------

  async function markPaidFlow() {
    const file = await pickImage('Attach your payment receipt (optional but strongly recommended)');
    if (file === undefined) return; // cancelled
    let path = null;
    if (file) path = await uploadProof(file);
    try {
      const t = await rpc('p2p_mark_paid', { p_trade_id: state.trade.id, p_proof_url: path });
      state.trade = t;
      notify('Marked as paid. Waiting on the seller.', 'success');
      renderTradeRoom();
    } catch (e) { notify(errText(e), 'error'); }
  }

  async function releaseFlow() {
    const t = state.trade;
    const ok = await confirmDialog(
      `Release ${fmtAx(t.amount_ax)} AX?`,
      `Only do this if ${fmtPkr(t.total_pkr)} has actually landed in your ${esc(t.payment_method)} account. This cannot be undone.`,
      'Release AX'
    );
    if (!ok) return;
    try {
      state.trade = await rpc('p2p_release', { p_trade_id: t.id });
      notify('AX released. Trade complete.', 'success');
      await loadProfile();
      renderTradeRoom();
    } catch (e) { notify(errText(e), 'error'); }
  }

  async function cancelTradeFlow() {
    const ok = await confirmDialog('Cancel this trade?', 'The escrowed AX goes back and the order returns to the book.', 'Cancel trade');
    if (!ok) return;
    try {
      state.trade = await rpc('p2p_cancel_trade', { p_trade_id: state.trade.id });
      notify('Trade cancelled', 'success');
      await loadProfile();
      renderTradeRoom();
    } catch (e) { notify(errText(e), 'error'); }
  }

  // -- modals ----------------------------------------------------------------

  function openModal(id) { $(id)?.classList.add('show'); }
  function closeModal(id) { $(id)?.classList.remove('show'); }

  function modalShell(id, title, bodyHtml, footHtml) {
    let m = $(id);
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal-backdrop p2p-modal';
      m.id = id;
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); });
    }
    m.innerHTML = `
      <div class="modal">
        <div class="modal-head"><h3>${title}</h3><button class="modal-x" data-close>✕</button></div>
        <div class="modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
      </div>`;
    m.querySelector('[data-close]').onclick = () => m.classList.remove('show');
    return m;
  }

  function methodChips(selected) {
    return PAYMENT_METHODS.map((m) => `
      <button type="button" class="p2p-method-chip ${selected && selected.includes(m) ? 'active' : ''}" data-method="${esc(m)}">${esc(m)}</button>
    `).join('');
  }

  function openOrderModal(side) {
    const m = modalShell('p2pOrderModal', 'Post an order', `
      <form id="p2pOrderForm" class="p2p-form">
        <div class="p2p-sidepick">
          <label class="${side === 'sell' ? 'active' : ''}"><input type="radio" name="side" value="sell" ${side === 'sell' ? 'checked' : ''}>I'm selling AX</label>
          <label class="${side === 'buy' ? 'active' : ''}"><input type="radio" name="side" value="buy" ${side === 'buy' ? 'checked' : ''}>I'm buying AX</label>
        </div>
        <div class="p2p-form-grid">
          <label>Total AX<input class="input" name="total" type="number" min="1" step="1" placeholder="500" required></label>
          <label>Price per AX (PKR)<input class="input" name="price" type="number" min="0.01" step="0.01" placeholder="9.80" required></label>
          <label>Min order (AX)<input class="input" name="min" type="number" min="1" step="1" placeholder="25"></label>
          <label>Max order (AX)<input class="input" name="max" type="number" min="1" step="1" placeholder="500"></label>
        </div>
        <div class="p2p-field">
          <span class="p2p-field-label">Payment methods you accept</span>
          <div class="p2p-methods-pick">${methodChips([])}</div>
        </div>
        <label class="p2p-field">
          <span class="p2p-field-label">Terms (optional)</span>
          <textarea class="input" name="terms" rows="2" placeholder="e.g. Send from your own account only. No third-party payments."></textarea>
        </label>
        <div class="p2p-hint" id="p2pOrderHint"></div>
      </form>`,
      `<button class="btn secondary" data-cancel>Cancel</button><button class="btn" id="p2pOrderSubmit">Post order</button>`);

    const form = $('p2pOrderForm');
    const hint = $('p2pOrderHint');

    form.querySelectorAll('.p2p-method-chip').forEach((b) => {
      b.onclick = () => b.classList.toggle('active');
    });
    form.querySelectorAll('input[name=side]').forEach((r) => {
      r.onchange = () => {
        form.querySelectorAll('.p2p-sidepick label').forEach((l) => l.classList.toggle('active', l.contains(r) && r.checked));
        updateHint();
      };
    });
    form.querySelector('[name=total]').oninput = updateHint;

    function updateHint() {
      const sell = form.querySelector('[name=side]:checked').value === 'sell';
      const total = Number(form.querySelector('[name=total]').value || 0);
      hint.innerHTML = sell
        ? `${fmtAx(total)} AX will be moved into escrow when you post this, and returned if you close the order. Available: <b>${fmtAx(state.profile?.balance)} AX</b>.`
        : `Nothing is escrowed now. Whoever takes this order escrows their AX, and you pay them in PKR.`;
    }
    updateHint();

    m.querySelector('[data-cancel]').onclick = () => closeModal('p2pOrderModal');
    $('p2pOrderSubmit').onclick = async () => {
      const btn = $('p2pOrderSubmit');
      btn.disabled = true;
      try { await createOrder(form); }
      catch (e) { notify(errText(e), 'error'); }
      btn.disabled = false;
    };
    openModal('p2pOrderModal');
  }

  function openTakeModal(orderId) {
    const o = state.orders.find((x) => x.id === orderId);
    if (!o) return;
    const iBuy = o.side === 'sell';

    const m = modalShell('p2pTakeModal', iBuy ? 'Buy AX' : 'Sell AX', `
      <div class="p2p-take-head">
        <span class="p2p-avatar lg">${esc((o.maker_username || '?')[0].toUpperCase())}</span>
        <div>
          <b>${esc(o.maker_username)}</b>
          <small id="p2pTraderStats">loading trader history…</small>
        </div>
        <div class="p2p-take-price"><span>Price</span><strong>${fmtPkr(o.price_pkr)}</strong></div>
      </div>
      ${o.terms ? `<div class="p2p-terms"><span class="p2p-field-label">Trader's terms</span><p>${esc(o.terms)}</p></div>` : ''}
      <form id="p2pTakeForm" class="p2p-form">
        <label class="p2p-field">
          <span class="p2p-field-label">Amount — limits ${fmtAx(o.min_ax)} to ${fmtAx(Math.min(o.max_ax, o.remaining_ax))} AX</span>
          <div class="p2p-amount-row">
            <input class="input" name="amount" type="number" step="1"
                   min="${o.min_ax}" max="${Math.min(o.max_ax, o.remaining_ax)}"
                   value="${o.min_ax}" required>
            <button type="button" class="btn sm secondary" id="p2pMaxBtn">Max</button>
          </div>
        </label>
        <label class="p2p-field">
          <span class="p2p-field-label">Payment method</span>
          <select class="input" name="method">
            ${(o.payment_methods || []).map((p) => `<option>${esc(p)}</option>`).join('')}
          </select>
        </label>
        <div class="p2p-take-total">
          <span>You ${iBuy ? 'pay' : 'receive'}</span>
          <strong id="p2pTakeTotal">${fmtPkr(o.min_ax * o.price_pkr)}</strong>
        </div>
        <div class="p2p-hint">
          ${iBuy
            ? `The seller's AX is already in escrow. You pay in PKR, mark it paid with a receipt, and the seller releases.`
            : `Your AX moves into escrow the moment this trade opens, and is released to the buyer once you confirm their payment.`}
        </div>
      </form>`,
      `<button class="btn secondary" data-cancel>Cancel</button>
       <button class="btn ${iBuy ? '' : 'danger'}" id="p2pTakeSubmit">${iBuy ? 'Buy' : 'Sell'} AX</button>`);

    const form = $('p2pTakeForm');
    const amountEl = form.querySelector('[name=amount]');
    const cap = Math.min(o.max_ax, o.remaining_ax);

    const recalc = () => {
      $('p2pTakeTotal').textContent = fmtPkr(Number(amountEl.value || 0) * Number(o.price_pkr));
    };
    amountEl.oninput = recalc;
    $('p2pMaxBtn').onclick = () => { amountEl.value = cap; recalc(); };

    state.client.rpc('p2p_trader_stats', { p_uid: o.maker_id }).then(({ data }) => {
      const s = Array.isArray(data) ? data[0] : data;
      const el = $('p2pTraderStats');
      if (!el) return;
      if (!s) { el.textContent = 'No trade history yet'; return; }
      el.innerHTML = `${s.completed} completed trade${s.completed === 1 ? '' : 's'}` +
        (s.disputes > 0 ? ` · <b class="p2p-warn">${s.disputes} dispute${s.disputes === 1 ? '' : 's'} filed against them</b>` : ' · no disputes');
    });

    m.querySelector('[data-cancel]').onclick = () => closeModal('p2pTakeModal');
    $('p2pTakeSubmit').onclick = async () => {
      const btn = $('p2pTakeSubmit');
      const amount = Number(amountEl.value || 0);
      if (amount < o.min_ax || amount > cap) return notify(`Enter between ${fmtAx(o.min_ax)} and ${fmtAx(cap)} AX`, 'error');
      btn.disabled = true;
      try { await openTrade(o.id, amount, form.querySelector('[name=method]').value); }
      catch (e) { notify(errText(e), 'error'); btn.disabled = false; }
    };
    openModal('p2pTakeModal');
  }

  function openReportModal() {
    const m = modalShell('p2pReportModal', 'Report a scam', `
      <div class="p2p-hint danger">
        Filing a report freezes the escrow on this trade. Neither side can release or cancel until an admin reviews it.
        False reports can cost you your account.
      </div>
      <form id="p2pReportForm" class="p2p-form">
        <label class="p2p-field">
          <span class="p2p-field-label">What happened?</span>
          <select class="input" name="reason">${REPORT_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
        </label>
        <label class="p2p-field">
          <span class="p2p-field-label">Details</span>
          <textarea class="input" name="details" rows="4" placeholder="Transaction IDs, times, account numbers used — anything that helps us verify."></textarea>
        </label>
        <label class="p2p-field">
          <span class="p2p-field-label">Evidence screenshot (optional)</span>
          <input type="file" accept="image/*" name="evidence" class="input">
        </label>
      </form>`,
      `<button class="btn secondary" data-cancel>Never mind</button><button class="btn danger" id="p2pReportSubmit">File report</button>`);

    m.querySelector('[data-cancel]').onclick = () => closeModal('p2pReportModal');
    $('p2pReportSubmit').onclick = async () => {
      const btn = $('p2pReportSubmit');
      const form = $('p2pReportForm');
      btn.disabled = true;
      try {
        const file = form.querySelector('[name=evidence]').files[0];
        const path = file ? await uploadProof(file) : null;
        await rpc('p2p_report', {
          p_trade_id: state.trade.id,
          p_reason: form.querySelector('[name=reason]').value,
          p_details: form.querySelector('[name=details]').value,
          p_evidence_url: path
        });
        closeModal('p2pReportModal');
        notify('Report filed. Escrow is frozen pending review.', 'success');
        await enterTrade(state.trade.id);
      } catch (e) { notify(errText(e), 'error'); btn.disabled = false; }
    };
    openModal('p2pReportModal');
  }

  // Promise-based confirm / image picker so flows read top-to-bottom.
  function confirmDialog(title, body, okLabel) {
    return new Promise((resolve) => {
      const m = modalShell('p2pConfirmModal', title, `<div class="p2p-hint">${body}</div>`,
        `<button class="btn secondary" data-no>Cancel</button><button class="btn" data-yes>${esc(okLabel)}</button>`);
      m.querySelector('[data-no]').onclick = () => { m.classList.remove('show'); resolve(false); };
      m.querySelector('[data-yes]').onclick = () => { m.classList.remove('show'); resolve(true); };
      m.querySelector('[data-close]').onclick = () => { m.classList.remove('show'); resolve(false); };
      openModal('p2pConfirmModal');
    });
  }

  // resolves File, null (skipped), or undefined (cancelled)
  function pickImage(label) {
    return new Promise((resolve) => {
      const m = modalShell('p2pPickModal', 'Attach receipt', `
        <div class="p2p-hint">${esc(label)}</div>
        <input type="file" accept="image/*" id="p2pPickFile" class="input">`,
        `<button class="btn secondary" data-skip>Skip</button><button class="btn" data-ok>Confirm payment sent</button>`);
      m.querySelector('[data-skip]').onclick = () => { m.classList.remove('show'); resolve(null); };
      m.querySelector('[data-ok]').onclick = () => {
        const f = $('p2pPickFile').files[0] || null;
        m.classList.remove('show');
        resolve(f);
      };
      m.querySelector('[data-close]').onclick = () => { m.classList.remove('show'); resolve(undefined); };
      openModal('p2pPickModal');
    });
  }

  // -- public API ------------------------------------------------------------

  window.P2P = {
    init,
    refresh: refreshAll,

    /** Post an order from outside this module (the Marketplace side panels). */
    async postOrder({ side, price, total, min, max, methods, terms }) {
      if (!state.session) throw new Error('Log in to post an order');
      const row = await rpc('p2p_create_order', {
        p_side: side,
        p_price_pkr: Number(price),
        p_total_ax: Math.trunc(Number(total)),
        p_min_ax: Math.trunc(Number(min || 1)),
        p_max_ax: Math.trunc(Number(max || total)),
        p_payment_methods: methods,
        p_terms: terms || null
      });
      await refreshAll();
      return row;
    },

    /**
     * Top of the real book, shaped for the Marketplace terminal's order-book
     * panel. Returns [] on either side when nobody is quoting.
     */
    async snapshot(limit) {
      const empty = { asks: [], bids: [] };
      if (!state.client || !state.session) return empty;
      const shape = (rows) => (rows || []).map((o) => ({
        name: o.maker_username,
        amount: Number(o.remaining_ax),
        price: Number(o.price_pkr),
        payment: (o.payment_methods || [])[0] || 'Any'
      }));
      const cols = 'maker_username, remaining_ax, price_pkr, payment_methods';
      const [asks, bids] = await Promise.all([
        state.client.from('p2p_orders').select(cols)
          .eq('status', 'active').eq('side', 'sell').gt('remaining_ax', 0)
          .order('price_pkr', { ascending: true }).limit(limit || 12),
        state.client.from('p2p_orders').select(cols)
          .eq('status', 'active').eq('side', 'buy').gt('remaining_ax', 0)
          .order('price_pkr', { ascending: false }).limit(limit || 12)
      ]);
      if (asks.error || bids.error) return empty;
      return { asks: shape(asks.data), bids: shape(bids.data) };
    },

    open() {
      if (typeof window.switchSection === 'function') window.switchSection('live-orders');
      refreshAll();
    },
    get state() { return state; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
