/* ==========================================================================
   ArenaX — verifies EVERY game's online wiring loads and starts, in a real
   browser. For each game: the OnlineMode subclass instantiates, the engine
   bridge is published, a match starts for host and guest with the right
   seat/side, and (where applicable) an action arriving over both transports
   applies exactly once.

   Usage: node scripts/test-all-games-online.js
   ========================================================================== */

const http = require('http'), fsp = require('fs/promises'), fs = require('fs');
const path = require('path'), os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5083;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  return new Promise((res) => {
    const s = http.createServer(async (q, r) => {
      try {
        const u = decodeURIComponent(q.url.split('?')[0]);
        const f = path.join(ROOT, u === '/' ? 'index.html' : u);
        if (!f.startsWith(ROOT)) { r.writeHead(403).end(); return; }
        const b = await fsp.readFile(f);
        r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        r.end(b);
      } catch (e) {
        r.writeHead(200, { 'Content-Type': 'application/json' });
        r.end('{"success":false}');
      }
    });
    s.listen(PORT, () => res(s));
  });
}

class CDP {
  constructor(u) { this.u = u; this.id = 0; this.p = new Map(); this.console = []; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.u);
      this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws'));
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.p.has(m.id)) {
          const q = this.p.get(m.id); this.p.delete(m.id);
          m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
          return;
        }
        if (m.method === 'Runtime.consoleAPICalled') {
          this.console.push('[' + m.params.type + '] ' + (m.params.args || [])
            .map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
        }
        if (m.method === 'Runtime.exceptionThrown') {
          this.console.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
        }
      };
    });
  }
  send(me, pa = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method: me, params: pa }));
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error(me + ' timeout')); } }, 30000);
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let pass = 0, fail = 0;
const check = (n, c, d) => {
  if (c) { pass++; console.log('    PASS  ' + n); }
  else { fail++; console.log('    FAIL  ' + n + (d !== undefined ? '  -> ' + JSON.stringify(d) : '')); }
};

// Stub the transports, then start a match in the given role.
const stubAndStart = (omName, role) => `(() => {
  const om = window.${omName};
  if (!om) return { error: 'missing ${omName}' };
  window.__sent = { broadcast: [], rest: [] };
  socketClient.userId = 'me-uuid'; socketClient.username = 'alice';
  socketClient.broadcastAction = a => { window.__sent.broadcast.push(a); return true; };
  socketClient.sendAction = a => { window.__sent.rest.push(a); return true; };
  socketClient.sendGameEnd = () => true;
  om.roomCode = 'T1'; om.role = '${role}'; om.wager = 0;
  var isHost = '${role}' === 'host';
  try {
    om.handleGameStart({ firstTurn: isHost ? 'me-uuid' : 'opp-uuid', players: [
      { userId: isHost ? 'me-uuid' : 'opp-uuid', username: isHost ? 'alice' : 'bob', role: 'host' },
      { userId: isHost ? 'opp-uuid' : 'me-uuid', username: isHost ? 'bob' : 'alice', role: 'guest' } ] });
  } catch (e) { return { error: String(e && e.message || e) }; }
  return { ok: true, gameStarted: om.gameStarted };
})()`;

