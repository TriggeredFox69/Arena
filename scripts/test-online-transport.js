/* ==========================================================================
   ArenaX — verifies the shared online transport (OnlineMode.sendReliableAction
   + shouldApplyAction) and the rebuilt ChessOnline, in a real browser.

   No Supabase / no auth needed: socketClient's send methods are stubbed so we
   can drive both transports deterministically and inspect what was sent.

   The critical invariant under test: a move sent over BOTH transports (fast
   broadcast + durable REST) must be applied EXACTLY ONCE. Applying a chess
   move twice corrupts the board irreversibly for one player only, which is
   precisely the failure the actionId dedupe exists to prevent.

   Usage: node scripts/test-online-transport.js
   ========================================================================== */

const http = require('http');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5079;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      try {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const file = path.join(ROOT, url === '/' ? 'index.html' : url);
        if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
        const body = await fsp.readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'offline test stub' }));
      }
    });
    srv.listen(PORT, () => resolve(srv));
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
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error(method + ' timeout')); } }, 30000);
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

// Stub the transports and start a match as the given role.
const SETUP = (role) => `(() => {
  const om = window.onlineMode_chess;
  if (!om) return { error: 'onlineMode_chess missing' };

  window.__sent = { broadcast: [], rest: [] };
  socketClient.userId = 'me-uuid';
  socketClient.username = 'alice';
  socketClient.broadcastAction = (a) => { window.__sent.broadcast.push(a); return true; };
  socketClient.sendAction = (a) => { window.__sent.rest.push(a); return true; };
  socketClient.sendGameEnd = () => true;

  om.roomCode = 'TEST01';
  om.role = '${role}';
  om.wager = 0;

  // Drive the base start handler exactly as a real 'start' room_event would.
  om.handleGameStart({
    firstTurn: '${role}' === 'host' ? 'me-uuid' : 'opp-uuid',
    players: [
      { userId: '${role}' === 'host' ? 'me-uuid' : 'opp-uuid', username: '${role}' === 'host' ? 'alice' : 'bob', role: 'host' },
      { userId: '${role}' === 'host' ? 'opp-uuid' : 'me-uuid', username: '${role}' === 'host' ? 'bob' : 'alice', role: 'guest' }
    ]
  });

  const g = window.chessGame;
  return {
    color: om.color, myTurn: om.myTurn, gameStarted: om.gameStarted,
    turn: g.turn, online: g.online, onlineColor: g.onlineColor,
    flipped: document.getElementById('board').classList.contains('flipped'),
    whiteName: document.getElementById('whiteName').textContent,
    blackName: document.getElementById('blackName').textContent,
    status: document.getElementById('statusText').textContent,
    moveCount: g.moveLog.length
  };
})()`;

