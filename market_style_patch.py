from pathlib import Path

p = Path(r'C:\Users\Askari\.claude\ArenaX_clone\index.html')
text = p.read_text(encoding='utf-8')
old = '''    .market-summary { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; margin-bottom: 16px; }
    .market-ticker {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      background: linear-gradient(90deg, rgba(18,18,24,.95), rgba(24,24,32,.92));
      border-radius: 18px;
      padding: 12px 0;
      margin-bottom: 16px;
    }
    .market-ticker-track {
      display: flex;
      gap: 18px;
      width: max-content;
      animation: tickerLoop 22s linear infinite;
      padding-left: 18px;
    }
    .market-ticker-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 800;
      color: var(--text);
      letter-spacing: .03em;
    }
    .market-ticker-item .up { color: var(--success); }
    .market-ticker-item .down { color: var(--danger); }
    .market-ticker-item .pair { color: var(--gold-light); text-transform: uppercase; font-size: 11px; letter-spacing: .1em; }
    @keyframes tickerLoop { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    .market-toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 16px;
    }
    .market-toggle-btn {
      border: 1px solid var(--line);
      background: rgba(255,255,255,.035);
      color: var(--muted);
      padding: 14px 16px;
      border-radius: 18px;
      font-weight: 900;
      font-size: 13px;
      letter-spacing: .08em;
      text-transform: uppercase;
      transition: .22s ease;
    }
    .market-toggle-btn:hover { transform: translateY(-2px); border-color: var(--line-strong); color: var(--text); }
    .market-toggle-btn.active {
      color: #140d04;
      background: var(--gold-gradient);
      box-shadow: 0 0 26px rgba(216,164,59,.22), inset 0 1px 0 rgba(255,255,255,.45);
      border-color: transparent;
    }
    .market-view { display: none; }
    .market-view.active { display: block; animation: fadeUp .28s ease both; }
    .market-sell-block, .market-buy-block { margin-top: 16px; }
    .market-filter-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0,1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .market-filter-card {
      border: 1px solid rgba(255,255,255,.06);
      background: rgba(255,255,255,.02);
      border-radius: 18px;
      padding: 16px;
    }
    .market-filter-card h3 {
      font-size: 13px;
      font-weight: 800;
      margin-bottom: 12px;
      color: var(--text);
    }
    .market-chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
    .market-chip {
      padding: 8px 11px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.04);
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      transition: .2s ease;
    }
    .market-chip.active {
      background: rgba(255,225,150,.12);
      border-color: var(--line-strong);
      color: var(--gold-light);
    }
    .market-form-grid {
      display: grid;
      grid-template-columns: 1.15fr .85fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .market-form-card {
      border: 1px solid rgba(255,255,255,.06);
      background: rgba(255,255,255,.02);
      border-radius: 20px;
      padding: 18px;
    }
    .market-form-card h3 {
      font-size: 17px;
      margin-bottom: 8px;
      font-family: var(--font-display);
    }
    .market-form-card p { color: var(--muted); font-size: 12.5px; line-height: 1.6; margin-bottom: 14px; }
    .market-inline-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0,1fr));
      gap: 10px;
    }
    .market-kpi {
      padding: 12px 14px;
      border-radius: 15px;
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.05);
    }
    .market-kpi .k-label {
      color: var(--muted-2);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .market-kpi .k-value {
      font-family: var(--font-display);
      font-size: 18px;
    }
    .market-book-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .order { justify-content: space-between; }
'''
new = '''    .market-summary { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px; margin-bottom: 18px; }
    .market-summary .stat-card {
      border-radius: 24px;
      background: linear-gradient(180deg, rgba(18,20,26,.94), rgba(13,15,20,.92));
      border: 1px solid rgba(255,255,255,.06);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 18px 38px rgba(0,0,0,.28);
    }
    .market-ticker {
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.06);
      background: linear-gradient(90deg, rgba(12,14,18,.96), rgba(16,18,24,.94));
      border-radius: 22px;
      padding: 14px 0;
      margin-bottom: 18px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
    }
    .market-ticker::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, rgba(0,0,0,.32), transparent 10%, transparent 90%, rgba(0,0,0,.32));
      pointer-events: none;
    }
    .market-ticker-track {
      display: flex;
      gap: 18px;
      width: max-content;
      animation: tickerLoop 22s linear infinite;
      padding-left: 18px;
    }
    .market-ticker-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 800;
      color: var(--text);
      letter-spacing: .03em;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,.02);
      border: 1px solid rgba(255,255,255,.04);
    }
    .market-ticker-item .up { color: var(--success); }
    .market-ticker-item .down { color: var(--danger); }
    .market-ticker-item .pair { color: var(--gold-light); text-transform: uppercase; font-size: 10px; letter-spacing: .14em; }
    @keyframes tickerLoop { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    .market-toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 18px;
      padding: 8px;
      border-radius: 24px;
      background: linear-gradient(180deg, rgba(12,14,18,.96), rgba(17,19,24,.92));
      border: 1px solid rgba(255,255,255,.06);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
    }
    .market-toggle-btn {
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      padding: 14px 18px;
      border-radius: 18px;
      font-weight: 900;
      font-size: 12px;
      letter-spacing: .14em;
      text-transform: uppercase;
      transition: .22s ease;
    }
    .market-toggle-btn:hover { color: var(--text); background: rgba(255,255,255,.03); }
    .market-toggle-btn.active {
      color: #140d04;
      background: linear-gradient(135deg, #ffe8a8, #e7be58 58%, #b27b17);
      box-shadow: 0 16px 30px rgba(216,164,59,.18), inset 0 1px 0 rgba(255,255,255,.5);
    }
    .market-view { display: none; }
    .market-view.active { display: block; animation: fadeUp .28s ease both; }
    .market-sell-block, .market-buy-block { margin-top: 18px; }
    .market-filter-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0,1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .market-filter-card,
    .market-form-card,
    .market-book-grid .card {
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,.06);
      background: linear-gradient(180deg, rgba(18,20,26,.95), rgba(13,15,20,.92));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 20px 38px rgba(0,0,0,.24);
    }
    .market-filter-card {
      padding: 18px;
      position: relative;
      overflow: hidden;
    }
    .market-filter-card::before,
    .market-form-card::before,
    .market-book-grid .card::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.02) 1px, transparent 1px);
      background-size: 34px 34px;
      opacity: .22;
      pointer-events: none;
    }
    .market-filter-card > *, .market-form-card > *, .market-book-grid .card > * { position: relative; z-index: 1; }
    .market-filter-card h3 {
      font-size: 13px;
      font-weight: 900;
      margin-bottom: 12px;
      color: var(--text);
      letter-spacing: -.02em;
    }
    .market-chip-group { display: flex; flex-wrap: wrap; gap: 10px; }
    .market-chip {
      padding: 9px 13px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.025);
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      transition: .22s ease;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
    }
    .market-chip:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.14); color: var(--text); }
    .market-chip.active {
      background: rgba(255,225,150,.12);
      border-color: rgba(255,225,150,.24);
      color: var(--gold-light);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 12px 24px rgba(216,164,59,.08);
    }
    .market-form-grid {
      display: grid;
      grid-template-columns: 1.15fr .85fr;
      gap: 18px;
      margin-bottom: 18px;
    }
    .market-form-card {
      padding: 22px;
      position: relative;
      overflow: hidden;
    }
    .market-form-card h3 {
      font-size: 18px;
      margin-bottom: 8px;
      font-family: var(--font-display);
      letter-spacing: -.02em;
    }
    .market-form-card p { color: var(--muted); font-size: 12.5px; line-height: 1.7; margin-bottom: 14px; }
    .market-inline-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0,1fr));
      gap: 12px;
    }
    .market-kpi {
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(255,255,255,.025);
      border: 1px solid rgba(255,255,255,.06);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
    }
    .market-kpi .k-label {
      color: var(--muted-2);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .market-kpi .k-value {
      font-family: var(--font-display);
      font-size: 19px;
    }
    .market-book-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .market-book-grid .card { padding: 20px; position: relative; overflow: hidden; }
    .order { justify-content: space-between; padding: 16px 14px; border-radius: 18px; background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.05); }
'''
if old not in text:
    raise SystemExit('old marketplace style block not found')
text = text.replace(old, new)
p.write_text(text, encoding='utf-8')
print('marketplace style updated')