const GAMES = [
  {
    name: '8 Ball Pool', page: '8ball-pool.html', om: 'onlineMode_8ballpool', bridge: 'game',
    probe: `(() => { const g = window.game, om = window.onlineMode_8ballpool;
      return { seat: om.myPlayerNumber, engineSeat: g.myPlayerNumber, online: g.online,
               currentPlayer: g.currentPlayer, started: g.gameStarted }; })()`,
    expectHost: s => s.seat === 1 && s.online === true && s.currentPlayer === 1,
    expectGuest: s => s.seat === 2 && s.online === true
  },
  {
    name: 'Chess', page: 'chess.html', om: 'onlineMode_chess', bridge: 'chessGame',
    probe: `(() => { const g = window.chessGame, om = window.onlineMode_chess;
      return { color: om.color, online: g.online, turn: g.turn,
               flipped: document.getElementById('board').classList.contains('flipped') }; })()`,
    expectHost: s => s.color === 'w' && s.online === true && s.flipped === false,
    expectGuest: s => s.color === 'b' && s.flipped === true
  },
  {
    name: 'Checkers', page: 'checkers.html', om: 'onlineMode_checkers', bridge: 'checkersApi',
    probe: `(() => { const a = window.checkersApi, om = window.onlineMode_checkers;
      return { mySide: a.state.mySide, DARK: a.DARK, LIGHT: a.LIGHT,
               online: a.state.online, mode: a.state.mode, turn: a.state.turn }; })()`,
    expectHost: s => s.mySide === s.DARK && s.online === true && s.mode === 'online',
    expectGuest: s => s.mySide === s.LIGHT && s.online === true
  },
  {
    name: 'Ludo', page: 'ludo.html', om: 'onlineMode_ludo', bridge: 'ludoApi',
    probe: `(() => { const a = window.ludoApi, om = window.onlineMode_ludo;
      return { mySeat: a.state.mySeat, online: a.state.online, mode: a.state.mode,
               turn: a.state.turn, players: a.state.players.length, isHost: om.isHost }; })()`,
    expectHost: s => s.mySeat === 0 && s.online === true && s.players === 2 && s.isHost === true,
    expectGuest: s => s.mySeat === 1 && s.online === true && s.isHost === false
  },
  {
    name: 'Carrom', page: 'carrom.html', om: 'onlineMode_carrom', bridge: 'carromApi',
    probe: `(() => { const a = window.carromApi, om = window.onlineMode_carrom, g = a.getGame();
      return { seat: om.myPlayerNumber, engineSeat: g.myPlayerNumber,
               mode: g.state && g.state.mode, pvp: a.GAME_MODE.PVP,
               hooked: typeof g.options.onShoot === 'function' }; })()`,
    expectHost: s => s.seat === 1 && s.engineSeat === 1 && s.mode === s.pvp && s.hooked === true,
    expectGuest: s => s.seat === 2 && s.engineSeat === 2 && s.mode === s.pvp
  },
  {
    name: 'Glow Hockey', page: 'glow-hockey.html', om: 'onlineMode_hockey', bridge: 'hockeyApi',
    probe: `(() => { const a = window.hockeyApi, om = window.onlineMode_hockey;
      return { active: a.NET.active, isHost: a.NET.isHost, mySide: a.NET.mySide,
               streaming: !!om._streamTimer }; })()`,
    expectHost: s => s.active === true && s.isHost === true && s.mySide === 'bottom' && s.streaming === true,
    expectGuest: s => s.active === true && s.isHost === false && s.mySide === 'top'
  }
];

(async () => {
  const srv = await serve();
  console.log('Serving ' + ROOT + ' on :' + PORT + '\n');
  const prof = path.join(os.tmpdir(), 'ax-all-' + process.pid);
  fs.mkdirSync(prof, { recursive: true });
  const proc = spawn(CHROME, ['--remote-debugging-port=9471', '--user-data-dir=' + prof,
    '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:9471/json/version')).ok) break; } catch (e) {} await sleep(300); }
  let t = null;
  for (let i = 0; i < 40; i++) {
    const l = await (await fetch('http://127.0.0.1:9471/json/list')).json();
    t = l.find(x => x.type === 'page'); if (t && t.webSocketDebuggerUrl) break; await sleep(250);
  }
  const cdp = new CDP(t.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');

  for (const g of GAMES) {
    console.log('=== ' + g.name + ' (' + g.page + ') ===');
    cdp.console.length = 0;
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/games/' + g.page });
    await sleep(4000);

    const loaded = await cdp.eval(`({ om: !!window.${g.om}, bridge: !!window.${g.bridge},
      hasReliable: !!(window.${g.om} && window.${g.om}.sendReliableAction),
      hasDedupe: !!(window.${g.om} && window.${g.om}.shouldApplyAction) })`);
    check('OnlineMode subclass instantiated', loaded.om === true, loaded);
    check('engine bridge published (window.' + g.bridge + ')', loaded.bridge === true, loaded);
    check('inherits shared reliable transport', loaded.hasReliable === true, loaded);
    check('inherits shared dedupe', loaded.hasDedupe === true, loaded);

    if (!loaded.om || !loaded.bridge) {
      const errs = cdp.console.filter(l => l.startsWith('[EXCEPTION]') || l.startsWith('[error]'));
      if (errs.length) console.log('    page errors: ' + errs.slice(0, 4).join(' | '));
      console.log('');
      continue;
    }

    let r = await cdp.eval(stubAndStart(g.om, 'host'));
    if (r.error) { check('host match starts', false, r); }
    else {
      const s = await cdp.eval(g.probe);
      check('host match starts with correct seat/side', g.expectHost(s), s);
    }

    r = await cdp.eval(stubAndStart(g.om, 'guest'));
    if (r.error) { check('guest match starts', false, r); }
    else {
      const s = await cdp.eval(g.probe);
      check('guest match starts with correct seat/side', g.expectGuest(s), s);
    }

    // Shared dedupe must hold for every game.
    const dd = await cdp.eval(`(() => { const om = window.${g.om};
      const a = { type: 'zzz-probe', actionId: 'probe:1' };
      return { first: om.shouldApplyAction(a), second: om.shouldApplyAction(a) }; })()`);
    check('same actionId applies once, then never again', dd.first === true && dd.second === false, dd);

    const errs = cdp.console.filter(l => l.startsWith('[EXCEPTION]'));
    check('no uncaught page exceptions', errs.length === 0, errs.slice(0, 3));
    console.log('');
  }

  console.log('================ RESULT ================');
  console.log('passed: ' + pass + '   failed: ' + fail);
  try { proc.kill(); } catch (e) {}
  srv.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
