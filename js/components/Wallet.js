/* ==========================================================================
   ARENAX FRONTEND - WALLET COMPONENT
   Mock USDT buy/withdraw system
   ========================================================================== */

class Wallet {
  constructor() {
    this.container = null;
    this.activeTab = 'buy';
  }

  render() {
    const user = store.getState().user;
    const usdtRate = 0.01; // 1 AX = 0.01 USDT

    return `
      <div class="wallet-container">
        <div class="wallet-header">
          <h2>Wallet</h2>
          <div class="balance-display">
            <span class="balance-label">Your Balance</span>
            <span class="balance-value">${user?.balance || 0} AX</span>
            <span class="balance-usdt">≈ ${((user?.balance || 0) * usdtRate).toFixed(2)} USDT</span>
          </div>
        </div>

        <div class="wallet-tabs">
          <button class="tab-btn ${this.activeTab === 'buy' ? 'active' : ''}" onclick="wallet.setTab('buy')">Buy AX</button>
          <button class="tab-btn ${this.activeTab === 'withdraw' ? 'active' : ''}" onclick="wallet.setTab('withdraw')">Withdraw</button>
        </div>

        <div class="wallet-content">
          ${this.activeTab === 'buy' ? this.renderBuyTab(usdtRate) : this.renderWithdrawTab(usdtRate)}
        </div>

        <div class="wallet-info">
          <h4>Exchange Rate</h4>
          <p>1 AX = ${usdtRate} USDT</p>
          <p>1 AX = 10 PKR</p>
        </div>
      </div>
    `;
  }

  renderBuyTab(usdtRate) {
    return `
      <div class="buy-tab">
        <h3>Buy AX Tokens with USDT</h3>

        <div class="form-row">
          <label>Amount (AX)</label>
          <input type="number" id="buy-amount" min="1" placeholder="e.g. 1000" oninput="wallet.updateBuyTotal()">
        </div>

        <div class="form-row">
          <label>Price</label>
          <input type="text" id="buy-price" disabled value="${usdtRate} USDT per AX">
        </div>

        <div class="form-row">
          <label>Total (USDT)</label>
          <input type="text" id="buy-total" disabled placeholder="0.00">
        </div>

        <div class="form-row">
          <button class="btn-primary btn-full" onclick="wallet.buyWithUSDT()">Pay with USDT</button>
        </div>

        <div class="payment-note">
          <p>📝 <strong>Mock Payment:</strong> This will simulate a USDT transaction.</p>
          <p>In production, this would connect to a real crypto payment gateway.</p>
        </div>
      </div>
    `;
  }

  renderWithdrawTab(usdtRate) {
    return `
      <div class="withdraw-tab">
        <h3>Withdraw AX to USDT</h3>

        <div class="form-row">
          <label>Amount (AX)</label>
          <input type="number" id="withdraw-amount" min="1" placeholder="e.g. 500" oninput="wallet.updateWithdrawTotal()">
        </div>

        <div class="form-row">
          <label>You will receive (USDT)</label>
          <input type="text" id="withdraw-total" disabled placeholder="0.00">
        </div>

        <div class="form-row">
          <label>USDT Wallet Address (TRC-20)</label>
          <input type="text" id="usdt-address" placeholder="TXyz...">
          <span class="input-hint">Enter your USDT TRC-20 address</span>
        </div>

        <div class="form-row">
          <button class="btn-primary btn-full" onclick="wallet.withdrawUSDT()">Request Withdrawal</button>
        </div>

        <div class="payment-note">
          <p>📝 <strong>Mock Withdrawal:</strong> This will simulate a withdrawal request.</p>
          <p>In production, withdrawals would be reviewed and processed manually.</p>
        </div>
      </div>
    `;
  }

  mount(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.update();
  }

  update() {
    if (!this.container) return;
    this.container.innerHTML = this.render();
  }

  setTab(tab) {
    this.activeTab = tab;
    this.update();
  }

  updateBuyTotal() {
    const amount = parseFloat(document.getElementById('buy-amount')?.value || 0);
    const usdtRate = 0.01;
    const total = amount * usdtRate;

    const totalInput = document.getElementById('buy-total');
    if (totalInput) {
      totalInput.value = total.toFixed(2) + ' USDT';
    }
  }

  updateWithdrawTotal() {
    const amount = parseFloat(document.getElementById('withdraw-amount')?.value || 0);
    const usdtRate = 0.01;
    const total = amount * usdtRate;

    const totalInput = document.getElementById('withdraw-total');
    if (totalInput) {
      totalInput.value = total.toFixed(2) + ' USDT';
    }
  }

  async buyWithUSDT() {
    const amount = parseFloat(document.getElementById('buy-amount')?.value || 0);

    if (amount <= 0) {
      arenaX.showNotification('Please enter a valid amount', 'error');
      return;
    }

    const usdtAmount = amount * 0.01;
    const confirm = window.confirm(`Buy ${amount} AX for ${usdtAmount.toFixed(2)} USDT?\n\nThis will generate a mock payment.`);

    if (!confirm) return;

    try {
      arenaX.showNotification('Processing payment...', 'info');

      const response = await api.post('/api/usdt/buy', { amountAx: amount });

      if (response.success) {
        // Show mock payment address
        arenaX.showNotification(`Mock payment address:\n${response.paymentAddress}`, 'info');

        // Simulate payment confirmation after 3 seconds
        setTimeout(async () => {
          arenaX.showNotification('Payment confirmed! ✓', 'success');

          // Refresh balance
          const userResponse = await api.get('/api/auth/me');
          if (userResponse.user) {
            store.updateBalance(userResponse.user.balance);
          }

          // Clear form
          document.getElementById('buy-amount').value = '';
          document.getElementById('buy-total').value = '';
        }, 3000);
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Payment failed', 'error');
    }
  }

  async withdrawUSDT() {
    const amount = parseFloat(document.getElementById('withdraw-amount')?.value || 0);
    const address = document.getElementById('usdt-address')?.value?.trim();

    if (amount <= 0) {
      arenaX.showNotification('Please enter a valid amount', 'error');
      return;
    }

    if (!address || address.length < 34) {
      arenaX.showNotification('Please enter a valid USDT address', 'error');
      return;
    }

    const usdtAmount = amount * 0.01;
    const confirm = window.confirm(`Withdraw ${amount} AX (${usdtAmount.toFixed(2)} USDT) to:\n${address}\n\nContinue?`);

    if (!confirm) return;

    try {
      arenaX.showNotification('Processing withdrawal...', 'info');

      const response = await api.post('/api/usdt/withdraw', {
        amountAx: amount,
        usdtAddress: address
      });

      if (response.success) {
        arenaX.showNotification('Withdrawal request submitted! ✓', 'success');

        // Show mock transaction hash
        setTimeout(() => {
          arenaX.showNotification(`Mock TXN: ${response.txnHash}`, 'info');
        }, 2000);

        // Refresh balance
        const userResponse = await api.get('/api/auth/me');
        if (userResponse.user) {
          store.updateBalance(userResponse.user.balance);
        }

        // Clear form
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('withdraw-total').value = '';
        document.getElementById('usdt-address').value = '';
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Withdrawal failed', 'error');
    }
  }
}

const wallet = new Wallet();
