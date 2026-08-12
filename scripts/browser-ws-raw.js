/* ==========================================================================
   ArenaX — is the Realtime WebSocket failure a supabase-js config problem, or
   is outbound wss:// simply blocked in this environment?

   Opens a RAW WebSocket to the exact Supabase Realtime endpoint from
   (a) node and (b) the browser, and compares.

   Usage: node scripts/browser-ws-raw.js
   ========================================================================== */

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'http://localhost:5000/games/8ball-pool.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SUPA_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const WS_URL = SUPA_URL.replace(/^https/, 'wss') + `/realtime/v1/websocket?apikey=${ANON}&vsn=1.0.0`;

class CDP {
  constructor(u) { this.u = u; this.id = 0; this.p = new Map(); }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.u);
      this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws'));
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.p.has(m.id)) { const q = this.p.get(m.id); this.p.delete(m.id); m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result); }
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error(method + ' timeout')); } }, 60000);
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

async function nodeTest() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(WS_URL);
    const done = (r) => { try { ws.close(); } catch (e) {} resolve(r); };
    ws.onopen = () => done({ result: 'OPEN', ms: Date.now() - t0 });
    ws.onerror = (e) => done({ result: 'ERROR', ms: Date.now() - t0, detail: e.message || 'error event' });
    ws.onclose = (e) => done({ result: 'CLOSED', code: e.code, reason: e.reason, ms: Date.now() - t0 });
    setTimeout(() => done({ result: 'TIMEOUT_15s' }), 15000);
  });
}

async function main() {
  console.log('WS endpoint:', WS_URL.replace(ANON, '<anon-key>'));

  console.log('\n=== (a) RAW WebSocket from NODE ===');
  console.log(await nodeTest());

  const profile = path.join(os.tmpdir(), 'arenax-wsraw-' + process.pid);
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, ['--remote-debugging-port=9431', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:9431/json/version')).ok) break; } catch (e) {} await sleep(300); }
  let target = null;
  for (let i = 0; i < 40; i++) {
    const l = await (await fetch('http://127.0.0.1:9431/json/list')).json();
    target = l.find(t => t.type === 'page'); if (target?.webSocketDebuggerUrl) break; await sleep(250);
  }
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(3000);

  console.log('\n=== (b) RAW WebSocket from the BROWSER (same URL) ===');
  console.log(await cdp.eval(`(() => new Promise((resolve) => {
    const t0 = Date.now();
    let ws;
    try { ws = new WebSocket(${JSON.stringify(WS_URL)}); }
    catch (e) { return resolve({ result: 'CONSTRUCTOR_THREW', detail: String(e) }); }
    const done = (r) => { try { ws.close(); } catch(e){} resolve(r); };
    ws.onopen  = () => done({ result: 'OPEN', ms: Date.now() - t0 });
    ws.onerror = () => done({ result: 'ERROR', ms: Date.now() - t0, readyState: ws.readyState });
    ws.onclose = (e) => done({ result: 'CLOSED', code: e.code, reason: e.reason, wasClean: e.wasClean, ms: Date.now() - t0 });
    setTimeout(() => done({ result: 'TIMEOUT_15s', readyState: ws.readyState }), 15000);
  }))()`));

  console.log('\n=== (c) plain HTTPS fetch to Supabase from the BROWSER (control) ===');
  console.log(await cdp.eval(`(async () => {
    try {
      const r = await fetch(${JSON.stringify(SUPA_URL)} + '/rest/v1/', { headers: { apikey: ${JSON.stringify(ANON)} } });
      return { ok: r.ok, status: r.status };
    } catch (e) { return { fetchError: String(e) }; }
  })()`));

  try { proc.kill(); } catch (e) {}
  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