async function main() {
  const srv = await serve();
  console.log('Serving ' + ROOT + ' on :' + PORT);

  const profile = path.join(os.tmpdir(), 'arenax-transport-' + process.pid);
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, ['--remote-debugging-port=9451', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:9451/json/version')).ok) break; } catch (e) {} await sleep(300); }
  let t = null;
  for (let i = 0; i < 40; i++) {
    const l = await (await fetch('http://127.0.0.1:9451/json/list')).json();
    t = l.find(x => x.type === 'page'); if (t?.webSocketDebuggerUrl) break; await sleep(250);
  }
  const cdp = new CDP(t.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/games/chess.html` });
  await sleep(3500);

  const ready = await cdp.eval(`!!(window.chessGame && window.onlineMode_chess && window.onlineMode_chess.sendReliableAction)`);
  if (!ready) { console.log('Not ready. Console:\n' + cdp.console.join('\n')); process.exit(1); }
  console.log('Chess + ChessOnline loaded.\n');

  // ------------------------------------------------------------------ HOST
  console.log('1) Match start as HOST (White)');
  let r = await cdp.eval(SETUP('host'));
  check('color = white', r.color === 'w', r);
  check('host moves first (myTurn)', r.myTurn === true, r);
  check('board NOT flipped for white', r.flipped === false, r);
  check('real usernames shown (alice/bob)', r.whiteName === 'alice' && r.blackName === 'bob', r);
  check('status shows your move', /Your move/.test(r.status), r.status);

  // ------------------------------------------------------------------ 2
  console.log('\n2) Local move goes out over BOTH transports with one actionId');
  r = await cdp.eval(`(() => {
    const g = window.chessGame;
    // e2 -> e4 : white pawn. row 6 col 4 -> row 4 col 4 in this layout.
    g.handleSquareClick(6, 4);
    g.handleSquareClick(4, 4);
    const s = window.__sent;
    return {
      broadcastCount: s.broadcast.length,
      restCount: s.rest.length,
      bIds: s.broadcast.map(a => a.actionId),
      rIds: s.rest.map(a => a.actionId),
      bTypes: s.broadcast.map(a => a.type),
      moveLog: g.moveLog.length,
      myTurnAfter: window.onlineMode_chess.myTurn
    };
  })()`);
  check('sent once over broadcast (fast path)', r.broadcastCount === 1, r);
  check('sent once over REST (durable path)', r.restCount === 1, r);
  check('both carry the SAME actionId', r.bIds[0] && r.bIds[0] === r.rIds[0], r);
  check('action typed as move', r.bTypes[0] === 'move', r);
  check('turn released after moving', r.myTurnAfter === false, r);

  // ------------------------------------------------------------------ 3
  console.log('\n3) THE INVARIANT: same opponent move over both transports applies ONCE');
  r = await cdp.eval(`(() => {
    const g = window.chessGame;
    const before = g.moveLog.length;
    // Black replies e7->e5 : row 1 col 4 -> row 3 col 4.
    const move = { from: { row: 1, col: 4 }, to: { row: 3, col: 4 } };
    const action = { type: 'move', move, actionId: 'opp-uuid:1' };

    // Arrives first over the fast broadcast (no server nextTurn field)...
    window.onlineMode_chess.handleGameAction({ action, by: 'opp-uuid' });
    const afterFirst = g.moveLog.length;
    // ...then the durable REST copy of the very same action.
    window.onlineMode_chess.handleGameAction({ action, by: 'opp-uuid', nextTurn: 'me-uuid' });
    const afterSecond = g.moveLog.length;

    return {
      before, afterFirst, afterSecond,
      pieceAtTarget: g.board[3][4],
      pieceAtOrigin: g.board[1][4],
      myTurn: window.onlineMode_chess.myTurn,
      turn: g.turn
    };
  })()`);
  check('first (broadcast) copy applied', r.afterFirst === r.before + 1, r);
  check('second (REST) copy applied ZERO extra times', r.afterSecond === r.afterFirst, r);
  check('board advanced exactly one move', r.pieceAtTarget && !r.pieceAtOrigin, r);
  check('turn returned to us', r.myTurn === true && r.turn === 'w', r);

  // ------------------------------------------------------------------ 4
  console.log('\n4) Out-of-turn move is refused (server-validated turn order kept)');
  r = await cdp.eval(`(() => {
    const om = window.onlineMode_chess;
    window.__sent.broadcast.length = 0; window.__sent.rest.length = 0;
    om.myTurn = false;                       // pretend it's the opponent's turn
    const ok = om.sendReliableAction({ type: 'move', move: { from: {row:6,col:0}, to: {row:4,col:0} } });
    return { ok, broadcast: window.__sent.broadcast.length, rest: window.__sent.rest.length };
  })()`);
  check('sendReliableAction refuses out-of-turn', r.ok === false, r);
  check('nothing leaked onto either transport', r.broadcast === 0 && r.rest === 0, r);

  // ------------------------------------------------------------------ 5
  console.log('\n5) Match start as GUEST (Black) — orientation + names swap');
  r = await cdp.eval(SETUP('guest'));
  check('color = black', r.color === 'b', r);
  check('guest does NOT move first', r.myTurn === false, r);
  check('board flipped for black', r.flipped === true, r);
  check('names swapped (white=bob, black=alice)', r.whiteName === 'bob' && r.blackName === 'alice', r);
  check('status shows waiting', /Waiting/.test(r.status), r.status);
  check('fresh match resets the board', r.moveCount === 0 && r.turn === 'w', r);

  console.log('\n================ RESULT ================');
  console.log('passed: ' + pass + '   failed: ' + fail);
  const errs = cdp.console.filter(l => l.startsWith('[EXCEPTION]') || l.startsWith('[error]'));
  if (errs.length) console.log('\nPage errors:\n' + errs.slice(0, 10).join('\n'));

  try { proc.kill(); } catch (e) {}
  srv.close();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
