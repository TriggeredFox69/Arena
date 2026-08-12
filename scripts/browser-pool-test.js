/* ==========================================================================
   ArenaX — REAL BROWSER end-to-end test for 8-ball pool online.

   Launches TWO isolated Chrome instances (separate user-data-dirs so each has
   its own localStorage/session), logs each in as a different test user, drives
   the actual UI (Play Online -> Find Opponent -> Ready), fires a real shot on
   the host by dispatching real mouse events at the canvas, and then reports
   the FULL turn state of BOTH clients plus every console message.

   This is the thing all the node-only tests could not do: observe what the
   browser actually executes.

   Usage: node scripts/browser-pool-test.js
   ========================================================================== */

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:5000/api';
const PAGE = 'http://localhost:5000/games/8ball-pool.html';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- minimal CDP client over the built-in WebSocket ----------
class CDP {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label;
    this.id = 0;
    this.pending = new Map();
    this.console = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error('ws error ' + this.label));
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
          return;
        }
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = (msg.params.args || [])
            .map(a => a.value !== undefined ? String(a.value)
                    : a.description !== undefined ? a.description
                    : (a.preview ? JSON.stringify(a.preview.properties?.map(p => p.name + ':' + p.value)) : a.type))
            .join(' ');
          this.console.push(`[${msg.params.type}] ${text}`);
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails;
          this.console.push(`[EXCEPTION] ${d.text} ${d.exception?.description || ''}`);
        }
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' timed out')); }
      }, 30000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) {
      throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function launchChrome(port, profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const proc = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--headless=new',
    '--window-size=1400,900',
    'about:blank'
  ], { stdio: 'ignore', detached: false });

  // wait for the debug endpoint
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return proc;
    } catch (e) { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('Chrome did not expose debug port ' + port);
}

async function firstPageTarget(port) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    if (page && page.webSocketDebuggerUrl) return page;
    await sleep(250);
  }
  throw new Error('no page target on ' + port);
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const d = await res.json();
  const token = d.token || d.data?.token;
  const user = d.user || d.data?.user;
  if (!token) throw new Error('login failed for ' + email + ': ' + JSON.stringify(d));
  return { token, user };
}

async function setupClient(port, profile, creds, label) {
  const proc = await launchChrome(port, profile);
  const target = await firstPageTarget(port);
  const cdp = new CDP(target.webSocketDebuggerUrl, label);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');

  // Land on the origin so localStorage is writable, seed auth, then reload.
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(2500);
  await cdp.eval(`
    localStorage.setItem('arenax_token', ${JSON.stringify(creds.token)});
    localStorage.setItem('arenax_user', ${JSON.stringify(JSON.stringify({ ...creds.user, token: creds.token }))});
    'seeded'
  `);
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(3000);
  cdp.console.length = 0; // drop pre-login noise
  return { proc, cdp };
}

function stateExpr() {
  return `(() => {
    const g = window.game, o = window.onlineMode_8ballpool;
    if (!g) return { error: 'window.game missing' };
    return {
      online: g.online,
      myPlayerNumber: g.myPlayerNumber,
      currentPlayer: g.currentPlayer,
      gameStarted: g.gameStarted,
      gameOver: g.gameOver,
      isShooting: g.isShooting,
      isRemoteShot: g.isRemoteShot,
      myShotInFlight: g.myShotInFlight,
      cueStriking: g.cueStriking,
      ballInHand: g.ballInHand,
      tableSettling: g.tableSettling,
      turnResolved: g.turnResolved,
      anyBallMoving: g.anyBallMoving ? g.anyBallMoving() : null,
      canAim: g.canAim ? g.canAim() : null,
      boardVisible: !document.getElementById('gameBoard').classList.contains('hidden'),
      p1Name: document.getElementById('player1Name')?.textContent,
      p2Name: document.getElementById('player2Name')?.textContent,
      // online-mode / transport state
      om_role: o?.role, om_gameStarted: o?.gameStarted, om_roomCode: o?.roomCode,
      om_myPlayerNumber: o?.myPlayerNumber,
      sc_connected: window.socketClient?.connected,
      sc_hasSupabase: !!window.socketClient?.supabase,
      sc_hasChannel: !!window.socketClient?.channel,
      sc_channelState: window.socketClient?.channel?.state,
      sc_userId: window.socketClient?.userId
    };
  })()`;
}

