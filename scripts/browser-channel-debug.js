/* ==========================================================================
   ArenaX — why does the Supabase Realtime channel end up 'errored' in the
   BROWSER when the identical subscription works from node?

   Creates channels in-page and reports the exact subscribe() status + error
   payload for each configuration, isolating which binding is at fault.

   Usage: node scripts/browser-channel-debug.js
   ========================================================================== */

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'http://localhost:5000/games/8ball-pool.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.console = []; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('ws err'));
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id);
          m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
          return;
        }
        if (m.method === 'Runtime.consoleAPICalled') {
          this.console.push('[' + m.params.type + '] ' + (m.params.args || [])
            .map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
        }
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(method + ' timeout')); } }, 60000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

async function main() {
  const profile = path.join(os.tmpdir(), 'arenax-chdbg-' + process.pid);
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    '--remote-debugging-port=9421', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:9421/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(300);
  }
  console.log('Chrome:', ver['Browser']);

  let target = null;
  for (let i = 0; i < 40; i++) {
    const l = await (await fetch('http://127.0.0.1:9421/json/list')).json();
    target = l.find(t => t.type === 'page');
    if (target?.webSocketDebuggerUrl) break;
    await sleep(250);
  }
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(3500);

  console.log('\n=== supabase-js version loaded in the browser ===');
  console.log(await cdp.eval(`(async () => {
    const c = await window.ARENAX_CONFIG.getSupabaseClient();
    return {
      hasClient: !!c,
      libVersion: (window.supabase && window.supabase.version) || 'unknown',
      realtimeUrl: c.realtime && c.realtime.endPoint,
      accessToken: c.realtime && typeof c.realtime.accessToken
    };
  })()`));

  // Test each binding type in isolation to find the culprit.
  const probe = (label, setup) => `(async () => {
    const c = await window.ARENAX_CONFIG.getSupabaseClient();
    const ch = c.channel('probe-${label}-' + Date.now(), { config: { broadcast: { self: true } } });
    ${setup}
    return await new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve({ status: 'TIMEOUT_15s', state: ch.state }); } }, 15000);
      ch.subscribe((status, err) => {
        if (done) return;
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          done = true; clearTimeout(t);
          resolve({
            status,
            state: ch.state,
            error: err ? (err.message || String(err)) : null,
            errorJson: err ? JSON.stringify(err, Object.getOwnPropertyNames(err)) : null
          });
        }
      });
    });
  })()`;

  console.log('\n=== A) broadcast only ===');
  console.log(await cdp.eval(probe('bcast', `ch.on('broadcast', { event: 'x' }, () => {});`)));

  console.log('\n=== B) presence only ===');
  console.log(await cdp.eval(probe('pres', `ch.on('presence', { event: 'sync' }, () => {});`)));

  console.log('\n=== C) postgres_changes only (room_events, no filter) ===');
  console.log(await cdp.eval(probe('pgAll', `
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_events' }, () => {});
  `)));

  console.log('\n=== D) postgres_changes WITH room_id filter (what joinGame does) ===');
  console.log(await cdp.eval(probe('pgFilt', `
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_events', filter: 'room_id=eq.00000000-0000-0000-0000-000000000000' }, () => {});
  `)));

  console.log('\n=== E) EXACT joinGame combo (broadcast + presence + postgres_changes) ===');
  console.log(await cdp.eval(probe('combo', `
    ch.on('broadcast', { event: 'game:action' }, () => {});
    ch.on('broadcast', { event: 'game:sync' }, () => {});
    ch.on('presence', { event: 'sync' }, () => {});
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_events', filter: 'room_id=eq.00000000-0000-0000-0000-000000000000' }, () => {});
  `)));

  console.log('\n=== Browser console during probes ===');
  console.log(cdp.console.join('\n') || '(empty)');

  try { proc.kill(); } catch (e) {}
  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
