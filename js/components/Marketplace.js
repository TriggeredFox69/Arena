/* ==========================================================================
   ARENAX FRONTEND - MARKETPLACE COMPONENT
   Peer-to-peer AX coin exchange with order book
   ========================================================================== */

class Marketplace {
  constructor() {
    this.container = null;
    this.refreshInterval = null;
  }

  render() {
    const { buyOrders, sellOrders } = store.getState().marketplace;
    const user = store.getState().user;

    return `
      <div class="marketplace-container">
        <div class="marketplace-header">
          <h2>Marketplace</h2>
          <p class="subtitle">Trade AX coins peer-to-peer</p>
        </div>

        <div class="order-book">
          <div class="order-book-side sell-side">
            <h3>Sell Orders <span class="count">(${sellOrders.length})</span></h3>
            <div class="orders-list">
              ${sellOrders.length === 0 ? '<p class="empty">No sell orders</p>' : sellOrders.map(order => `
                <div class="order-item sell-order">
                  <div class="order-info">
                    <span class="amount">${order.amount_ax - order.filled_amount} AX</span>
                    <span class="price">@ ${order.price_per_ax} PKR</span>
                  </div>
                  <div class="order-meta">
                    <span class="total">Total: ${((order.amount_ax - order.filled_amount) * order.price_per_ax).toFixed(2)} PKR</span>
                    <button class="btn-buy-quick" onclick="marketplace.buyOrder(${order.id}, ${order.price_per_ax})">Buy</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="order-book-divider"></div>

          <div class="order-book-side buy-side">
            <h3>Buy Orders <span class="count">(${buyOrders.length})</span></h3>
            <div class="orders-list">
              ${buyOrders.length === 0 ? '<p class="empty">No buy orders</p>' : buyOrders.map(order => `
                <div class="order-item buy-order">
                  <div class="order-info">
                    <span class="amount">${order.amount_ax - order.filled_amount} AX</span>
                    <span class="price">@ ${order.price_per_ax} PKR</span>
                  </div>
                  <div class="order-meta">
                    <span class="total">Total: ${((order.amount_ax - order.filled_amount) * order.price_per_ax).toFixed(2)} PKR</span>
                    <button class="btn-sell-quick" onclick="marketplace.sellOrder(${order.id}, ${order.price_per_ax})">Sell</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="create-order-section">
          <h3>Create Order</h3>
          <div class="order-form">
            <div class="form-row">
              <label>Type</label>
              <div class="btn-group">
                <button class="btn-toggle ${this.orderType === 'buy' ? 'active' : ''}" onclick="marketplace.setOrderType('buy')">Buy</button>
                <button class="btn-toggle ${this.orderType === 'sell' ? 'active' : ''}" onclick="marketplace.setOrderType('sell')">Sell</button>
              </div>
            </div>

            <div class="form-row">
              <label>Amount (AX)</label>
              <input type="number" id="order-amount" min="1" placeholder="e.g. 100" oninput="marketplace.updateTotal()">
            </div>

            <div class="form-row">
              <label>Price per AX (PKR)</label>
              <input type="number" id="order-price" min="0.01" step="0.01" placeholder="e.g. 10.00" oninput="marketplace.updateTotal()">
            </div>

            <div class="form-row">
              <label>Total (PKR)</label>
              <input type="text" id="order-total" disabled placeholder="0.00">
            </div>

            <div class="form-row">
              <button class="btn-primary btn-full" onclick="marketplace.createOrder()">Place Order</button>
            </div>

            <div class="balance-info">
              Your balance: <strong>${user?.balance || 0} AX</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  mount(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.orderType = 'buy';
    this.update();
    this.loadOrders();

    // Refresh orders every 5 seconds
    this.refreshInterval = setInterval(() => this.loadOrders(), 5000);

    // Subscribe to WebSocket order filled events
    socketClient.on('order_filled', (data) => {
      store.addNotification({
        type: 'order_filled',
        title: 'Order Filled',
        message: `Your order was filled: ${data.amount} AX @ ${data.price} PKR`
      });
      this.loadOrders();

      // Refresh user balance
      api.get('/api/auth/me').then(response => {
        if (response.user) {
          store.updateBalance(response.user.balance);
        }
      });
    });
  }

  unmount() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  update() {
    if (!this.container) return;
    this.container.innerHTML = this.render();
  }

  setOrderType(type) {
    this.orderType = type;
    this.update();
  }

  updateTotal() {
    const amount = parseFloat(document.getElementById('order-amount')?.value || 0);
    const price = parseFloat(document.getElementById('order-price')?.value || 0);
    const total = amount * price;

    const totalInput = document.getElementById('order-total');
    if (totalInput) {
      totalInput.value = total.toFixed(2);
    }
  }

  async loadOrders() {
    try {
      const response = await api.get('/api/marketplace/orders');
      if (response.buyOrders && response.sellOrders) {
        store.setMarketplaceOrders(response.buyOrders, response.sellOrders);
        this.update();
      }
    } catch (err) {
      console.error('Load orders error:', err);
    }
  }

  async createOrder() {
    const amount = parseFloat(document.getElementById('order-amount')?.value || 0);
    const price = parseFloat(document.getElementById('order-price')?.value || 0);

    if (amount <= 0 || price <= 0) {
      arenaX.showNotification('Please enter valid amount and price', 'error');
      return;
    }

    try {
      const response = await api.post('/api/marketplace/order', {
        type: this.orderType,
        amountAx: amount,
        pricePerAx: price
      });

      if (response.success) {
        arenaX.showNotification(`${this.orderType === 'buy' ? 'Buy' : 'Sell'} order placed!`, 'success');

        // Clear form
        document.getElementById('order-amount').value = '';
        document.getElementById('order-price').value = '';
        document.getElementById('order-total').value = '';

        // Refresh orders and balance
        await this.loadOrders();
        const userResponse = await api.get('/api/auth/me');
        if (userResponse.user) {
          store.updateBalance(userResponse.user.balance);
        }
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Failed to create order', 'error');
    }
  }

  buyOrder(orderId, price) {
    const amount = prompt(`How many AX to buy @ ${price} PKR?`);
    if (!amount || isNaN(amount) || amount <= 0) return;

    // Quick buy creates a matching buy order
    this.createQuickOrder('buy', parseInt(amount), price);
  }

  sellOrder(orderId, price) {
    const amount = prompt(`How many AX to sell @ ${price} PKR?`);
    if (!amount || isNaN(amount) || amount <= 0) return;

    // Quick sell creates a matching sell order
    this.createQuickOrder('sell', parseInt(amount), price);
  }

  async createQuickOrder(type, amount, price) {
    try {
      const response = await api.post('/api/marketplace/order', {
        type,
        amountAx: amount,
        pricePerAx: price
      });

      if (response.success) {
        arenaX.showNotification('Order placed and matching...', 'success');
        await this.loadOrders();

        const userResponse = await api.get('/api/auth/me');
        if (userResponse.user) {
          store.updateBalance(userResponse.user.balance);
        }
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Failed to create order', 'error');
    }
  }
}

const marketplace = new Marketplace();
