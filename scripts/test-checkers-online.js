/* ==========================================================================
   ArenaX — Checkers online wiring test, in a real browser.
   Verifies the engine API is exposed, a match starts with correct sides for
   host and guest, and an opponent move arriving over BOTH transports is
   applied exactly once.

   Usage: node scripts/test-checkers-online.js
   ========================================================================== */
const http = require('http'), fsp = require('fs/promises'), fs = require('fs');
const path = require('path'), os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5081;
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
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '  -> ' + JSON.stringify(d) : '')); }
};

const SETUP = (role) => [
  '(() => {',
  '  const om = window.onlineMode_checkers, api = window.checkersApi;',
  '  if (!om || !api) return { error: "missing om/api" };',
  '  window.__sent = { broadcast: [], rest: [] };',
  '  socketClient.userId = "me-uuid"; socketClient.username = "alice";',
  '  socketClient.broadcastAction = a => { window.__sent.broadcast.push(a); return true; };',
  '  socketClient.sendAction = a => { window.__sent.rest.push(a); return true; };',
  '  socketClient.sendGameEnd = () => true;',
  '  om.roomCode = "T1"; om.role = "' + role + '"; om.wager = 0;',
  '  var isHost = "' + role + '" === "host";',
  '  om.handleGameStart({ firstTurn: isHost ? "me-uuid" : "opp-uuid", players: [',
  '    { userId: isHost ? "me-uuid" : "opp-uuid", username: isHost ? "alice" : "bob", role: "host" },',
  '    { userId: isHost ? "opp-uuid" : "me-uuid", username: isHost ? "bob" : "alice", role: "guest" } ] });',
  '  const S = api.state;',
  '  return { mySide: S.mySide, DARK: api.DARK, LIGHT: api.LIGHT, online: S.online,',
  '           turn: S.turn, mode: S.mode, myTurn: om.myTurn,',
  '           banner: document.getElementById("turnText").textContent };',
  '})()'
].join('\n');

(async () => {
  const srv = await serve();
  console.log('Serving ' + ROOT + ' on :' + PORT);
  const prof = path.join(os.tmpdir(), 'ax-chk-' + process.pid);
  fs.mkdirSync(prof, { recursive: true });
  const proc = spawn(CHROME, ['--remote-debugging-port=9461', '--user-data-dir=' + prof,
    '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:9461/json/version')).ok) break; } catch (e) {} await sleep(300); }
  let t = null;
  for (let i = 0; i < 40; i++) {
    const l = await (await fetch('http://127.0.0.1:9461/json/list')).json();
    t = l.find(x => x.type === 'page'); if (t && t.webSocketDebuggerUrl) break; await sleep(250);
  }
  const cdp = new CDP(t.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/games/checkers.html' });
  await sleep(3500);

  if (!await cdp.eval('!!(window.checkersApi && window.onlineMode_checkers)')) {
    console.log('NOT READY. Console:\n' + cdp.console.join('\n'));
    process.exit(1);
  }
  console.log('Checkers + CheckersOnline loaded.\n');

  console.log('1) Engine API surface');
  let r = await cdp.eval('(()=>{const a=window.checkersApi;return {missing:["applyMove","applyRemoteMove","resetGame","state","DARK","LIGHT","renderPlayers","setBanner"].filter(k=>!(k in a))};})()');
  check('all required API members exposed', r.missing.length === 0, r);

  console.log('\n2) Start as HOST (Dark, moves first)');
  r = await cdp.eval(SETUP('host'));
  check('host dealt DARK', r.mySide === r.DARK, r);
  check('online flag set on engine', r.online === true, r);
  check('mode=online so the AI scheduler stays off', r.mode === 'online', r);
  check('Dark moves first and it is our turn', r.turn === r.DARK && r.myTurn === true, r);
  check('banner shows our turn', /your turn/i.test(r.banner), r.banner);

  console.log('\n3) Our own move goes out over BOTH transports, one actionId');
  r = await cdp.eval([
    '(async()=>{',
    ' const om=window.onlineMode_checkers, api=window.checkersApi, S=api.state;',
    ' window.__sent.broadcast.length=0; window.__sent.rest.length=0;',
    ' S.turn=api.DARK; om.myTurn=true; om.gameStarted=true; S.applyingRemote=false;',
    ' const mv={from:{row:5,col:0},to:{row:4,col:1},captures:[]};',
    ' await api.applyMove(mv);',
    ' const s=window.__sent;',
    ' return { b:s.broadcast.length, r:s.rest.length,',
    '          sameId: s.broadcast[0] && s.rest[0] && s.broadcast[0].actionId===s.rest[0].actionId,',
    '          type: s.broadcast[0] && s.broadcast[0].type,',
    '          moved: !!S.board[4][1] && !S.board[5][0] };',
    '})()'
  ].join('\n'));
  check('sent once over broadcast', r.b === 1, r);
  check('sent once over REST', r.r === 1, r);
  check('both carry the same actionId', r.sameId === true, r);
  check('typed as move', r.type === 'move', r);
  check('board advanced locally', r.moved === true, r);

  console.log('\n4) THE INVARIANT: opponent move over both transports applies ONCE');
  r = await cdp.eval([
    '(async()=>{',
    ' const om=window.onlineMode_checkers, api=window.checkersApi, S=api.state;',
    ' api.resetGame("online"); S.online=true; S.mySide=api.DARK; S.turn=api.DARK;',
    ' om.gameStarted=true; window.__sent.broadcast.length=0; window.__sent.rest.length=0;',
    ' const move={from:{row:5,col:0},to:{row:4,col:1},captures:[]};',
    ' const action={type:"move",move,actionId:"opp:1"};',
    ' const before=JSON.stringify(S.board);',
    ' om.handleGameAction({action,by:"opp-uuid"});',
    ' await new Promise(x=>setTimeout(x,700));',
    ' const afterFirst=JSON.stringify(S.board);',
    ' om.handleGameAction({action,by:"opp-uuid",nextTurn:"me-uuid"});',
    ' await new Promise(x=>setTimeout(x,700));',
    ' const afterSecond=JSON.stringify(S.board);',
    ' return { changed: before!==afterFirst, idempotent: afterFirst===afterSecond,',
    '          dest: !!S.board[4][1], origin: !!S.board[5][0],',
    '          turn:S.turn, LIGHT:api.LIGHT,',
    '          echoed: window.__sent.broadcast.length };',
    '})()'
  ].join('\n'));
  check('first (broadcast) copy applied', r.changed === true, r);
  check('second (REST) copy applied ZERO extra times', r.idempotent === true, r);
  check('piece moved 5,0 -> 4,1', r.dest === true && r.origin === false, r);
  check('turn passed to the other side', r.turn === r.LIGHT, r);
  check('replaying a remote move does NOT echo it back', r.echoed === 0, r);

  console.log('\n5) Start as GUEST (Light, does not move first)');
  r = await cdp.eval(SETUP('guest'));
  check('guest dealt LIGHT', r.mySide === r.LIGHT, r);
  check('guest does not move first', r.myTurn === false, r);
  check('Dark still moves first', r.turn === r.DARK, r);

  console.log('\n================ RESULT ================');
  console.log('passed: ' + pass + '   failed: ' + fail);
  const errs = cdp.console.filter(l => l.startsWith('[EXCEPTION]') || l.startsWith('[error]'));
  if (errs.length) console.log('\nPage errors:\n' + errs.slice(0, 8).join('\n'));
  try { proc.kill(); } catch (e) {}
  srv.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
