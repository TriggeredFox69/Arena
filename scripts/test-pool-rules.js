/* ==========================================================================
   ArenaX — 8-ball RULES test, run against the real pool-game.js /
   pool-online.js in a real browser (no Supabase / no auth needed: these are
   pure rule-engine assertions).

   Covers the reported bug and its neighbours:
     1. Group assignment gives BOTH players a type (the reported defect: the
        watching client used to set only the shooter's, stranding the other
        player on "Yet to decide" and returning 7 from
        getPlayerBallsRemaining()).
     2. The remote-apply path produces byte-identical group state to the
        shooter's local path.
     3. Potting on the break keeps the breaker's turn and leaves the table open.
     4. Potting your own group keeps the turn; potting the opponent's passes it.
     5. A scratch is a foul and hands ball-in-hand to the opponent.
     6. Potting the 8 early loses; potting it after clearing your group wins.

   Usage: node scripts/test-pool-rules.js
   ========================================================================== */

const http = require('http');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5077;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};

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
        // Stub the API so page bootstrap never hangs on a missing backend.
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

// Put the table into a controlled state, then resolve one shot.
// pocket: array of ball numbers to mark pocketed by this shot.
const SCENARIO = (opts) => `(() => {
  const g = window.game;
  const o = ${JSON.stringify(opts)};

  // --- deterministic table state ---
  g.gameOver = false; g.gameStarted = true; g.turnResolved = false;
  g.online = !!o.online; g.myPlayerNumber = o.myPlayerNumber || null;
  g.gameMode = o.online ? 'online' : 'player';
  g.initBalls();
  g.firstBallType = o.firstBallType || null;
  g.player1Type = o.player1Type || null;
  g.player2Type = o.player2Type || null;
  g.currentPlayer = o.shooter;
  g.lastShooter = o.shooter;
  g.myShotInFlight = true;          // pretend WE fired it
  g.breakShot = !!o.breakShot;
  g.ballInHand = false; g.ballInHandPlayer = null;
  g.cueBall.isPocketed = !!o.scratch;

  // --- simulate the shot's tracking record ---
  g.shotActive = true;
  g.shotPocketed = [];
  (o.pocket || []).forEach(n => {
    const b = g.balls.find(x => x.number === n);
    if (b) { b.isPocketed = true; g.shotPocketed.push(b); }
  });
  if (o.scratch) g.shotPocketed.push(g.cueBall);
  // pre-clear a player's group if the scenario needs it
  (o.alsoPocketed || []).forEach(n => {
    const b = g.balls.find(x => x.number === n);
    if (b) b.isPocketed = true;
  });
  g.firstHitBall = o.firstHit !== undefined
    ? g.balls.find(x => x.number === o.firstHit)
    : g.balls.find(x => x.number === (o.breakShot ? 1 : ((o.pocket && o.pocket[0]) || 1)));
  g.anyCushion = o.anyCushion !== undefined ? o.anyCushion : true;
  g.cushionHitBalls = new Set(o.cushionHitBalls || [1,2,3,4]);

  // capture what gets reported to the opponent
  let reported = null;
  window.onlineMode_8ballpool = window.onlineMode_8ballpool || {};
  window.onlineMode_8ballpool.reportShotResult = (r) => { reported = r; };

  g.handleTurnEnd();

  return {
    currentPlayer: g.currentPlayer,
    player1Type: g.player1Type,
    player2Type: g.player2Type,
    firstBallType: g.firstBallType,
    ballInHand: g.ballInHand,
    ballInHandPlayer: g.ballInHandPlayer,
    gameOver: g.gameOver,
    p1Label: document.getElementById('player1Type').textContent,
    p2Label: document.getElementById('player2Type').textContent,
    p1Remaining: g.getPlayerBallsRemaining(1),
    p2Remaining: g.getPlayerBallsRemaining(2),
    reported
  };
})()`;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

