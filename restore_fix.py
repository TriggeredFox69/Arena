from pathlib import Path

p = Path(r'C:\Users\Askari\.claude\ArenaX_clone\index.html')
text = p.read_text(encoding='utf-8')
anchor = '<div class="toasts" id="toasts"></div>'
if anchor not in text:
    raise SystemExit('toasts anchor not found')
head = text.split(anchor)[0] + anchor + '\n\n'
script = '''  <script>
    const user = JSON.parse(localStorage.getItem('arenax_user') || '{"username":"gandu","uid":"AX840364","coins":99,"gamesPlayed":2,"wins":1}');
    const friends = JSON.parse(localStorage.getItem('arenax_friends') || '[{"name":"sami","uid":"AX10211","online":true},{"name":"pasha","uid":"AX99281","online":true},{"name":"rehan","uid":"AX56370","online":true}]');
    const upcomingGames = [
      { emoji:'🏰', title:'Castle Siege', meta:'Strategy battles with AXLITE farming.' },
      { emoji:'🏎️', title:'Turbo Racers', meta:'High-speed races with airdrop rewards.' },
      { emoji:'🧩', title:'Puzzle Arena', meta:'Solve to earn AXLITE points.' }
    ];
    const sellOrders = [
      {name:'TraderPro', amount:500, price:9.8},
      {name:'CoinMaster', amount:250, price:10.0},
      {name:'QuickSeller', amount:1000, price:10.2}
    ];
    const buyOrders = [
      {name:'AXWhale', amount:300, price:9.5},
      {name:'BuyerPK', amount:800, price:9.2},
      {name:'MarketBot', amount:150, price:9.0}
    ];
    const sectionMeta = {
      dashboard: { title: 'Dashboard', subtitle: 'Your ArenaX overview and featured game.' },
      games: { title: 'Games', subtitle: 'Current live titles and the roadmap ahead.' },
      airdrop: { title: 'Airdrop', subtitle: 'Farm AXLITE now. Airdrop unlocks at 1B farmed tokens.' },
      marketplace: { title: 'Marketplace', subtitle: 'Peer-to-peer AX coin trading and orders.' },
      wallet: { title: 'Wallet', subtitle: 'Manage AX, buy through USDT, and request withdrawals.' },
      friends: { title: 'Friends', subtitle: 'Find players by UID and manage social connections.' },
      chat: { title: 'Chat', subtitle: 'Community messages, banter, and quick reactions.' },
      rooms: { title: 'Rooms', subtitle: 'Create private matches and invite friends directly.' }
    };
    let walletMode = 'buy';
    let marketplaceView = 'sell';
    const AXLITE_GOAL = 1000000000;
    let airdropFarmed = Number(localStorage.getItem('arenax_axlite_farmed') || 12470382);
    if (!Number.isFinite(airdropFarmed) || airdropFarmed < 0) airdropFarmed = 12470382;

    function saveUser(){ localStorage.setItem('arenax_user', JSON.stringify(user)); }
    function el(id){ return document.getElementById(id); }
    function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function closeSidebar(){}
    function openGame(path){ window.location.href = path; }
    function toast(text){ const box = el('toasts'); if (!box) return; const d = document.createElement('div'); d.className='toast'; d.textContent = text; box.appendChild(d); setTimeout(()=>d.remove(), 2200); }
    function closeModals(){ document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('show')); }
    function openTradeModal(){ el('tradeModal')?.classList.add('show'); }
    function openWallet(mode){ walletMode = mode; if (el('walletTitle')) el('walletTitle').textContent = mode === 'buy' ? 'Buy AX' : 'Withdraw AX'; if (el('walletAddress')) el('walletAddress').style.display = mode === 'buy' ? 'none' : 'block'; el('walletModal')?.classList.add('show'); }
    function openSendModal(uid=''){ if (el('sendUid')) el('sendUid').value = uid || ''; el('sendModal')?.classList.add('show'); }
    function openRoomModal(){ el('roomModal')?.classList.add('show'); }
    function confirmWallet(){ closeModals(); toast(walletMode === 'buy' ? 'AX purchase request submitted' : 'Withdraw request submitted'); }
    function confirmSend(){ const amount = Number(el('sendAmount')?.value || 0); if (amount > 0) { user.coins = Math.max((user.coins||99) - amount, 0); saveUser(); render(); } closeModals(); toast('AX sent successfully'); }
    function confirmFriend(){ closeModals(); toast('Friend request sent'); }
    function createRoom(){ closeModals(); toast('Custom room created'); }

    function renderAirdrop(){
      if (!el('airdropFarmedCount')) return;
      const pct = Math.min((airdropFarmed / AXLITE_GOAL) * 100, 100);
      el('airdropFarmedCount').textContent = Math.floor(airdropFarmed).toLocaleString();
      el('airdropProgressFill').style.width = pct.toFixed(2) + '%';
      el('airdropProgressText').textContent = pct.toFixed(2) + '% complete';
      el('airdropRemainingText').textContent = Math.max(AXLITE_GOAL - airdropFarmed, 0).toLocaleString() + ' AXLITE remaining';
      el('airdropStatusText').textContent = airdropFarmed >= AXLITE_GOAL ? 'Live' : 'Not Live';
      el('airdropStatusText').style.color = airdropFarmed >= AXLITE_GOAL ? 'var(--success)' : 'var(--danger)';
      el('airdropStatusNote').textContent = airdropFarmed >= AXLITE_GOAL ? 'AXLITE airdrop unlocked' : 'Unlocks at 1B farmed AXLITE';
    }
    function tickAirdrop(){
      const inc = 1200 + Math.floor(Math.random() * 3600);
      airdropFarmed = Math.min(airdropFarmed + inc, AXLITE_GOAL);
      localStorage.setItem('arenax_axlite_farmed', String(airdropFarmed));
      renderAirdrop();
    }

    function render(){
      const maxAmount = Math.max(...sellOrders.map(o => o.amount), ...buyOrders.map(o => o.amount));
      const orderRow = (o, cls, i) => `
        <div class="order ${cls}" style="animation-delay:${i * 60}ms">
          <div class="order-main">
            <strong>${o.amount.toLocaleString()} AX</strong> &nbsp;<span>${esc(o.name)}</span>
            <div class="order-bar"><i style="width:${Math.round(o.amount / maxAmount * 100)}%"></i></div>
          </div>
          <div class="order-price"><strong>₨${o.price.toFixed(1)}</strong><br><span>per AX</span></div>
        </div>`;
      if (el('sellOrders')) el('sellOrders').innerHTML = sellOrders.map((o, i) => orderRow(o, 'sell', i)).join('');
      if (el('buyOrders')) el('buyOrders').innerHTML = buyOrders.map((o, i) => orderRow(o, 'buy', i)).join('');
      if (el('sellSideBuyOrders')) el('sellSideBuyOrders').innerHTML = buyOrders.slice(0, 3).map((o, i) => orderRow(o, 'buy', i)).join('');
      if (el('buySideSellOrders')) el('buySideSellOrders').innerHTML = sellOrders.slice(0, 3).map((o, i) => orderRow(o, 'sell', i)).join('');
      const bestAsk = Math.min(...sellOrders.map(o => o.price));
      const bestBid = Math.max(...buyOrders.map(o => o.price));
      if (el('marketAsk')) el('marketAsk').textContent = '₨' + bestAsk.toFixed(1);
      if (el('marketBid')) el('marketBid').textContent = '₨' + bestBid.toFixed(1);
      if (el('marketSpread')) el('marketSpread').textContent = '₨' + (bestAsk - bestBid).toFixed(1);
      if (el('sellSuggestedRate')) el('sellSuggestedRate').textContent = '₨' + bestAsk.toFixed(1);
      if (el('buySuggestedRate')) el('buySuggestedRate').textContent = '₨' + bestBid.toFixed(1);
      if (el('walletCoinsHero')) el('walletCoinsHero').textContent = (user.coins || 99) + ' AX';
      if (el('walletCoins')) el('walletCoins').textContent = (user.coins || 99) + ' AX';
      if (el('walletWorth')) el('walletWorth').textContent = '₨' + ((user.coins || 99) * 10).toLocaleString();
      if (el('walletUsdt')) el('walletUsdt').textContent = ((user.coins || 99) * 0.01).toFixed(2) + ' USDT';
      const ticker = el('marketTickerTrack');
      if (ticker) ticker.innerHTML = Array.from({length:2}).map(() => `
        <div class="market-ticker-item"><span class="pair">AX/PKR</span> <strong>₨9.20</strong> <span class="down">-0.4%</span></div>
        <div class="market-ticker-item"><span class="pair">AX/PKR</span> <strong>₨9.45</strong> <span class="up">+0.8%</span></div>
        <div class="market-ticker-item"><span class="pair">AX/PKR</span> <strong>₨9.80</strong> <span class="up">+1.1%</span></div>
        <div class="market-ticker-item"><span class="pair">AX/PKR</span> <strong>₨10.00</strong> <span class="up">+2.1%</span></div>
        <div class="market-ticker-item"><span class="pair">USDT/PKR</span> <strong>₨280.57</strong> <span class="up">+0.2%</span></div>
        <div class="market-ticker-item"><span class="pair">TRON/TRC20</span> <strong>Live</strong> <span class="up">Fast</span></div>
      `).join('');
      const gameGrid = el('gameGrid');
      if (gameGrid) gameGrid.innerHTML = upcomingGames.map((g, i) => `<div class="game-item" style="animation-delay:${i*60}ms"><div class="game-icon">${g.emoji}</div><div class="game-copy"><h3>${g.title}</h3><p>${g.meta}</p></div><div class="soon">🔒 Tomorrow</div></div>`).join('');
      renderAirdrop();
    }

    function switchSection(section){
      document.querySelectorAll('.section-view').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      el('section-' + section)?.classList.add('active');
      document.querySelector('.nav-btn[data-section="' + section + '"]')?.classList.add('active');
      if (el('topTitle') && sectionMeta[section]) el('topTitle').textContent = sectionMeta[section].title;
      if (el('topSubtitle') && sectionMeta[section]) el('topSubtitle').textContent = sectionMeta[section].subtitle;
      if (section === 'marketplace') switchMarketView(marketplaceView, false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function switchMarketView(view, notify=true){
      marketplaceView = view;
      el('marketSellView')?.classList.toggle('active', view === 'sell');
      el('marketBuyView')?.classList.toggle('active', view === 'buy');
      el('marketSellTab')?.classList.toggle('active', view === 'sell');
      el('marketBuyTab')?.classList.toggle('active', view === 'buy');
      if (notify) toast((view === 'sell' ? 'Sell' : 'Buy') + ' marketplace ready');
    }
    function toggleMarketFilter(btn){ btn.classList.toggle('active'); }
    function selectPriority(btn, side){ const group = el(`${side}PriorityFilters`); if (!group) return; group.querySelectorAll('.market-chip').forEach(chip => chip.classList.remove('active')); btn.classList.add('active'); }
    function createMarketplaceOffer(type){
      const isSell = type === 'sell';
      const amount = Number(el(isSell ? 'sellAmountInput' : 'buyAmountInput')?.value || 0);
      const price = Number(el(isSell ? 'sellPriceInput' : 'buyPriceInput')?.value || 0);
      if (!amount || amount < 1 || !price || price < 1) return toast('Enter a valid AX amount and exchange rate');
      const payment = el(isSell ? 'sellPaymentType' : 'buyPaymentType')?.value || 'JazzCash';
      const minLimit = Number(el(isSell ? 'sellMinLimitInput' : 'buyMinLimitInput')?.value || 0);
      const entry = { name: user.username || 'You', amount, price, payment, minLimit };
      if (isSell) sellOrders.unshift(entry); else buyOrders.unshift(entry);
      render();
      toast((isSell ? 'Sell' : 'Buy') + ' offer created');
    }
    function createOrder(){
      const type = el('tradeType')?.value || 'sell';
      const amount = Number(el('tradeAmount')?.value || 0);
      const price = Number(el('tradePrice')?.value || 0);
      if (!amount || !price) return toast('Enter valid amount and price');
      const entry = { name: user.username || 'You', amount, price };
      if (type === 'sell') sellOrders.unshift(entry); else buyOrders.unshift(entry);
      closeModals();
      render();
      toast('Marketplace order created');
    }

    document.querySelectorAll('.nav-btn[data-section]').forEach(btn => btn.addEventListener('click', () => switchSection(btn.dataset.section)));
    render();
    setInterval(tickAirdrop, 1000);
  </script>
</body>
</html>
'''
p.write_text(head + script, encoding='utf-8')
print('RESTORED MAIN SCRIPT')
