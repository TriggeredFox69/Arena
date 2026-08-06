from pathlib import Path

p = Path(r'C:\Users\Askari\.claude\ArenaX_clone\index.html')
text = p.read_text(encoding='utf-8')
start = text.index('<section class="section-view" id="section-marketplace">')
end = text.index('<section class="section-view" id="section-wallet">')
new_section = '''<section class="section-view" id="section-marketplace">
        <div class="section-head">
          <div>
            <h2>AX Marketplace</h2>
            <p>Premium exchange-inspired trading desk for AX/PKR with live-style depth and order flow.</p>
          </div>
          <button class="btn" onclick="openTradeModal()">+ Create Order</button>
        </div>

        <div class="market-exchange-shell glow-card" style="padding:22px;border-radius:28px;">
          <div class="market-pair-hero">
            <div class="market-pair-left">
              <div class="market-pair-badge">AX/PKR</div>
              <div class="market-pair-price" id="marketAsk">—</div>
              <div class="small-text">ArenaX spot market · simulated exchange flow</div>
            </div>
            <div class="market-pair-stats">
              <div class="market-stat-pill"><span>Best Bid</span><strong id="marketBid">—</strong></div>
              <div class="market-stat-pill"><span>Spread</span><strong id="marketSpread">—</strong></div>
              <div class="market-stat-pill"><span>24H High</span><strong>₨10.0</strong></div>
              <div class="market-stat-pill"><span>24H Vol</span><strong>1.82M AX</strong></div>
            </div>
          </div>

          <div class="market-ticker">
            <div class="market-ticker-track" id="marketTickerTrack"></div>
          </div>

          <div class="market-toggle">
            <button class="market-toggle-btn active" id="marketSellTab" onclick="switchMarketView('sell')">Sell</button>
            <button class="market-toggle-btn" id="marketBuyTab" onclick="switchMarketView('buy')">Buy</button>
          </div>

          <div class="market-exchange-layout">
            <div class="market-orderbook-column">
              <div class="market-depth-card">
                <div class="section-head" style="margin-bottom:14px;">
                  <div>
                    <h2 style="font-size:18px;">Order Book</h2>
                    <p>Live depth inspired by top exchanges.</p>
                  </div>
                  <span class="pill">Depth</span>
                </div>
                <div class="market-book-panels">
                  <div class="market-book-side">
                    <div class="market-book-head sell"><span>Asks</span><strong>Sell Liquidity</strong></div>
                    <div class="market-list" id="sellOrders"></div>
                  </div>
                  <div class="market-book-side">
                    <div class="market-book-head buy"><span>Bids</span><strong>Buy Liquidity</strong></div>
                    <div class="market-list" id="buyOrders"></div>
                  </div>
                </div>
              </div>

              <div class="market-flow-grid">
                <div class="card" style="border-radius:24px;padding:20px;">
                  <div class="section-head" style="margin-bottom:12px;"><div><h2 style="font-size:17px;">Matched Buyer Demand</h2><p>Best buyer interest for your AX.</p></div></div>
                  <div class="market-list" id="sellSideBuyOrders"></div>
                </div>
                <div class="card" style="border-radius:24px;padding:20px;">
                  <div class="section-head" style="margin-bottom:12px;"><div><h2 style="font-size:17px;">Matched Seller Supply</h2><p>Best seller offers available now.</p></div></div>
                  <div class="market-list" id="buySideSellOrders"></div>
                </div>
              </div>
            </div>

            <div class="market-trade-column">
              <div class="market-filter-grid market-filter-grid-compact" id="marketSharedFilters">
                <div class="market-filter-card">
                  <h3>Pakistan Methods</h3>
                  <div class="market-chip-group" id="sellPakistanFilters">
                    <button class="market-chip active" onclick="toggleMarketFilter(this)">JazzCash</button>
                    <button class="market-chip active" onclick="toggleMarketFilter(this)">Easypaisa</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">NayaPay</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">SadaPay</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">Raast</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">IBFT</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">HBL</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">UBL</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">Meezan</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">Allied</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">Bank Alfalah</button>
                  </div>
                </div>
                <div class="market-filter-card">
                  <h3>International</h3>
                  <div class="market-chip-group" id="sellInternationalFilters">
                    <button class="market-chip active" onclick="toggleMarketFilter(this)">PayPal</button>
                    <button class="market-chip active" onclick="toggleMarketFilter(this)">Stripe</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">Wire</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">Card</button>
                  </div>
                </div>
                <div class="market-filter-card">
                  <h3>Crypto / Chain</h3>
                  <div class="market-chip-group" id="sellCryptoFilters">
                    <button class="market-chip active" onclick="toggleMarketFilter(this)">TRON / TRC20</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">USDT</button>
                    <button class="market-chip" onclick="toggleMarketFilter(this)">Instant</button>
                  </div>
                </div>
                <div class="market-filter-card">
                  <h3>Priority</h3>
                  <div class="market-chip-group" id="sellPriorityFilters">
                    <button class="market-chip active" onclick="selectPriority(this, 'sell')">Lowest price</button>
                    <button class="market-chip" onclick="selectPriority(this, 'sell')">Highest price</button>
                    <button class="market-chip" onclick="selectPriority(this, 'sell')">Recently listed</button>
                  </div>
                </div>
              </div>

              <div class="market-view active" id="marketSellView">
                <div class="market-form-grid market-form-grid-tight">
                  <div class="market-form-card">
                    <h3>Sell AX</h3>
                    <p>Place a premium sell order, choose settlement rails, and capture the strongest buy-side demand.</p>
                    <div class="market-inline-grid">
                      <input class="input" id="sellAmountInput" type="number" min="1" placeholder="Amount in AX">
                      <input class="input" id="sellPriceInput" type="number" min="1" step="0.1" placeholder="PKR per AX">
                    </div>
                    <div class="market-inline-grid" style="margin-top:12px;">
                      <select class="input" id="sellPaymentType">
                        <option>JazzCash</option>
                        <option>Easypaisa</option>
                        <option>NayaPay</option>
                        <option>SadaPay</option>
                        <option>Raast</option>
                        <option>Bank Transfer / IBFT</option>
                        <option>PayPal</option>
                        <option>Stripe</option>
                        <option>TRON / TRC20</option>
                      </select>
                      <input class="input" id="sellMinLimitInput" type="number" min="1" placeholder="Minimum AX limit">
                    </div>
                    <div class="hero-actions" style="margin-top:14px;">
                      <button class="btn" onclick="createMarketplaceOffer('sell')">Create Sell Offer</button>
                      <button class="btn secondary" onclick="openTradeModal()">Advanced Order</button>
                    </div>
                  </div>
                  <div class="market-form-card">
                    <h3>Sell Analytics</h3>
                    <p>Price your ask using live demand and stay ahead of the spread.</p>
                    <div class="market-inline-grid">
                      <div class="market-kpi"><div class="k-label">Suggested Rate</div><div class="k-value" id="sellSuggestedRate">₨9.8</div></div>
                      <div class="market-kpi"><div class="k-label">Min Order</div><div class="k-value">25 AX</div></div>
                      <div class="market-kpi"><div class="k-label">Preferred Rail</div><div class="k-value">JazzCash</div></div>
                      <div class="market-kpi"><div class="k-label">Settlement</div><div class="k-value">Under 10m</div></div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="market-view" id="marketBuyView">
                <div class="market-form-grid market-form-grid-tight">
                  <div class="market-form-card">
                    <h3>Buy AX</h3>
                    <p>Accumulate AX like a pro trader using the best payment route and strongest market depth.</p>
                    <div class="market-inline-grid">
                      <input class="input" id="buyAmountInput" type="number" min="1" placeholder="Amount in AX">
                      <input class="input" id="buyPriceInput" type="number" min="1" step="0.1" placeholder="PKR per AX">
                    </div>
                    <div class="market-inline-grid" style="margin-top:12px;">
                      <select class="input" id="buyPaymentType">
                        <option>JazzCash</option>
                        <option>Easypaisa</option>
                        <option>NayaPay</option>
                        <option>SadaPay</option>
                        <option>Raast</option>
                        <option>Bank Transfer / IBFT</option>
                        <option>PayPal</option>
                        <option>Stripe</option>
                        <option>TRON / TRC20</option>
                      </select>
                      <input class="input" id="buyMinLimitInput" type="number" min="1" placeholder="Minimum seller limit">
                    </div>
                    <div class="hero-actions" style="margin-top:14px;">
                      <button class="btn" onclick="createMarketplaceOffer('buy')">Create Buy Request</button>
                      <button class="btn secondary" onclick="openTradeModal()">Advanced Order</button>
                    </div>
                  </div>
                  <div class="market-form-card">
                    <h3>Buy Analytics</h3>
                    <p>Track the strongest bid opportunity and route through the fastest liquidity lane.</p>
                    <div class="market-inline-grid">
                      <div class="market-kpi"><div class="k-label">Target Rate</div><div class="k-value" id="buySuggestedRate">₨9.5</div></div>
                      <div class="market-kpi"><div class="k-label">Min Fill</div><div class="k-value">50 AX</div></div>
                      <div class="market-kpi"><div class="k-label">Preferred Rail</div><div class="k-value">TRON</div></div>
                      <div class="market-kpi"><div class="k-label">Settlement</div><div class="k-value">Instant</div></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

'''
text = text[:start] + new_section + text[end:]
p.write_text(text, encoding='utf-8')
print('marketplace section rebuilt')