async function main() {
  console.log('=== Logging in both users via API ===');
  const c1 = await login('chesstester1@test.local', 'Test1234!');
  const c2 = await login('chesstester2@test.local', 'Test1234!');
  console.log('P1:', c1.user?.username, '| P2:', c2.user?.username);

  // clear stale queue state
  for (const t of [c1.token, c2.token]) {
    await fetch(`${API}/matchmaking/leave`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: '{}'
    });
  }

  const base = path.join(os.tmpdir(), 'arenax-cdp-' + process.pid);
  console.log('\n=== Launching two isolated Chrome instances ===');
  const A = await setupClient(9411, path.join(base, 'a'), c1, 'HOST');
  const B = await setupClient(9412, path.join(base, 'b'), c2, 'GUEST');
  console.log('Both browsers ready.');

  console.log('\n=== Both click Play Online -> Find Opponent ===');
  const openOnline = `(() => {
    const btn = [...document.querySelectorAll('[data-mode]')].find(b => b.getAttribute('data-mode') === 'online');
    if (!btn) return 'no online button';
    btn.click();
    return 'clicked online';
  })()`;
  console.log('HOST :', await A.cdp.eval(openOnline));
  console.log('GUEST:', await B.cdp.eval(openOnline));
  await sleep(1200);

  const findOpp = `(() => {
    const b = [...document.querySelectorAll('#onlineModal button')].find(x => /Find Opponent/i.test(x.textContent));
    if (!b) return 'no find-opponent button';
    b.click(); return 'clicked find';
  })()`;
  console.log('HOST :', await A.cdp.eval(findOpp));
  await sleep(1500);
  console.log('GUEST:', await B.cdp.eval(findOpp));

  console.log('\n=== Waiting for match + clicking Ready on both ===');
  await sleep(4000);
  const clickReady = `(() => {
    const b = document.getElementById('readyBtn_8ball-pool');
    if (!b) return 'no ready button';
    if (b.style.display === 'none') return 'ready button hidden';
    b.click(); return 'clicked ready';
  })()`;
  console.log('HOST :', await A.cdp.eval(clickReady));
  await sleep(2500);
  const guestSeesHostReady = await B.cdp.eval(`(() => {
    const el = document.getElementById('waitingHostStatus_8ball-pool');
    const o = window.onlineMode_8ballpool;
    return el ? {
      text: el.textContent, ready: el.classList.contains('ready'),
      roomCode: o?.roomCode, pollActive: !!o?._readyPoll,
      gameStartedState: o?.gameStarted,
      hostReadyState: o?._hostReady, guestReadyState: o?._guestReady
    } : null;
  })()`);
  console.log('GUEST sees host ready:', guestSeesHostReady);
  if (!guestSeesHostReady?.ready) {
    const directSync = await B.cdp.eval(`window.onlineMode_8ballpool.apiCall(
      '/rooms/sync?code=' + window.onlineMode_8ballpool.roomCode, 'GET'
    )`);
    console.log('GUEST direct lobby sync:', directSync);
    console.log('GUEST console before ready assertion:\n' + B.cdp.console.join('\n'));
    throw new Error('Guest did not receive host ready state');
  }
  console.log('GUEST:', await B.cdp.eval(clickReady));

  console.log('\n=== Waiting for game start ===');
  await sleep(6000);

  let sa = await A.cdp.eval(stateExpr());
  let sb = await B.cdp.eval(stateExpr());
  console.log('\n--- HOST state after start ---');  console.log(sa);
  console.log('\n--- GUEST state after start ---'); console.log(sb);

  if (!sa.boardVisible || !sb.boardVisible) {
    console.log('\n*** Game did not start on both clients. Console dump: ***');
    console.log('HOST console:\n' + A.cdp.console.join('\n'));
    console.log('GUEST console:\n' + B.cdp.console.join('\n'));
    process.exit(2);
  }

  // Identify who has the turn and fire a real shot from that client.
  const shooter = sa.currentPlayer === sa.myPlayerNumber ? A : B;
  const shooterName = shooter === A ? 'HOST' : 'GUEST';
  console.log(`\n=== Firing a REAL shot from ${shooterName} (currentPlayer=${sa.currentPlayer}) ===`);

  // Real pointer events on the canvas: aim, hold to charge, release.
  const canvasRect = await shooter.cdp.eval(`(() => {
    const c = document.getElementById('poolCanvas'); const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  const cx = Math.round(canvasRect.x + canvasRect.w * 0.35);
  const cy = Math.round(canvasRect.y + canvasRect.h * 0.5);

  await shooter.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, buttons: 0 });
  await shooter.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(900); // hold to charge power
  await shooter.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 0 });

  console.log('Shot fired. Waiting 10s for physics + turn handoff...');
  await sleep(10000);

  sa = await A.cdp.eval(stateExpr());
  sb = await B.cdp.eval(stateExpr());
  console.log('\n--- HOST state AFTER SHOT ---');  console.log(sa);
  console.log('\n--- GUEST state AFTER SHOT ---'); console.log(sb);

  // Exercise ball-in-hand ownership and durable placement synchronization on
  // whichever client owns the current turn after the shot.
  const owner = sa.currentPlayer === sa.myPlayerNumber ? A : B;
  const watcher = owner === A ? B : A;
  const ownerPlayer = owner === A ? sa.myPlayerNumber : sb.myPlayerNumber;
  await watcher.cdp.eval(`(() => {
    game.currentPlayer = ${ownerPlayer};
    game.setBallInHandFor(${ownerPlayer});
    return game.hasBallInHandControl();
  })()`);
  const watcherCanPlace = await watcher.cdp.eval('game.hasBallInHandControl()');
  const ownerCanPlace = await owner.cdp.eval(`(() => {
    game.currentPlayer = ${ownerPlayer};
    game.setBallInHandFor(${ownerPlayer});
    return game.hasBallInHandControl();
  })()`);
  if (watcherCanPlace || !ownerCanPlace) throw new Error('Ball-in-hand ownership guard failed');
  await owner.cdp.eval('game.placeCueBallAt({ x: 260, y: 260 })');
  await sleep(2500);
  const watcherPlacement = await watcher.cdp.eval(`({
    x: Math.round(game.cueBall.x), y: Math.round(game.cueBall.y),
    ballInHand: game.ballInHand, canPlace: game.hasBallInHandControl()
  })`);
  console.log('Ball-in-hand watcher state:', watcherPlacement);
  if (watcherPlacement.x !== 260 || watcherPlacement.y !== 260 || watcherPlacement.ballInHand) {
    throw new Error('Cue-ball placement did not synchronize');
  }

  console.log('\n================ HOST CONSOLE ================');
  console.log(A.cdp.console.join('\n') || '(empty)');
  console.log('\n================ GUEST CONSOLE ===============');
  console.log(B.cdp.console.join('\n') || '(empty)');

  console.log('\n================ VERDICT ================');
  const hostCanPlay  = sa.currentPlayer === sa.myPlayerNumber;
  const guestCanPlay = sb.currentPlayer === sb.myPlayerNumber;
  console.log('HOST  currentPlayer/my:', sa.currentPlayer + '/' + sa.myPlayerNumber, '| canAim:', sa.canAim);
  console.log('GUEST currentPlayer/my:', sb.currentPlayer + '/' + sb.myPlayerNumber, '| canAim:', sb.canAim);
  if (sa.currentPlayer !== sb.currentPlayer) {
    console.log('\n*** DESYNC: the two clients disagree on whose turn it is. ***');
  } else if (!hostCanPlay && !guestCanPlay) {
    console.log('\n*** FROZEN: neither client can aim. ***');
  } else if (hostCanPlay || guestCanPlay) {
    console.log('\nOK: exactly one side has the turn and can aim:', hostCanPlay ? 'HOST' : 'GUEST');
  }

  try { A.proc.kill(); } catch (e) {}
  try { B.proc.kill(); } catch (e) {}
  process.exit(0);
}

main().catch(async (e) => { console.error('FATAL:', e); process.exit(1); });