async function main() {
  const srv = await serve();
  console.log('Serving ' + ROOT + ' on :' + PORT);

  const profile = path.join(os.tmpdir(), 'arenax-rules-' + process.pid);
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, ['--remote-debugging-port=9441', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:9441/json/version')).ok) break; } catch (e) {} await sleep(300); }
  let t = null;
  for (let i = 0; i < 40; i++) {
    const l = await (await fetch('http://127.0.0.1:9441/json/list')).json();
    t = l.find(x => x.type === 'page'); if (t?.webSocketDebuggerUrl) break; await sleep(250);
  }
  const cdp = new CDP(t.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/games/8ball-pool.html` });
  await sleep(3500);

  const ready = await cdp.eval(`!!(window.game && window.game.initBalls && window.game.setGroups)`);
  if (!ready) {
    console.log('Page/game not ready. Console:\n' + cdp.console.join('\n'));
    process.exit(1);
  }
  console.log('Game engine loaded.\n');

  // ---------------------------------------------------------------- 1
  console.log('1) setGroups() assigns BOTH players a group');
  let r = await cdp.eval(`(() => {
    const g = window.game;
    g.player1Type = null; g.player2Type = null; g.firstBallType = null; g.online = false;
    g.setGroups(1, 'solids');
    const a = { p1: g.player1Type, p2: g.player2Type, first: g.firstBallType };
    g.player1Type = null; g.player2Type = null; g.firstBallType = null;
    g.setGroups(2, 'stripes');
    const b = { p1: g.player1Type, p2: g.player2Type, first: g.firstBallType };
    return { a, b };
  })()`);
  check('P1 takes solids -> P2 gets stripes', r.a.p1 === 'solids' && r.a.p2 === 'stripes', r.a);
  check('P2 takes stripes -> P1 gets solids', r.b.p2 === 'stripes' && r.b.p1 === 'solids', r.b);

  // ---------------------------------------------------------------- 2
  console.log('\n2) THE REPORTED BUG: watcher applying a remote group assignment');
  r = await cdp.eval(`(() => {
    const g = window.game;
    g.player1Type = null; g.player2Type = null; g.firstBallType = null;
    g.online = true; g.myPlayerNumber = 2;   // we are the GUEST / watcher
    g.balls.forEach(b => b.isPocketed = false);
    // exactly what the host sends after claiming solids
    window.onlineMode_8ballpool.applyRemoteTurnResult({
      assignedType: { player: 1, type: 'solids' },
      nextTurn: 2, keepTurn: false, ballInHand: false,
      finalBalls: g.balls.map(b => ({ number: b.number, x: b.x, y: b.y, isPocketed: false }))
    });
    return {
      p1: g.player1Type, p2: g.player2Type, first: g.firstBallType,
      p1Label: document.getElementById('player1Type').textContent,
      p2Label: document.getElementById('player2Type').textContent,
      p1Remaining: g.getPlayerBallsRemaining(1),
      p2Remaining: g.getPlayerBallsRemaining(2)
    };
  })()`);
  check('watcher: host got solids', r.p1 === 'solids', r);
  check('watcher: OTHER player got stripes (was null before fix)', r.p2 === 'stripes', r);
  check('watcher: no label stuck on "Yet to decide"',
    r.p1Label !== 'Yet to decide' && r.p2Label !== 'Yet to decide', { p1: r.p1Label, p2: r.p2Label });
  check('watcher: getPlayerBallsRemaining real 7/7 (not the null-type fallback, '
    + 'and proves stripes=9-15 so both groups have 7 balls)',
    r.p1Remaining === 7 && r.p2Remaining === 7, r);

  // ---------------------------------------------------------------- 3
  console.log('\n3) Potting on the break keeps the turn and leaves the table open');
  r = await cdp.eval(SCENARIO({ shooter: 1, online: true, myPlayerNumber: 1, breakShot: true, pocket: [3], firstHit: 1, cushionHitBalls: [1,2,3,4] }));
  check('breaker keeps the turn', r.currentPlayer === 1, r);
  check('table stays open (no group assigned on the break)',
    r.firstBallType === null && r.player1Type === null && r.player2Type === null, r);
  check('reported keepTurn=true to opponent', r.reported && r.reported.keepTurn === true, r.reported);

  // ---------------------------------------------------------------- 4
  console.log('\n4) Group assignment on the first pot after the break');
  r = await cdp.eval(SCENARIO({ shooter: 1, online: true, myPlayerNumber: 1, breakShot: false, pocket: [2], firstHit: 2 }));
  check('shooter claims solids (ball 2)', r.player1Type === 'solids', r);
  check('opponent gets stripes', r.player2Type === 'stripes', r);
  check('shooter keeps the turn', r.currentPlayer === 1, r);
  check('assignedType reported for the opponent to mirror',
    r.reported && r.reported.assignedType && r.reported.assignedType.player === 1
      && r.reported.assignedType.type === 'solids', r.reported);

  // ---------------------------------------------------------------- 5
  console.log('\n5) Potting your own group keeps the turn; opponent\'s passes it');
  r = await cdp.eval(SCENARIO({ shooter: 1, player1Type: 'solids', player2Type: 'stripes',
    firstBallType: 'solids', pocket: [4], firstHit: 4 }));
  check('potting own solid keeps the turn', r.currentPlayer === 1, r);

  r = await cdp.eval(SCENARIO({ shooter: 1, player1Type: 'solids', player2Type: 'stripes',
    firstBallType: 'solids', pocket: [11], firstHit: 11 }));
  check('hitting opponent\'s ball first is a foul -> turn passes', r.currentPlayer === 2, r);
  check('foul gives opponent ball-in-hand', r.ballInHand === true && r.ballInHandPlayer === 2, r);

  // ---------------------------------------------------------------- 6
  console.log('\n6) Scratch is a foul with ball-in-hand for the opponent');
  r = await cdp.eval(SCENARIO({ shooter: 1, player1Type: 'solids', player2Type: 'stripes',
    firstBallType: 'solids', pocket: [4], firstHit: 4, scratch: true }));
  check('scratch passes the turn', r.currentPlayer === 2, r);
  check('scratch grants ball-in-hand to opponent', r.ballInHand === true && r.ballInHandPlayer === 2, r);

  // ---------------------------------------------------------------- 7
  console.log('\n7) The 8-ball');
  r = await cdp.eval(SCENARIO({ shooter: 1, online: true, myPlayerNumber: 1, player1Type: 'solids', player2Type: 'stripes',
    firstBallType: 'solids', pocket: [8], firstHit: 8 }));
  check('8 potted with group NOT cleared -> game over, shooter loses',
    r.gameOver === true && r.reported && r.reported.winner === 2, r);

  r = await cdp.eval(SCENARIO({ shooter: 1, online: true, myPlayerNumber: 1, player1Type: 'solids', player2Type: 'stripes',
    firstBallType: 'solids', alsoPocketed: [1,2,3,4,5,6,7], pocket: [8], firstHit: 8 }));
  check('8 potted after clearing solids -> shooter wins',
    r.gameOver === true && r.reported && r.reported.winner === 1, r);

  console.log('\n================ RESULT ================');
  console.log('passed: ' + pass + '   failed: ' + fail);
  const errs = cdp.console.filter(l => l.startsWith('[EXCEPTION]') || l.startsWith('[error]'));
  if (errs.length) { console.log('\nPage errors:\n' + errs.join('\n')); }

  try { proc.kill(); } catch (e) {}
  srv.close();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
